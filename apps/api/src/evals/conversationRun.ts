/**
 * The conversation suite, offline: every case goes through the real
 * POST /v1/agent/chat of an in-process API (fake Arc, no model, so the
 * reader path), signed in as the owner or with no wallet at all, and is
 * scored by the same checks the live runner uses (conversations.ts).
 */
import { DEFAULT_FENCE, findToken, LEASH_SCHEMA, tokenAddress, type Address, type Leash } from "@lykia/core";
import type { PulseFeed } from "../arc/pulse.js";
import { createApp } from "../app.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../__tests__/support.js";
import { createWatch } from "../agents/instructions.js";
import { leashService } from "../leash/service.js";
import { issueToken } from "../platform/session.js";
import { services } from "../services.js";
import { CONVERSATIONS, scoreConversation, type ChatAnswer, type ConversationCase } from "./conversations.js";
import type { CaseScore } from "./score.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
const USDC = "0x3600000000000000000000000000000000000000";
const GALAXY = "0x8E357432CC12ff425c36432F312968aEb16112AF";
const PAYEE = "0x1111111111111111111111111111111111111111" as Address;
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

const MAIN_SPOKE = "0xb843bdc3a87a05e77e07df9fe48928b3a34b134d";
const EURC_MAINNET = (() => {
  const t = findToken("mainnet", "EURC");
  return t ? (tokenAddress(t, "mainnet") ?? "").toLowerCase() : "";
})();

/** The fake Arc with a quoter that knows which way a USDC/EURC swap goes, so both directions quote near the reference. */
export class TalkArc extends FakeArc {
  override client() {
    const base = super.client();
    return {
      ...base,
      simulateContract: async (call: { args: readonly [{ amountIn: bigint; fee: number; tokenIn?: string }] }) => {
        const params = call.args[0];
        if (params.fee !== 500) throw new Error("no pool");
        const fromEurc = (params.tokenIn ?? "").toLowerCase() === EURC_MAINNET;
        return { result: [fromEurc ? (params.amountIn * 1_000_000n) / this.quoteRatePpm : (params.amountIn * this.quoteRatePpm) / 1_000_000n, 0n, 0, 0n] };
      },
    } as never;
  }
}

/**
 * A loan under the floor on Aave V4's Main Spoke, as the chain would answer: 600 USDC owed against 0.0153 cirBTC at
 * health 1.38. The position reader and the planner both read it from here, so the fix is computed and planned on
 * the same figures.
 */
export function lendOnAave(arc: FakeArc): void {
  const main = (address: string) => address.toLowerCase() === MAIN_SPOKE;
  arc.extraReads.set("getReserveCount", (c) => (main(c.address) ? 3n : 2n));
  arc.extraReads.set("getUserSuppliedAssets", (c) => (main(c.address) && c.args?.[0] === 2n ? 1_530_000n : 0n));
  arc.extraReads.set("getUserTotalDebt", (c) => (main(c.address) && c.args?.[0] === 0n ? 600_000_000n : 0n));
  arc.extraReads.set("getUserReserveStatus", (c) => [main(c.address) && c.args?.[0] === 2n, main(c.address) && c.args?.[0] === 0n]);
  arc.extraReads.set("getReserve", (c) => ({ underlying: c.args?.[0] === 0n ? USDC : c.args?.[0] === 1n ? "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" : "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", hub: "0x17288dfc86205301064577b98B02b81017e6F79C", assetId: 0, decimals: 6, collateralRisk: 0, flags: 0, dynamicConfigKey: 1 }));
  arc.extraReads.set("getDynamicReserveConfig", () => ({ collateralFactor: 7800, maxLiquidationBonus: 0, liquidationFee: 0 }));
  arc.extraReads.set("getUserAccountData", (c) => (main(c.address) ? { riskPremium: 0n, avgCollateralFactor: 78n * 10n ** 16n, healthFactor: 138n * 10n ** 16n, totalCollateralValue: 1_062n * 10n ** 26n, totalDebtValueRay: 600n * 10n ** 26n * 10n ** 27n, activeCollateralCount: 1n, borrowCount: 1n } : { riskPremium: 0n, avgCollateralFactor: 0n, healthFactor: 0n, totalCollateralValue: 0n, totalDebtValueRay: 0n, activeCollateralCount: 0n, borrowCount: 0n }));
}

async function prepare(ctx: AppContext, arc: FakeArc, c: ConversationCase): Promise<void> {
  const setup = c.setup ?? [];
  if (setup.includes("loan")) lendOnAave(arc);
  if (setup.includes("collateral")) {
    const cirbtc = findToken("mainnet", "cirBTC");
    const at = cirbtc ? tokenAddress(cirbtc, "mainnet") : null;
    if (cirbtc && at) arc.setBalance(at, OWNER, 10n ** BigInt(cirbtc.decimals) / 100n);
  }
  if (setup.includes("running")) {
    const order = await services(ctx).standing.create({ owner: OWNER, environment: "mainnet", draft: { trigger: { kind: "schedule", every: "week", weekday: "fri", at: "09:00", timezone: "UTC" }, actions: [{ verb: "send", token: "USDC", amount: { exact: "5" }, to: PAYEE }], text: "Pay 5 USDC rent every Friday" } });
    if (setup.includes("paused")) await services(ctx).standing.setStatus(order.id, "paused");
    await createWatch(ctx, { owner: OWNER, environment: "mainnet", condition: { kind: "health-below", threshold: "1.5" }, threadId: null });
    await leashService(ctx).put({ schema: LEASH_SCHEMA, id: "lsh_0000000000c1", owner: OWNER.toLowerCase(), environment: "mainnet", agentId: "agent_eval", agentName: "Invoice bot", parentAgentId: null, template: "pay-invoices", fence: DEFAULT_FENCE, fenceHash: "sha256:00", budget: { perStepUsd: "10", perDayUsd: "20", totalUsd: "140" }, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), tools: ["plan"], venues: null, recipients: [], status: "active", session: null, tag: null, key: { id: "key_c1", prefix: "lk_c1" }, createdBy: { via: "session", developer: OWNER.toLowerCase() }, createdAt: new Date().toISOString() } as unknown as Leash);
  }
}

async function ask(served: Served, token: string | null, c: ConversationCase, say: string, threadId: string | undefined): Promise<ChatAnswer> {
  const response = await fetch(`${served.url}/v1/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...(token ? { "lykia-session": token } : {}) },
    body: JSON.stringify({ message: say, environment: "mainnet", ...(c.who === "owner" ? { owner: OWNER } : {}), ...(threadId ? { threadId } : {}), ...(c.origin ? { origin: c.origin } : {}) }),
  });
  const body = (await response.json().catch(() => null)) as (ChatAnswer & { error?: { message?: string } }) | null;
  if (!response.ok || !body) throw new Error(`HTTP ${response.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
  return body;
}

export async function runConversation(c: ConversationCase, print = false): Promise<CaseScore> {
  const arc = new TalkArc();
  arc.setBalance(USDC, OWNER, 900_000_000n);
  const eurc = findToken("mainnet", "EURC");
  const eurcAt = eurc ? tokenAddress(eurc, "mainnet") : null;
  if (eurcAt) arc.setBalance(eurcAt, OWNER, 200_000_000n);
  arc.vaultAssets.set(GALAXY.toLowerCase(), 80_000_000_000_000n);
  const ctx = createContext(testConfig({ LYKIA_RATE_LIMIT_HEAVY: "100000", LYKIA_RATE_LIMIT_SHARED: "100000", LYKIA_RATE_LIMIT_DEFAULT: "100000" }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
  const served = await serve(createApp(ctx));
  try {
    await prepare(ctx, arc, c);
    const token = c.who === "owner" ? issueToken(ctx, OWNER).token : null;
    const answers: ChatAnswer[] = [];
    let threadId: string | undefined;
    for (const turn of c.turns) {
      const a = await ask(served, token, c, turn.say, threadId);
      threadId = a.threadId ?? threadId;
      answers.push(a);
      if (print) console.log(`\n> ${turn.say}\n${a.reply}\n  [${a.stopReason}] cards: ${a.events.filter((e) => e.event === "block").map((e) => (e.data as { kind: string }).kind).join(", ") || "none"} · plans: ${JSON.stringify(a.proposals.map((p) => p.steps))} · options: ${JSON.stringify((a.events.filter((e) => e.event === "clarify").pop()?.data as { options?: string[] } | undefined)?.options ?? [])}`);
    }
    return scoreConversation(c, answers, c.who === "guest");
  } catch (error) {
    return { id: c.id, category: `talk:${c.category}`, passed: false, checks: [], score: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await served.close();
    await closeContext(ctx);
  }
}

export async function runConversationCases(only: ReadonlySet<string> | null, category: string | null, print = false): Promise<CaseScore[]> {
  const out: CaseScore[] = [];
  for (const c of CONVERSATIONS.filter((x) => (!only || only.has(x.id)) && (!category || `talk:${x.category}` === category || category === "talk"))) out.push(await runConversation(c, print));
  return out;
}
