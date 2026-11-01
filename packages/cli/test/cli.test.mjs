import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, run, signPayload } from "../src/cli.mjs";

const KEY = "lk_test_abcdefabcdef_" + "A".repeat(32);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function harness(routes, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lykia-cli-"));
  const calls = [];
  const stdout = [];
  const stderr = [];
  const io = {
    configPath: join(dir, "config.json"),
    env: { LYKIA_BASE_URL: "https://api.test", ...env },
    now: () => Date.UTC(2026, 10, 1, 12),
    sleep: async () => undefined,
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      for (const [prefix, answer] of routes) if (url.startsWith(prefix)) return typeof answer === "function" ? answer(url, init) : json(200, answer);
      return json(404, { error: { code: "NOT_FOUND", message: "no route" } });
    },
  };
  return { io, calls, stdout, stderr };
}

test("parses flags", () => {
  assert.deepEqual(parseArgs(["plan", "send 5 usdc", "--owner", "0x1", "--json", "--env=testnet"]), { _: ["plan", "send 5 usdc"], owner: "0x1", json: true, env: "testnet" });
});

test("login checks the key, saves it privately and refuses browser keys", async () => {
  const h = harness([["https://api.test/v1/versions", { latest: "2026-11-01" }]]);
  assert.equal(await run(["login", "--key", KEY], h.io), 0);
  const saved = JSON.parse(readFileSync(h.io.configPath, "utf8"));
  assert.equal(saved.apiKey, KEY);
  assert.equal(statSync(h.io.configPath).mode & 0o777, 0o600);
  assert.match(h.stdout[0], /test \(testnet only\)/u);
  await assert.rejects(run(["login", "--key", "lk_pk_test_abcdefabcdef_" + "A".repeat(32)], h.io), /publishable/u);
  await assert.rejects(run(["login", "--key", "nope"], h.io), /Pass a Lykia key/u);
  assert.equal(await run(["logout"], h.io), 0);
  assert.ok(!existsSync(h.io.configPath));
});

test("keys, plan and quote call the API with the key and an idempotency key", async () => {
  const h = harness(
    [
      ["https://api.test/v1/developers/keys", (url, init) => (init.method === "POST" ? json(201, { prefix: "lk_test_x_…", mode: "test", secret: "lk_test_secret" }) : json(200, { keys: [{ id: "abcdefabcdef", label: "ci", prefix: "lk_test_abcdefabcdef_…", mode: "test", scopes: ["read"], revokedAt: null }] }))],
      ["https://api.test/v1/intents", { intent: { verdict: { decision: "allow", reasons: [] }, steps: [{ kind: "transfer", venue: "arc-transfer" }] } }],
      ["https://api.test/v1/quote", { options: [{ label: "Uniswap v3 0.05%", amountOut: "89" }], choice: { chosen: { label: "Uniswap v3 0.05%", venue: "uniswap-v3", amountOut: "89" }, reason: "Most out." } }],
    ],
    { LYKIA_API_KEY: KEY },
  );
  await run(["keys", "list"], h.io);
  assert.match(h.stdout.at(-1), /abcdefabcdef\s+ci/u);
  assert.equal(h.calls[0].init.headers["Lykia-Key"], KEY);
  await run(["keys", "create", "--label", "ci", "--scopes", "read,quote"], h.io);
  assert.deepEqual(JSON.parse(h.calls[1].init.body), { label: "ci", mode: "test", scopes: ["read", "quote"] });
  assert.match(h.calls[1].init.headers["Idempotency-Key"], /^[0-9a-f]{32}$/u);
  await run(["plan", "send 5 USDC to 0x2", "--owner", "0x1", "--env", "testnet"], h.io);
  assert.deepEqual(JSON.parse(h.calls[2].init.body), { owner: "0x1", text: "send 5 USDC to 0x2", environment: "testnet", dryRun: true });
  assert.match(h.stdout.at(-1), /Decision: allow/u);
  await run(["quote", "--from", "USDC", "--to", "EURC", "--amount", "100"], h.io);
  assert.match(h.stdout.at(-1), /Best: Uniswap v3/u);
});

test("webhooks listen forwards new events to localhost, signed", async () => {
  const forwarded = [];
  const event = { id: "evt_1", type: "payout.sent", event: "payout.sent", createdAt: "2026-11-01T12:00:01.000Z", data: { amount: "5" } };
  const h = harness(
    [
      ["https://api.test/v1/events", { data: [event], nextCursor: null }],
      ["http://localhost:4242/hooks", (url, init) => {
        forwarded.push(init);
        return new Response("ok", { status: 200 });
      }],
    ],
    { LYKIA_API_KEY: KEY },
  );
  await run(["webhooks", "listen", "--forward-to", "http://localhost:4242/hooks", "--secret", "whsec_cli_test", "--iterations", "1"], h.io);
  assert.equal(forwarded.length, 1);
  const header = forwarded[0].headers["Lykia-Signature"];
  const t = Number(/t=(\d+)/u.exec(header)[1]);
  assert.equal(header, `t=${t},v1=${createHmac("sha256", "whsec_cli_test").update(`${t}.${forwarded[0].body}`).digest("hex")}`);
  assert.equal(signPayload("s", "b", 1), signPayload("s", "b", 1));
  assert.match(h.stdout.at(-1), /payout\.sent\s+evt_1\s+-> 200/u);
  await assert.rejects(run(["webhooks", "listen", "--forward-to", "https://example.com/x"], h.io), /localhost/u);
});

test("logs tail prints new entries oldest first", async () => {
  const h = harness([["https://api.test/v1/logs", { data: [{ at: "2026-11-01T12:00:02Z", status: 403, method: "POST", path: "/v1/intents", latencyMs: 4, errorCode: "FORBIDDEN", requestId: "r2" }, { at: "2026-11-01T12:00:01Z", status: 200, method: "GET", path: "/v1/venues", latencyMs: 3, errorCode: null, requestId: "r1" }], nextCursor: null }]], { LYKIA_API_KEY: KEY });
  await run(["logs", "tail", "--status", "error", "--iterations", "1"], h.io);
  assert.match(h.calls[0].url, /statusClass=error/u);
  assert.match(h.stdout[0], /r1$/u);
  assert.match(h.stdout[1], /FORBIDDEN\s+r2$/u);
});
