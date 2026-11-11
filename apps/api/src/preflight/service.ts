/**
 * Preflight on the server: gathers what the checks read (the wallet, Arc's
 * gas price, Chainlink, the owner's preferences, Herding, recent plans,
 * contacts, contract code, the destination chain's gas, vault caps) and
 * runs core's checks. Every read is bounded and optional: a read that fails
 * only hides the findings that needed it. Nothing here signs or decides
 * a route; the model never sees a finding before code wrote it.
 */
import {
  getToken,
  networkFor,
  nextScheduleRun,
  runPreflight,
  tokenAddress,
  tokensFor,
  fingerprintOf,
  deriveIntentStatus,
  watchFindings,
  type Address,
  type ArcEnvironment,
  type Fence,
  type FenceFacts,
  type Finding,
  type IntentGraph,
  type Obligation,
  type PlanAction,
  type PreflightPlan,
  type PreflightState,
  type PreflightStep,
  type RecentPlan,
  type RunningRow,
  type StandingOrder,
} from "@lykia/core";
import { erc20Abi, parseAbi } from "viem";
import type { AppContext } from "../context.js";
import type { StepPlan } from "../engine/adapters.js";
import type { StepSource } from "../engine/planner.js";
import { gasFor } from "../engine/search.js";
import { FEEDS } from "../arc/prices.js";
import { services } from "../services.js";
import { getPreferences } from "../fold/preferences.js";
import { settle, withTimeout } from "../fold/util.js";
import { memoryService } from "../personal/memory.js";
import { staleApprovals } from "../agents/insights.js";
import { ordersService } from "../orders/service.js";
import { automations, listOwned } from "../devflows/stores.js";
import type { StoredAutomation } from "../devflows/automations.js";
import { typedCollection } from "../platform/typed.js";
import type { JsonValue } from "../store/types.js";
import { destinationGas } from "./destinations.js";

import { tx } from "@lykia/core";
/** The placeholder owner chat plans for when no wallet is connected: not anyone's wallet, so nothing to warn about. */
const SAMPLE_OWNER = "0x000000000000000000000000000000000000dead";
const DAY = 86_400_000;
const READ_MS = 2_500;
const VAULT_ABI = parseAbi(["function maxDeposit(address) view returns (uint256)"]);

export interface PlanPreflightInput {
  readonly graph: IntentGraph;
  readonly facts: FenceFacts;
  readonly plans: Readonly<Record<string, StepPlan>>;
  readonly sources?: Readonly<Record<string, StepSource>>;
  readonly actions: readonly PlanAction[];
  readonly fence: Fence;
  readonly account: "eoa" | "smart";
  readonly dryRun: boolean;
  /** What the planner read (balances, prices); absent = read now. */
  readonly reads?: { readonly balances: Readonly<Record<string, string>>; readonly prices: Readonly<Record<string, { readonly usd: string | null; readonly source: string; readonly updatedAt: string | null }>>; readonly at: number };
}

const iso = (ms: number) => new Date(ms).toISOString();
const lc = (a: string) => a.toLowerCase();

/** The plan as the checks see it. */
export function preflightPlanOf(input: PlanPreflightInput): PreflightPlan {
  const { graph, facts } = input;
  const keys = input.actions.map((a) => JSON.stringify(a));
  const steps: PreflightStep[] = graph.steps.map((s) => {
    const fact = facts.steps.find((f) => f.id === s.id);
    const plan = input.plans[s.id];
    const source = input.sources?.[s.id];
    const index = source ? keys.indexOf(JSON.stringify(source.action)) : -1;
    return {
      id: s.id,
      kind: s.kind,
      venue: s.venue,
      summary: s.summary,
      inputs: s.inputs,
      outputs: s.outputs,
      ...(s.fee ? { fee: s.fee } : {}),
      settlement: s.settlement,
      ...(s.route ? { route: s.route } : {}),
      ...(s.stage !== undefined ? { stage: s.stage } : {}),
      status: s.status,
      gasUnits: gasFor(plan?.adapter),
      action: index >= 0 ? index : graph.steps.length === 1 && input.actions.filter((a) => a.verb !== "reserve").length === 1 ? input.actions.findIndex((a) => a.verb !== "reserve") : null,
      usd: fact?.usd ?? null,
      ...(fact?.recipient ? { recipient: fact.recipient } : {}),
      ...(fact?.destination ? { destination: fact.destination } : {}),
      ...(fact?.slippageBps !== undefined ? { slippageBps: fact.slippageBps } : {}),
      ...(fact && "healthFactorAfter" in fact ? { healthFactorAfter: fact.healthFactorAfter ?? null } : {}),
      ...(fact && "fxDeviationBps" in fact ? { fxDeviationBps: fact.fxDeviationBps ?? null } : {}),
      params: plan?.params ?? {},
    };
  });
  return {
    id: graph.id,
    environment: graph.environment,
    owner: graph.owner,
    account: graph.agent?.address ?? graph.owner,
    accountKind: input.account,
    source: graph.source,
    dryRun: input.dryRun,
    createdAt: graph.createdAt,
    actions: input.actions,
    steps,
    verdict: { decision: graph.verdict.decision, reasons: graph.verdict.reasons },
    fence: input.fence,
    spent: facts.spent ?? null,
  };
}

/* --------------------------------------------------------------- reads */

interface StoredIntentLike {
  readonly graph?: IntentGraph;
  readonly facts?: FenceFacts;
}

/** The owner's stored plans (graph and facts), newest first. */
async function ownerPlans(ctx: AppContext, owner: Address): Promise<{ graph: IntentGraph; facts: FenceFacts | null }[]> {
  const docs = await ctx.store.collection<JsonValue>("intents").list({ limit: 2_000 }).catch(() => []);
  const out: { graph: IntentGraph; facts: FenceFacts | null }[] = [];
  for (const d of docs) {
    const v = d.value as unknown as StoredIntentLike;
    if (v.graph && lc(v.graph.owner) === lc(owner)) out.push({ graph: v.graph, facts: v.facts ?? null });
  }
  return out.sort((a, b) => b.graph.createdAt.localeCompare(a.graph.createdAt));
}

function recentOf(plans: readonly { graph: IntentGraph; facts: FenceFacts | null }[], now: number): RecentPlan[] {
  return plans
    .filter((p) => now - Date.parse(p.graph.createdAt) <= 2 * DAY)
    .map(({ graph, facts }) => ({
      id: graph.id,
      createdAt: graph.createdAt,
      status: deriveIntentStatus(graph),
      fingerprint: fingerprintOf(graph.steps.map((s) => {
        const f = facts?.steps.find((x) => x.id === s.id);
        return { kind: s.kind, inputs: s.inputs, ...(f?.recipient ? { recipient: f.recipient } : {}), ...(f?.destination ? { destination: f.destination } : {}) };
      })),
      swaps: graph.steps.filter((s) => s.kind === "swap" || s.kind === "fx").map((s) => ({ from: s.inputs[0]?.symbol ?? "", to: s.outputs[0]?.symbol ?? "", settledAt: s.status === "settled" ? (s.settledAt ?? graph.createdAt) : null, feeUsd: s.fee?.usd ?? null })),
      paid: graph.steps.filter((s) => s.kind === "transfer" && s.status === "settled").map((s) => facts?.steps.find((x) => x.id === s.id)?.recipient).filter((r): r is Address => Boolean(r)),
    }));
}

async function walletBalances(ctx: AppContext, environment: ArcEnvironment, account: Address): Promise<Record<string, string> | null> {
  const tokens = tokensFor(environment).map((t) => ({ symbol: t.symbol, address: tokenAddress(t, environment) })).filter((t): t is { symbol: string; address: Address } => t.address !== null);
  try {
    const reads = await ctx.chains.client(environment).multicall({ contracts: tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [account] }) as const), allowFailure: true });
    return Object.fromEntries(tokens.map((t, i) => [t.symbol, reads[i]?.status === "success" ? String(reads[i]!.result) : "0"]));
  } catch {
    return null;
  }
}

async function gasPrice(ctx: AppContext, environment: ArcEnvironment): Promise<PreflightState["gas"]> {
  try {
    const live = await withTimeout((ctx.chains.client(environment) as unknown as { getGasPrice?: () => Promise<bigint> }).getGasPrice?.() ?? Promise.resolve(undefined), READ_MS);
    return typeof live === "bigint" && live > 0n ? { priceWei: live.toString(), read: { source: "Arc chain · eth_gasPrice", readAt: iso(ctx.clock.now()) } } : null;
  } catch {
    return null;
  }
}

async function headAge(ctx: AppContext, environment: ArcEnvironment): Promise<PreflightState["head"]> {
  try {
    const client = ctx.chains.client(environment) as unknown as { getBlock?: (a: { blockTag: "latest" }) => Promise<{ timestamp: bigint; number: bigint }> };
    if (!client.getBlock) return null;
    const block = await withTimeout(client.getBlock({ blockTag: "latest" }), READ_MS);
    if (!block) return null;
    return { ageSeconds: Math.max(0, ctx.clock.now() / 1000 - Number(block.timestamp)), read: { source: `Arc chain · block ${block.number}`, readAt: iso(ctx.clock.now()) } };
  } catch {
    return null;
  }
}

const pauseOf = (id: string, owner: Address): Obligation["pause"] => ({ path: `/v1/automations/${encodeURIComponent(id)}/pause?owner=${lc(owner)}`, method: "post" });

/** Money that leaves the wallet by itself in the next 7 days, and rows that may move the same money. */
export async function herdingOf(ctx: AppContext, owner: Address, environment: ArcEnvironment): Promise<{ obligations: Obligation[]; running: RunningRow[] }> {
  const now = ctx.clock.now();
  const obligations: Obligation[] = [];
  const running: RunningRow[] = [];
  const [standing, unified, orders] = await Promise.all([
    settle(services(ctx).standing.list(owner), [] as StandingOrder[]),
    settle(listOwned(automations(ctx), lc(owner)) as Promise<StoredAutomation[]>, []),
    settle(ordersService(ctx).list(environment, owner), []),
  ]);
  for (const o of standing) {
    if (o.status !== "active" || o.environment !== environment || o.signer !== "wallet") continue;
    const next = o.nextRunAt ?? (o.trigger.kind === "schedule" ? iso(nextScheduleRun(o.trigger, now)) : null);
    running.push({ id: o.id, name: o.text, kind: "Automation", text: o.text, nextRunAt: next, pause: pauseOf(o.id, owner) });
    if (o.trigger.kind !== "schedule" || !next) continue;
    // How many runs land inside the week: daily ones up to 7, weekly 1, monthly at most 1.
    const runs = o.trigger.every === "day" ? Math.max(0, Math.min(7, Math.ceil((now + 7 * DAY - Date.parse(next)) / DAY))) : Date.parse(next) - now <= 7 * DAY ? 1 : 0;
    if (runs === 0) continue;
    for (const a of o.actions) {
      if (a.verb !== "send" || !("exact" in a.amount)) continue;
      const token = getToken(a.token);
      if (!token) continue;
      const [w = "0", f = ""] = a.amount.exact.split(".");
      const units = (BigInt(w) * 10n ** BigInt(token.decimals) + BigInt((f + "0".repeat(token.decimals)).slice(0, token.decimals) || "0")) * BigInt(runs);
      obligations.push({ id: o.id, name: o.text.slice(0, 60), kind: "Recurring payment", symbol: token.symbol, units: units.toString(), decimals: token.decimals, dueAt: next, pause: pauseOf(o.id, owner) });
    }
  }
  for (const a of unified) {
    if (a.status !== "active" || a.environment !== environment || a.action.type !== "plan") continue;
    const next = a.trigger.type === "schedule" ? iso(nextScheduleRun({ kind: "schedule", every: a.trigger.every, ...(a.trigger.weekday ? { weekday: a.trigger.weekday } : {}), ...(a.trigger.day ? { day: a.trigger.day } : {}), at: a.trigger.at, timezone: a.trigger.timezone }, now)) : null;
    running.push({ id: a.id, name: a.name, kind: "Automation", text: a.action.sentence, nextRunAt: next, pause: pauseOf(a.id, owner) });
  }
  for (const o of orders) {
    if (o.status !== "open" && o.status !== "waiting") continue;
    const sell = tokensFor(environment).find((t) => lc(tokenAddress(t, environment) ?? "") === lc(o.order.tokenIn));
    if (!sell) continue;
    const next = o.order.interval > 0 && o.lastExecutedAt ? iso(Date.parse(o.lastExecutedAt) + o.order.interval * 1000) : null;
    // LykiaOrders pulls each slice from the wallet when a keeper fills it: one slice is what can leave next.
    obligations.push({ id: o.hash, name: o.summary.slice(0, 60), kind: "Order", symbol: sell.symbol, units: String(o.order.amountIn), decimals: sell.decimals, dueAt: next });
  }
  return { obligations, running };
}

/** Old unlimited approvals: the token, the spender and the venue. */
async function unlimited(ctx: AppContext, environment: ArcEnvironment, owner: Address): Promise<PreflightState["unlimitedApprovals"]> {
  const list = await settle(withTimeout(staleApprovals(ctx, environment, owner), READ_MS), null);
  return (list ?? [])
    .filter((a) => a.severity === "act")
    .map((a) => {
      const data = a.transactions?.[0]?.data ?? "0x";
      const spender = `0x${data.slice(10 + 24, 10 + 64)}`;
      const [symbol = "", venue = ""] = a.title.replace(" still approved to ", "|").split("|");
      return { symbol, spender, venue };
    })
    .filter((a) => /^0x[0-9a-f]{40}$/iu.test(a.spender));
}

/* ---------------------------------------------------------- APY readings */

const apyReadings = (ctx: AppContext) => typedCollection<{ readonly apy: number; readonly at: string }>(ctx, "apy_readings");

/** Records today's APY for a vault and returns the one recorded 7 to 10 days ago, if any. */
async function apyWeekAgo(ctx: AppContext, environment: ArcEnvironment, vault: string, apyNow: number | null): Promise<number | null> {
  const now = ctx.clock.now();
  const key = (ms: number) => `${environment}:${lc(vault)}:${iso(ms).slice(0, 10)}`;
  if (apyNow !== null) await apyReadings(ctx).put(key(now), { apy: apyNow, at: iso(now) }, { ttlMs: 30 * DAY }).catch(() => undefined);
  for (let d = 7; d <= 10; d++) {
    const doc = await apyReadings(ctx).get(key(now - d * DAY)).catch(() => null);
    if (doc) return doc.value.apy;
  }
  return null;
}

/* ---------------------------------------------------------- gather + run */

export async function gatherState(ctx: AppContext, plan: PreflightPlan, input: Pick<PlanPreflightInput, "reads"> & { readonly fresh?: boolean }): Promise<PreflightState> {
  const env = plan.environment;
  const owner = plan.owner as Address;
  const account = plan.account as Address;
  const now = ctx.clock.now();
  const client = ctx.chains.client(env);
  const symbols = [...new Set(plan.steps.flatMap((s) => [...s.inputs, ...s.outputs].map((a) => a.symbol.split("@")[0]!)))];
  const transferTo = [...new Set(plan.steps.filter((s) => s.kind === "transfer" && s.recipient).map((s) => lc(s.recipient!)))];
  const bridges = plan.steps.filter((s) => s.kind === "bridge" && (s.destination ?? s.params.destination));
  const deposits = plan.steps.filter((s) => (s.kind === "deposit" || s.kind === "supply") && s.params.vault);
  const borrowing = plan.steps.some((s) => s.healthFactorAfter !== undefined);

  const [balances, gas, prices, prefs, herding, plans, contacts, pastRecipients, code, destinations, approvals, vaults, health, head] = await Promise.all([
    input.reads && !input.fresh ? Promise.resolve({ ...input.reads.balances }) : walletBalances(ctx, env, account),
    gasPrice(ctx, env),
    input.reads && !input.fresh ? Promise.resolve(input.reads.prices) : settle(services(ctx).prices.prices(symbols), {}),
    settle(getPreferences(ctx, owner), null),
    settle(herdingOf(ctx, owner, env), { obligations: [], running: [] }),
    settle(ownerPlans(ctx, owner), []),
    settle(memoryService(ctx).contacts(owner), null),
    settle(typedCollection<{ address: string }>(ctx, "security_recipients").list({ prefix: `${lc(owner)}:`, limit: 1000 }), []),
    Promise.all(transferTo.map(async (a) => [a, Boolean(await settle(withTimeout(client.getCode({ address: a as Address }), READ_MS), null))] as const)),
    Promise.all(bridges.map(async (s) => {
      const dest = (s.destination ?? s.params.destination)!;
      const recipient = s.recipient ?? owner;
      const read = await destinationGas(ctx.fetch, env, dest, recipient);
      return read ? ([`${dest}:${lc(recipient)}`, { nativeWei: read.nativeWei, nativeSymbol: read.nativeSymbol, chainName: dest, read: { source: read.source, readAt: iso(now) } }] as const) : null;
    })),
    unlimited(ctx, env, owner),
    Promise.all(deposits.map(async (s) => {
      const vault = s.params.vault as Address;
      const max = await settle(withTimeout(client.readContract({ address: vault, abi: VAULT_ABI, functionName: "maxDeposit", args: [account] }) as Promise<bigint>, READ_MS), null);
      const apy = s.route?.chosen.apy ? Number(s.route.chosen.apy) : null;
      return [lc(vault), { maxDeposit: typeof max === "bigint" ? max.toString() : null, apyNow: apy, apyWeekAgo: await apyWeekAgo(ctx, env, vault, apy), read: { source: `${s.route?.chosen.label ?? "Vault"} · maxDeposit on Arc`, readAt: iso(now) } }] as const;
    })),
    borrowing ? settle(withTimeout(services(ctx).flock.snapshot(env, owner), 4_000), null) : Promise.resolve(null),
    headAge(ctx, env),
  ]);

  const recent = recentOf(plans, now);
  const paid = new Map<string, string | null>();
  for (const p of plans.slice(0, 500)) for (const s of p.graph.steps) if (s.kind === "transfer" && s.status === "settled") {
    const r = p.facts?.steps.find((x) => x.id === s.id)?.recipient;
    if (r) paid.set(lc(r), paid.get(lc(r)) ?? null);
  }
  for (const d of pastRecipients) paid.set(lc(d.value.address), paid.get(lc(d.value.address)) ?? null);
  for (const c of contacts ?? []) if (c.confirmedSends > 0 || c.origin === "manual") paid.set(lc(c.address), c.name);
  const incoming = plans.flatMap(({ graph }) => graph.steps.filter((s) => (s.status === "submitted" || s.status === "settling") && s.kind !== "transfer").flatMap((s) => s.outputs.filter((o) => !o.symbol.includes("@")).map((o) => ({ label: s.summary.slice(0, 80), symbol: o.symbol, units: o.minimum ?? o.amount, decimals: o.decimals, etaSeconds: s.settlement.kind === "receipt" ? 5 : s.settlement.expectedSeconds }))));
  const feeds = Object.fromEntries(Object.entries(prices).map(([symbol, q]) => [symbol, { usd: q.usd, updatedAt: q.updatedAt, maxAgeSeconds: FEEDS[symbol]?.maxAgeSeconds ?? null, source: q.source }]));
  return {
    now,
    wallet: balances ? { balances, read: { source: `Arc chain · balanceOf${plan.accountKind === "smart" ? " (LykiaAccount)" : ""}`, readAt: iso(input.reads && !input.fresh ? input.reads.at : now) } } : null,
    gas,
    prices: { USDC: { usd: "1", updatedAt: null, maxAgeSeconds: null, source: "unit of account (Arc gas token)" }, ...feeds },
    prefs: { gasReserveUsdc: prefs?.gasFloorUsdc ?? "0.5", cashFloorUsd: prefs?.liquidityFloorUsd ?? "500", explicit: Boolean(prefs?.updatedAt), read: { source: prefs?.updatedAt ? "Your Lyko" : "Lykia default (Your Lyko)", readAt: prefs?.updatedAt ?? null } },
    obligations: herding.obligations,
    running: herding.running,
    recent,
    counterparties: plans.length === 0 && contacts === null ? null : [...paid].map(([address, label]) => ({ address, label })),
    code: Object.fromEntries(code),
    contracts: tokensFor(env).map((t) => ({ address: tokenAddress(t, env) ?? "", name: `${t.symbol} token` })).filter((t) => t.address !== ""),
    incoming,
    head,
    destinations: Object.fromEntries(destinations.filter((d): d is NonNullable<typeof d> => d !== null)),
    unlimitedApprovals: approvals,
    vaults: Object.fromEntries(vaults),
    health: Object.fromEntries((health?.health ?? []).map((h) => [h.venue, h.healthFactor])),
    budget: plan.accountKind === "smart" ? { kind: "leash", name: plan.fence.label ?? tx("this leash") } : plan.account !== plan.owner ? { kind: "agent", name: plan.fence.label ?? tx("the agent") } : { kind: "fence", name: tx("Your Fence") },
    beta: env === "mainnet" ? (ctx.config.beta ?? null) : null,
    minFeeGwei: networkFor(env).minMaxFeePerGasGwei,
  };
}

/** Every plan check for a plan; [] for the sample address (not anyone's wallet). */
export async function planPreflight(ctx: AppContext, input: PlanPreflightInput & { readonly fresh?: boolean }): Promise<Finding[]> {
  if (lc(input.graph.owner) === SAMPLE_OWNER) return [];
  const plan = preflightPlanOf(input);
  try {
    const state = await gatherState(ctx, plan, input);
    return runPreflight(plan, state);
  } catch (error) {
    ctx.log.warn("preflight failed", { intent: input.graph.id, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/* ------------------------------------------------------------- watch */

/** Lyko on watch: the wallet state the owner may already be in (gas nearly empty, stranded tokens, dust, what is due, a stuck bridge). */
export async function watchPreflight(ctx: AppContext, environment: ArcEnvironment, owner: Address, snapshot: { readonly native: { readonly usdc18: string }; readonly holdings: readonly { readonly where: string; readonly kind: string; readonly symbol: string; readonly amount: string | number; readonly usd: string | number | null }[]; readonly at: string; readonly block: string | null }, intents: readonly IntentGraph[], personal = true): Promise<Finding[]> {
  const now = ctx.clock.now();
  // Someone else's address: Lykia's defaults and no Herding (what is due is the owner's business).
  const [prefs, gas, herding] = await Promise.all([settle(getPreferences(ctx, personal ? owner : null), null), gasPrice(ctx, environment), personal ? settle(herdingOf(ctx, owner, environment), { obligations: [], running: [] }) : Promise.resolve({ obligations: [], running: [] })]);
  let usdc6: bigint;
  try {
    usdc6 = BigInt(snapshot.native.usdc18) / 10n ** 12n;
  } catch {
    return [];
  }
  const toUnits = (v: string | number, d: number) => {
    const [w = "0", f = ""] = String(v).split(".");
    try {
      return (BigInt(w) * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0")).toString();
    } catch {
      return "0";
    }
  };
  const holdings = snapshot.holdings.filter((h) => h.where === "wallet" && h.kind === "token").map((h) => {
    const d = getToken(h.symbol)?.decimals ?? 6;
    return { symbol: h.symbol, units: toUnits(h.amount, d), decimals: d, usd: h.usd === null ? null : String(h.usd) };
  });
  const inFlight = intents.flatMap((g) => g.steps.filter((s) => s.status === "settling" && s.settlement.kind === "cctp").map((s) => ({ intentId: g.id, stepId: s.id, summary: s.summary, destination: s.settlement.kind === "cctp" ? s.settlement.destination : "", sentAt: s.submittedAt ?? null, expectedSeconds: s.settlement.kind === "cctp" ? s.settlement.expectedSeconds : 60 })));
  return watchFindings({ now, owner, usdc: usdc6.toString(), read: { source: `Arc chain · native USDC${snapshot.block ? ` · block ${snapshot.block}` : ""}`, readAt: snapshot.at }, holdings, gasReserveUsdc: prefs?.gasFloorUsdc ?? "0.5", gas, minFeeGwei: networkFor(environment).minMaxFeePerGasGwei, obligations: herding.obligations, inFlight });
}

