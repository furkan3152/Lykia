/**
 * Starting things from Ask Lyko, and the answers that replaced pages.
 *
 *   agent         a Pack agent: it holds a leash (its own Fence and a daily
 *                 budget carved from the owner's). The card creates it once
 *                 the owner confirms.
 *   leash         a leash for an outside bot: the card opens the leash
 *                 review sheet (who, from, limits, review, keys).
 *   autopilot     Autopilot's limits: the card opens the Autopilot review
 *                 sheet (read, accept, sign once).
 *   autopilot     an automation Autopilot signs: the card adds it once the
 *     task        owner confirms. DCA is a LykiaOrders order, not a task.
 *   yields        live rates for a token (Pastures' answer)
 *   pools         new pools on Arc with each token's check (Discover's)
 *   markets       perps price, funding and open interest (Markets')
 *
 * Every figure on a draft is the owner's own (stated, or picked from the
 * options a question offered) and checked against the limits that apply;
 * nothing is created, signed or saved here. Every figure on an answer card
 * is read from its source, with the source and the read time.
 */
import { AUTOPILOT_BETA, AUTOPILOT_LIMITS, LEASH_LIMITS, PACK_ROLES, autopilotTask, type Address, type ArcEnvironment, type AutopilotTaskInput, type PackRole } from "@lykia/core";
import type { AnswerBlock, FactRow, YieldRow } from "@lykia/core/api/answer";
import type { AppContext } from "../context.js";
import { autopilotService } from "../autopilot/service.js";
import { discoverService } from "../discover/service.js";
import { services } from "../services.js";

const usdOk = (v: string | null | undefined): v is string => typeof v === "string" && /^\d{1,9}(?:\.\d{1,2})?$/u.test(v) && Number(v) > 0;
const money = (v: string) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export type Drafted = { readonly ok: true; readonly block: AnswerBlock; readonly summary: string } | { readonly ok: false; readonly question: string; readonly options: readonly string[]; readonly reason: string };

/** An agent that holds a leash: name, role and a daily budget the owner stated. */
export function agentDraft(input: { readonly name: string; readonly role: string; readonly dailyUsd: string | null; readonly mission?: string | null; readonly environment: ArcEnvironment }): Drafted {
  const role = (PACK_ROLES as readonly string[]).includes(input.role) && input.role !== "orchestrator" ? (input.role as PackRole) : "custom";
  const base = `Create a ${input.name.toLowerCase()} agent`;
  if (!usdOk(input.dailyUsd)) return { ok: false, question: `How much may ${input.name} spend a day? Its budget is carved from your Fence.`, options: ["100", "250", "500"].map((v) => `${base} with a $${v} daily budget`), reason: "No daily budget was stated." };
  return {
    ok: true,
    summary: `${input.name}: a ${role.replace(/-/gu, " ")} agent with ${money(input.dailyUsd)} a day`,
    block: { kind: "agent-draft", name: input.name.slice(0, 48), role, dailyUsd: input.dailyUsd, mission: input.mission?.slice(0, 400) ?? null, environment: input.environment },
  };
}

/** Autopilot's limits: each one stated or picked, and inside the beta ceilings. */
export function autopilotDraft(input: { readonly perStepUsd: string | null; readonly perDayUsd: string | null; readonly days: number | null; readonly payees?: readonly string[]; readonly environment: ArcEnvironment }): Drafted {
  const options = [["25", "75"], ["50", "150"], ["100", "300"]].map(([a, b]) => `Turn on Autopilot with $${a} a step and $${b} a day for 30 days`);
  if (!usdOk(input.perStepUsd) || !usdOk(input.perDayUsd) || input.days === null) return { ok: false, question: "What limits should Autopilot sign inside? Pick one, or say your own.", options, reason: "Autopilot's limits were not all stated." };
  if (Number(input.perStepUsd) > Number(AUTOPILOT_BETA.perStepUsd) || Number(input.perDayUsd) > Number(AUTOPILOT_BETA.perDayUsd)) return { ok: false, question: `While in beta Autopilot signs at most ${money(AUTOPILOT_BETA.perStepUsd)} a step and ${money(AUTOPILOT_BETA.perDayUsd)} a day. Which limits?`, options, reason: "Above the beta ceilings." };
  if (Number(input.perStepUsd) > Number(input.perDayUsd)) return { ok: false, question: "One step cannot be larger than a whole day. Which limits?", options, reason: "Per step above per day." };
  if (input.days < AUTOPILOT_LIMITS.minDays || input.days > AUTOPILOT_LIMITS.maxDays) return { ok: false, question: `For how many days (${AUTOPILOT_LIMITS.minDays} to ${AUTOPILOT_LIMITS.maxDays})?`, options: ["For 7 days", "For 30 days"], reason: "Days out of range." };
  const payees = (input.payees ?? []).filter((p) => /^0x[0-9a-fA-F]{40}$/u.test(p)).map((p) => p.toLowerCase()).slice(0, 10);
  return {
    ok: true,
    summary: `Autopilot: up to ${money(input.perStepUsd)} a step and ${money(input.perDayUsd)} a day for ${input.days} days`,
    block: { kind: "autopilot-draft", perStepUsd: input.perStepUsd, perDayUsd: input.perDayUsd, days: input.days, payees, environment: input.environment },
  };
}

/** A task for Autopilot: validated against Autopilot's own limits and payees when it is on. */
export async function autopilotTaskDraft(ctx: AppContext, owner: Address | null, environment: ArcEnvironment, task: AutopilotTaskInput | null, missing: string | null, options: readonly string[]): Promise<Drafted> {
  if (missing === "dca") return { ok: false, question: "Buying on a schedule is a DCA order on LykiaOrders: signed once, filled by keepers inside your terms. How long should it run?", options, reason: "DCA goes through LykiaOrders, the one engine for limit, stop, TWAP and DCA orders." };
  if (!task) return { ok: false, question: missing === "floor" ? "Below which health factor should Autopilot repay?" : missing === "amount" ? "How much at most should one run move?" : missing === "payee" ? "Who should Autopilot pay? Paste the address." : missing === "every" ? "How often should it pay?" : missing === "keep" ? "How much USDC should stay in your account?" : missing === "vault" ? "Into which vault?" : "What should Autopilot do for you?", options, reason: `The task is missing its ${missing ?? "kind"}.` };
  const ap = owner ? await autopilotService(ctx).get(owner, environment).catch(() => null) : null;
  const limits = ap?.limits ?? { perStepUsd: AUTOPILOT_BETA.perStepUsd };
  const built = autopilotTask(task, { id: "apt_00000000", now: new Date(ctx.clock.now()).toISOString(), limits, payees: ap?.payees ?? (task.kind === "pay" ? [task.payee] : []) });
  if (!built.task) return { ok: false, question: `${built.issues[0]?.message ?? "That task does not fit."} What should it be instead?`, options, reason: built.issues.map((i) => i.message).join(" ") };
  const state = !ap || ap.status === "stopped" ? "off" : ap.status;
  const flat = Object.fromEntries(Object.entries(task).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  return { ok: true, summary: `${built.task.label}${state === "off" ? " (Autopilot is off: turn it on first)" : ""}`, block: { kind: "autopilot-task", label: built.task.label, task: flat, environment, autopilot: state } };
}

/** A leash's limits, stated or picked. */
export function leashDraftBlock(input: { readonly name: string; readonly template: "pay-invoices" | "trade-small" | "earn"; readonly perDayUsd: string | null; readonly perStepUsd?: string | null; readonly days: number | null; readonly recipients?: readonly string[]; readonly spendFrom?: "arc" | "gateway" }): Drafted {
  const what = { "pay-invoices": "to pay invoices", "trade-small": "to trade small amounts", earn: "to earn" }[input.template];
  if (!usdOk(input.perDayUsd)) return { ok: false, question: `How much may ${input.name} spend a day?`, options: ["10", "20", "50"].map((v) => `Give ${input.name} $${v} a day for 7 days ${what}`), reason: "No daily budget was stated." };
  if (input.days === null) return { ok: false, question: `For how many days should ${input.name}'s leash last?`, options: [7, 14, 30].map((d) => `Give ${input.name} $${input.perDayUsd} a day for ${d} days ${what}`), reason: "No duration was stated." };
  if (input.days < 1 || input.days > LEASH_LIMITS.maxDays) return { ok: false, question: `A leash lasts 1 to ${LEASH_LIMITS.maxDays} days. How long?`, options: [7, 30].map((d) => `Give ${input.name} $${input.perDayUsd} a day for ${d} days ${what}`), reason: "Days out of range." };
  if (input.perStepUsd && (!usdOk(input.perStepUsd) || Number(input.perStepUsd) > Number(input.perDayUsd))) return { ok: false, question: "One step cannot be more than a day's budget. How much in one go?", options: [`${money(input.perDayUsd)} in one go`], reason: "Per step above per day." };
  const recipients = (input.recipients ?? []).filter((r) => /^0x[0-9a-fA-F]{40}$/u.test(r)).map((r) => r.toLowerCase());
  const total = Number(input.perDayUsd) * input.days;
  return {
    ok: true,
    summary: `${input.name}: ${money(input.perDayUsd)} a day for ${input.days} days ${what} (at most ${money(String(total))} in all)`,
    block: {
      kind: "leash-draft",
      title: `A leash for ${input.name}`,
      note: input.template === "pay-invoices" && recipients.length === 0 ? "It pays only payees you name: add them in the review." : null,
      draft: { name: input.name.slice(0, 48), template: input.template, perDayUsd: input.perDayUsd, days: input.days, ...(input.perStepUsd ? { perStepUsd: input.perStepUsd } : {}), ...(recipients.length > 0 ? { recipients } : {}), ...(input.spendFrom ? { spendFrom: input.spendFrom } : {}) },
    },
  };
}

/* ---------------------------------------------------------------- answers */

/** Live rates for a token across Morpho vaults and Aave reserves, best first; risk by depth. Unreadable rates stay null. */
export async function yieldsCard(ctx: AppContext, environment: ArcEnvironment, token: "USDC" | "EURC"): Promise<{ block: AnswerBlock; rows: YieldRow[]; summary: string }> {
  const rates = await services(ctx).yields.rates(environment);
  const tier = (tvl: string | null): YieldRow["risk"] => (tvl === null ? "medium" : Number(tvl) >= 10_000_000 ? "low" : Number(tvl) >= 1_000_000 ? "medium" : "high");
  const pct = (v: string | null) => (v === null ? null : (Number(v) * 100).toFixed(2));
  const rows: YieldRow[] = [
    // Two vaults can share a name: the short address tells them apart.
    ...rates.vaults.filter((v) => v.asset === token).map((v, _i, all) => ({ venue: `${v.name || "Morpho vault"}${!v.name || all.filter((x) => x.name === v.name).length > 1 ? ` · ${v.address.slice(0, 6)}…${v.address.slice(-4)}` : ""}`.slice(0, 80), apyPercent: pct(v.apy), risk: tier(v.tvlUsd), source: "Morpho API" })),
    ...rates.reserves.filter((r) => r.symbol === token && r.canSupply).map((r) => ({ venue: `Aave V4 ${r.spokeName}`.slice(0, 80), apyPercent: pct(r.supplyApy), risk: "medium" as const, source: "Aave API" })),
  ]
    .sort((a, b) => Number(b.apyPercent ?? -1) - Number(a.apyPercent ?? -1))
    .slice(0, 6);
  const best = rows.find((r) => r.apyPercent !== null)?.venue ?? null;
  const unavailable = rates.sources.morpho !== "live" && rates.sources.aave !== "live";
  const source = rates.sources.morpho === "live" && rates.sources.aave === "live" ? "Morpho and Aave APIs" : rates.sources.morpho === "live" ? "Morpho API" : rates.sources.aave === "live" ? "Aave API" : "Morpho and Aave APIs";
  return {
    rows,
    block: { kind: "yields", token, rows, best, from: { source, readAt: rates.at, block: null, ...(unavailable ? { stale: "both rate sources are unavailable right now" } : {}) } },
    summary: rows.length === 0 ? `No readable ${token} rates on Arc ${environment} right now.` : `${rows.length} ${token} rate${rows.length === 1 ? "" : "s"} read; best ${best ?? "unavailable"}.`,
  };
}

/** New pools on Arc's exchanges with each new token's check result. */
export async function poolsFacts(ctx: AppContext, environment: ArcEnvironment): Promise<{ block: AnswerBlock | null; summary: string }> {
  const radar = await discoverService(ctx).launches(environment);
  const from = { source: "Arc AMM factories", readAt: radar.at, block: radar.toBlock !== "0" ? radar.toBlock : null };
  const rows: FactRow[] = radar.pools.slice(0, 8).map((p) => {
    const fresh = p.tokens.find((t) => t.address === p.newToken) ?? p.tokens[1];
    const pair = p.tokens.map((t) => t.symbol ?? `${t.address.slice(0, 6)}…`).join(" / ");
    return { label: `${pair} · ${p.label}`.slice(0, 80), value: fresh.trust === "verified" ? "verified" : fresh.trust === "lookalike" ? "lookalike: careful" : "unverified", note: fresh.warning?.slice(0, 200) ?? null, from: { ...from, block: p.block } };
  });
  if (rows.length === 0) return { block: null, summary: radar.notes[0] ?? `No new pools on Arc ${environment} since block ${radar.fromBlock}.` };
  return { block: { kind: "facts", title: `New pools on Arc ${environment}`, rows, note: `Read from block ${radar.fromBlock} to ${radar.toBlock}. A new token is never "safe": the check says what can be proven.` }, summary: `${radar.pools.length} new pool${radar.pools.length === 1 ? "" : "s"} since block ${radar.fromBlock}.` };
}

/** Perps markets on Extended (collateral on Arc): price, funding and open interest, read-only. */
export async function marketsFacts(ctx: AppContext, market: string | null): Promise<{ block: AnswerBlock | null; summary: string }> {
  const data = await discoverService(ctx).perpsMarkets();
  const readAt = new Date(ctx.clock.now()).toISOString();
  const all = data.markets as { market: string; lastPrice: unknown; fundingRate: unknown; openInterest: unknown; change24h: unknown }[];
  const picked = (market ? all.filter((m) => m.market.toUpperCase().startsWith(market.toUpperCase())) : all).slice(0, market ? 2 : 6);
  const num = (v: unknown, d = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "unavailable" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));
  const rows: FactRow[] = picked.flatMap((m) => [
    { label: `${m.market} · last price`, value: num(m.lastPrice), note: `24 h change ${num(Number(m.change24h) * 100)}%`, from: { source: "Extended API", readAt, block: null } },
    { label: `${m.market} · funding rate`, value: m.fundingRate === null || m.fundingRate === undefined ? "unavailable" : `${(Number(m.fundingRate) * 100).toFixed(4)}%`, note: `Open interest ${num(m.openInterest, 0)}`, from: { source: "Extended API", readAt, block: null } },
  ]).slice(0, 12);
  if (rows.length === 0) return { block: null, summary: market ? `Extended lists no ${market} market right now.` : "Extended's markets are unavailable right now." };
  return { block: { kind: "facts", title: market ? `${market} perps on Extended` : "Perps markets on Extended", rows, note: data.notes[1]?.slice(0, 300) ?? null }, summary: `${picked.length} market${picked.length === 1 ? "" : "s"} read from Extended.` };
}
