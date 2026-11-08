/**
 * Evaluating a Fence against the facts of a plan. The result is a Verdict
 * (`lykia.verdict/v1`): allow, confirm or deny, every reason with the rule
 * it came from, and a digest binding the Fence hash, the facts and the
 * decision. That digest rides in each step's Arc Memo and is what a
 * Tag files to the ERC-8004 ValidationRegistry.
 */
import { canonicalDigest, type Sha256Digest } from "./canonical.js";
import { sameAddress, type Address } from "./contracts.js";
import type { StepKind } from "./intent.js";
import type { ArcEnvironment } from "./networks.js";
import { fenceHash, formatUsdMicros, normalizeFence, ratioBps, timeMinutes, usdMicros, WEEKDAYS, type Fence, type ScentRequirement } from "./fence.js";
import { venueFamily } from "./protocols.js";

export const VERDICT_SCHEMA = "lykia.verdict/v1" as const;

/** Scent results, best first. */
export type ScentLevel = "verified" | "no-red-flags" | "caution" | "danger" | "unknown";
const SCENT_RANK: Readonly<Record<ScentLevel, number>> = { verified: 0, "no-red-flags": 1, caution: 2, danger: 3, unknown: 4 };

export interface TokenFact {
  readonly symbol: string;
  readonly address: Address;
  readonly listed: boolean;
  /** Scent result for tokens the step buys or receives; absent = not inspected. */
  readonly scent?: ScentLevel;
  /** True when the step acquires this token (buy, receive), false when it spends it. */
  readonly acquired: boolean;
}

export interface StepFact {
  readonly id: string;
  readonly kind: StepKind;
  readonly venue: string;
  /** USD value moved by the step; null = unpriced (fails closed under caps). */
  readonly usd: string | null;
  readonly tokens: readonly TokenFact[];
  readonly recipient?: Address;
  /** Bridge destination key ("base"). */
  readonly destination?: string;
  readonly slippageBps?: number;
  /** Lending: health factor after the step; null = could not be read. */
  readonly healthFactorAfter?: string | null;
  /** StableFX: quote deviation from the reference rate; null = no reference. */
  readonly fxDeviationBps?: number | null;
  /** Lykia's fee on this step; already included in `usd` (caps count it). */
  readonly fee?: { readonly line: string; readonly usd: string | null };
}

export interface FenceFacts {
  readonly environment: ArcEnvironment;
  readonly signer: "wallet" | "agent";
  readonly owner: Address;
  /** The plan came from an agent's proposal rather than the owner. */
  readonly proposedByAgent?: boolean;
  readonly steps: readonly StepFact[];
  /** Spend so far (USD); null = unknown. Absent = no daily/weekly caps to check. */
  readonly spent?: { readonly dayUsd: string | null; readonly weekUsd: string | null };
  readonly now: number;
  /** The `lykia.program/v1` digest the plan was compiled from: pinned in factsDigest, so the verdict commits to the program. */
  readonly program?: Sha256Digest;
}

export type FenceRule =
  | "mode.whistle"
  | "mode.dry-run"
  | "fee"
  | "environment"
  | "signer"
  | "kinds"
  | "venues"
  | "tokens.allow"
  | "tokens.unlisted"
  | "scent"
  | "recipients"
  | "bridges"
  | "caps.step"
  | "caps.intent"
  | "caps.daily"
  | "caps.weekly"
  | "limits.steps"
  | "limits.slippage"
  | "lending.health"
  | "fx.deviation"
  | "schedule"
  | "confirm.above"
  | "confirm.external"
  | "confirm.cross-chain"
  | "confirm.agent"
  | "confirm.unlisted"
  | "beta.cap"
  | "facts.unavailable";

export type Decision = "allow" | "confirm" | "deny";

export interface VerdictReason {
  readonly rule: FenceRule;
  readonly decision: Decision;
  readonly message: string;
  readonly step?: string;
}

export interface FenceVerdict {
  readonly schema: typeof VERDICT_SCHEMA;
  readonly decision: Decision;
  /** False in dry-run or on deny: nothing may be signed. */
  readonly signable: boolean;
  readonly reasons: readonly VerdictReason[];
  /** Reasons set aside because the step brings the flock home (Whistle lane). */
  readonly waived: readonly VerdictReason[];
  readonly fenceHash: Sha256Digest;
  readonly factsDigest: Sha256Digest;
  /** Binds fence, facts and decision: goes into memos and validation records. */
  readonly digest: Sha256Digest;
}

/**
 * Bringing the flock home: repaying debt, withdrawing to the owner and
 * sending to the owner reduce risk and are never blocked by limits.
 */
export function isHomeward(step: StepFact, owner: Address): boolean {
  if (step.kind === "repay") return true;
  if (step.kind === "approve") return false;
  if ((step.kind === "withdraw" || step.kind === "transfer") && step.recipient !== undefined && sameAddress(step.recipient, owner)) return true;
  return false;
}

export interface ScheduleState {
  readonly open: boolean;
  readonly weekday: string;
  readonly minutes: number;
}

export function scheduleState(schedule: Fence["schedule"], now: number): ScheduleState | null {
  if (!schedule) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "").slice(0, 3).toLowerCase();
  const minutes = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const open = schedule.windows.some((w) => w.days.includes(weekday as (typeof WEEKDAYS)[number]) && minutes >= (timeMinutes(w.from) ?? 1441) && minutes < (timeMinutes(w.to) ?? -1));
  return { open, weekday, minutes };
}

/**
 * Server-side limits that sit above every Fence and that no owner can loosen,
 * such as the mainnet beta cap while the contracts are unaudited.
 */
export interface FenceOptions {
  readonly beta?: { readonly perStepUsd: string; readonly perDayUsd: string };
}

export function evaluateFence(input: Fence, facts: FenceFacts, options: FenceOptions = {}): FenceVerdict {
  const fence = normalizeFence(input);
  const reasons: VerdictReason[] = [];
  const waived: VerdictReason[] = [];
  const homeward = new Set(facts.steps.filter((s) => isHomeward(s, facts.owner)).map((s) => s.id));
  const allHomeward = facts.steps.length > 0 && facts.steps.every((s) => homeward.has(s.id) || s.kind === "approve");

  /** Limits a homeward step may skip; the hard floor (environment, signer, recipients deny, unlisted when acquiring) always holds. */
  const push = (reason: VerdictReason, waivable = true) => {
    const onHomeward = reason.step ? homeward.has(reason.step) : allHomeward;
    if (waivable && reason.decision !== "allow" && onHomeward) waived.push(reason);
    else reasons.push(reason);
  };
  const deny = (rule: FenceRule, message: string, step?: string, waivable = true) => push({ rule, decision: "deny", message, ...(step ? { step } : {}) }, waivable);
  const confirm = (rule: FenceRule, message: string, step?: string) => push({ rule, decision: "confirm", message, ...(step ? { step } : {}) });

  if (fence.mode === "whistle") deny("mode.whistle", "The whistle is blown: Lyko holds the flock. Only homeward moves (repay, withdraw or send to the owner) pass.");
  if (fence.environments && !fence.environments.includes(facts.environment)) deny("environment", `This Fence does not cover Arc ${facts.environment}.`, undefined, false);
  if (fence.signers && !fence.signers.includes(facts.signer)) deny("signer", facts.signer === "agent" ? "This Fence does not admit agents." : "This Fence only admits agents.", undefined, false);
  if (fence.limits?.maxSteps !== undefined && facts.steps.length > fence.limits.maxSteps) deny("limits.steps", `The plan has ${facts.steps.length} steps; the Fence allows ${fence.limits.maxSteps}.`);
  if (facts.signer === "agent" || facts.proposedByAgent) {
    if (fence.confirm?.when?.includes("agent-proposal") && facts.proposedByAgent) confirm("confirm.agent", "An agent proposed this plan: the owner confirms it.");
  }

  let intentMicros = 0n;
  let intentUnpriced = false;
  for (const step of facts.steps) {
    if (fence.kinds?.allow && !fence.kinds.allow.includes(step.kind)) deny("kinds", `${step.kind} is outside the Fence.`, step.id);
    // A venue that routes through another (a curator's Morpho vaults) answers to both ids.
    const family = venueFamily(step.venue);
    const denied = family.find((v) => fence.venues?.deny?.includes(v));
    if (denied) deny("venues", `${denied === step.venue ? step.venue : `${step.venue} (through ${denied})`} is on the deny list.`, step.id);
    else if (fence.venues?.allow && step.kind !== "approve" && !family.some((v) => fence.venues!.allow!.includes(v))) deny("venues", `${step.venue} is not an allowed venue.`, step.id);

    for (const token of step.tokens) {
      if (!token.listed) {
        if (fence.tokens?.unlisted === "deny" && token.acquired) deny("tokens.unlisted", `${token.symbol} (${token.address}) is not a registry token.`, step.id, false);
        else if (fence.confirm?.when?.includes("unlisted-token")) confirm("confirm.unlisted", `${token.symbol} is not a registry token.`, step.id);
      }
      if (fence.tokens?.allow && token.acquired && !fence.tokens.allow.some((s) => s.toLowerCase() === token.symbol.toLowerCase())) deny("tokens.allow", `${token.symbol} is not on the Fence's token list.`, step.id);
      if (token.acquired) {
        const need: ScentRequirement = fence.scent?.require ?? "no-red-flags";
        if (need !== "off") {
          const level: ScentLevel = token.listed ? "verified" : token.scent ?? "unknown";
          if (SCENT_RANK[level] > SCENT_RANK[need]) deny("scent", level === "unknown" ? `Lyko has not sniffed ${token.symbol} yet: run Scent first.` : `Lyko smells a wolf: ${token.symbol} scored "${level}", the Fence needs "${need}".`, step.id, false);
        }
      }
    }

    if (step.recipient !== undefined && !sameAddress(step.recipient, facts.owner)) {
      const mode = fence.recipients?.mode ?? "own";
      const listed = (fence.recipients?.allow ?? []).some((a) => sameAddress(a, step.recipient as string));
      if ((fence.recipients?.deny ?? []).some((a) => sameAddress(a, step.recipient as string))) deny("recipients", `${step.recipient} is on the deny list.`, step.id, false);
      else if (mode === "own" || (mode === "allowlist" && !listed)) deny("recipients", `${step.recipient} is not the owner${mode === "allowlist" ? " and not on the allowlist" : ""}.`, step.id, false);
      else if (facts.signer === "agent" && !listed) deny("recipients", "Agents only pay recipients on the allowlist.", step.id, false);
      else if (fence.confirm?.when?.includes("external-recipient")) confirm("confirm.external", `Value leaves the owner for ${step.recipient}.`, step.id);
    }

    if (step.kind === "bridge" || step.kind === "gateway-deposit") {
      if (step.kind === "bridge" && fence.bridges?.destinations && (!step.destination || !fence.bridges.destinations.includes(step.destination))) deny("bridges", `${step.destination ?? "That destination"} is not an allowed bridge destination.`, step.id);
      if (fence.confirm?.when?.includes("cross-chain")) confirm("confirm.cross-chain", `Value leaves Arc${step.destination ? ` for ${step.destination}` : ""}.`, step.id);
    }

    if (step.slippageBps !== undefined && fence.limits?.maxSlippageBps !== undefined && step.slippageBps > fence.limits.maxSlippageBps) deny("limits.slippage", `Slippage ${step.slippageBps} bps is above the Fence's ${fence.limits.maxSlippageBps} bps.`, step.id);

    if ((step.kind === "borrow" || (step.kind === "withdraw" && step.healthFactorAfter !== undefined)) && fence.lending?.minHealthFactor) {
      if (step.healthFactorAfter === null || step.healthFactorAfter === undefined) deny("facts.unavailable", "The health factor after this step could not be read.", step.id);
      else if (ratioBps(step.healthFactorAfter) < ratioBps(fence.lending.minHealthFactor)) deny("lending.health", `Health factor would fall to ${step.healthFactorAfter}; the Fence keeps it above ${fence.lending.minHealthFactor}.`, step.id);
    }

    if (step.kind === "fx" && fence.fx?.maxDeviationBps !== undefined) {
      if (step.fxDeviationBps === null || step.fxDeviationBps === undefined) deny("facts.unavailable", "No reference rate to check the FX quote against.", step.id);
      else if (Math.abs(step.fxDeviationBps) > fence.fx.maxDeviationBps) deny("fx.deviation", `The FX quote is ${Math.abs(step.fxDeviationBps)} bps off the reference; the band is ${fence.fx.maxDeviationBps} bps.`, step.id);
    }

    if (step.kind !== "approve") {
      if (step.usd === null) {
        intentUnpriced = true;
        if (fence.caps?.perStepUsd || fence.caps?.perIntentUsd || fence.caps?.dailyUsd || fence.caps?.weeklyUsd || fence.confirm?.aboveUsd) deny("facts.unavailable", "This step has no USD price; caps cannot be checked.", step.id);
      } else {
        const micros = usdMicros(step.usd);
        intentMicros += micros;
        if (fence.caps?.perStepUsd && micros > usdMicros(fence.caps.perStepUsd)) deny("caps.step", `$${step.usd} is above the per-step cap of $${fence.caps.perStepUsd}.`, step.id);
      }
    }
  }

  if (!intentUnpriced) {
    if (fence.caps?.perIntentUsd && intentMicros > usdMicros(fence.caps.perIntentUsd)) deny("caps.intent", `The plan moves $${formatUsdMicros(intentMicros)}; the per-intent cap is $${fence.caps.perIntentUsd}.`);
    if (fence.confirm?.aboveUsd && intentMicros > usdMicros(fence.confirm.aboveUsd)) confirm("confirm.above", `Above $${fence.confirm.aboveUsd}: the owner confirms.`);
    const window = (rule: FenceRule, label: string, cap: string | undefined, spent: string | null | undefined) => {
      if (!cap) return;
      if (spent === null || spent === undefined) return deny("facts.unavailable", `${label} spend is unknown; the ${label.toLowerCase()} cap cannot be checked.`);
      const total = usdMicros(spent) + intentMicros;
      if (total > usdMicros(cap)) deny(rule, `${label} spend would reach $${formatUsdMicros(total)}; the cap is $${cap}.`);
    };
    window("caps.daily", "Daily", fence.caps?.dailyUsd, facts.spent ? facts.spent.dayUsd : fence.caps?.dailyUsd ? null : undefined);
    window("caps.weekly", "Weekly", fence.caps?.weeklyUsd, facts.spent ? facts.spent.weekUsd : fence.caps?.weeklyUsd ? null : undefined);
  }

  // Mainnet beta cap: a hard ceiling while the contracts are unaudited. Homeward moves are waived like every limit.
  if (options.beta && facts.environment === "mainnet") {
    const stepCap = usdMicros(options.beta.perStepUsd);
    let betaMicros = 0n;
    let betaUnpriced = false;
    for (const step of facts.steps) {
      if (step.kind === "approve") continue;
      if (step.usd === null) {
        betaUnpriced = true;
        deny("facts.unavailable", "This step has no USD price; the beta cap cannot be checked.", step.id);
        continue;
      }
      const micros = usdMicros(step.usd);
      if (!isHomeward(step, facts.owner)) betaMicros += micros;
      if (micros > stepCap) deny("beta.cap", `Beta: $${step.usd} is above the $${options.beta.perStepUsd} per-step cap that applies to everyone while Lykia's contracts are unaudited.`, step.id);
    }
    if (!betaUnpriced && betaMicros > 0n) {
      const spentDay = facts.spent ? facts.spent.dayUsd : null;
      if (spentDay === null) deny("facts.unavailable", "Today's spend is unknown; the beta daily cap cannot be checked.");
      else if (usdMicros(spentDay) + betaMicros > usdMicros(options.beta.perDayUsd)) deny("beta.cap", `Beta: today's spend would reach $${formatUsdMicros(usdMicros(spentDay) + betaMicros)}; the beta daily cap is $${options.beta.perDayUsd}.`);
    }
  }

  const schedule = scheduleState(fence.schedule, facts.now);
  if (schedule && !schedule.open) deny("schedule", `Outside the Fence's hours (${schedule.weekday} ${String(Math.floor(schedule.minutes / 60)).padStart(2, "0")}:${String(schedule.minutes % 60).padStart(2, "0")} ${fence.schedule?.timezone}).`);

  const decision: Decision = reasons.some((r) => r.decision === "deny") ? "deny" : reasons.some((r) => r.decision === "confirm") ? "confirm" : "allow";
  for (const step of facts.steps) if (step.fee) reasons.push({ rule: "fee", decision: "allow", message: `${step.fee.line}${step.fee.usd !== null ? ` ($${step.fee.usd})` : ""}, counted in the caps.`, step: step.id });
  if (fence.mode === "dry-run") reasons.push({ rule: "mode.dry-run", decision: "allow", message: "Dry run: Lyko walks the route but nothing is signed." });
  const hash = fenceHash(input);
  const factsDigest = canonicalDigest(facts);
  const signable = decision !== "deny" && fence.mode !== "dry-run";
  const digest = canonicalDigest({ schema: VERDICT_SCHEMA, fenceHash: hash, factsDigest, decision, signable, rules: reasons.map((r) => `${r.rule}:${r.decision}:${r.step ?? ""}`) });
  return { schema: VERDICT_SCHEMA, decision, signable, reasons, waived, fenceHash: hash, factsDigest, digest };
}
