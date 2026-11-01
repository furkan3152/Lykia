/**
 * End-to-end mainnet dry run, in process: the real app against Arc mainnet
 * and the real price and venue sources, with an in-memory store. For each
 * scenario it plans (with Lykia's fee), reads the Fence verdict, prepares
 * the first ready step's unsigned calls and simulates every call with
 * eth_call from the owner, whose USDC balance is set through a state
 * override. Nothing is signed or broadcast.
 *
 * Run: npm run smoke:e2e -w @lykia/api
 */
import { DEFAULT_FENCE, type Address } from "@lykia/core";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { closeContext, createContext } from "../context.js";
import { MemoryStore } from "../store/memory.js";
import { systemClock } from "../clock.js";

const OWNER = (process.env.E2E_OWNER ?? "0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb") as Address // a funded mainnet EOA, used only as eth_call sender;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const FUNDED_WEI = "0x" + (10_000n * 10n ** 18n).toString(16); // 10,000 native USDC (18 decimals) = 10,000 USDC ERC-20 face

const scenarios: { name: string; body: Record<string, unknown> }[] = [
  // The payee is on the Fence's allowlist, as a named payee would be.
  { name: "send 25 USDC to a named payee", body: { actions: [{ verb: "send", token: "USDC", amount: { exact: "25" }, to: PAYEE }], fence: { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: [PAYEE] } } } },
  { name: "swap 100 USDC to EURC", body: { actions: [{ verb: "swap", from: "USDC", to: "EURC", amount: { exact: "100" } }] } },
  { name: "earn on 200 USDC", body: { actions: [{ verb: "earn", token: "USDC", amount: { exact: "200" } }] } },
  // A Fence that allows $1,000,000 per step still cannot pass the beta cap.
  { name: "beta cap: send 1500 USDC under a loose Fence", body: { actions: [{ verb: "send", token: "USDC", amount: { exact: "1500" }, to: PAYEE }], fence: { ...DEFAULT_FENCE, recipients: { mode: "allowlist", allow: [PAYEE] }, caps: { perStepUsd: "1000000", perIntentUsd: "1000000", dailyUsd: "1000000", weeklyUsd: "1000000" }, confirm: { aboveUsd: "1000000", when: [] } } } },
];

const config = loadConfig({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/DATABASE_URL|POSTGRES_URL/u.test(k))), NODE_ENV: "development", LYKIA_MODE: "mainnet", LYKIA_LOG_LEVEL: "silent" });
const ctx = createContext(config, { store: new MemoryStore(systemClock) });
const app = createApp(ctx);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const address = server.address();
const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

// Loose view of JSON answers: the script prints them, the API's own tests check their types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, json: await response.json().catch(() => null) };
}

const lines: string[] = [];
const log = (line: string) => {
  lines.push(line);
  process.stdout.write(`${line}\n`);
};
let failures = 0;

const fees = await call("GET", "/v1/fees");
log(`fees: ${fees.json?.bps ?? "?"} bps to ${fees.json?.recipient ?? "?"}; beta cap ${fees.json?.beta ? `$${fees.json.beta.perStepUsd}/step, $${fees.json.beta.perDayUsd}/day` : "off"}`);

for (const scenario of scenarios) {
  log(`\n== ${scenario.name}`);
  const planned = await call("POST", "/v1/intents", { ...scenario.body, owner: OWNER, environment: "mainnet", signer: "wallet" });
  if (planned.status >= 400) {
    log(`  plan: HTTP ${planned.status} ${planned.json?.error?.code ?? ""} ${planned.json?.error?.message ?? ""}`);
    failures += 1;
    continue;
  }
  const intent = planned.json.intent;
  const verdict = intent.verdict;
  log(`  plan ${intent.id}: ${intent.steps.length} step(s): ${intent.steps.map((s: Json) => `${s.id} ${s.kind}@${s.venue}${s.fee ? ` (fee ${Number(s.fee.amount) / 10 ** s.fee.decimals} ${s.fee.symbol})` : ""}`).join(", ")}`);
  log(`  verdict: ${verdict.decision}${verdict.signable ? ", signable" : ", not signable"}; digest ${String(verdict.digest).slice(0, 22)}…`);
  for (const reason of verdict.reasons.filter((r: Json) => r.decision !== "allow")) log(`    - ${reason.rule}: ${reason.message}`);
  const expectDeny = scenario.name.startsWith("beta cap");
  if (expectDeny) {
    const capped = verdict.decision === "deny" && verdict.reasons.some((r: Json) => r.rule === "beta.cap");
    log(`  beta cap ${capped ? "holds" : "DID NOT HOLD"}`);
    if (!capped) failures += 1;
    continue;
  }
  if (!verdict.signable) {
    failures += 1;
    continue;
  }
  const ready = intent.steps.find((s: Json) => s.status === "ready");
  if (!ready) {
    log("  no ready step");
    failures += 1;
    continue;
  }
  const prepared = await call("POST", `/v1/intents/${intent.id}/steps/${ready.id}/prepare`, { confirm: true });
  if (prepared.status >= 400) {
    log(`  prepare ${ready.id}: HTTP ${prepared.status} ${prepared.json?.error?.message ?? ""}`);
    failures += 1;
    continue;
  }
  const transactions = (prepared.json.transactions ?? prepared.json.step?.transactions ?? []) as { from: Address; to: Address; data: `0x${string}`; value: string; label: string }[];
  log(`  prepare ${ready.id}: ${transactions.length} transaction(s), binding ${String(prepared.json.binding ?? prepared.json.step?.binding ?? "").slice(0, 22)}…`);
  for (const tx of transactions) {
    try {
      await ctx.chains.rawRpc("mainnet", "eth_call", [{ from: tx.from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.value).toString(16)}` }, "latest", { [tx.from]: { balance: FUNDED_WEI } }]);
      log(`    eth_call ok: ${tx.label} -> ${tx.to}`);
    } catch (error) {
      failures += 1;
      log(`    eth_call REVERTED: ${tx.label} -> ${tx.to}: ${error instanceof Error ? error.message.split("\n")[0]?.slice(0, 200) : String(error)}`);
    }
  }
}

const eco = await call("GET", "/v1/ecosystem?environment=mainnet");
log(`\necosystem: ${eco.json?.totals?.protocols} protocols, ${eco.json?.totals?.verified} verified, ${eco.json?.totals?.routable} routable; TVL on Arc ${eco.json?.totals?.tvlUsd !== null ? `$${Math.round((eco.json?.totals?.tvlUsd ?? 0) / 1e6)}M` : "unavailable"}`);
const manifest = await call("GET", "/.well-known/x402");
log(`x402 manifest: ${manifest.json?.services?.length ?? 0} paid services, payTo ${manifest.json?.payTo}, settlement ${manifest.json?.settlement?.mode}`);
const challenge = await call("POST", "/v1/x402/quote", { kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "100" });
log(`x402 quote without payment: HTTP ${challenge.status} ${challenge.json?.error ? JSON.stringify(challenge.json.error).slice(0, 300) : ""} (${challenge.json?.accepts?.[0]?.network ?? "-"}, ${challenge.json?.accepts?.[0]?.amount ?? "-"} units)`);
if (challenge.status !== 402) failures += 1;

log(`\n${failures === 0 ? "e2e: all checks passed" : `e2e: ${failures} check(s) failed`}`);
server.close();
await closeContext(ctx);
process.exit(failures === 0 ? 0 : 1);
