import { corsHeaders, jsonResponse, readBody, validBearer } from "./http.ts";
import { ReleaseError } from "./r2-objects.ts";
import { canonicalUri, mimeType, readDirectory, readResource, readSnapshot, resolveAlias } from "./release-reader.ts";
import { publisherFetch } from "./release-publisher.ts";

export interface DirectEnv {
  SKILLS_BUCKET: R2Bucket;
  GISUL_BEARER_TOKEN: string;
  GISUL_PUBLISH_TOKEN?: string;
  GISUL_SERVER_VERSION?: string;
}

const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function rpcError(request: Request, id: Rpc["id"], code: number, message: string, status = 200): Response {
  return jsonResponse(request, { jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);
}

export default {
  async fetch(request: Request, env: DirectEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/admin/")) return publisherFetch(request, env);
    if (url.pathname === "/healthz") return jsonResponse(request, { ok: true, service: "gisul-worker", storage: "r2" });
    if (url.pathname !== "/mcp") return jsonResponse(request, { error: "Not Found" }, 404);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (!env.GISUL_BEARER_TOKEN) return jsonResponse(request, { error: "MCP authentication is not configured" }, 503);
    if (!await validBearer(request, env.GISUL_BEARER_TOKEN)) return jsonResponse(request, { error: "Unauthorized" }, 401, { "www-authenticate": "Bearer" });
    if (request.method !== "POST") return jsonResponse(request, { error: "Method Not Allowed" }, 405, { allow: "POST" });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return jsonResponse(request, { error: "Expected application/json" }, 415);
    const protocol = request.headers.get("mcp-protocol-version");
    if (protocol && !versions.includes(protocol)) return rpcError(request, null, -32600, "Unsupported MCP protocol version", 400);
    let bytes: ArrayBuffer;
    try { bytes = await readBody(request, 64 * 1024); } catch { return jsonResponse(request, { error: "Request body is too large" }, 413); }
    let rpc: Rpc;
    try { rpc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return rpcError(request, null, -32700, "Parse error", 400); }
    if (!rpc || Array.isArray(rpc) || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string" || (rpc.id !== undefined && rpc.id !== null && typeof rpc.id !== "string" && typeof rpc.id !== "number") || (rpc.params !== undefined && (!rpc.params || typeof rpc.params !== "object" || Array.isArray(rpc.params)))) return rpcError(request, null, -32600, "Invalid Request", 400);
    if (rpc.id === undefined) return jsonResponse(request, undefined, 202);
    const respond = (result: unknown) => jsonResponse(request, { jsonrpc: "2.0", id: rpc.id, result });
    const params = rpc.params ?? {};
    if (rpc.method === "initialize") return respond({
      protocolVersion: versions.includes(String(params.protocolVersion)) ? params.protocolVersion : versions[0],
      serverInfo: { name: "gisul", version: env.GISUL_SERVER_VERSION ?? "0.2.0" },
      capabilities: { resources: { listChanged: false }, extensions: { "io.modelcontextprotocol/skills": { directoryRead: true } } },
      instructions: "Remote workflow skills. Discover metadata with skills/list, load a selected manifest with skills/get, then read supporting resources only when needed. Keep the returned commit in params._meta['io.gisul/commit'] for subsequent resource reads.",
    });
    if (rpc.method === "ping") return respond({});
    if (rpc.method === "tools/list") return respond({ tools: [] });
    if (!["skills/list", "skills/get", "resources/list", "resources/read", "resources/directory/read"].includes(rpc.method)) return rpcError(request, rpc.id, -32601, "Method not found");
    try {
      if (params._meta !== undefined && (!params._meta || typeof params._meta !== "object" || Array.isArray(params._meta))) throw new ReleaseError("Invalid request metadata", 400);
      const pin = (params._meta as Record<string, unknown> | undefined)?.["io.gisul/commit"];
      const snapshot = await readSnapshot(env.SKILLS_BUCKET, pin);
      const _meta = { release: snapshot.identity.release, commit: snapshot.identity.commit, server_version: env.GISUL_SERVER_VERSION ?? "0.2.0" };
      if (rpc.method === "skills/list") {
        if (params.cursor !== undefined) throw new ReleaseError("This catalog is complete and has no cursor", 400);
        return respond({ resultType: "complete", skills: snapshot.inventory.skills, _meta });
      }
      if (rpc.method === "resources/list") return respond({ resources: [...snapshot.files.keys()].sort().map(uri => ({ uri, name: decodeURIComponent(uri.split("/").at(-1)!), mimeType: mimeType(uri) })), _meta });
      const uri = canonicalUri(params.uri);
      if (rpc.method === "skills/get") {
        const target = resolveAlias(snapshot.inventory, uri);
        const skill = snapshot.inventory.skills.find(skill => skill.uri === target)!;
        return respond({ resultType: "complete", skill, _meta: { ..._meta, ...(target !== uri ? { movedFrom: uri } : {}) } });
      }
      if (rpc.method === "resources/directory/read") return respond({ resultType: "complete", resources: readDirectory(snapshot, uri), _meta });
      return respond({ contents: [await readResource(env.SKILLS_BUCKET, snapshot, uri)], _meta });
    } catch (error) {
      const invalid = error instanceof ReleaseError && [400, 404].includes(error.status);
      return rpcError(request, rpc.id, invalid ? -32602 : -32603, error instanceof ReleaseError ? error.message : "Release could not be read or verified");
    }
  },
} satisfies ExportedHandler<DirectEnv>;
