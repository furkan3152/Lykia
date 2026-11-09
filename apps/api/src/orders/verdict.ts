/**
 * The Fence and the mainnet beta cap on one LykiaOrders order. Each
 * execution is one swap a keeper may run, pulling `amountIn` from the maker
 * (LykiaOrders.sol: "Amount pulled from the maker per execution"), so one
 * execution's full value is what the rules judge: at draft time (the Orders
 * route, Ask's draft_order and compiled programs) and again when the signed
 * order is stored.
 *
 * A USDC/EURC order is an FX step, so the Fence's FX band needs the quote's
 * distance from its reference. An order with a Chainlink trigger executes at
 * the trigger: its expected output is computed at the trigger price, and that
 * price is its reference. An order without one executes at the market: its
 * expected output (the live quote) is compared with Chainlink EURC/USD now.
 */
import { findToken, tokenAddress, type Address, type ArcEnvironment, type FenceVerdict } from "@lykia/core";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { usdOf, valueVerdict } from "../modules/common.js";
import { services } from "../services.js";

export interface OrderQuote {
  /** Whole tokens swapped per execution (after the fee and the tip). */
  readonly swapped: string;
  /** Whole tokens expected out per execution, before slippage. */
  readonly expectedOut: string;
  /** The trigger price (USD per non-USDC token), when the order has one. */
  readonly triggerPrice?: string | null;
}

/** Signed distance of the order's expected rate from its reference, in bps; null when no reference can be read. */
export async function orderFxDeviationBps(ctx: AppContext, sell: string, buy: string, quote: OrderQuote): Promise<number | null> {
  const swapped = Number(quote.swapped);
  const out = Number(quote.expectedOut);
  if (!(swapped > 0) || !(out > 0)) return null;
  const rate = out / swapped;
  // Reference rate, buy-token per sell-token: the trigger when there is one, else Chainlink EURC/USD now.
  const eurUsd = quote.triggerPrice ? Number(quote.triggerPrice) : Number((await services(ctx).prices.price("EURC")).usd ?? NaN);
  if (!(eurUsd > 0)) return null;
  const reference = sell === "USDC" ? 1 / eurUsd : eurUsd;
  return Math.round(((rate - reference) / reference) * 10_000);
}

export async function orderVerdict(ctx: AppContext, input: { readonly environment: ArcEnvironment; readonly owner: Address; readonly sell: string; readonly buy: string; readonly perExecution: string; readonly fence?: unknown; readonly quote?: OrderQuote }): Promise<FenceVerdict> {
  const sellToken = findToken(input.environment, input.sell);
  const buyToken = findToken(input.environment, input.buy);
  if (!sellToken || !buyToken) throw new LykiaHttpError("INVALID_REQUEST", 400, "Orders trade registry tokens (see /v1/tokens).");
  const fx = [sellToken.symbol, buyToken.symbol].sort().join("/") === "EURC/USDC";
  const fxDeviationBps = fx && input.quote ? await orderFxDeviationBps(ctx, sellToken.symbol, buyToken.symbol, input.quote) : null;
  return valueVerdict(ctx, {
    environment: input.environment,
    owner: input.owner,
    ...(input.fence !== undefined ? { fence: input.fence } : {}),
    steps: [
      {
        id: "s1",
        kind: fx ? "fx" : "swap",
        venue: "lykia-orders",
        usd: await usdOf(ctx, sellToken.symbol, input.perExecution),
        ...(fx ? { fxDeviationBps } : {}),
        tokens: [
          { symbol: sellToken.symbol, address: tokenAddress(sellToken, input.environment) as Address, listed: true, acquired: false },
          { symbol: buyToken.symbol, address: tokenAddress(buyToken, input.environment) as Address, listed: true, acquired: true },
        ],
      },
    ],
  });
}

/** The quote a drafted order carries (ordersService.draft's perExecution). */
export function quoteOf(draft: { readonly perExecution: { readonly swapped: string; readonly expectedOut: string } }, triggerPrice?: string | null): OrderQuote {
  return { swapped: draft.perExecution.swapped, expectedOut: draft.perExecution.expectedOut, ...(triggerPrice ? { triggerPrice } : {}) };
}
