import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FENCE, decodeMemo, kunyeCardDigest } from "@lykia/core";
import { decodeFunctionData } from "viem";
import { createApp } from "../app.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { IDENTITY_REGISTRY_ABI, MEMO_ABI } from "../engine/abis.js";
import type { PulseFeed } from "../arc/pulse.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41";
const USDC = "0x3600000000000000000000000000000000000000";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

describe("Lykia API", () => {
  let ctx: AppContext;
  let served: Served;
  const arc = new FakeArc();

  before(async () => {
    arc.setBalance(USDC, OWNER, 1_000_000_000n);
    ctx = createContext(testConfig({ LYKIA_X402_PAY_TO: "0x2222222222222222222222222222222222222222" }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
  });

  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const post = (path: string, body: unknown) => fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("serves liveness and the registry", async () => {
    assert.equal((await fetch(`${served.url}/health`)).status, 200);
    const venues = (await (await fetch(`${served.url}/v1/venues?environment=testnet`)).json()) as { venues: { id: string; executable: boolean }[] };
    assert.equal(venues.venues.find((v) => v.id === "cctp")?.executable, true);
    assert.equal(venues.venues.some((v) => v.id === "morpho-vaults"), false);
    const mainnet = (await (await fetch(`${served.url}/v1/venues?environment=mainnet`)).json()) as { venues: { id: string; executable: boolean }[] };
    assert.equal(mainnet.venues.find((v) => v.id === "aave-v4")?.executable, true);
    assert.equal(mainnet.venues.find((v) => v.id === "aerodrome-slipstream")?.executable, false);
    assert.equal(venues.venues.find((v) => v.id === "lykia-practice")?.executable, false);
  });

  it("validates and evaluates Fences", async () => {
    const bad = (await (await post("/v1/fence/validate", { fence: { schema: "lykia.fence/v1", caps: { perStepUsd: 5 } } })).json()) as { ok: boolean };
    assert.equal(bad.ok, false);
    const loose = (await (await post("/v1/fence/validate", { fence: { ...DEFAULT_FENCE, recipients: { mode: "any" } }, previous: DEFAULT_FENCE })).json()) as { loosened: string[] };
    assert.ok(loose.loosened.some((l) => l.includes("Recipients opened")));
    const verdict = (await (await post("/v1/fence/evaluate", { facts: { environment: "testnet", signer: "agent", owner: OWNER, steps: [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "5", tokens: [], recipient: "0x1111111111111111111111111111111111111111" }], spent: { dayUsd: "0", weekUsd: "0" } } })).json()) as { decision: string };
    assert.equal(verdict.decision, "deny");
  });

  it("plans from a Turkish sentence, prepares a memo-wrapped transfer and refuses mismatched hashes", async () => {
    const fence = { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: ["0x1111111111111111111111111111111111111111"] } };
    const created = await post("/v1/intents", { text: "20 USDC'yi 0x1111111111111111111111111111111111111111 adresine fatura 12 için gönder", owner: OWNER, environment: "testnet", fence });
    assert.equal(created.status, 201);
    const { intent } = (await created.json()) as { intent: { id: string; verdict: { decision: string } } };
    assert.equal(intent.verdict.decision, "confirm");
    const unconfirmed = await post(`/v1/intents/${intent.id}/steps/s1/prepare`, {});
    assert.equal(unconfirmed.status, 409);
    const prepared = (await (await post(`/v1/intents/${intent.id}/steps/s1/prepare`, { confirm: true })).json()) as { transactions: { to: string; data: `0x${string}`; from: string }[]; memo: string };
    const tx = prepared.transactions[0]!;
    const decoded = decodeFunctionData({ abi: MEMO_ABI, data: tx.data });
    assert.equal(decodeMemo(decoded.args[3])?.note, "fatura 12");
    assert.match(prepared.memo, /^lykia:1:out_/u);
    const hash = `0x${"cd".repeat(32)}`;
    arc.transactions.set(hash, { from: OWNER, to: tx.to, input: "0xdeadbeef", value: 0n, chainId: 5042002 });
    const mismatch = await post(`/v1/intents/${intent.id}/steps/s1/submit`, { hashes: [hash] });
    assert.equal(mismatch.status, 409);
    const good = `0x${"ef".repeat(32)}`;
    arc.transactions.set(good, { from: OWNER, to: tx.to, input: tx.data, value: 0n, chainId: 5042002 });
    arc.receipts.set(good, { status: "success" });
    const submitted = (await (await post(`/v1/intents/${intent.id}/steps/s1/submit`, { hashes: [good] })).json()) as { step: { status: string }; outrun: { status: string } };
    assert.equal(submitted.step.status, "settled");
    assert.equal(submitted.outrun.status, "settled");
  });

  it("asks instead of guessing", async () => {
    const response = await post("/v1/intents", { text: "send 1,5 usdc", owner: OWNER, environment: "testnet" });
    assert.equal(response.status, 422);
  });

  it("drafts a Künye that pins the Fence hash on-chain", async () => {
    const body = (await (await post("/v1/kunye/draft", { environment: "testnet", owner: OWNER, name: "Payroll Shepherd", description: "Pays the team", fence: DEFAULT_FENCE })).json()) as { card: never; cardDigest: string; fenceHash: string; agentURI: string; transaction: { data: `0x${string}` } };
    assert.equal(body.cardDigest, kunyeCardDigest(body.card));
    const decoded = decodeFunctionData({ abi: IDENTITY_REGISTRY_ABI, data: body.transaction.data });
    assert.equal(decoded.functionName, "register");
    const entries = decoded.args[1] as readonly { metadataKey: string; metadataValue: string }[];
    assert.equal(entries[0]?.metadataKey, "lykia.fence");
    assert.equal(`sha256:${entries[0]?.metadataValue.slice(2)}`, body.fenceHash);
    const card = await fetch(body.agentURI);
    assert.equal(card.status, 200);
  });

  it("answers 402 on paid routes until a payment arrives", async () => {
    const response = await fetch(`${served.url}/v1/x402/scent/0x9999999999999999999999999999999999999999?environment=testnet`);
    assert.equal(response.status, 402);
    const body = (await response.json()) as { accepts: { network: string; asset: string }[] };
    assert.equal(body.accepts[0]?.network, "eip155:5042002");
    assert.ok(response.headers.get("payment-required"));
  });

  it("answers in Lyko's voice without an agent key", async () => {
    const body = (await (await post("/v1/agent/chat", { messages: [{ role: "user", content: "come bye" }], environment: "testnet" })).json()) as { mode: string; command: string };
    assert.equal(body.mode, "reader");
    assert.equal(body.command, "come bye");
  });
});
