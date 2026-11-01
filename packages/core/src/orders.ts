/**
 * Conditional orders (LykiaOrders on Arc): limit, stop-loss, take-profit,
 * DCA and TWAP swaps. The maker signs an EIP-712 order off chain; funds stay
 * in the maker's wallet behind an allowance to LykiaOrders until a keeper
 * executes a slice through LykiaRouter. Output always goes to the maker and
 * must meet `minAmountOut`.
 *
 * This module mirrors the contract's rules so the API and the web can
 * validate, price and display orders without a chain call. Pure: no I/O.
 */
import type { Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";
import { networkFor } from "./networks.js";

export const ORDER_KINDS = ["limit", "stop-loss", "take-profit", "dca", "twap"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** On-chain enum index of each kind (LykiaOrders.Kind). */
export const ORDER_KIND_INDEX: Readonly<Record<OrderKind, number>> = { limit: 0, "stop-loss": 1, "take-profit": 2, dca: 3, twap: 4 };

export const ORDERS_MAX_FEE_BPS = 300;
export const ORDERS_MAX_EXECUTIONS = 1000;
/** A keeper tip is at most 1% of a slice. */
export const ORDERS_MAX_TIP_BPS = 100;

/** The signed struct, with integers as decimal strings. */
export interface SignedOrderStruct {
  readonly maker: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: string;
  readonly minAmountOut: string;
  readonly maxTip: string;
  readonly maxFeeBps: number;
  readonly oracle: Address;
  readonly triggerPrice: string;
  readonly triggerAbove: boolean;
  readonly maxOracleAge: number;
  readonly kind: number;
  readonly executions: number;
  readonly interval: number;
  readonly startTime: number;
  readonly deadline: number;
  readonly nonce: string;
}

export const ORDER_EIP712_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "maxTip", type: "uint256" },
    { name: "maxFeeBps", type: "uint16" },
    { name: "oracle", type: "address" },
    { name: "triggerPrice", type: "int256" },
    { name: "triggerAbove", type: "bool" },
    { name: "maxOracleAge", type: "uint32" },
    { name: "kind", type: "uint8" },
    { name: "executions", type: "uint32" },
    { name: "interval", type: "uint32" },
    { name: "startTime", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export function orderDomain(environment: ArcEnvironment, verifyingContract: Address): { readonly name: "LykiaOrders"; readonly version: "1"; readonly chainId: number; readonly verifyingContract: Address } {
  return { name: "LykiaOrders", version: "1", chainId: networkFor(environment).chainId, verifyingContract };
}

export interface OrderSlice {
  readonly fee: bigint;
  readonly tip: bigint;
  /** What the router swaps after fee and tip. */
  readonly swapped: bigint;
}

/** Splits one execution's `amountIn` the way the contract does. */
export function orderSlice(amountIn: bigint, feeBps: number, tip: bigint): OrderSlice {
  const fee = (amountIn * BigInt(feeBps)) / 10_000n;
  return { fee, tip, swapped: amountIn - fee - tip };
}

/** The largest tip a keeper may take for this slice. */
export function maxTipFor(amountIn: bigint, signedMaxTip: bigint): bigint {
  const cap = (amountIn * BigInt(ORDERS_MAX_TIP_BPS)) / 10_000n;
  return signedMaxTip < cap ? signedMaxTip : cap;
}

export interface OrderIssue {
  readonly field: string;
  readonly message: string;
}

/** Same shape rules as LykiaOrders._validate, with plain-English messages. */
export function validateOrderStruct(o: SignedOrderStruct): OrderIssue[] {
  const issues: OrderIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  const zero = "0x0000000000000000000000000000000000000000";
  if (o.tokenIn.toLowerCase() === o.tokenOut.toLowerCase()) add("tokenOut", "Sell and buy tokens must differ.");
  if (BigInt(o.amountIn) <= 0n) add("amountIn", "The amount per execution must be positive.");
  if (BigInt(o.minAmountOut) <= 0n) add("minAmountOut", "The minimum output must be positive.");
  if (o.maxFeeBps > ORDERS_MAX_FEE_BPS) add("maxFeeBps", `At most ${ORDERS_MAX_FEE_BPS} bps.`);
  const single = o.kind <= 2;
  if (single ? o.executions !== 1 : o.executions < 2 || o.executions > ORDERS_MAX_EXECUTIONS) add("executions", single ? "Limit, stop-loss and take-profit orders execute once." : `DCA and TWAP need 2 to ${ORDERS_MAX_EXECUTIONS} executions.`);
  if (!single && o.interval <= 0) add("interval", "DCA and TWAP need an interval between executions.");
  if ((o.kind === 1 || o.kind === 2) && o.oracle === zero) add("oracle", "Stop-loss and take-profit orders need a price trigger.");
  if (o.oracle !== zero && o.maxOracleAge <= 0) add("maxOracleAge", "A price trigger needs a maximum price age.");
  if (o.deadline <= o.startTime) add("deadline", "The order must end after it starts.");
  return issues;
}

export type OrderStatus = "open" | "waiting" | "filled" | "cancelled" | "expired" | "invalid";

export interface OrderRecord {
  readonly hash: `0x${string}`;
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly kind: OrderKind;
  readonly order: SignedOrderStruct;
  readonly signature: `0x${string}`;
  /** "Buy EURC when EURC/USD ≤ 1.09", for lists and notifications. */
  readonly summary: string;
  readonly createdAt: string;
}

export interface OrderView extends OrderRecord {
  readonly status: OrderStatus;
  readonly executed: number;
  /** Why it is not executable right now ("condition", "interval", "stale price"…); null when it is. */
  readonly waitingFor: string | null;
  readonly lastExecutedAt: string | null;
}
