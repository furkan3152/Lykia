/**
 * One contract suite for both Store backends. The Postgres run needs
 * LYKIA_TEST_DATABASE_URL (a throwaway database); it uses its own table
 * prefix and drops its tables afterwards.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { ManualClock } from "../../clock.js";
import { LykiaHttpError } from "../../http/errors.js";
import { MemoryStore } from "../memory.js";
import { PostgresStore } from "../postgres.js";
import type { Store } from "../types.js";

interface Backend {
  readonly store: Store;
  cleanup(): Promise<void>;
}

type Doc = { readonly name: string; readonly n?: number; readonly tags?: readonly string[] };

function contract(label: string, make: (clock: ManualClock) => Promise<Backend>, skip: string | false = false): void {
  describe(`Store contract: ${label}`, { skip }, () => {
    const clock = new ManualClock(1_800_000_000_000);
    let backend: Backend;
    let store: Store;
    let suffix = 0;
    const fresh = () => `c${(suffix += 1)}`;

    before(async () => {
      backend = await make(clock);
      store = backend.store;
    });

    after(async () => {
      await backend?.cleanup();
    });

    beforeEach(() => {
      clock.set(1_800_000_000_000);
    });

    it("puts, gets and versions documents", async () => {
      const docs = store.collection<Doc>(fresh());
      assert.equal(await docs.get("a"), null);
      const first = await docs.put("a", { name: "one" });
      assert.equal(first.version, 1);
      assert.equal(first.expiresAt, null);
      assert.equal(first.updatedAt, clock.now());
      clock.advance(10);
      const second = await docs.put("a", { name: "two", n: 2 });
      assert.equal(second.version, 2);
      const read = await docs.get("a");
      assert.deepEqual(read?.value, { name: "two", n: 2 });
      assert.equal(read?.version, 2);
      assert.equal(read?.updatedAt, clock.now());
    });

    it("stores JSON copies (undefined dropped, no aliasing)", async () => {
      const docs = store.collection<Doc>(fresh());
      const value = { name: "x", n: undefined, tags: ["a"] } as Doc;
      await docs.put("k", value);
      (value.tags as string[]).push("mutated");
      const read = await docs.get("k");
      assert.deepEqual(read?.value, { name: "x", tags: ["a"] });
    });

    it("keeps collections separate", async () => {
      const a = store.collection<Doc>(fresh());
      const b = store.collection<Doc>(fresh());
      await a.put("same", { name: "a" });
      assert.equal(await b.get("same"), null);
    });

    it("deletes and reports whether something was deleted", async () => {
      const docs = store.collection<Doc>(fresh());
      await docs.put("a", { name: "a" });
      assert.equal(await docs.delete("a"), true);
      assert.equal(await docs.delete("a"), false);
      assert.equal(await docs.get("a"), null);
    });

    it("lists by prefix in id order with cursor pagination", async () => {
      const docs = store.collection<Doc>(fresh());
      for (const id of ["user:b", "user:a", "user:c", "other:z", "user_x", "user%y"]) await docs.put(id, { name: id });
      const all = await docs.list({ prefix: "user:" });
      assert.deepEqual(
        all.map((doc) => doc.id),
        ["user:a", "user:b", "user:c"],
      );
      const page1 = await docs.list({ prefix: "user:", limit: 2 });
      assert.deepEqual(
        page1.map((doc) => doc.id),
        ["user:a", "user:b"],
      );
      const page2 = await docs.list({ prefix: "user:", after: page1[1]?.id as string });
      assert.deepEqual(
        page2.map((doc) => doc.id),
        ["user:c"],
      );
      // LIKE wildcards in the prefix are literal.
      assert.deepEqual(
        (await docs.list({ prefix: "user_" })).map((doc) => doc.id),
        ["user_x"],
      );
      assert.deepEqual(
        (await docs.list({ prefix: "user%" })).map((doc) => doc.id),
        ["user%y"],
      );
      assert.equal((await docs.list()).length, 6);
      // Code-unit order: uppercase sorts before lowercase.
      await docs.put("B", { name: "B" });
      assert.equal((await docs.list())[0]?.id, "B");
    });

    it("compare-and-set inserts once and updates only the expected version", async () => {
      const docs = store.collection<Doc>(fresh());
      const created = await docs.compareAndSet("lock", null, { name: "first" });
      assert.equal(created?.version, 1);
      assert.equal(await docs.compareAndSet("lock", null, { name: "second" }), null, "must not exist");
      assert.equal(await docs.compareAndSet("lock", 5, { name: "stale" }), null, "wrong version");
      const updated = await docs.compareAndSet("lock", 1, { name: "updated" });
      assert.equal(updated?.version, 2);
      assert.equal(await docs.compareAndSet("lock", 1, { name: "again" }), null, "version already moved on");
      assert.deepEqual((await docs.get("lock"))?.value, { name: "updated" });
      assert.equal(await docs.compareAndSet("missing", 1, { name: "x" }), null);
    });

    it("compare-and-set under contention lets exactly one writer win", async () => {
      const docs = store.collection<Doc>(fresh());
      const results = await Promise.all(Array.from({ length: 8 }, (_, index) => docs.compareAndSet("race", null, { name: `w${index}` })));
      assert.equal(results.filter(Boolean).length, 1);
    });

    it("expires documents after their TTL", async () => {
      const docs = store.collection<Doc>(fresh());
      const doc = await docs.put("t", { name: "ttl" }, { ttlMs: 1_000 });
      assert.equal(doc.expiresAt, clock.now() + 1_000);
      clock.advance(999);
      assert.ok(await docs.get("t"));
      clock.advance(1);
      assert.equal(await docs.get("t"), null);
      assert.equal((await docs.list()).length, 0);
      assert.equal(await docs.delete("t"), false, "an expired document counts as absent");
      // An expired document can be claimed again and restarts at version 1.
      const reclaimed = await docs.compareAndSet("t", null, { name: "again" });
      assert.equal(reclaimed?.version, 1);
      await docs.put("t2", { name: "x" }, { ttlMs: 10 });
      clock.advance(11);
      assert.equal((await docs.put("t2", { name: "y" })).version, 1);
    });

    it("rejects invalid ids, names and TTLs", async () => {
      assert.throws(() => store.collection("Bad Name"));
      const docs = store.collection<Doc>(fresh());
      await assert.rejects(docs.get(""));
      await assert.rejects(docs.put("x".repeat(257), { name: "x" }));
      await assert.rejects(docs.put("a", { name: "x" }, { ttlMs: 0 }));
      await assert.rejects(docs.list({ limit: 0 }));
    });

    it("counts with fixed-window TTLs", async () => {
      const counters = store.counters(fresh());
      assert.equal(await counters.get("ip"), 0);
      assert.equal(await counters.increment("ip", 1, { ttlMs: 1_000 }), 1);
      clock.advance(500);
      assert.equal(await counters.increment("ip", 2, { ttlMs: 1_000 }), 3);
      clock.advance(499);
      assert.equal(await counters.get("ip"), 3);
      clock.advance(1);
      assert.equal(await counters.get("ip"), 0, "the window started at the first increment");
      assert.equal(await counters.increment("ip", 1, { ttlMs: 1_000 }), 1);
      assert.equal(await counters.increment("forever"), 1);
      assert.equal(await counters.increment("forever", -3), -2);
      await counters.reset("forever");
      assert.equal(await counters.get("forever"), 0);
      await assert.rejects(counters.increment("ip", 1.5));
    });

    it("sweeps expired rows", async () => {
      const docs = store.collection<Doc>(fresh());
      const counters = store.counters(fresh());
      await docs.put("gone", { name: "x" }, { ttlMs: 10 });
      await docs.put("kept", { name: "y" });
      await counters.increment("gone", 1, { ttlMs: 10 });
      clock.advance(20);
      assert.ok((await store.sweep()) >= 2);
      assert.ok(await docs.get("kept"));
    });

    it("answers ping", async () => {
      await store.ping();
    });
  });
}

contract("memory", async (clock) => ({ store: new MemoryStore(clock), cleanup: async () => undefined }));

const databaseUrl = process.env.LYKIA_TEST_DATABASE_URL?.trim();
contract(
  "postgres",
  async (clock) => {
    const store = new PostgresStore({ url: databaseUrl as string, clock, tablePrefix: `lykia_test_${randomBytes(4).toString("hex")}` });
    return {
      store,
      cleanup: async () => {
        await store.dropTables();
        await store.close();
      },
    };
  },
  databaseUrl ? false : "set LYKIA_TEST_DATABASE_URL to run the Postgres store tests",
);

describe("PostgresStore failures", () => {
  it("maps an unreachable database to 503 STORE_UNAVAILABLE without leaking details", async () => {
    const store = new PostgresStore({ url: "postgresql://lykia:secret@127.0.0.1:1/lykia" });
    try {
      await store.collection("docs").get("x");
      assert.fail("expected STORE_UNAVAILABLE");
    } catch (error) {
      assert.ok(error instanceof LykiaHttpError);
      assert.equal(error.code, "STORE_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.ok(!error.message.includes("secret"));
    } finally {
      await store.close();
    }
  });

  it("validates the table prefix", () => {
    assert.throws(() => new PostgresStore({ url: "postgresql://x@localhost/x", tablePrefix: "bad-prefix;" }));
  });
});
