export interface Env {
  ORIGIN_BASE_URL: string;
}

function textResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function hasBearerAuth(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  return Boolean(authorization?.startsWith("Bearer "));
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  if (!origin) return {};

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function shouldProxy(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/auth/") || pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === "/healthz") {
      return new Response(JSON.stringify({ ok: true, service: "gisul-worker" }), {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    }

    if (!shouldProxy(url.pathname)) {
      return textResponse(404, "Not Found");
    }

    if (url.pathname === "/mcp" && !hasBearerAuth(request)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          ...corsHeaders(request),
          "www-authenticate": "Bearer",
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/mcp" && request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          ...corsHeaders(request),
          allow: "POST",
          "cache-control": "no-store",
        },
      });
    }

    const originUrl = new URL(url.pathname + url.search, env.ORIGIN_BASE_URL);
    const headers = new Headers(request.headers);
    headers.set("x-gisul-proxy", "cloudflare-worker");

    const originResponse = await fetch(originUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
    const responseHeaders = new Headers(originResponse.headers);

    for (const [key, value] of Object.entries(corsHeaders(request))) {
      responseHeaders.set(key, value);
    }
    responseHeaders.set("cache-control", "no-store");

    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: responseHeaders,
    });
  },
} satisfies ExportedHandler<Env>;
