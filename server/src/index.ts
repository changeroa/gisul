#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { Request, Response } from "express";
import { z } from "zod";

const DEFAULT_ROOT = path.join(homedir(), "gisul");
const ROOT_DIR = path.resolve(process.env.SKILLPACK_ROOT ?? DEFAULT_ROOT);
const DEFAULT_SKILL_ROOTS = [
  { id: "gisul", dir: path.join(ROOT_DIR, "skills") },
  { id: "skillpack", dir: path.join(homedir(), "skillpack", "skills") },
  { id: "codex", dir: path.join(homedir(), ".codex", "skills") },
  { id: "agents", dir: path.join(homedir(), ".agents", "skills") },
];
const SKILL_ROOTS = (process.env.SKILLPACK_SKILLS_DIRS
  ? process.env.SKILLPACK_SKILLS_DIRS.split(path.delimiter)
      .filter(Boolean)
      .map((dir, index) => ({ id: `root${index}`, dir }))
  : DEFAULT_SKILL_ROOTS
).map((root) => ({
  id: root.id,
  dir: path.resolve(root.dir),
}));
const MAX_RESOURCE_BYTES = 1024 * 1024;
const SKILL_URI_AUTHORITY = process.env.SKILLPACK_URI_AUTHORITY ?? "gisul";
const DEFAULT_HTTP_PORT = 8788;
const STATE_DIR = path.resolve(process.env.SKILLPACK_STATE_DIR ?? path.join(homedir(), ".config", "skillpack-mcp"));
const TOKEN_REQUESTS_FILE = path.resolve(process.env.SKILLPACK_TOKEN_REQUESTS_FILE ?? path.join(STATE_DIR, "token-requests.json"));
const TOKENS_FILE = path.resolve(process.env.SKILLPACK_TOKENS_FILE ?? path.join(STATE_DIR, "tokens.json"));
const ADMIN_TOKEN_FILE = path.resolve(process.env.SKILLPACK_ADMIN_TOKEN_FILE ?? path.join(STATE_DIR, "admin-token"));

type SkillSummary = {
  name: string;
  source: string;
  description: string;
  uri: string;
  path: string;
  sha256: string;
  resources: string[];
};

type SkillRecord = {
  source: string;
  dirName: string;
  rootDir: string;
};

type TokenRequestStatus = "pending" | "approved" | "denied" | "delivered";

type TokenRequestRecord = {
  id: string;
  claimHash: string;
  status: TokenRequestStatus;
  label: string;
  note: string;
  requester: string;
  createdAt: string;
  approvedAt?: string;
  deniedAt?: string;
  deliveredAt?: string;
  tokenId?: string;
  tokenPlaintext?: string;
};

type IssuedTokenRecord = {
  id: string;
  tokenHash: string;
  prefix: string;
  label: string;
  note: string;
  requestId?: string;
  requester?: string;
  createdAt: string;
  revokedAt?: string;
};

type TokenStore = {
  tokens: IssuedTokenRecord[];
};

type TokenRequestStore = {
  requests: TokenRequestRecord[];
};

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(prefix = ""): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function equalSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function getRequester(req: Request): string {
  const forwardedFor = req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "";
  return Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor).split(",")[0].trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

async function readTokenStore(): Promise<TokenStore> {
  const store = await readJsonFile<TokenStore>(TOKENS_FILE, { tokens: [] });
  return { tokens: Array.isArray(store.tokens) ? store.tokens : [] };
}

async function writeTokenStore(store: TokenStore): Promise<void> {
  await writeJsonFile(TOKENS_FILE, store);
}

async function readTokenRequestStore(): Promise<TokenRequestStore> {
  const store = await readJsonFile<TokenRequestStore>(TOKEN_REQUESTS_FILE, { requests: [] });
  return { requests: Array.isArray(store.requests) ? store.requests : [] };
}

async function writeTokenRequestStore(store: TokenRequestStore): Promise<void> {
  await writeJsonFile(TOKEN_REQUESTS_FILE, store);
}

function parseFrontmatter(markdown: string): Record<string, string> {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return {};

  const result: Record<string, string> = {};
  for (const line of markdown.slice(4, end).split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return result;
}

function assertSkillName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
  return name;
}

function normalizeRelativePath(value: string | undefined): string {
  if (!value || value === "/") return "SKILL.md";
  if (value.includes("\0")) throw new Error("Resource path contains a NUL byte");

  const normalized = path.posix.normalize(value.replace(/^\/+/, ""));
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Resource path escapes the skill directory: ${value}`);
  }
  return normalized;
}

function parseSkillUri(uri: string): { record: SkillRecord; relativePath: string } {
  const parsed = new URL(uri);
  if (parsed.protocol !== "skill:") {
    throw new Error(`Unsupported resource URI protocol: ${parsed.protocol}`);
  }

  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const source = assertSkillName(parts[0] ?? "");
  const dirName = assertSkillName(parts[1] ?? "");
  const relativePath = normalizeRelativePath(parts.slice(2).join("/"));
  const rootDir = SKILL_ROOTS.find((root) => root.id === source)?.dir;
  if (!rootDir) throw new Error(`Unknown skill source: ${source}`);

  return { record: { source, dirName, rootDir }, relativePath };
}

async function readSkillMarkdown(record: SkillRecord): Promise<{ markdown: string; filePath: string }> {
  const safeName = assertSkillName(record.dirName);
  const filePath = path.join(record.rootDir, safeName, "SKILL.md");
  const markdown = await readFile(filePath, "utf8");
  return { markdown, filePath };
}

async function readSkillResource(record: SkillRecord, relativePathInput?: string): Promise<{ text: string; filePath: string }> {
  const safeName = assertSkillName(record.dirName);
  const relativePath = normalizeRelativePath(relativePathInput);
  const baseDir = path.join(record.rootDir, safeName);
  const filePath = path.resolve(baseDir, relativePath);
  const relativeToBase = path.relative(baseDir, filePath);

  if (relativeToBase.startsWith("..") || path.isAbsolute(relativeToBase)) {
    throw new Error(`Resource path escapes the skill directory: ${relativePathInput}`);
  }

  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`Resource is not a file: ${relativePath}`);
  if (info.size > MAX_RESOURCE_BYTES) {
    throw new Error(`Resource exceeds ${MAX_RESOURCE_BYTES} bytes: ${relativePath}`);
  }

  return { text: await readFile(filePath, "utf8"), filePath };
}

async function listResourceUris(record: SkillRecord): Promise<string[]> {
  const safeName = assertSkillName(record.dirName);
  const baseDir = path.join(record.rootDir, safeName);
  const output: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const nextPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relative = path.relative(baseDir, nextPath).split(path.sep).join("/");
      output.push(
        `skill://${SKILL_URI_AUTHORITY}/${encodeURIComponent(record.source)}/${encodeURIComponent(safeName)}/${relative
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
      );
    }
  }

  await walk(baseDir);
  return output.sort();
}

async function listSkills(query?: string): Promise<SkillSummary[]> {
  const normalizedQuery = query?.trim().toLowerCase();
  const skills: SkillSummary[] = [];

  for (const root of SKILL_ROOTS) {
    let entries;
    try {
      entries = await readdir(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const record: SkillRecord = { source: root.id, dirName: entry.name, rootDir: root.dir };

      try {
        const { markdown, filePath } = await readSkillMarkdown(record);
        const frontmatter = parseFrontmatter(markdown);
        const name = frontmatter.name || entry.name;
        const description = frontmatter.description || "";

        if (
          normalizedQuery &&
          !name.toLowerCase().includes(normalizedQuery) &&
          !description.toLowerCase().includes(normalizedQuery)
        ) {
          continue;
        }

        skills.push({
          name,
          source: root.id,
          description,
          uri: `skill://${SKILL_URI_AUTHORITY}/${encodeURIComponent(root.id)}/${encodeURIComponent(entry.name)}`,
          path: filePath,
          sha256: hashText(markdown),
          resources: await listResourceUris(record),
        });
      } catch {
        continue;
      }
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function asJsonText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function registerSkillpackTools(server: McpServer): void {
  server.registerTool(
    "skills_list",
    {
      title: "List skills",
      description: "List SKILL.md packages available from gisul.",
      inputSchema: {
        query: z.string().optional().describe("Optional case-insensitive substring filter."),
      },
    },
    async ({ query }) => asJsonText(await listSkills(query)),
  );

  server.registerTool(
    "skills_get",
    {
      title: "Get skill",
      description: "Read a skill's SKILL.md by name.",
      inputSchema: {
        name: z.string().describe("Skill directory name or frontmatter name."),
      },
    },
    async ({ name }) => {
      const skills = await listSkills();
      const selected =
        skills.find((skill) => skill.name === name) ??
        skills.find((skill) => skill.uri.endsWith(`/${encodeURIComponent(name)}`));
      if (!selected) throw new Error(`Skill not found: ${name}`);

      const { record } = parseSkillUri(selected.uri);
      const { markdown, filePath } = await readSkillMarkdown(record);
      return asJsonText({ name: selected.name, source: selected.source, uri: selected.uri, path: filePath, markdown });
    },
  );

  server.registerTool(
    "resources_read",
    {
      title: "Read skill resource",
      description: "Read a skill resource by skill://<authority>/<source>/<skill>/<path> URI.",
      inputSchema: {
        uri: z.string().describe("Resource URI, for example skill://gisul/agents/korean-spell-check/SKILL.md."),
      },
    },
    async ({ uri }) => {
      const { record, relativePath } = parseSkillUri(uri);
      const { text, filePath } = await readSkillResource(record, relativePath);
      return asJsonText({ uri, path: filePath, text });
    },
  );
}

function createSkillpackServer(): McpServer {
  const server = new McpServer({
    name: "gisul",
    version: "0.1.0",
  });
  registerSkillpackTools(server);
  return server;
}

async function readBearerToken(): Promise<string | undefined> {
  if (process.env.SKILLPACK_BEARER_TOKEN) return process.env.SKILLPACK_BEARER_TOKEN.trim();
  if (!process.env.SKILLPACK_BEARER_TOKEN_FILE) return undefined;

  return (await readFile(process.env.SKILLPACK_BEARER_TOKEN_FILE, "utf8")).trim();
}

async function readAdminToken(bearerToken: string | undefined): Promise<string | undefined> {
  if (process.env.SKILLPACK_ADMIN_TOKEN) return process.env.SKILLPACK_ADMIN_TOKEN.trim();
  try {
    return (await readFile(ADMIN_TOKEN_FILE, "utf8")).trim();
  } catch {
    return bearerToken;
  }
}

async function isAuthorized(header: string | undefined, bearerToken: string | undefined): Promise<boolean> {
  if (!bearerToken) return true;
  if (!header?.startsWith("Bearer ")) return false;

  const token = header.slice("Bearer ".length);
  if (equalSecret(token, bearerToken)) return true;

  const store = await readTokenStore();
  const tokenHash = sha256(token);
  return store.tokens.some((record) => !record.revokedAt && equalSecret(record.tokenHash, tokenHash));
}

function hasAdminCookie(req: Request, adminToken: string | undefined): boolean {
  if (!adminToken) return true;
  const cookies = req.headers.cookie?.split(";").map((value) => value.trim()) ?? [];
  const cookie = cookies.find((value) => value.startsWith("skillpack_admin="));
  if (!cookie) return false;
  return equalSecret(decodeURIComponent(cookie.slice("skillpack_admin=".length)), adminToken);
}

function requireAdmin(req: Request, res: Response, adminToken: string | undefined): boolean {
  if (hasAdminCookie(req, adminToken)) return true;
  res.status(303).set("Location", "/dashboard/login").end();
  return false;
}

async function createTokenRequest(req: Request, res: Response): Promise<void> {
  const id = randomToken("req_");
  const claimToken = randomToken("claim_");
  const now = new Date().toISOString();
  const store = await readTokenRequestStore();

  const record: TokenRequestRecord = {
    id,
    claimHash: sha256(claimToken),
    status: "pending",
    label: sanitizeText(req.body?.label, "unnamed-client", 80),
    note: sanitizeText(req.body?.note, "", 500),
    requester: getRequester(req),
    createdAt: now,
  };
  store.requests.unshift(record);
  await writeTokenRequestStore(store);

  res.status(201).json({
    requestId: id,
    claimToken,
    status: "pending",
    statusUrl: `/auth/token-requests/${encodeURIComponent(id)}?claim_token=${encodeURIComponent(claimToken)}`,
    dashboardUrl: "/dashboard",
  });
}

async function getTokenRequest(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id ?? "");
  const claimToken = String(req.query.claim_token ?? req.headers["x-skillpack-claim-token"] ?? "");
  const store = await readTokenRequestStore();
  const record = store.requests.find((request) => request.id === id);

  if (!record || !claimToken || !equalSecret(record.claimHash, sha256(claimToken))) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (record.status === "approved" && record.tokenPlaintext) {
    const token = record.tokenPlaintext;
    record.status = "delivered";
    record.deliveredAt = new Date().toISOString();
    delete record.tokenPlaintext;
    await writeTokenRequestStore(store);
    res.json({ requestId: record.id, status: "approved", bearerToken: token });
    return;
  }

  res.json({ requestId: record.id, status: record.status });
}

async function approveTokenRequest(id: string): Promise<void> {
  const requestStore = await readTokenRequestStore();
  const request = requestStore.requests.find((candidate) => candidate.id === id);
  if (!request) throw new Error(`Request not found: ${id}`);
  if (request.status !== "pending") return;

  const token = randomToken("skp_");
  const tokenId = randomToken("tok_");
  const now = new Date().toISOString();
  const tokenStore = await readTokenStore();

  tokenStore.tokens.unshift({
    id: tokenId,
    tokenHash: sha256(token),
    prefix: token.slice(0, 12),
    label: request.label,
    note: request.note,
    requestId: request.id,
    requester: request.requester,
    createdAt: now,
  });

  request.status = "approved";
  request.approvedAt = now;
  request.tokenId = tokenId;
  request.tokenPlaintext = token;

  await writeTokenStore(tokenStore);
  await writeTokenRequestStore(requestStore);
}

async function denyTokenRequest(id: string): Promise<void> {
  const store = await readTokenRequestStore();
  const request = store.requests.find((candidate) => candidate.id === id);
  if (!request) throw new Error(`Request not found: ${id}`);
  if (request.status !== "pending") return;
  request.status = "denied";
  request.deniedAt = new Date().toISOString();
  await writeTokenRequestStore(store);
}

async function revokeToken(tokenId: string): Promise<void> {
  const store = await readTokenStore();
  const token = store.tokens.find((candidate) => candidate.id === tokenId);
  if (!token) throw new Error(`Token not found: ${tokenId}`);
  if (!token.revokedAt) token.revokedAt = new Date().toISOString();
  await writeTokenStore(store);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0f172a; color: #e5e7eb; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px; }
    h1 { font-size: 28px; margin: 0 0 20px; }
    h2 { font-size: 18px; margin: 28px 0 12px; }
    form { display: inline; }
    input, textarea { width: 100%; box-sizing: border-box; margin: 6px 0 14px; padding: 10px 12px; border-radius: 6px; border: 1px solid #334155; background: #020617; color: #e5e7eb; }
    button, .button { display: inline-block; margin: 2px 4px 2px 0; padding: 8px 12px; border: 0; border-radius: 6px; background: #2563eb; color: white; cursor: pointer; text-decoration: none; }
    button.danger { background: #b91c1c; }
    button.secondary { background: #475569; }
    table { width: 100%; border-collapse: collapse; background: #111827; border-radius: 8px; overflow: hidden; }
    th, td { padding: 10px; border-bottom: 1px solid #334155; text-align: left; vertical-align: top; font-size: 14px; }
    th { background: #1f2937; }
    code { color: #bfdbfe; }
    .muted { color: #94a3b8; }
    .panel { background: #111827; border: 1px solid #334155; border-radius: 8px; padding: 16px; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

async function showRequestForm(_req: Request, res: Response): Promise<void> {
  res.type("html").send(
    page(
      "Request Skillpack Token",
      `<h1>Request Token</h1>
      <form method="post" action="/auth/token-requests">
        <label>Client label<input name="label" placeholder="my laptop, claude desktop, test client"></label>
        <label>Note<textarea name="note" rows="4" placeholder="Why this token is needed"></textarea></label>
        <button type="submit">Create Request</button>
      </form>`,
    ),
  );
}

async function showDashboardLogin(_req: Request, res: Response): Promise<void> {
  res.type("html").send(
    page(
      "Skillpack Login",
      `<h1>Skillpack Admin</h1>
      <form method="post" action="/dashboard/login" class="panel">
        <label>Admin token<input name="token" type="password" autocomplete="current-password"></label>
        <button type="submit">Log in</button>
      </form>`,
    ),
  );
}

async function handleDashboardLogin(req: Request, res: Response, adminToken: string | undefined): Promise<void> {
  const submitted = sanitizeText(req.body?.token, "", 4096);
  if (!adminToken || !submitted || !equalSecret(submitted, adminToken)) {
    res.status(401).type("html").send(page("Unauthorized", `<h1>Unauthorized</h1><a class="button" href="/dashboard/login">Retry</a>`));
    return;
  }

  res
    .status(303)
    .set("Set-Cookie", `skillpack_admin=${encodeURIComponent(adminToken)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`)
    .set("Location", "/dashboard")
    .end();
}

async function showDashboard(req: Request, res: Response, adminToken: string | undefined): Promise<void> {
  if (!requireAdmin(req, res, adminToken)) return;

  const [requestStore, tokenStore] = await Promise.all([readTokenRequestStore(), readTokenStore()]);
  const requests = requestStore.requests.slice(0, 100);
  const tokens = tokenStore.tokens.slice(0, 100);

  const requestRows = requests
    .map(
      (request) => `<tr>
        <td><code>${escapeHtml(request.id)}</code><div class="muted">${escapeHtml(request.requester)}</div></td>
        <td>${escapeHtml(request.label)}<div class="muted">${escapeHtml(request.note)}</div></td>
        <td>${escapeHtml(request.status)}<div class="muted">${escapeHtml(request.createdAt)}</div></td>
        <td>
          ${
            request.status === "pending"
              ? `<form method="post" action="/dashboard/requests/${encodeURIComponent(request.id)}/approve"><button type="submit">Approve</button></form>
                 <form method="post" action="/dashboard/requests/${encodeURIComponent(request.id)}/deny"><button class="danger" type="submit">Deny</button></form>`
              : ""
          }
        </td>
      </tr>`,
    )
    .join("");

  const tokenRows = tokens
    .map(
      (token) => `<tr>
        <td><code>${escapeHtml(token.id)}</code><div class="muted">${escapeHtml(token.prefix)}...</div></td>
        <td>${escapeHtml(token.label)}<div class="muted">${escapeHtml(token.note)}</div></td>
        <td>${escapeHtml(token.revokedAt ? "revoked" : "active")}<div class="muted">${escapeHtml(token.createdAt)}</div></td>
        <td>${
          token.revokedAt
            ? ""
            : `<form method="post" action="/dashboard/tokens/${encodeURIComponent(token.id)}/revoke"><button class="danger" type="submit">Revoke</button></form>`
        }</td>
      </tr>`,
    )
    .join("");

  res.type("html").send(
    page(
      "Skillpack Dashboard",
      `<h1>Skillpack Dashboard</h1>
      <p><a class="button secondary" href="/auth/request">Open request form</a></p>
      <h2>Requests</h2>
      <table>
        <thead><tr><th>Request</th><th>Client</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${requestRows || `<tr><td colspan="4" class="muted">No requests</td></tr>`}</tbody>
      </table>
      <h2>Issued Tokens</h2>
      <table>
        <thead><tr><th>Token</th><th>Client</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${tokenRows || `<tr><td colspan="4" class="muted">No issued tokens</td></tr>`}</tbody>
      </table>`,
    ),
  );
}

async function startStdio(): Promise<void> {
  const server = createSkillpackServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp(): Promise<void> {
  const bearerToken = await readBearerToken();
  const adminToken = await readAdminToken(bearerToken);
  const port = Number(process.env.PORT ?? DEFAULT_HTTP_PORT);
  const host = process.env.HOST ?? "127.0.0.1";
  const allowedHosts = (process.env.SKILLPACK_ALLOWED_HOSTS ?? "127.0.0.1,localhost")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const app = createMcpExpressApp({ host, allowedHosts });
  app.use(express.urlencoded({ extended: false }));

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, service: "gisul" });
  });

  app.get("/auth/request", showRequestForm);
  app.post("/auth/token-requests", createTokenRequest);
  app.get("/auth/token-requests/:id", getTokenRequest);

  app.get("/dashboard/login", showDashboardLogin);
  app.post("/dashboard/login", async (req: Request, res: Response) => {
    await handleDashboardLogin(req, res, adminToken);
  });
  app.get("/dashboard", async (req: Request, res: Response) => {
    await showDashboard(req, res, adminToken);
  });
  app.post("/dashboard/requests/:id/approve", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res, adminToken)) return;
    await approveTokenRequest(String(req.params.id));
    res.status(303).set("Location", "/dashboard").end();
  });
  app.post("/dashboard/requests/:id/deny", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res, adminToken)) return;
    await denyTokenRequest(String(req.params.id));
    res.status(303).set("Location", "/dashboard").end();
  });
  app.post("/dashboard/tokens/:id/revoke", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res, adminToken)) return;
    await revokeToken(String(req.params.id));
    res.status(303).set("Location", "/dashboard").end();
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    if (!(await isAuthorized(req.headers.authorization, bearerToken))) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const server = createSkillpackServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.all("/mcp", (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed");
  });

  app.listen(port, host, (error?: Error) => {
    if (error) {
      console.error("Failed to start HTTP MCP server:", error);
      process.exit(1);
    }
    console.error(`gisul listening on http://${host}:${port}/mcp`);
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--http")) {
    await startHttp();
    return;
  }
  await startStdio();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
