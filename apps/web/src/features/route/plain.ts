/**
 * What the owner reads about a plan, in plain words (pure; node tests load
 * this file). The Fence and the route search write their reasons for the
 * record ("confirm.cross-chain: Value leaves Arc for base."); on screen each
 * becomes one sentence that says why, and route-search bookkeeping ("Route
 * search winner: …, beat 0 other options") stays off the screen. Figures
 * are only reformatted, never computed here.
 */
import { fromBaseUnits, type IntentGraph } from "@lykia/core";

import { displayAmount } from "./reviewModel";
import { intlLocale, t as msg } from "../../i18n";

const CHAIN_NAMES: Readonly<Record<string, string>> = { base: "Base", ethereum: "Ethereum", arbitrum: msg("route.plain.arbitrum"), optimism: msg("route.plain.optimism"), polygon: msg("route.plain.polygon"), avalanche: msg("route.plain.avalanche"), solana: msg("route.plain.solana"), unichain: msg("route.plain.unichain"), linea: msg("route.plain.linea"), sonic: msg("route.plain.sonic"), "world-chain": msg("route.plain.worldChain"), worldchain: msg("route.plain.worldChain"), sei: msg("route.plain.sei"), codex: msg("route.plain.codex"), ink: msg("route.plain.ink"), plume: msg("route.plain.plume"), hyperevm: "HyperEVM", bnb: msg("route.plain.bnbChain") };

/** "base" -> "Base". */
export function chainName(key: string): string {
  const k = key.trim().toLowerCase();
  return CHAIN_NAMES[k] ?? k.replace(/(^|[-\s])\w/gu, (c) => c.toUpperCase()).replace(/-/gu, " ");
}

const short = (a: string) => (/^0x[0-9a-f]{40}$/iu.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** A token amount shown to two decimals at most ("0.189955" -> "0.19"), never rounded to zero. */
export function roundAmount(text: string): string {
  const n = Number(text.replace(/,/gu, ""));
  if (!Number.isFinite(n)) return text;
  if (n !== 0 && Math.abs(n) < 0.01) return n > 0 ? msg("route.plain.under001") : text;
  return n.toLocaleString(intlLocale(), { maximumFractionDigits: 2 });
}

/** One Fence reason as the owner reads it: why they confirm, or what the rule said, in one sentence without its code. */
export function plainReason(message: string, rule?: string): string {
  const m = message.trim();
  let x: RegExpMatchArray | null;
  if (rule === "confirm.agent" || /^An agent proposed this plan/iu.test(m)) return msg("route.plain.youConfirmBecauseLykoWroteThis");
  if ((x = m.match(/^Value leaves Arc(?: for ([\w -]+))?\.?$/iu))) return x[1] ? msg("route.plain.youConfirmBecauseTheMoneyLeaves", { chainName: chainName(x[1]) }) : msg("route.plain.youConfirmBecauseTheMoneyLeaves2");
  if ((x = m.match(/^Value leaves the owner for (\S+?)\.?$/iu))) return msg("route.plain.youConfirmBecauseTheMoneyGoes", { short: short(x[1]!) });
  if ((x = m.match(/^Above \$([\d,.]+): the owner confirms\.?$/iu))) return msg("route.plain.youConfirmBecauseThePlanMoves", { value: x[1] });
  if ((x = m.match(/^(\S+) is not a registry token\.?$/iu))) return msg("route.plain.youConfirmBecauseIsNotOn", { value: x[1] });
  if (rule === "fee" || /^Lykia fee /iu.test(m)) return feeLine(m) ?? m;
  if (rule === "mode.dry-run" || /^Dry run:/iu.test(m)) return msg("route.plain.practiceModeNothingCanBeSigned");
  return m.replace(/\s*,?\s*counted in the caps\.?$/iu, ".");
}

/** "Lykia fee 1% · 0.189955 USDC ($0.189955), counted in the caps." -> "Lykia fee: 0.19 USDC (1%)". */
export function feeLine(message: string): string | null {
  const x = message.match(/Lykia fee\s+([\d.]+%)\s*·\s*([\d.,]+)\s+([A-Za-z]+)/u);
  return x ? msg("route.plain.lykiaFee", { roundAmount: roundAmount(x[2]!), value: x[3], value2: x[1] }) : null;
}

/** Drops the route search's bookkeeping from a plan's rationale; what is left is the owner's own reason, if any. */
export function plainRationale(text: string): string {
  return text
    .split(/(?<=\.)\s+/u)
    .filter((s) => !/^Route search winner:/iu.test(s) && !/\bbeat \d+ other options?\b/iu.test(s) && !/\bover 90 days\b/iu.test(s))
    .join(" ")
    .trim();
}

/** "As asked: cctp." -> "You asked for CCTP."; other route reasons are already sentences. */
export function plainRouteWhy(reason: string, label: string): string {
  if (/^As asked\b/iu.test(reason.trim())) return msg("route.plain.youAskedFor", { label });
  return reason;
}

/** A step line without its technical tail: "Bridge 0.99 USDC to Base over CCTP (Circle forwards the mint)" -> "Bridge 0.99 USDC to Base over CCTP". */
export function plainStep(summary: string): string {
  return summary.replace(/\s*\((?:Circle forwards the mint|min [^)]*|minimum [^)]*)\)\s*$/iu, "").replace(/\s*->\s*/gu, " → ");
}

/** "about 20 seconds", "about 2 min", "under a second" (Arc settles on the receipt). */
export function durationText(seconds: number | null): string {
  if (seconds === null) return msg("route.plain.underASecond");
  if (seconds < 60) return msg("route.plain.aboutSeconds", { Math: Math.max(1, Math.round(seconds / 5) * 5) });
  return msg("route.plain.aboutMin", { Math: Math.round(seconds / 60) });
}

export interface PlanGist {
  /** "about 0.99 USDC on Base"; null when the plan delivers nothing measurable (a send to someone else). */
  readonly get: string | null;
  readonly send: string | null;
  /** "Lykia fee 0.01 USDC (1%) · network fee a few cents". */
  readonly cost: string;
  readonly time: string;
  /** "Arc" or the destination chain. */
  readonly where: string;
  /** "0.01 USDC": Lykia's fee alone, for the review's opening sentence; null when there is none. */
  readonly fee: string | null;
}

/** What a plan sends, gets, costs and how long it takes, from its intent graph (figures as the graph has them). */
export function planGist(graph: IntentGraph): PlanGist {
  const steps = graph.steps.filter((s) => s.kind !== "approve");
  const consumed = new Set(graph.steps.flatMap((s) => s.dependsOn));
  const first = steps.find((s) => s.dependsOn.length === 0);
  const sendIn = first?.inputs[0];
  const last = [...steps].reverse().find((s) => !consumed.has(s.id));
  const out = last?.outputs[0];
  const bridge = steps.find((s) => s.settlement.kind !== "receipt");
  const where = bridge && bridge.settlement.kind !== "receipt" ? chainName(bridge.settlement.destination) : "Arc";
  const symbol = (sym: string) => sym.split("@")[0] ?? sym;
  const place = (s: NonNullable<typeof last>, sym: string) => (s.kind === "bridge" ? msg("route.plain.onChain", { where }) : sym.includes("@") ? msg("route.plain.inThePosition") : s.kind === "transfer" ? msg("route.plain.toTheRecipient") : "");
  const get = out && last && last.kind !== "transfer" ? msg("route.plain.aboutAmount", { amount: `${displayAmount(out.amount, out.decimals)} ${symbol(out.symbol)}`, place: place(last, out.symbol) }) : null;
  const send = sendIn ? `${displayAmount(sendIn.amount, sendIn.decimals)} ${symbol(sendIn.symbol)}` : null;
  const fees = new Map<string, { units: bigint; decimals: number; bps: number }>();
  for (const s of graph.steps) {
    if (!s.fee) continue;
    const f = fees.get(s.fee.symbol) ?? { units: 0n, decimals: s.fee.decimals, bps: s.fee.bps };
    f.units += BigInt(s.fee.amount);
    fees.set(s.fee.symbol, f);
  }
  const feeText = [...fees.entries()].map(([sym, f]) => `${roundAmount(fromBaseUnits(f.units.toString(), f.decimals))} ${sym} (${(f.bps / 100).toFixed(f.bps % 100 === 0 ? 0 : 2)}%)`);
  const cost = msg("route.plain.networkFeeAFewCents", { value: feeText.length > 0 ? msg("route.plain.lykiaFee2", { feeText: feeText.join(" + ") }) : msg("route.plain.noLykiaFee") });
  const seconds = steps.reduce<number | null>((t, s) => (s.settlement.kind === "receipt" ? t : (t ?? 0) + s.settlement.expectedSeconds), null);
  const fee = fees.size > 0 ? [...fees.entries()].map(([sym, f]) => `${roundAmount(fromBaseUnits(f.units.toString(), f.decimals))} ${sym}`).join(" + ") : null;
  return { get, send, cost, time: durationText(seconds), where, fee };
}

/** The review modal's opening sentence: "You send 1 USDC from Arc and receive about 0.99 USDC on Base in about 20 seconds. Lykia fee 0.01 USDC." */
export function leadSentence(graph: IntentGraph): string {
  const g = planGist(graph);
  const fee = g.fee ? msg("route.plain.feeSentence", { fee: g.fee }) : "";
  const steps = graph.steps.filter((s) => s.kind !== "approve");
  const instant = steps.every((s) => s.settlement.kind === "receipt");
  const when = instant ? msg("route.plain.inUnderASecond") : msg("route.plain.inTime", { time: g.time });
  if (g.send && g.get) return msg("route.plain.youSendFromArcAndReceive", { send: g.send, get: g.get, when, fee });
  if (g.send) return msg("route.plain.youSendFromArcItLands", { send: g.send, when, fee });
  return msg("route.plain.nothingLeavesYourWalletUntilYou", { fee });
}
