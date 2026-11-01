/**
 * Lykia's protocol fee: a share of every value-moving step, paid on chain in
 * the same atomic transaction as the step (an ERC-20 transfer to the fee
 * recipient inside the step's Multicall3From batch, or inside the same user
 * operation for smart accounts). A prepared step without its fee transfer
 * does not match its binding and is refused at submit.
 *
 * Policy (`FEE_POLICY_TEXT`):
 *  - charged: send, swap, fx, deposit, supply, borrow (on the borrowed
 *    amount), bridge, Gateway deposits;
 *  - exempt: repay, withdraw (value coming home to the owner), approvals,
 *    revokes, Tag registration and attestations;
 *  - taken from the step's input token before the action, so quotes and
 *    minimum outputs are computed on what the venue actually receives;
 *    a send with an exact amount pays the fee on top, so the recipient
 *    gets exactly what was asked;
 *  - the fee is rounded up to the next base unit, so it is never more than
 *    one unit above the exact share.
 */
import { fromBaseUnits } from "./amounts.js";
import type { Address } from "./contracts.js";
import type { StepKind } from "./intent.js";

export const DEFAULT_FEE_BPS = 100;
export const MAX_FEE_BPS = 300;
export const DEFAULT_FEE_RECIPIENT: Address = "0x8c5281055b197443ff01dbbdfbf29fd63946ca1e";

export interface FeePolicy {
  readonly bps: number;
  readonly recipient: Address;
}

export const DEFAULT_FEE_POLICY: FeePolicy = Object.freeze({ bps: DEFAULT_FEE_BPS, recipient: DEFAULT_FEE_RECIPIENT });

/** Step kinds that never pay the fee. */
export const FEE_EXEMPT_KINDS: ReadonlySet<StepKind> = new Set<StepKind>(["repay", "withdraw", "approve", "register-agent", "attest"]);

export const FEE_POLICY_TEXT =
  "Lykia takes a protocol fee on every value-moving step (send, swap, FX, deposit, supply, borrow, bridge, Gateway deposit), paid on chain in the same transaction. Repay, withdrawals home, approvals, revokes and Tag steps are free.";

export function isFeeBearing(kind: StepKind): boolean {
  return !FEE_EXEMPT_KINDS.has(kind);
}

export function validFeeBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= 0 && bps <= MAX_FEE_BPS;
}

/** The fee on `units`, rounded up: never more than one base unit above the exact share. */
export function feeOf(units: bigint, bps: number): bigint {
  if (!validFeeBps(bps)) throw new RangeError(`fee bps must be an integer between 0 and ${MAX_FEE_BPS}.`);
  if (units <= 0n || bps === 0) return 0n;
  return (units * BigInt(bps) + 9_999n) / 10_000n;
}

/** Splits a gross amount into the fee and what the venue receives. */
export function splitFee(gross: bigint, bps: number): { readonly fee: bigint; readonly net: bigint } {
  const fee = feeOf(gross, bps);
  return { fee, net: gross > fee ? gross - fee : 0n };
}

/** The fee recorded on a step, as shown to the owner and checked at submit. */
export interface StepFee {
  readonly bps: number;
  readonly recipient: Address;
  readonly symbol: string;
  readonly token: Address;
  readonly decimals: number;
  /** Base units. */
  readonly amount: string;
  /** USD value; null when unpriced. */
  readonly usd: string | null;
  /** "input": taken from the input before the action; "on-top": paid besides an exact send; "output": taken from a borrowed amount. */
  readonly basis: "input" | "on-top" | "output";
}

export function feePercent(bps: number): string {
  const whole = bps / 100;
  return `${Number.isInteger(whole) ? whole.toFixed(0) : whole.toString()}%`;
}

/** "Lykia fee 1% · 2 USDC". */
export function feeLine(fee: StepFee): string {
  return `Lykia fee ${feePercent(fee.bps)} · ${fromBaseUnits(fee.amount, fee.decimals)} ${fee.symbol}`;
}

/** Fees summed per token across steps: ["3.5 USDC", "0.0001 cirBTC"]. */
export function feeTotals(fees: readonly (StepFee | undefined)[]): string[] {
  const totals = new Map<string, { amount: bigint; decimals: number }>();
  for (const fee of fees) {
    if (!fee) continue;
    const prev = totals.get(fee.symbol);
    totals.set(fee.symbol, { amount: (prev?.amount ?? 0n) + BigInt(fee.amount), decimals: fee.decimals });
  }
  return [...totals.entries()].filter(([, t]) => t.amount > 0n).map(([symbol, t]) => `${fromBaseUnits(t.amount, t.decimals)} ${symbol}`);
}
