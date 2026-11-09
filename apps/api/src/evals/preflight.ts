/**
 * Preflight evaluations: whole plans through the real planner and preflight
 * against a fake Arc (and, for a bridge, the destination chain's RPC), each
 * scored check by check. Every figure is computed by code; the cases check
 * what the owner is told and that each fix is concrete.
 *
 *   preflight-gas-reserve    2 of 2.01 USDC to EURC: a gas warning, a fix near 1.50 that re-plans clean
 *   preflight-insufficient   more than the wallet holds: what is missing, the fee and the gas, the max that fits
 *   preflight-poisoned       a lookalike of a past payee: blocked, "Did you mean" the real one
 *   preflight-bridge-gas     a bridge to Base for a recipient with no ETH there: a warning that says so
 *   preflight-fence-split    over today's cap: blocked, with what fits today and the rest tomorrow
 *   preflight-duplicate      the same plan again minutes after it was signed: a warning
 *   preflight-obligations    a recurring payment due this week the balance left won't cover: a warning and a pause
 *   preflight-health         a borrow under the loan floor blocks, one close to it warns, before and after shown
 */
import { DEFAULT_FENCE, preflightGate, preflightLead, runPreflight, type Address, type Fence, type Finding, type PreflightPlan, type PreflightState } from "@lykia/core";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { FakeArc, offlineFetch, testConfig } from "../__tests__/support.js";
import { planActions } from "../agents/engine.js";
import { services } from "../services.js";
import type { CaseScore, Check } from "./score.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
const PAYEE = "0x1111111111111111111111111111111111111111" as Address;
const FRIEND = "0xabcd1111111111111111111111111111111b1234" as Address;
const LOOKALIKE = "0xabcd9999999999999999999999999999999b1234" as Address;
const USDC = "0x3600000000000000000000000000000000000000";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const check = (name: string, ok: boolean, detail?: string): Check => ({ name, ok, ...(detail && !ok ? { detail } : {}) });
const open: Fence = { ...DEFAULT_FENCE, recipients: { mode: "any" } as Fence["recipients"], confirm: { aboveUsd: "100000", when: [] } };
const ids = (f: readonly Finding[] | undefined) => (f ?? []).map((x) => `${x.severity}:${x.id}`).join(", ");

interface PreflightCase {
  readonly id: string;
  run(): Promise<Check[]>;
}

function context(usdc: bigint, routes: Record<string, unknown> = {}): { ctx: AppContext; arc: FakeArc } {
  const arc = new FakeArc();
  arc.setBalance(USDC, OWNER, usdc);
  return { arc, ctx: createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch(routes) }) };
}

async function sentence(ctx: AppContext, text: string, fence: Fence = open) {
  const { readWithMemory } = await import("../personal/reader.js");
  const parsed = await readWithMemory(ctx, null, text);
  return planActions(ctx, parsed.actions, text, { environment: "mainnet", owner: OWNER, fence, proposedByAgent: false });
}

const findingsOf = (o: Awaited<ReturnType<typeof sentence>>): readonly Finding[] => (o.kind === "planned" ? (o.result.intent.preflight ?? []) : o.kind === "refused" ? (o.findings ?? []) : []);

export const PREFLIGHT_CASES: readonly PreflightCase[] = [
  {
    id: "preflight-gas-reserve",
    async run() {
      const { ctx } = context(2_010_000n);
      try {
        const out = await sentence(ctx, "buy EURC with 2 USDC");
        const f = findingsOf(out).find((x) => x.check === "gas-reserve");
        const fix = f?.fixes.find((x) => x.kind === "replan");
        const amount = Number((fix?.actions?.[0] as { amount?: { exact?: string } } | undefined)?.amount?.exact ?? NaN);
        const again = fix?.sentence ? findingsOf(await sentence(ctx, fix.sentence)) : [];
        const lead = preflightLead(findingsOf(out)) ?? "";
        return [
          check("a gas-reserve warning", f?.severity === "warn", ids(findingsOf(out))),
          check("the fix is computed near 1.50 USDC", amount >= 1.49 && amount <= 1.5, String(amount)),
          check("the warning says gas is paid in USDC", /gas is paid in USDC/u.test(f?.why ?? "")),
          check("the chat lead asks the fix's question", /Use 1\.5\d? USDC and keep 0\.5 for gas\?$/u.test(lead), lead),
          check("every figure has a source", (f?.figures ?? []).every((x) => x.source.length > 0)),
          check("the fix re-plans clean", !again.some((x) => x.check === "gas-reserve"), ids(again)),
          check("signing waits for an acknowledgement", preflightGate(findingsOf(out)).needsAck.includes("gas-reserve")),
        ];
      } finally {
        await closeContext(ctx);
      }
    },
  },
  {
    id: "preflight-insufficient",
    async run() {
      const { ctx } = context(2_010_000n);
      try {
        const out = await sentence(ctx, `send 2.5 USDC to ${PAYEE}`);
        const f = findingsOf(out).find((x) => x.check === "insufficient");
        const max = f?.fixes.find((x) => x.kind === "replan");
        return [
          check("planned as a preview, blocked", out.kind === "planned" && f?.severity === "block", ids(findingsOf(out))),
          check("names the amount, the fee and the gas", /2\.50 to move \+ 0\.025 Lykia fee \+ up to [\d.]+ network fee; the wallet has 2\.01 USDC/u.test(f?.why ?? ""), f?.why),
          check("offers the most that fits", max !== undefined && Number((max.actions?.[0] as { amount: { exact: string } }).amount.exact) < 2.01, max?.label),
          check("offers adding USDC, which needs no gas", f?.fixes.some((x) => x.kind === "add-funds" && !x.needsGas) === true),
        ];
      } finally {
        await closeContext(ctx);
      }
    },
  },
  {
    id: "preflight-poisoned",
    async run() {
      const { ctx } = context(100_000_000n);
      try {
        await ctx.store.collection("security_recipients").put(`${OWNER}:${FRIEND}`, { address: FRIEND, count: 3, lastAt: "2026-11-01T00:00:00.000Z" });
        const out = await sentence(ctx, `send 5 USDC to ${LOOKALIKE}`);
        const f = findingsOf(out).find((x) => x.check === "recipient");
        const fix = f?.fixes[0];
        return [
          check("blocked", f?.severity === "block", ids(findingsOf(out))),
          check("says it only looks like a past payee", /only looks like/u.test(f?.title ?? "")),
          check("'Did you mean' the real address", /^Did you mean 0xabcd1111…1234\?$/u.test(fix?.label ?? "") && (fix?.actions?.[0] as { to?: string } | undefined)?.to?.toLowerCase() === FRIEND, fix?.label),
          check("the fix re-plans to the real one", /0xabcd1111111111111111111111111111111b1234/iu.test(fix?.sentence ?? ""), fix?.sentence),
        ];
      } finally {
        await closeContext(ctx);
      }
    },
  },
  {
    id: "preflight-bridge-gas",
    async run() {
      const { ctx } = context(100_000_000n, { "https://mainnet.base.org": { jsonrpc: "2.0", id: 1, result: "0x0" } });
      try {
        const out = await sentence(ctx, "bridge 10 USDC to base");
        const all = findingsOf(out);
        const gas = all.find((x) => x.id.startsWith("bridge-destination:gas"));
        const unsupported = findingsOf(await sentence(ctx, "bridge 10 USDC to solana"));
        return [
          check("warns the recipient has no ETH on Base", gas?.severity === "warn" && /no ETH on Base/u.test(gas.title), ids(all)),
          check("the figure comes from Base's RPC", gas?.figures.some((x) => /mainnet\.base\.org/u.test(x.source)) === true, JSON.stringify(gas?.figures)),
          check("shows the bridge time and fee", all.some((x) => x.id.startsWith("bridge-destination:time"))),
          check("a chain Lykia can't reach is blocked with the supported list", unsupported.some((x) => x.severity === "block" && x.id === "bridge-destination:unsupported" && /Base/u.test(x.why)), ids(unsupported)),
        ];
      } finally {
        await closeContext(ctx);
      }
    },
  },
  {
    id: "preflight-fence-split",
    async run() {
      const { ctx } = context(1_000_000_000n);
      try {
        const fence: Fence = { ...open, caps: { perStepUsd: "1000", perIntentUsd: "2500", dailyUsd: "50" } };
        const out = await sentence(ctx, `send 80 USDC to ${PAYEE}`, fence);
        const f = findingsOf(out).find((x) => x.check === "fence-room");
        const split = f?.fixes.find((x) => x.id === "split-days");
        const today = Number((split?.actions?.[0] as { amount?: { exact?: string } } | undefined)?.amount?.exact ?? NaN);
        return [
          check("blocked over today's cap", f?.severity === "block", ids(findingsOf(out))),
          check("offers what fits today", today > 0 && today * 1.01 <= 50.01, String(today)),
          check("says the rest is for tomorrow", /tomorrow/u.test(split?.detail ?? ""), split?.detail),
          check("offers changing the Fence", f?.fixes.some((x) => x.kind === "change-fence") === true),
        ];
      } finally {
        await closeContext(ctx);
      }
    },
  },
  {
    id: "preflight-duplicate",
    async run() {
      const { ctx, arc } = context(100_000_000n);
      try {
        const first = await sentence(ctx, `send 5 USDC to ${PAYEE}`);
        if (first.kind !== "planned") return [check("first plan", false, first.kind)];
        await services(ctx).intents.prepare(first.result.intent.id, "s1", { confirm: true, acknowledge: true });
        void arc;
        const second = await sentence(ctx, `send 5 USDC to ${PAYEE}`);
        const f = findingsOf(second).find((x) => x.check === "duplicate");
        return [
          check("a repeat warning", f?.severity === "warn", ids(findingsOf(second))),
          check("says when the first one was started", /repeat of the plan you started signing/u.test(f?.say ?? ""), f?.say),
          check("links the earlier plan", f?.fixes.some((x) => x.path === `/app/outrun/${first.result.intent.id}`) === true),
        ];
      } finally {
        await closeContext(ctx);
      }
    },
  },
  {
    id: "preflight-obligations",
    async run() {
      const { ctx } = context(20_000_000n);
      try {
        await services(ctx).standing.create({ owner: OWNER, environment: "mainnet", draft: { trigger: { kind: "schedule", every: "week", weekday: "fri", at: "09:00", timezone: "UTC" }, actions: [{ verb: "send", token: "USDC", amount: { exact: "10" }, to: PAYEE }], text: "Pay 10 USDC every Friday" } });
        const out = await sentence(ctx, "buy EURC with 15 USDC");
        const f = findingsOf(out).find((x) => x.check === "obligations");
        return [
          check("warns what is due this week", f?.severity === "warn", ids(findingsOf(out))),
          check("lists the payment", f?.figures.some((x) => /Pay 10 USDC every Friday/u.test(x.label)) === true),
          check("offers a smaller amount", f?.fixes.some((x) => x.kind === "replan") === true),
          check("offers pausing it in Herding", f?.fixes.some((x) => x.kind === "pause" && /\/pause/u.test(x.path ?? "")) === true),
        ];
      } finally {
        await closeContext(ctx);
      }
    },
  },
  {
    id: "preflight-health",
    async run() {
      // The borrow step's health after comes from the planner's venue read; here it is given, and the check alone is scored.
      const base: PreflightPlan = { id: "out_eval0health", environment: "mainnet", owner: OWNER, account: OWNER, accountKind: "eoa", source: "borrow 200 USDC", dryRun: false, createdAt: new Date().toISOString(), actions: [{ verb: "borrow", token: "USDC", amount: { exact: "200" } }], steps: [], verdict: { decision: "allow", reasons: [] }, fence: DEFAULT_FENCE, spent: { dayUsd: "0", weekUsd: "0" } };
      const step = (hf: string) => ({ id: "s1", kind: "borrow" as const, venue: "aave-v4", summary: "Borrow 200 USDC", inputs: [], outputs: [], settlement: { kind: "receipt" as const }, stage: 1, status: "ready", gasUnits: 300_000, action: 0, usd: "200", healthFactorAfter: hf, params: {} });
      const state: PreflightState = { now: Date.now(), wallet: { balances: { USDC: "100000000" }, read: { source: "Arc", readAt: null } }, gas: null, prices: {}, prefs: { gasReserveUsdc: "0.5", cashFloorUsd: "0", read: { source: "Your Lyko", readAt: null } }, obligations: [], running: [], recent: [], counterparties: null, code: {}, contracts: [], incoming: [], head: null, destinations: {}, unlimitedApprovals: [], vaults: {}, health: { "aave-v4": "2.10" }, budget: { kind: "fence", name: "Your Fence" }, beta: null, minFeeGwei: 20 };
      const under = runPreflight({ ...base, steps: [step("1.32")] }, state).find((x) => x.check === "loan-health");
      const close = runPreflight({ ...base, steps: [step("1.62")] }, state).find((x) => x.check === "loan-health");
      return [
        check("under the floor blocks", under?.severity === "block"),
        check("close to it warns", close?.severity === "warn"),
        check("before -> after", close?.change?.before === "2.10" && close.change.after === "1.62", JSON.stringify(close?.change)),
      ];
    },
  },
];

export async function runPreflightCases(only: ReadonlySet<string> | null, category: string | null): Promise<CaseScore[]> {
  if (category && category !== "preflight") return [];
  const out: CaseScore[] = [];
  for (const c of PREFLIGHT_CASES.filter((x) => !only || only.has(x.id))) {
    try {
      const checks = await c.run();
      out.push({ id: c.id, category: "preflight", passed: checks.every((x) => x.ok), checks, score: checks.filter((x) => x.ok).length / Math.max(1, checks.length) });
    } catch (error) {
      out.push({ id: c.id, category: "preflight", passed: false, checks: [], score: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}
