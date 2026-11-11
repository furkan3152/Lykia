/**
 * The Fold's insights: what Lyko on watch notices, computed on the server
 * from the Flock, the owner's preferences, the Herding list, the Pack, the
 * day's spend and open plans. Deterministic thresholds, never a model. Each
 * insight carries the figures behind it (with human labels), a severity and,
 * when there is a sensible move, a one-tap draft that goes through the
 * proposal system. Unpriced holdings are flagged, never counted as zero.
 */
import { intlTag } from "../i18n/format.js";
import { ownerFence } from "../personal/fence.js";
import { assessToken, currentMix, genericPositionInsights, fenceForProfile, fromBaseUnits, riskTierOf, type Address, type ArcEnvironment, type FoldInsightKind, type FoldPreferences, type IntentGraph, type Position, type PositionsResponse } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { FoldFigure, FoldInsight, FoldInsightsResponse, FoldInstruction } from "@lykia/core/api/fold";
import type { Insight } from "@lykia/core/api/agents";
import type { AppContext } from "../context.js";
import { agentServices } from "../agents/index.js";
import { staleApprovals } from "../agents/insights.js";
import { getProfile } from "../personal/profile.js";
import { typedCollection } from "../platform/typed.js";
import { ordersService } from "../orders/service.js";
import { services } from "../services.js";
import { instructionsFor } from "./instructions.js";
import { getPreferences } from "./preferences.js";
import { handledInsights, listProposals } from "./proposals.js";
import { ownerIntents } from "./trails.js";
import { settle, withTimeout } from "./util.js";
import { readPositions } from "../positions/service.js";
import { fireWatches, sentMarks, watchFactsOf } from "../agents/instructions.js";
import { blockOf, isoOf } from "../agents/cards.js";
import type { BlockSource } from "@lykia/core/api/answer";
import type { Finding } from "@lykia/core";
import { watchPreflight } from "../preflight/service.js";

import { tx } from "@lykia/core";
const usd = (n: number) => `$${n.toLocaleString(intlTag(), { maximumFractionDigits: 2, minimumFractionDigits: n > 0 && n < 1 ? 2 : 0 })}`;
const amount = (n: number) => (n >= 100 ? String(Math.floor(n)) : n.toFixed(2).replace(/\.?0+$/u, ""));
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const RISK_WORD = { careful: "low", balanced: "medium", bold: "high" } as const;

/** Everything the rules read. Gathered once per request; every part is optional so a failing read only hides its own insights. */
export interface InsightInputs {
  readonly snapshot: FlockSnapshot;
  readonly preferences: FoldPreferences;
  readonly minHealthFactor: number;
  readonly instructions: readonly FoldInstruction[];
  readonly standing: readonly { readonly id: string; readonly text: string; readonly every: "day" | "week" | "month"; readonly sendUsd: number; readonly active: boolean }[];
  readonly pack: readonly PackAgentView[];
  readonly spentDayUsd: number | null;
  readonly dailyCapUsd: number | null;
  readonly betaDayUsd: number | null;
  readonly intents: readonly IntentGraph[];
  readonly approvals: readonly Insight[];
  readonly orders: readonly { readonly hash: string; readonly summary: string; readonly symbol: string | null; readonly trigger: number | null; readonly above: boolean }[];
  readonly bestLowRiskApy: { readonly name: string; readonly apy: number } | null;
  readonly heldApy: { readonly name: string; readonly apy: number; readonly usd: number } | null;
  /** The position map, when it could be read: health factors, LP ranges and orders come from it. */
  readonly positions?: PositionsResponse | null;
  /** Preflight's watch findings (gas nearly empty, stranded tokens, dust, what is due, a stuck bridge); they replace the plain gas-floor line. */
  readonly watch?: readonly Finding[] | null;
}

const WATCH_KIND: Readonly<Record<string, FoldInsightKind>> = { "gas-empty": "gas-floor", stranded: "stranded", dust: "dust" };

/** A preflight watch finding as a Fold insight: one primary fix, never one that needs gas the wallet lacks (watch.ts decides). */
export function insightFromFinding(f: Finding): Omit<FoldInsight, "handled"> {
  const kind: FoldInsightKind = WATCH_KIND[f.id] ?? (f.id.startsWith("obligations") ? "obligations" : f.id.startsWith("bridge-stuck") ? "bridge-stuck" : "gas-floor");
  const fix = f.fixes[0];
  const draft = !fix
    ? null
    : fix.kind === "add-funds"
      ? { label: fix.label, sentence: null, ...(fix.address ? { receive: fix.address as Address } : {}) }
      : fix.kind === "replan"
        ? { label: fix.label, sentence: fix.sentence ?? null }
        : fix.kind === "pause"
          ? { label: fix.label, sentence: null, href: "/app/fold/herding" }
          : { label: fix.label, sentence: null, ...(fix.path ? { href: fix.path } : {}) };
  const first = f.figures[0];
  return {
    id: kind === "gas-floor" ? "gas-floor" : f.id.slice(0, 80),
    kind,
    severity: f.severity === "block" || f.id === "gas-empty" ? "act" : f.severity === "warn" ? "watch" : "info",
    title: f.title,
    explain: f.why,
    figures: f.figures.map((x) => ({ label: x.label, value: x.value })),
    draft,
    ...(first ? { from: { source: first.source, readAt: isoOf(first.readAt), block: null } } : {}),
  };
}

/** One health factor per lending account (an Aave Spoke, a Morpho market) from the position map. */
export function healthFromPositions(positions: PositionsResponse): { venue: string; account: string; label: string; healthFactor: string | null; debt: Position | null }[] {
  const out = new Map<string, { venue: string; account: string; label: string; healthFactor: string | null; debt: Position | null }>();
  for (const v of positions.venues) {
    for (const p of v.positions) {
      if (!p.health || p.health.factor === null) continue;
      const account = p.id.split(":").slice(0, 2).join(":");
      const prev = out.get(account);
      const debt = Number(p.valueUsd ?? 0) < 0 ? p : (prev?.debt ?? null);
      out.set(account, { venue: p.venue, account, label: p.label.split(" · ")[0] ?? p.venueName, healthFactor: p.health.factor, debt });
    }
  }
  return [...out.values()];
}

export function computeInsights(input: InsightInputs): Omit<FoldInsight, "handled">[] {
  const out: Omit<FoldInsight, "handled">[] = [];
  const { snapshot: snap, preferences: prefs } = input;
  const total = num(snap.totalUsd);
  const wallet = (symbol: string) => snap.holdings.find((h) => h.where === "wallet" && h.kind === "token" && h.symbol === symbol);
  const risk = RISK_WORD[prefs.risk];
  const figures = (...rows: [string, string][]): FoldFigure[] => rows.map(([label, value]) => ({ label, value }));

  // idle-usdc: USDC above the liquidity floor, earning nothing.
  const usdc = num(wallet("USDC")?.usd);
  const floor = Number(prefs.liquidityFloorUsd);
  if (usdc !== null && usdc - floor >= 50) {
    const idle = usdc - floor;
    out.push({
      id: "idle-usdc",
      kind: "idle-usdc",
      severity: idle >= 1000 ? "act" : "watch",
      title: tx("{amount} of USDC is resting above your floor", { amount: usd(idle) }),
      explain: tx("Your wallet keeps {amount} liquid for gas and payments. The rest earns nothing while it sits; a {risk}-risk lending market or vault on Arc can hold it and you can withdraw any time.", { amount: usd(floor), risk }),
      figures: figures([tx("USDC in your wallet"), usd(usdc)], [tx("Your liquidity floor"), usd(floor)], [tx("Idle above the floor"), usd(idle)], [tx("Risk profile"), prefs.risk]),
      draft: { label: tx("Put it to work"), sentence: tx("Put {idle} USDC to work at {risk} risk", { idle: amount(idle), risk }) },
    });
  }

  // health-factor: lending positions near the Fence floor (per account from the position map when it was read).
  const lendingRead = input.positions ? input.positions.venues.filter((v) => v.venueKind === "lending" || v.venueKind === "market" || v.venue === "lykia-practice") : [];
  const fromMap = input.positions && lendingRead.length > 0 && lendingRead.every((v) => v.status === "ok") ? healthFromPositions(input.positions) : null;
  const healthRows = fromMap ?? snap.health.map((h) => ({ venue: h.venue, account: h.venue, label: h.venue, healthFactor: h.healthFactor, debt: null as Position | null }));
  for (const h of healthRows) {
    const hf = num(h.healthFactor);
    const id = fromMap ? `health-${h.account.replace(/[^a-z0-9-]+/giu, "-").slice(0, 60)}` : `health-${h.venue}`;
    if (hf === null) {
      out.push({ id, kind: "health-factor", severity: "watch", title: tx("The health factor on {label} could not be read", { label: h.label }), explain: tx("Without it nobody can judge how close the position is to liquidation, so the Fence refuses new borrowing there until it reads again."), figures: figures([tx("Venue"), h.label], [tx("Health factor"), "unknown"]), draft: null });
      continue;
    }
    if (hf >= input.minHealthFactor * 1.25) continue;
    const debt = h.debt ? { usd: h.debt.valueUsd, symbol: h.debt.symbol } : snap.holdings.find((x) => x.where === h.venue && x.kind === "debt");
    const debtUsd = Math.abs(num(debt?.usd) ?? 0);
    const repay = debtUsd * 0.25;
    out.push({
      id,
      kind: "health-factor",
      severity: hf < input.minHealthFactor + 0.1 ? "act" : "watch",
      title: tx("Health factor {value} on {label}", { value: hf.toFixed(2), label: h.label }),
      explain: tx("Your Fence floor is {minHealthFactor}. A price move could push the position under it and toward liquidation. Repaying part of the debt, or adding collateral, raises it.", { minHealthFactor: input.minHealthFactor }),
      figures: figures([tx("Health factor now"), hf.toFixed(2)], [tx("Your Fence floor"), String(input.minHealthFactor)], [tx("Debt on this venue"), debtUsd > 0 ? usd(debtUsd) : "unknown"], ...(repay > 0 ? ([[tx("Repaying a quarter"), usd(repay)]] as [string, string][]) : [])),
      draft: repay >= 1 ? { label: tx("Repay a quarter"), sentence: tx("Repay {repay} {value} on {venue}", { repay: amount(repay), value: debt?.symbol ?? "USDC", venue: h.venue }) } : null,
    });
  }

  // fx-drift: EURC share off the target mix.
  const mix = currentMix(snap.holdings);
  if (mix.totalUsd >= 50) {
    const drift = mix.eurcPct - prefs.targetMix.eurcPct;
    if (Math.abs(drift) > prefs.targetMix.bandPct) {
      const moveUsd = (Math.abs(drift) / 100) * mix.totalUsd;
      const over = drift > 0;
      out.push({
        id: "fx-drift",
        kind: "fx-drift",
        severity: Math.abs(drift) > prefs.targetMix.bandPct * 2 ? "act" : "watch",
        title: tx("EURC is {eurcPct}% of the Flock; your target is {eurcPct2}%", { eurcPct: Math.round(mix.eurcPct), eurcPct2: prefs.targetMix.eurcPct }),
        explain: tx("You asked Lyko to keep EURC within {bandPct} points of {eurcPct}%. {value} brings it back, inside your Fence's FX band.", { bandPct: prefs.targetMix.bandPct, eurcPct: prefs.targetMix.eurcPct, value: over ? tx("Converting part of the EURC to USDC") : tx("Converting some USDC to EURC") }),
        figures: figures([tx("EURC share now"), `${mix.eurcPct}%`], [tx("Your target"), `${prefs.targetMix.eurcPct}% ± ${prefs.targetMix.bandPct}`], [tx("To convert"), usd(moveUsd)]),
        draft: { label: over ? tx("Convert to USDC") : tx("Convert to EURC"), sentence: over ? tx("Convert {value} EURC to USDC", { value: amount(moveUsd / Math.max(0.5, Number(snap.prices.EURC?.usd ?? "1.1"))) }) : tx("Convert {moveUsd} USDC to EURC", { moveUsd: amount(moveUsd) }) },
      });
    }
  }

  // runway: scheduled payments in the next 30 days against liquid stablecoins.
  const per30 = { day: 30, week: 30 / 7, month: 1 } as const;
  const due = input.standing.filter((s) => s.active && s.sendUsd > 0).reduce((sum, s) => sum + s.sendUsd * per30[s.every], 0);
  if (due > 0) {
    const liquid = (usdc ?? 0) + (num(wallet("EURC")?.usd) ?? 0);
    if (due > liquid * 0.8) {
      const short = due - liquid;
      const earning = snap.holdings.some((h) => h.kind === "vault" || h.kind === "supply");
      out.push({
        id: "runway",
        kind: "runway",
        severity: due > liquid ? "act" : "watch",
        title: due > liquid ? tx("Scheduled payments need {amount} more than you hold liquid", { amount: usd(short) }) : tx("Scheduled payments will use most of your liquid balance"),
        explain: tx("In the next 30 days your recurring instructions send about {amount}. {value} keeps them from failing, or you can pause one in Herding.", { amount: usd(due), value: earning ? tx("Withdrawing from an earning position") : tx("Topping up the wallet") }),
        figures: figures([tx("Due in 30 days"), usd(due)], [tx("Liquid USDC and EURC"), usd(liquid)], [tx("Instructions"), String(input.standing.filter((s) => s.active).length)]),
        draft: earning && short > 0 ? { label: tx("Withdraw the gap"), sentence: tx("Withdraw {short} USDC from my vault", { short: amount(short) }) } : null,
      });
    }
  }

  // approval-hygiene: leftover allowances to venue contracts, each with a ready-to-sign revoke.
  if (input.approvals.length > 0) {
    const unlimited = input.approvals.filter((a) => a.severity === "act").length;
    out.push({
      id: "approval-hygiene",
      kind: "approval-hygiene",
      severity: unlimited > 0 ? "act" : "watch",
      title: tx("{length, plural, one {# token approval} other {# token approvals}} left open", { length: input.approvals.length }),
      explain: tx("Lykia's own steps approve exact amounts that the same transaction spends, so these are left from elsewhere. Each is a standing door an exploit at that venue could walk through. Revoking closes it."),
      figures: input.approvals.slice(0, 6).map((a) => ({ label: a.title, value: a.severity === "act" ? "unlimited" : "limited" })),
      draft: { label: input.approvals.length === 1 ? tx("Revoke it") : tx("Revoke all"), sentence: null, transactions: input.approvals.flatMap((a) => a.transactions ?? []) },
    });
  }

  // scent-warning: holdings that are not registry tokens.
  for (const h of snap.holdings) {
    if (h.kind !== "token") continue;
    const trust = assessToken({ environment: snap.environment, address: h.token, symbol: h.symbol });
    if (trust.status === "verified") continue;
    out.push({ id: `scent-${h.token.toLowerCase()}`, kind: "scent-warning", severity: trust.status === "lookalike" ? "act" : "watch", title: tx("{symbol} has red flags", { symbol: h.symbol }), explain: tx("{warning} Lyko keeps it out of every plan unless your Fence allows unlisted tokens.", { warning: trust.warning }), figures: figures([tx("Token"), h.symbol], [tx("Address"), `${h.token.slice(0, 8)}…${h.token.slice(-4)}`], [tx("Check"), trust.status]), draft: null });
  }

  // Preflight's watch side: gas nearly empty, stranded tokens, dust, what is due this week, a stuck bridge.
  if (input.watch) out.push(...input.watch.map(insightFromFinding));
  // gas-floor (when preflight could not run): native USDC for gas under the owner's floor.
  if (!input.watch) try {
    const gas = Number(fromBaseUnits(BigInt(snap.native.usdc18), 18));
    const gasFloor = Number(prefs.gasFloorUsdc);
    if (gas < gasFloor && (total ?? 0) > 0) out.push({ id: "gas-floor", kind: "gas-floor", severity: gas < gasFloor / 4 ? "act" : "watch", title: tx("Gas is down to {value} USDC", { value: gas.toFixed(3) }), explain: tx("Arc pays gas in USDC. Below your floor of {gasFloor} USDC a plan may stop halfway. Keep a little USDC in the wallet itself.", { gasFloor }), figures: figures([tx("Gas balance"), `${gas.toFixed(4)} USDC`], [tx("Your gas floor"), `${gasFloor} USDC`]), draft: null });
  } catch {
    /* malformed native balance: skip */
  }

  // beta-headroom: close to today's cap.
  const caps = [input.dailyCapUsd, input.betaDayUsd].filter((c): c is number => c !== null && c > 0);
  if (input.spentDayUsd !== null && caps.length > 0) {
    const cap = Math.min(...caps);
    const used = input.spentDayUsd / cap;
    if (used >= 0.8) out.push({ id: "beta-headroom", kind: "beta-headroom", severity: used >= 0.95 ? "act" : "watch", title: tx("{value}% of today's cap is used", { value: Math.round(used * 100) }), explain: tx("Plans above the {amount} that is left today are refused until the day resets (UTC). {value}", { amount: usd(Math.max(0, cap - input.spentDayUsd)), value: cap === input.betaDayUsd ? tx("This is the beta cap that sits above every Fence while the contracts are unaudited.") : tx("This is your Fence's daily cap.") }), figures: figures([tx("Spent today"), usd(input.spentDayUsd)], [tx("Daily cap"), usd(cap)], [tx("Left today"), usd(Math.max(0, cap - input.spentDayUsd))]), draft: null });
  }

  // order-near-trigger: an order within 2% of its trigger price.
  for (const o of input.orders) {
    if (o.trigger === null || o.symbol === null) continue;
    const price = num(snap.prices[o.symbol]?.usd);
    if (price === null || price <= 0) continue;
    const gap = Math.abs(price - o.trigger) / o.trigger;
    if (gap <= 0.02) out.push({ id: `order-${o.hash.slice(0, 18)}`, kind: "order-near-trigger", severity: "info", title: tx("{summary}: {value}% from its trigger", { summary: o.summary, value: (gap * 100).toFixed(1) }), explain: tx("A keeper fills it on the next pass once the price crosses, within the limits you signed."), figures: figures([tx("Price now"), `$${price.toFixed(4)}`], [tx("Trigger"), `$${o.trigger.toFixed(4)} (${o.above ? "above" : "below"})`]), draft: null });
  }

  // agent-budget: an agent near its daily budget.
  for (const a of input.pack) {
    if (a.status !== "active") continue;
    const cap = num(a.budget.caps.dailyUsd);
    const spent = num(a.budget.spent.dayUsd) ?? 0;
    if (!cap || cap <= 0 || spent / cap < 0.8) continue;
    out.push({ id: `agent-${a.id}`, kind: "agent-budget", severity: spent >= cap ? "act" : "watch", title: tx("{name} has used {value}% of today's budget", { name: a.name, value: Math.round((spent / cap) * 100) }), explain: tx("Its next moves are refused once the budget is spent. Raise it by asking Lyko (your wallet signs a looser Fence), or let it rest until tomorrow."), figures: figures([tx("Spent today"), usd(spent)], [tx("Daily budget"), usd(cap)], [tx("Role"), a.role]), draft: null });
  }

  // unsettled: steps still in flight.
  const inFlight = input.intents.flatMap((g) => g.steps.filter((s) => s.status === "submitted" || s.status === "settling").map((s) => ({ g, s })));
  if (inFlight.length > 0) {
    const cross = inFlight.filter(({ s }) => s.settlement.kind !== "receipt").length;
    out.push({ id: "unsettled", kind: "unsettled", severity: "info", title: tx("{length, plural, one {# step is} other {# steps are}} still settling", { length: inFlight.length }), explain: cross > 0 ? tx("A cross-chain mint (CCTP or Gateway) takes a few minutes to land. Lyko tracks it and marks it done in Trails.") : tx("Arc usually settles in under a second; Lyko checks the receipt and marks it done in Trails."), figures: inFlight.slice(0, 4).map(({ s }) => ({ label: s.summary, value: s.status })), draft: null });
  }

  // yield-change: a better low-risk rate, after fees, than where the money earns now.
  if (input.bestLowRiskApy && input.heldApy && input.bestLowRiskApy.apy - input.heldApy.apy >= 0.75 && input.heldApy.usd >= 100) {
    const gain = (input.heldApy.usd * (input.bestLowRiskApy.apy - input.heldApy.apy)) / 100 - input.heldApy.usd * 0.01 * 2;
    if (gain > 0) out.push({ id: "yield-change", kind: "yield-change", severity: "info", title: tx("{name} pays {value}%", { name: input.bestLowRiskApy.name, value: input.bestLowRiskApy.apy.toFixed(2) }), explain: tx("Your {name} position earns {value}%. Moving it gains about {amount} a year after Lykia's fee on both legs.", { name: input.heldApy.name, value: input.heldApy.apy.toFixed(2), amount: usd(gain) }), figures: figures([tx("Earning now"), `${input.heldApy.apy.toFixed(2)}%`], [tx("Best low-risk"), `${input.bestLowRiskApy.apy.toFixed(2)}%`], [tx("Position"), usd(input.heldApy.usd)], [tx("Yearly gain after fees"), usd(gain)]), draft: { label: tx("Move it"), sentence: tx("Withdraw {usd} USDC from {value} and put it to work at low risk", { usd: amount(input.heldApy.usd), value: /Aave/u.test(input.heldApy.name) ? (input.heldApy.name.split(" · ")[0] ?? "Aave V4") : tx("my vault") }) } });
  }

  // lp-out-of-range: liquidity that earns no fees until the price comes back into its band.
  for (const p of (input.positions?.venues ?? []).flatMap((v) => v.positions)) {
    if (p.state !== "out-of-range" || !p.range) continue;
    const value = Math.abs(num(p.valueUsd) ?? 0);
    if (value < 1) continue;
    out.push({
      id: `lp-${p.id.split(":").slice(-1)[0]}-${p.venue}`.slice(0, 80),
      kind: "lp-out-of-range",
      severity: value >= 500 ? "watch" : "info",
      title: tx("{label} is out of range", { label: p.label }),
      explain: tx("The price is {price} {quote}, outside your {lower}–{upper} band, so this liquidity earns no fees and sits in one token. Moving the range or removing the liquidity puts it back to work; Lykia cannot do that in one step yet, so Lyko can walk you through it.", { price: p.range.price, quote: p.range.quote, lower: p.range.lower, upper: p.range.upper }),
      figures: figures([tx("Price now"), `${p.range.price} ${p.range.quote}`], [tx("Your band"), `${p.range.lower}–${p.range.upper}`], [tx("Value"), usd(value)]),
      draft: null,
    });
  }

  // order-expiring: an open order whose deadline is within a day.
  for (const p of (input.positions?.venues ?? []).flatMap((v) => v.positions)) {
    if (p.state !== "escrowed" || !p.facts?.some((f) => f.label === "Expiring")) continue;
    const expires = p.facts.find((f) => f.label === "Expires")?.value ?? null;
    out.push({ id: `order-expiring-${p.id.slice(-12)}`, kind: "order-expiring", severity: "watch", title: tx("{label} expires within a day", { label: p.label }), explain: tx("If it does not fill before its deadline, nothing happens and the reserved amount stays in your wallet. Sign a new order to keep it running."), figures: figures([tx("Reserved"), `${p.amount} ${p.symbol}`], ...(expires ? ([[tx("Expires"), expires]] as [string, string][]) : [])), draft: null });
  }

  // Every other kind, generically from its detail blocks: near a threshold, something to claim, about to end, sitting idle.
  for (const g of genericPositionInsights((input.positions?.venues ?? []).flatMap((v) => v.positions), Date.parse(input.positions?.at ?? "") || Date.now())) out.push({ ...g, id: g.id.slice(0, 80), figures: [...g.figures] });

  const rank = { act: 0, watch: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/* ---------------------------------------------------------- gathering */

const seen = (ctx: AppContext) => typedCollection<{ readonly at: string; readonly titles: Readonly<Record<string, string>> }>(ctx, "fold_seen");

function sendUsdOf(actions: readonly { readonly verb: string; readonly token?: string; readonly amount?: unknown }[], eurUsd: number): number {
  let sum = 0;
  for (const a of actions) {
    if (a.verb !== "send" || !a.amount || typeof a.amount !== "object" || !("exact" in (a.amount as object))) continue;
    const v = Number((a.amount as { exact: string }).exact);
    if (Number.isFinite(v)) sum += a.token === "EURC" ? v * eurUsd : v;
  }
  return sum;
}

async function gatherInputs(ctx: AppContext, environment: ArcEnvironment, owner: Address, personal: boolean, snapshot?: FlockSnapshot): Promise<InsightInputs> {
  const snap = snapshot ?? (await services(ctx).flock.snapshot(environment, owner));
  const [prefs, profile] = await Promise.all([personal ? getPreferences(ctx, owner) : getPreferences(ctx, null), personal ? getProfile(ctx, owner) : getProfile(ctx, null)]);
  const fence = personal ? await ownerFence(ctx, owner) : fenceForProfile({ ...profile, risk: riskTierOf(prefs.risk) });
  const [approvals, instructions, standing, pack, spent, intents, rates, positions] = await Promise.all([
    settle(staleApprovals(ctx, environment, owner), []),
    personal ? settle(instructionsFor(ctx, owner), []) : Promise.resolve([]),
    personal ? settle(services(ctx).standing.list(owner), []) : Promise.resolve([]),
    personal ? settle(agentServices(ctx).pack.tree(owner, environment), []) : Promise.resolve([]),
    settle(services(ctx).intents.spent(environment, owner), { dayUsd: null, weekUsd: null }),
    personal ? settle(ownerIntents(ctx, owner), []) : Promise.resolve([]),
    personal ? settle(withTimeout(services(ctx).yields.rates(environment), 2_500), null) : Promise.resolve(null),
    settle(withTimeout(readPositions(ctx, environment, owner, { personal }), 9_000), null),
  ]);
  const eurUsd = Number(snap.prices.EURC?.usd ?? "1.1") || 1.1;
  const orders = personal
    ? (await Promise.all((["mainnet", "testnet"] as const).map((e) => settle(ordersService(ctx).list(e, owner), [])))).flat()
    : [];
  const vaultRates = rates?.vaults.filter((v) => v.asset === "USDC" && v.apy !== null) ?? [];
  const lowRisk = vaultRates.filter((v) => Number(v.tvlUsd ?? 0) >= 10_000_000).sort((a, b) => Number(b.apy) - Number(a.apy))[0];
  const held = snap.holdings.find((h) => h.kind === "vault" && vaultRates.some((v) => v.address.toLowerCase() === h.token.toLowerCase()));
  const heldRate = held ? vaultRates.find((v) => v.address.toLowerCase() === held.token.toLowerCase()) : undefined;
  // From the position map: the largest USDC position that earns (a vault or an Aave supply), with its own rate.
  const earningUsdc = (positions?.venues ?? []).flatMap((v) => v.positions).filter((p) => p.symbol === "USDC" && p.state === "earning" && p.apy && (p.venueKind === "vault" || p.venueKind === "lending") && Number(p.valueUsd ?? 0) > 0).sort((a, b) => Number(b.valueUsd) - Number(a.valueUsd))[0];
  const heldApy = earningUsdc ? { name: earningUsdc.label, apy: Number(earningUsdc.apy!.percent), usd: Number(earningUsdc.valueUsd) } : held && heldRate ? { name: heldRate.name || held.symbol, apy: Number(heldRate.apy) * 100, usd: Number(held.usd ?? 0) } : null;
  return {
    snapshot: snap,
    preferences: prefs,
    minHealthFactor: Number(fence.lending?.minHealthFactor ?? "1.2"),
    instructions,
    standing: standing.filter((o) => o.trigger.kind === "schedule").map((o) => ({ id: o.id, text: o.text, every: (o.trigger as { every: "day" | "week" | "month" }).every, sendUsd: sendUsdOf(o.actions as never, eurUsd), active: o.status === "active" })),
    pack,
    spentDayUsd: spent.dayUsd === null ? null : Number(spent.dayUsd),
    dailyCapUsd: fence.caps?.dailyUsd ? Number(fence.caps.dailyUsd) : null,
    betaDayUsd: environment === "mainnet" && ctx.config.beta ? Number(ctx.config.beta.perDayUsd) : null,
    intents: intents.filter((g) => g.environment === environment),
    approvals,
    orders: orders
      .filter((o) => (o.status === "open" || o.status === "waiting") && o.order.oracle !== "0x0000000000000000000000000000000000000000")
      .map((o) => {
        const symbol = /BTC/iu.test(o.summary) ? "cirBTC" : /EURC|EUR/iu.test(o.summary) ? "EURC" : null;
        const trigger = Number(o.order.triggerPrice) / 1e8;
        return { hash: o.hash, summary: o.summary, symbol, trigger: Number.isFinite(trigger) && trigger > 0 ? trigger : null, above: o.order.triggerAbove };
      }),
    bestLowRiskApy: lowRisk ? { name: lowRisk.name || tx("A Morpho vault"), apy: Number(lowRisk.apy) * 100 } : null,
    heldApy,
    positions,
    watch: await settle(watchPreflight(ctx, environment, owner, snap, intents.filter((g) => g.environment === environment), personal), null),
  };
}

/** The Fold's insights for an address. `personal` (the reader proved control) applies preferences, handled flags and the morning brief. */
export async function foldInsights(ctx: AppContext, environment: ArcEnvironment, owner: Address, personal: boolean): Promise<FoldInsightsResponse> {
  const inputs = await gatherInputs(ctx, environment, owner, personal);
  const computed = computeInsights(inputs);
  // Watch tasks Ask Lyko handed over are checked against the same reads; a met one is an insight of its own.
  const health = inputs.positions ? healthFromPositions(inputs.positions).map((h) => ({ venue: h.venue, label: h.label, factor: h.healthFactor })) : inputs.snapshot.health.map((h) => ({ venue: h.venue, label: h.venue, factor: h.healthFactor }));
  const watched = personal ? await settle(fireWatches(ctx, owner, environment, watchFactsOf(inputs, health), computed), []) : [];
  const raw = [...watched, ...computed];
  const hidden = new Set<FoldInsightKind>(personal ? inputs.preferences.insights.hidden : []);
  const done = personal ? await handledInsights(ctx, owner) : new Map<string, string>();
  const sent = personal ? await settle(sentMarks(ctx, owner, environment), new Map()) : new Map();
  // Every insight says where its figures were read: the position map for positions, the Flock snapshot for the rest.
  const snapFrom: BlockSource = { source: "Arc chain · the Flock", readAt: isoOf(inputs.snapshot.at), block: blockOf(inputs.snapshot.block) };
  const mapFrom: BlockSource | null = inputs.positions ? { source: "Arc chain and venue APIs", readAt: isoOf(inputs.positions.at), block: blockOf(inputs.positions.block) } : null;
  const fromOf = (kind: FoldInsightKind): BlockSource => (mapFrom && (kind === "health-factor" || kind === "lp-out-of-range" || kind === "yield-change" || kind === "near-threshold" || kind === "unclaimed" || kind === "expiring" || kind === "idle-position" || kind === "watch-task") ? mapFrom : snapFrom);
  const insights: FoldInsight[] = raw.filter((i) => !hidden.has(i.kind)).map((i) => ({ ...i, from: i.from ?? fromOf(i.kind), handled: done.get(i.id) === i.title, ...(sent.get(i.id) && done.get(i.id) === i.title ? { sent: sent.get(i.id) } : {}) }));
  let brief: FoldInsightsResponse["brief"] = { since: null, lines: [] };
  if (personal) {
    const last = (await seen(ctx).get(owner.toLowerCase()).catch(() => null))?.value ?? null;
    if (last) {
      const fresh = insights.filter((i) => !i.handled && last.titles[i.id] !== i.title).map((i) => i.title);
      const finished = (await listProposals(ctx, owner, { reconcile: false }).catch(() => [])).filter((p) => (p.status === "done" || p.status === "stopped") && p.updatedAt > last.at).map((p) => `${p.status === "done" ? tx("Done") : tx("Stopped")}: ${p.title}`);
      brief = { since: last.at, lines: [...fresh, ...finished].slice(0, 5) };
    }
  }
  return { owner: owner.toLowerCase() as Address, environment, at: new Date(ctx.clock.now()).toISOString(), insights, brief, personal };
}

/** "I've seen these": the next brief only lists what changed after now. */
export async function markSeen(ctx: AppContext, environment: ArcEnvironment, owner: Address): Promise<{ readonly at: string }> {
  const current = await foldInsights(ctx, environment, owner, true).catch(() => null);
  const at = new Date(ctx.clock.now()).toISOString();
  await seen(ctx).put(owner.toLowerCase(), { at, titles: Object.fromEntries((current?.insights ?? []).map((i) => [i.id, i.title])) }, { ttlMs: 90 * 86_400_000 });
  return { at };
}
