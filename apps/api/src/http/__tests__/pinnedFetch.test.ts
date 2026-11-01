import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LookupFunction } from "node:net";
import { after, before, describe, it } from "node:test";
import { assertPublicUrl, createGuardedLookup } from "../netguard.js";
import { createPinnedFetch } from "../pinnedFetch.js";

describe("pinned fetch", () => {
  let server: http.Server;
  let port = 0;
  const seen: { host?: string; body: string }[] = [];

  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ host: req.headers.host, body });
        if (req.url === "/redirect") {
          res.writeHead(302, { location: "http://169.254.169.254/" });
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  // A lookup that pins card.example to the local test server (stands in for a public address).
  const pinToLocal: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  };

  it("connects to the pinned address and keeps the Host header and body", async () => {
    const fetchPinned = createPinnedFetch({ lookup: pinToLocal });
    const response = await fetchPinned(`http://card.example:${port}/card.json`, { method: "POST", headers: { "content-type": "application/json" }, body: "{\"a\":1}" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, path: "/card.json" });
    const last = seen[seen.length - 1]!;
    assert.equal(last.host, `card.example:${port}`);
    assert.equal(last.body, "{\"a\":1}");
  });

  it("refuses redirects when redirect is 'error'", async () => {
    const fetchPinned = createPinnedFetch({ lookup: pinToLocal });
    await assert.rejects(fetchPinned(`http://card.example:${port}/redirect`, { redirect: "error" }), /Redirect/u);
  });

  it("refuses a host that resolves to a private address at connect time", async () => {
    const guarded = createGuardedLookup((_h, cb) => cb(null, [{ address: "10.0.0.7", family: 4 }]));
    const fetchPinned = createPinnedFetch({ lookup: guarded });
    await assert.rejects(fetchPinned(`http://internal.example:${port}/`), (error: NodeJS.ErrnoException) => error.code === "EURLFORBIDDEN");
  });

  it("defeats DNS rebinding: public at registration, private at connect", async () => {
    let calls = 0;
    const answers = ["93.184.216.34", "127.0.0.1"];
    const resolver = (_h: string, cb: (e: NodeJS.ErrnoException | null, a: readonly { address: string; family: number }[]) => void) => {
      const address = answers[Math.min(calls, answers.length - 1)]!;
      calls += 1;
      cb(null, [{ address, family: 4 }]);
    };
    // Registration check sees the public answer.
    await assertPublicUrl("https://rebind.example/hook", "url", async (h) => new Promise((resolve) => resolver(h, (_e, a) => resolve(a as never))));
    // The connection resolves again (once) and gets the loopback answer: refused, nothing is sent.
    const before = seen.length;
    const fetchPinned = createPinnedFetch({ lookup: createGuardedLookup(resolver) });
    await assert.rejects(fetchPinned(`http://rebind.example:${port}/hook`, { method: "POST", body: "secret" }), (error: NodeJS.ErrnoException) => error.code === "EURLFORBIDDEN");
    assert.equal(seen.length, before);
    assert.equal(calls, 2);
  });

  it("caps the response size", async () => {
    const fetchPinned = createPinnedFetch({ lookup: pinToLocal, maxBytes: 5 });
    await assert.rejects(fetchPinned(`http://card.example:${port}/big`), /larger than/u);
  });
});
