/**
 * Answer cards and work steps for Lyko's chat.
 *
 * Cards (`block` events) are built here from data the server holds: the
 * wallet snapshot, the owner's preferences, the Fence and its verdict, the
 * oracle prices and the planned intent. A model can ask for a card by kind
 * (show_card), but every number in it comes from these reads, never from
 * the model's words.
 *
 * Steps (`step` events) mark real work as it starts and ends, with the
 * measured time, so the chat can lay one tessera per step.
 */
import { fromBaseUnits, type Address, type ArcEnvironment, type Fence, type IntentGraph } from "@lykia/core";
import { parseAnswerBlock, parseChatStep, type AnswerBlock, type ChatStep, type ChatStepKind } from "@lykia/core/api/answer";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { AppContext } from "../context.js";
import { getPreferences } from "../fold/preferences.js";
import { services } from "../services.js";
import type { Emit } from "./orchestrator.js";

/* ------------------------------------------------------------------ steps */

export interface StepHandle {
  end(state: Exclude<ChatStep["state"], "running">, result?: string, detail?: string): void;
}

export interface Stepper {
  start(kind: ChatStepKind, label: string, agent?: string): StepHandle;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const steppers = new WeakMap<Emit, Stepper>();

/** One stepper per turn (per emit function), so ids stay unique across perception, the reader and the tool loop. */
export function stepsFor(emit: Emit): Stepper {
  const known = steppers.get(emit);
  if (known) return known;
  let n = 0;
  const stepper: Stepper = {
    start(kind, label, agent) {
      n += 1;
      const id = `s${n}`;
      const t0 = Date.now();
      const base = { id, kind, label: clip(label, 80), ...(agent ? { agent: clip(agent, 60) } : {}) };
      const send = (step: ChatStep) => {
        const valid = parseChatStep(step);
        if (valid) emit("step", valid);
      };
      send({ ...base, state: "running" });
      let ended = false;
      return {
        end(state, result, detail) {
          if (ended) return;
          ended = true;
          send({ ...base, state, ...(result ? { result: clip(result.replace(/\s+/gu, " ").trim(), 160) } : {}), ...(detail ? { detail: clip(detail.replace(/\s+/gu, " ").trim(), 600) } : {}), ms: Date.now() - t0 });
        },
      };
    },
  };
  steppers.set(emit, stepper);
  return stepper;
}

/** Emits a block only when it validates. */
export function emitBlock(emit: Emit, block: AnswerBlock | null): AnswerBlock | null {
  const valid = block ? parseAnswerBlock(block) : null;
  if (valid) emit("block", valid);
  return valid;
}

/* ------------------------------------------------------------------ cards */

/** Trims a decimal string to at most `places` decimals, without trailing zeros. */
export function trimDecimal(value: string, places = 6): string {
  const [w = "0", f = ""] = value.split(".");
  const frac = f.slice(0, places).replace(/0+$/u, "");
  return frac ? `${w}.${frac}` : w;
}

/** The gas gauge: native USDC (Arc's gas) against the owner's gas floor. */
export async function gasCard(ctx: AppContext, environment: ArcEnvironment, owner: Address, snap: FlockSnapshot, sample: boolean): Promise<AnswerBlock | null> {
  const prefs = await getPreferences(ctx, sample ? null : owner).catch(() => null);
  const floor = prefs?.gasFloorUsdc ?? "0.5";
  let balance: string;
  try {
    balance = trimDecimal(fromBaseUnits(BigInt(snap.native.usdc18), 18), 6);
  } catch {
    return null;
  }
  const pulse = ctx.pulse.latest(environment);
  const gwei = pulse?.gasPriceGwei;
  return { kind: "gas", balance, floor, address: sample ? null : owner, gasPriceGwei: gwei !== undefined && gwei !== null && /^\d+(?:\.\d+)?$/u.test(String(gwei)) ? trimDecimal(String(gwei), 4) : null };
}

/** The pasture mosaic: the largest holdings by USD value. */
export function balanceCard(snap: FlockSnapshot): AnswerBlock | null {
  const holdings = snap.holdings
    .filter((h) => h.kind !== "debt")
    .slice()
    .sort((a, b) => Number(b.usd ?? -1) - Number(a.usd ?? -1))
    .slice(0, 8)
    .map((h) => ({ symbol: h.symbol, amount: trimDecimal(String(h.amount), 6), usd: h.usd === null ? null : trimDecimal(String(h.usd), 2), where: String(h.where).slice(0, 60) || "wallet" }));
  return { kind: "balance", totalUsd: snap.totalUsd === null ? null : trimDecimal(snap.totalUsd, 2), holdings };
}

/** The rate tile for a pair: the oracle reference, and the Fence's FX band when it has one. */
export async function rateCard(ctx: AppContext, base: string, quote: string, fence: Fence, quoted?: string): Promise<AnswerBlock | null> {
  const prices = await services(ctx).prices.prices([base, quote]).catch(() => null);
  const b = prices?.[base];
  const q = prices?.[quote];
  const reference = b?.usd && q?.usd && Number(q.usd) > 0 ? trimDecimal(String(Number(b.usd) / Number(q.usd)), 6) : null;
  const rate = quoted ?? reference;
  if (!rate) return null;
  const source = [b?.source, q?.source].filter((s): s is string => Boolean(s) && !/unit of account/u.test(s!)).map((s) => s.replace(/^chainlink:/iu, "Chainlink ")).join(" · ") || null;
  return { kind: "rate", base, quote, rate, reference: quoted ? reference : null, bandBps: fence.fx?.maxDeviationBps ?? null, source: source ? source.slice(0, 80) : null };
}

/** The rate a planned conversion gets: output per input of its first conversion step. */
export function quotedRate(intent: Pick<IntentGraph, "steps">): { base: string; quote: string; rate: string } | null {
  for (const step of intent.steps) {
    if (step.kind !== "swap" && step.kind !== "fx") continue;
    const inp = step.inputs[0];
    const out = step.outputs[0];
    if (!inp || !out) continue;
    // The protocol fee comes off the input before the swap: the rate is what the rest buys.
    const fee = step.fee && step.fee.basis === "input" && step.fee.token.toLowerCase() === inp.token.toLowerCase() ? Number(fromBaseUnits(step.fee.amount, step.fee.decimals)) : 0;
    const a = Number(fromBaseUnits(inp.amount, inp.decimals)) - fee;
    const b = Number(fromBaseUnits(out.amount, out.decimals));
    if (!(a > 0) || !(b > 0)) continue;
    return { base: inp.symbol, quote: out.symbol, rate: trimDecimal(String(b / a), 6) };
  }
  return null;
}

/** The Fence gate: the rules that refused or want a confirmation, and the room left under the caps. */
export function fenceCard(intent: Pick<IntentGraph, "verdict">, fence: Fence): AnswerBlock | null {
  const decision = intent.verdict.decision;
  if (decision !== "deny" && decision !== "confirm") return null;
  const rules = intent.verdict.reasons
    .filter((r) => r.decision === decision)
    .slice(0, 6)
    .map((r) => ({ rule: String(r.rule).slice(0, 40), message: r.message.slice(0, 400) }));
  if (rules.length === 0) return null;
  const caps = fence.caps ?? {};
  const headroom = [
    caps.perStepUsd ? { label: "Per step", value: `$${caps.perStepUsd}` } : null,
    caps.perIntentUsd ? { label: "Per plan", value: `$${caps.perIntentUsd}` } : null,
    caps.dailyUsd ? { label: "Per day", value: `$${caps.dailyUsd}` } : null,
    fence.limits?.maxSlippageBps !== undefined ? { label: "Max slippage", value: `${(fence.limits.maxSlippageBps / 100).toFixed(2)}%` } : null,
  ].filter((h): h is { label: string; value: string } => h !== null);
  return { kind: "fence", decision, rules, headroom };
}

/* -------------------------------------------------------------- questions */

export type InfoQuestion = { readonly kind: "gas" } | { readonly kind: "balance" } | { readonly kind: "rate"; readonly base: string; readonly quote: string };

const ACTION_VERB = /\b(?:send|pay|swap|convert|move|bridge|deposit|withdraw|earn|put|buy|sell|stake|lend|borrow|hedge|keep|sweep|create|set|every|rebalance|allocate|split|top up|alert|notify|remind)\b/iu;

/**
 * Plain questions the reader answers with a card instead of a plan: gas,
 * balances and the EURC rate. A sentence with an action verb is a plan,
 * never a question.
 */
export function infoQuestion(text: string): InfoQuestion | null {
  const t = text.trim().toLowerCase();
  if (t.length > 160 || ACTION_VERB.test(t)) return null;
  if (/\bgas\b/u.test(t)) return { kind: "gas" };
  if (/\b(?:eurc|euro|eur)\b/u.test(t) && /\b(?:rate|price|worth|fx|quote|exchange)\b/u.test(t)) return { kind: "rate", base: "USDC", quote: "EURC" };
  if (/\b(?:balance|balances|holdings|portfolio|my flock|what do i (?:hold|have|own)|how much (?:do i|have i))\b/u.test(t)) return { kind: "balance" };
  return null;
}
