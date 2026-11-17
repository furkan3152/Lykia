/**
 * Request schemas shared by the free routes, their paid x402 twins, the
 * OpenAPI catalogue and the x402 discovery document. Every field carries a
 * description: agents build their calls from these schemas, and the
 * discovery document and the 402 answers publish them as JSON Schema.
 *
 * This file imports nothing from the modules or the x402 code, so all of
 * them can share it without import cycles.
 */
import { STEP_KINDS } from "@lykia/core";
import { z } from "zod";
import { evmAddress } from "../http/validate.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);
const usd = z.string().regex(/^\d{1,15}(?:\.\d{1,8})?$/u);
const amount = z.string().regex(/^\d{1,18}(?:\.\d{1,18})?$/u);
const symbol = z.string().min(2).max(10);
const environment = z.enum(["mainnet", "testnet"]);

const tokenFact = z.object({
  symbol: z.string().max(32).describe("Token symbol, for example USDC."),
  address: address.describe("Token contract address on Arc."),
  listed: z.boolean().describe("True when the token is in Lykia's token registry."),
  acquired: z.boolean().describe("True when the step buys or receives this token, false when it spends it."),
  scent: z.enum(["verified", "no-red-flags", "caution", "danger", "unknown"]).optional().describe("Scent result for a token the step acquires; omit when the token was not inspected."),
});

const stepFact = z.object({
  id: z.string().max(32).describe("Step id, unique within the plan, for example s1."),
  kind: z.string().max(32).describe(`Step kind: ${STEP_KINDS.join(", ")}.`),
  venue: z.string().max(48).describe("Venue id the step uses, as GET /v1/venues lists it, for example arc-transfer."),
  usd: usd.nullable().describe("USD value the step moves, as a decimal string; null when it could not be priced (caps then fail closed)."),
  tokens: z.array(tokenFact).max(8).describe("Tokens the step spends or acquires, at most 8."),
  recipient: address.optional().describe("Address that receives value, for transfers and payouts."),
  destination: z.string().max(32).optional().describe("Bridge destination chain key, for example base."),
  slippageBps: z.number().int().min(0).max(10_000).optional().describe("Maximum slippage in basis points (0 to 10000)."),
  healthFactorAfter: z.string().max(16).nullable().optional().describe("Lending health factor after the step, as a decimal string; null when it could not be read."),
  fxDeviationBps: z.number().int().min(-10_000).max(10_000).nullable().optional().describe("FX quote deviation from the reference rate in basis points; null when there is no reference rate."),
});

/** The facts of a planned move, as the Fence evaluates them. */
export const factsSchema = z.object({
  environment: environment.describe("Arc network the move runs on: mainnet or testnet."),
  signer: z.enum(["wallet", "agent"]).describe("Who signs: the owner's own wallet, or an agent acting for the owner."),
  owner: address.describe("The owner's address on Arc."),
  proposedByAgent: z.boolean().optional().describe("True when an agent proposed the plan rather than the owner."),
  steps: z.array(stepFact).max(12).describe("The planned steps, at most 12."),
  spent: z
    .object({
      dayUsd: usd.nullable().describe("USD already spent today; null when unknown."),
      weekUsd: usd.nullable().describe("USD already spent this week; null when unknown."),
    })
    .optional()
    .describe("Spend so far, for the daily and weekly caps; omit when there are no such caps to check."),
  now: z.number().int().positive().optional().describe("Evaluation time in Unix milliseconds; defaults to the server's clock."),
});

/** POST /fence/evaluate and its paid twin. */
export const fenceCheckSchema = z.object({
  fence: z.unknown().optional().describe("A lykia.fence/v1 document; omit it to use the default Fence (the Balanced preset)."),
  facts: factsSchema.describe("The planned move to check."),
});

const quoteEnvironment = environment.optional().describe("Arc network to quote on: mainnet or testnet; defaults to the server's network.");

/** POST /quote and its paid twin: one variant per kind. */
export const quoteSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("swap").describe("swap: the best venue to sell `amount` of `from` for `to`."),
    environment: quoteEnvironment,
    from: symbol.describe("Symbol of the token to sell, for example USDC."),
    to: symbol.describe("Symbol of the token to buy, for example EURC."),
    amount: amount.describe("Amount of `from` to sell, in whole tokens as a decimal string, for example 100."),
  }),
  z.object({
    kind: z.literal("earn").describe("earn: every venue that pays a yield on `token`, and the pick."),
    environment: quoteEnvironment,
    token: symbol.describe("Symbol of the token to earn on, for example USDC."),
    maxRisk: z.enum(["low", "medium", "high"]).optional().describe("Highest risk tier the pick may take: low, medium or high (default medium)."),
  }),
  z.object({
    kind: z.literal("borrow").describe("borrow: every lending venue that can lend `amount` of `token` to `account`, and the pick."),
    environment: quoteEnvironment,
    token: symbol.describe("Symbol of the token to borrow, for example USDC."),
    amount: amount.describe("Amount to borrow, in whole tokens as a decimal string."),
    collateral: symbol.optional().describe("Symbol of the collateral token (default cirBTC)."),
    collateralAmount: amount.optional().describe("Collateral to post, in whole tokens as a decimal string; omit it and the quote sizes the collateral that keeps `minHealth`."),
    minHealth: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/u).optional().describe("Lowest health factor to keep after borrowing, as a decimal string (default 1.5)."),
    account: evmAddress.describe("The borrower's address on Arc; its existing positions are read."),
  }),
]);

/** GET /scent/:token and its paid twin. */
export const tokenParamsSchema = z.object({ token: evmAddress.describe("Token contract address on Arc.") });

/** The query of the paid Scent report: the report is read, and paid for, on this network. */
export const environmentQuerySchema = z.object({ environment: environment.optional().describe("Arc network to read the token on, and to pay on: mainnet or testnet; defaults to the server's network.") });
