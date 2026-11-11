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

const CHAIN_NAMES: Readonly<Record<string, string>> = { base: "Base", ethereum: "Ethereum", arbitrum: "Arbitrum", optimism: "Optimism", polygon: "Polygon", avalanche: "Avalanche", solana: "Solana", unichain: "Unichain", linea: "Linea", sonic: "Sonic", "world-chain": "World Chain", worldchain: "World Chain", sei: "Sei", codex: "Codex", ink: "Ink", plume: "Plume", hyperevm: "HyperEVM", bnb: "BNB Chain" };

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
  if (n !== 0 && Math.abs(n) < 0.01) return n > 0 ? "under 0.01" : text;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** One Fence reason as the owner reads it: why they confirm, or what the rule said, in one sentence without its code. */
export function plainReason(message: string, rule?: string): string {
  const m = message.trim();
  let x: RegExpMatchArray | null;
  if (rule === "confirm.agent" || /^An agent proposed this plan/iu.test(m)) return "You confirm because Lyko wrote this plan, not you.";
  if ((x = m.match(/^Value leaves Arc(?: for ([\w -]+))?\.?$/iu))) return x[1] ? `You confirm because the money leaves Arc for ${chainName(x[1])}.` : "You confirm because the money leaves Arc.";
  if ((x = m.match(/^Value leaves the owner for (\S+?)\.?$/iu))) return `You confirm because the money goes to someone else (${short(x[1]!)}).`;
  if ((x = m.match(/^Above \$([\d,.]+): the owner confirms\.?$/iu))) return `You confirm because the plan moves more than $${x[1]}.`;
  if ((x = m.match(/^(\S+) is not a registry token\.?$/iu))) return `You confirm because ${x[1]} is not on Lykia's token list.`;
  if (rule === "fee" || /^Lykia fee /iu.test(m)) return feeLine(m) ?? m;
  if (rule === "mode.dry-run" || /^Dry run:/iu.test(m)) return "Practice mode: nothing can be signed.";
  return m.replace(/\s*,?\s*counted in the caps\.?$/iu, ".");
}

/** "Lykia fee 1% · 0.189955 USDC ($0.189955), counted in the caps." -> "Lykia fee: 0.19 USDC (1%)". */
export function feeLine(message: string): string | null {
  const x = message.match(/Lykia fee\s+([\d.]+%)\s*·\s*([\d.,]+)\s+([A-Za-z]+)/u);
  return x ? `Lykia fee: ${roundAmount(x[2]!)} ${x[3]} (${x[1]})` : null;
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
  if (/^As asked\b/iu.test(reason.trim())) return `You asked for ${label}.`;
  return reason;
}

/** A step line without its technical tail: "Bridge 0.99 USDC to Base over CCTP (Circle forwards the mint)" -> "Bridge 0.99 USDC to Base over CCTP". */
export function plainStep(summary: string): string {
  return summary.replace(/\s*\((?:Circle forwards the mint|min [^)]*|minimum [^)]*)\)\s*$/iu, "").replace(/\s*->\s*/gu, " → ");
}

/** "about 20 seconds", "about 2 min", "under a second" (Arc settles on the receipt). */
export function durationText(seconds: number | null): string {
  if (seconds === null) return "under a second";
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds / 5) * 5)} seconds`;
  return `about ${Math.round(seconds / 60)} min`;
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
  const place = (s: NonNullable<typeof last>, sym: string) => (s.kind === "bridge" ? ` on ${where}` : sym.includes("@") ? " in the position" : s.kind === "transfer" ? " to the recipient" : "");
  const get = out && last && last.kind !== "transfer" ? `about ${displayAmount(out.amount, out.decimals)} ${symbol(out.symbol)}${place(last, out.symbol)}` : null;
  const send = sendIn ? `${displayAmount(sendIn.amount, sendIn.decimals)} ${symbol(sendIn.symbol)}` : null;
  const fees = new Map<string, { units: bigint; decimals: number; bps: number }>();
  for (const s of graph.steps) {
    if (!s.fee) continue;
    const f = fees.get(s.fee.symbol) ?? { units: 0n, decimals: s.fee.decimals, bps: s.fee.bps };
    f.units += BigInt(s.fee.amount);
    fees.set(s.fee.symbol, f);
  }
  const feeText = [...fees.entries()].map(([sym, f]) => `${roundAmount(fromBaseUnits(f.units.toString(), f.decimals))} ${sym} (${(f.bps / 100).toFixed(f.bps % 100 === 0 ? 0 : 2)}%)`);
  const cost = `${feeText.length > 0 ? `Lykia fee ${feeText.join(" + ")}` : "No Lykia fee"} · network fee a few cents`;
  const seconds = steps.reduce<number | null>((t, s) => (s.settlement.kind === "receipt" ? t : (t ?? 0) + s.settlement.expectedSeconds), null);
  return { get, send, cost, time: durationText(seconds), where };
}

/** The review modal's opening sentence: "You send 1 USDC from Arc and receive about 0.99 USDC on Base in about 20 seconds. Lykia fee 0.01 USDC." */
export function leadSentence(graph: IntentGraph): string {
  const g = planGist(graph);
  const fee = g.cost.startsWith("Lykia fee") ? ` ${g.cost.split(" · ")[0]!.replace(/ \([^)]*\)$/u, "")}.` : "";
  const when = g.time === "under a second" ? "in under a second" : `in ${g.time}`;
  if (g.send && g.get) return `You send ${g.send} from Arc and receive ${g.get} ${when}.${fee}`;
  if (g.send) return `You send ${g.send} from Arc; it lands ${when}.${fee}`;
  return `Nothing leaves your wallet until you sign.${fee}`;
}
