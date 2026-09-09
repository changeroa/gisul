import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

const origin = "https://client.example";
const env = { ORIGIN_BASE_URL: "https://upstream.example" };

const cases = [
  { name: "adds Origin when Vary is absent", vary: null, expected: "Origin" },
  { name: "adds Origin when Vary is empty", vary: "", expected: "Origin" },
  { name: "preserves an existing field", vary: "Accept-Encoding", expected: "Accept-Encoding, Origin" },
  { name: "preserves multiple fields and their formatting", vary: "Accept-Encoding,  Accept-Language", expected: "Accept-Encoding,  Accept-Language, Origin" },
  { name: "does not duplicate Origin", vary: "Origin", expected: "Origin" },
  { name: "recognizes lowercase origin", vary: "origin", expected: "origin" },
  { name: "recognizes mixed-case Origin among fields", vary: "Accept-Encoding,\t oRiGiN , Accept-Language", expected: "Accept-Encoding,\t oRiGiN , Accept-Language" },
  { name: "matches whole tokens", vary: "X-Origin", expected: "X-Origin, Origin" },
  { name: "preserves wildcard Vary", vary: "*", expected: "*" },
  { name: "preserves wildcard among fields", vary: "Accept-Encoding, *", expected: "Accept-Encoding, *" },
];

for (const { name, vary, expected } of cases) {
  for (const withOrigin of [true, false]) {
    test(`${name} (${withOrigin ? "with" : "without"} request Origin)`, async (t) => {
      const upstreamHeaders = new Headers({ "x-upstream": "preserved" });
      if (vary !== null) upstreamHeaders.set("vary", vary);
      const upstream = new Response("upstream body", {
        status: 202,
        statusText: "Accepted",
        headers: upstreamHeaders,
      });
      const fetchMock = t.mock.method(globalThis, "fetch", async () => upstream);
      const requestHeaders = new Headers({ authorization: "Bearer test-token" });
      if (withOrigin) requestHeaders.set("origin", origin);

      const response = await worker.fetch(new Request("https://proxy.example/mcp", {
        method: "POST",
        headers: requestHeaders,
      }), env);

      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(response.headers.get("vary"), withOrigin ? expected : vary);
      assert.equal(response.headers.get("access-control-allow-origin"), withOrigin ? origin : null);
      assert.equal(response.headers.get("x-upstream"), "preserved");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.status, 202);
      assert.equal(response.statusText, "Accepted");
      assert.equal(await response.text(), "upstream body");
      assert.equal(upstream.headers.get("vary"), vary);
    });
  }
}
