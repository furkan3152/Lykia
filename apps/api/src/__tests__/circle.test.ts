import assert from "node:assert/strict";
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { decodeFunctionData, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { cctpFees, FORWARDING_HOOK_DATA, forwardedBridge, TOKEN_MESSENGER_HOOK_ABI } from "../circle/cctp.js";
import { screenAddress } from "../circle/compliance.js";
import { discoverServices } from "../circle/discovery.js";
import { draftGatewayTransfer, gatewayMaxFee, GATEWAY_MINTER_ABI, submitGatewayTransfer } from "../circle/gateway.js";
import { circleStatus } from "../circle/status.js";
import { entitySecretCiphertext, resetWalletKeyCache, createAgentWallet } from "../circle/wallets.js";
import { arcRequirement, authorizationTypedData, fetchChallenge, payAndFetch, paymentHeader, readChallenge } from "../circle/x402buyer.js";
import { AGENTIC_COMMERCE_ABI } from "../modules/jobs.js";
import { deviationBps } from "../oracles/pyth.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(KEY);
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const fakeFetch = (handler: Handler) => async (url: string, init?: RequestInit) => handler(url, init);
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("Circle products", () => {
  it("status is honest about keys", () => {
    const none = circleStatus(testConfig(), 0);
    const by = (s: typeof none, id: string) => s.products.find((p) => p.id === id)!;
    assert.equal(by(none, "gateway").state, "live");
    assert.equal(by(none, "compliance").state, "needs-key");
    assert.deepEqual(by(none, "dev-wallets").needs, ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"]);
    assert.equal(by(none, "paymaster").state, "unavailable-on-arc");
    const keyed = circleStatus(testConfig({ CIRCLE_API_KEY: "TEST_API_KEY:abc:def", CIRCLE_ENTITY_SECRET: "a".repeat(64) }), 0);
    assert.equal(by(keyed, "compliance").state, "configured");
    assert.equal(by(keyed, "dev-wallets").state, "configured");
    assert.equal(by(keyed, "stablefx").state, "configured");
  });

  it("Gateway: the burn intent is EIP-712 the depositor can sign, and the mint comes back unsigned", async () => {
    const draft = draftGatewayTransfer({ environment: "testnet", depositor: account.address, destination: "base", valueUnits: 10_000_000n });
    const typed = draft.typedData[0] as Parameters<typeof account.signTypedData>[0];
    const signature = await account.signTypedData(typed);
    assert.equal((await recoverTypedDataAddress({ ...(typed as object), signature } as Parameters<typeof recoverTypedDataAddress>[0])).toLowerCase(), account.address.toLowerCase());
    assert.equal(draft.fee.maxFee, String(gatewayMaxFee(10_000_000n, true, "0.0035")));
    assert.equal(gatewayMaxFee(10_000_000n, false, "0.0035"), 7_000n);
    assert.throws(() => draftGatewayTransfer({ environment: "testnet", depositor: account.address, destination: "narnia", valueUnits: 1n }));
    let sent: unknown;
    const result = await submitGatewayTransfer(fakeFetch((url, init) => {
      assert.equal(url, "https://gateway-api-testnet.circle.com/v1/transfer");
      sent = JSON.parse(String(init?.body));
      return json({ transferId: "t1", attestation: "0xaa", signature: "0xbb" });
    }), { environment: "testnet", destination: "base", burnIntents: draft.burnIntents, signatures: [signature] });
    assert.equal((sent as unknown[]).length, 1);
    assert.equal(result.mint.chainId, 84532);
    assert.deepEqual(decodeFunctionData({ abi: GATEWAY_MINTER_ABI, data: result.mint.data as Hex }).args, ["0xaa", "0xbb"]);
  });

  it("CCTP: live fees and a forwarded burn whose maxFee covers the forwarding fee", async () => {
    const fees = fakeFetch((url) => {
      assert.match(url, /\/v2\/burn\/USDC\/fees\/26\/6\?forward=true$/u);
      return json([{ finalityThreshold: 1000, minimumFee: 1, forwardFee: { low: 50000, med: 53703, high: 60000 } }, { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 50000, med: 53703, high: 60000 } }]);
    });
    assert.equal((await cctpFees(fees, "mainnet", 6, true))[0]?.forwardFee?.med, "53703");
    const r = await forwardedBridge(fees, { environment: "mainnet", owner: account.address, recipient: RECIPIENT, destination: "base", amountUnits: 10_000_000n, fast: true });
    assert.equal(r.maxFee, String(1_000n + 53_703n));
    assert.equal(r.burn, String(10_000_000n + 54_703n));
    const call = decodeFunctionData({ abi: TOKEN_MESSENGER_HOOK_ABI, data: r.transactions[1]!.data });
    assert.equal(call.args[7], FORWARDING_HOOK_DATA);
    assert.equal(call.args[1], 6);
  });

  it("Marketplace discovery keeps the Arc payment option", async () => {
    const r = await discoverServices(fakeFetch(() => json({ items: [{ resource: "https://data.example/pool", accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x1", payTo: "0x2", amount: "50000" }, { scheme: "exact", network: "eip155:5042", asset: "0x3600000000000000000000000000000000000000", payTo: RECIPIENT, amount: "50000" }], metadata: { provider: { name: "Data Co", category: "FINANCIAL_ANALYSIS" }, description: "Pools", method: "GET" } }] })), { network: "eip155:5042" }, Date.now());
    assert.equal(r.services[0]?.arc?.priceUsdc, "0.05");
    assert.equal(r.services[0]?.provider, "Data Co");
  });

  it("x402: reads a v2 challenge, builds EIP-3009 typed data and pays with the signature", async () => {
    const challenge = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", payTo: RECIPIENT, amount: "10000", maxTimeoutSeconds: 120, extra: { name: "USDC", version: "2" } }], resource: "https://api.example/answer" };
    const header = Buffer.from(JSON.stringify(challenge)).toString("base64");
    let paidWith: string | null = null;
    const service = fakeFetch((_url, init) => {
      const h = new Headers(init?.headers);
      if (h.get("payment-signature")) {
        paidWith = h.get("payment-signature");
        return json({ answer: 42 }, 200, { "payment-response": Buffer.from(JSON.stringify({ success: true, transaction: "0xabc" })).toString("base64") });
      }
      return new Response("", { status: 402, headers: { "payment-required": header } });
    });
    const probe = await fetchChallenge(service, "https://api.example/answer", "GET", publicResolver);
    assert.equal(probe.status, 402);
    const req = arcRequirement(probe.challenge!, "testnet")!;
    assert.equal(req.amount, "10000");
    assert.equal(arcRequirement(probe.challenge!, "mainnet"), null);
    const typed = authorizationTypedData({ environment: "testnet", from: account.address, requirement: req, now: Date.now() });
    const signature = await account.signTypedData(typed as Parameters<typeof account.signTypedData>[0]);
    const paid = await payAndFetch(service, { resource: "https://api.example/answer", method: "GET", header: paymentHeader(2, req, typed.message, signature) }, publicResolver);
    assert.equal(paid.status, 200);
    assert.deepEqual(paid.settlement, { success: true, transaction: "0xabc" });
    const decoded = JSON.parse(Buffer.from(String(paidWith), "base64").toString()) as { payload: { signature: string } };
    assert.equal(decoded.payload.signature, signature);
    await assert.rejects(fetchChallenge(service, "http://127.0.0.1/x", "GET", async () => [{ address: "127.0.0.1", family: 4 }]));
    const v1 = await readChallenge(json({ x402Version: 1, accepts: [{ scheme: "exact", network: "eip155:5042", asset: "0x3600000000000000000000000000000000000000", payTo: RECIPIENT, maxAmountRequired: "5" }] }, 402), "https://x");
    assert.equal(v1.accepts[0]?.amount, "5");
  });

  it("Compliance screening maps DENIED and caches", async () => {
    let calls = 0;
    const f = fakeFetch((_u, init) => {
      calls += 1;
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer k");
      return json({ data: { result: "DENIED", decision: { ruleName: "Sanctions", reasons: [{ riskScore: "BLOCKLIST" }] } } });
    });
    const a = await screenAddress(f, "k", "testnet", "0x7fb49965753A9eC3646fd5d004ee5AeD6Cc89999", 1_000);
    assert.equal(a.result, "DENIED");
    await screenAddress(f, "k", "testnet", "0x7fb49965753A9eC3646fd5d004ee5AeD6Cc89999", 2_000);
    assert.equal(calls, 1);
  });

  it("Wallets: the entity secret travels as RSA-OAEP ciphertext and agent wallets are SCA on Arc", async () => {
    resetWalletKeyCache();
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const secret = "ab".repeat(32);
    const bodies: Record<string, unknown>[] = [];
    const f = fakeFetch((url, init) => {
      if (url.endsWith("/config/entity/publicKey")) return json({ data: { publicKey } });
      bodies.push(JSON.parse(String(init?.body)));
      if (url.endsWith("/developer/walletSets")) return json({ data: { walletSet: { id: "set-1" } } });
      return json({ data: { wallets: [{ id: "w-1", address: RECIPIENT, blockchain: "ARC-TESTNET", accountType: "SCA" }] } });
    });
    const ct = await entitySecretCiphertext(f, { apiKey: "k", entitySecret: secret, walletSetId: null }, 0);
    assert.equal(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(ct, "base64")).toString("hex"), secret);
    const w = await createAgentWallet(f, { apiKey: "k", entitySecret: secret, walletSetId: null }, { environment: "testnet", refId: "pk_1", name: "Payroll" }, 0);
    assert.equal(w.walletSetId, "set-1");
    assert.equal(bodies[1]?.accountType, "SCA");
    assert.deepEqual(bodies[1]?.blockchains, ["ARC-TESTNET"]);
  });

  it("oracle deviation and ERC-8183 calldata", () => {
    assert.equal(deviationBps("1.1154", "1.1150"), 4);
    assert.equal(deviationBps(null, "1"), null);
    const data = "0x" as Hex;
    assert.ok(AGENTIC_COMMERCE_ABI.length >= 6, data);
  });
});

describe("Circle routes and screening in plans", () => {
  let ctx: AppContext;
  let served: Served;
  const arc = new FakeArc();
  const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41";
  const DENIED = "0x7fb49965753A9eC3646fd5d004ee5AeD6Cc89999";

  before(async () => {
    arc.setBalance("0x3600000000000000000000000000000000000000", OWNER, 1_000_000_000n);
    ctx = createContext(testConfig({ CIRCLE_API_KEY: "TEST_API_KEY:x:y" }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch({ "https://api.circle.com/v1/w3s/compliance/screening/addresses": { data: { result: "DENIED", decision: { ruleName: "Sanctions" } } } }) });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${served.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };

  it("a screened-denied recipient is refused by the Fence with a reason", async () => {
    const r = await post("/v1/intents", { text: `send 5 USDC to ${DENIED}`, owner: OWNER, environment: "testnet", fence: { schema: "lykia.fence/v1", recipients: { mode: "any" }, tokens: { unlisted: "deny" } } });
    const intent = r.body.intent as { verdict: { decision: string; reasons: { rule: string }[] } };
    assert.equal(intent.verdict.decision, "deny");
    assert.ok(intent.verdict.reasons.some((x) => x.rule === "recipients"));
    assert.ok((r.body.notes as string[]).some((n) => n.includes("Circle Compliance")));
  });

  it("status route, gateway draft route, and keyed routes say what they need", async () => {
    const s = await fetch(`${served.url}/v1/circle/status`).then((x) => x.json() as Promise<{ products: { id: string; state: string }[] }>);
    assert.equal(s.products.find((p) => p.id === "compliance")?.state, "configured");
    const d = await post("/v1/circle/gateway/transfer/draft", { owner: OWNER, destination: "ethereum", amount: "25", environment: "mainnet" });
    assert.equal(d.status, 200);
    const w = await post("/v1/circle/stablefx/quote", { from: "USDC", to: "EURC", amount: "10", type: "reference" });
    assert.equal(w.status, 502, "a configured key reaches Circle (offline here), never a fake quote");
    const job = await post("/v1/jobs/draft", { owner: OWNER, provider: RECIPIENT, description: "Summarise the week", expiresInHours: 24 });
    const call = decodeFunctionData({ abi: AGENTIC_COMMERCE_ABI, data: (job.body.transactions as { data: Hex }[])[0]!.data });
    assert.equal(call.functionName, "createJob");
  });
});
