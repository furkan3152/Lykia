import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import type { AppContext } from "../../context.js";
import { systemClock } from "../../clock.js";
import { MemoryStore } from "../../store/memory.js";
import { idempotency } from "../idempotency.js";

describe("Idempotency-Key", () => {
  let base = "";
  let calls = 0;
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  before(async () => {
    const ctx = { store: new MemoryStore(systemClock) } as unknown as AppContext;
    const app = express();
    app.use(express.json());
    app.use(idempotency(ctx));
    app.post("/intents", async (req, res) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, req.body.slow ? 150 : 0));
      if (req.body.boom) {
        res.status(500).json({ error: "boom" });
        return;
      }
      if (req.body.limited && calls % 2 === 1) {
        // A route-level rate limiter answers before the handler runs.
        res.status(429).json({ error: { code: "RATE_LIMITED" } });
        return;
      }
      res.status(201).json({ id: `out_${calls}` });
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  const post = (body: unknown, key?: string) => fetch(`${base}/intents`, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) });

  it("replays the first answer for the same key and body", async () => {
    const a = await post({ text: "send 1 usdc" }, "key-aaaaaaaa");
    const b = await post({ text: "send 1 usdc" }, "key-aaaaaaaa");
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers.get("idempotent-replayed"), "true");
    assert.deepEqual(await b.json(), await a.json());
    assert.equal(calls, 1);
  });

  it("refuses the same key with a different body", async () => {
    const r = await post({ text: "send 2 usdc" }, "key-aaaaaaaa");
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "IDEMPOTENCY_CONFLICT");
  });

  it("refuses a concurrent duplicate while the first is in flight", async () => {
    const [a, b] = await Promise.all([post({ slow: true }, "key-bbbbbbbb"), new Promise<Response>((r) => setTimeout(() => r(post({ slow: true }, "key-bbbbbbbb")), 30))]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  });

  it("does not store 5xx answers, so the key can be retried", async () => {
    const before = calls;
    assert.equal((await post({ boom: true }, "key-cccccccc")).status, 500);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await post({ boom: true }, "key-cccccccc")).status, 500);
    assert.equal(calls, before + 2);
  });

  it("does not store a 429, so the retry after the window runs", async () => {
    calls = 0;
    assert.equal((await post({ limited: true }, "key-dddddddd")).status, 429);
    await new Promise((r) => setTimeout(r, 20));
    const retry = await post({ limited: true }, "key-dddddddd");
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get("idempotent-replayed"), null);
  });

  it("leaves requests without a key alone and validates keys", async () => {
    const before = calls;
    await post({ x: 1 });
    await post({ x: 1 });
    assert.equal(calls, before + 2);
    assert.equal((await post({ x: 1 }, "short")).status, 400);
  });
});
