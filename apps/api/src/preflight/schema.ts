/**
 * The preflight finding as a zod schema, for the OpenAPI document and the
 * SDK's generated types (lykia.preflight/v1). The engine builds findings in
 * core; this only describes them.
 */
import { z } from "zod";

const figure = z.object({ label: z.string(), value: z.string(), source: z.string(), readAt: z.string().nullable().describe("ISO time of the read; null for a schedule or a preference") });

export const fixSchema = z.object({
  id: z.string(),
  kind: z.enum(["replan", "wait", "pause", "switch-network", "change-fence", "add-funds", "open"]),
  label: z.string().describe("The chip, e.g. \"Use 1.50 USDC\""),
  detail: z.string().optional(),
  question: z.string().optional(),
  sentence: z.string().optional().describe("replan: the sentence to plan instead (POST /v1/intents with text)"),
  actions: z.array(z.unknown()).optional().describe("replan: the same plan as typed actions (POST /v1/intents with actions)"),
  path: z.string().optional(),
  method: z.enum(["get", "post"]).optional(),
  etaSeconds: z.number().optional(),
  address: z.string().optional(),
  chainId: z.number().optional(),
  needsGas: z.boolean().describe("True when the fix is itself a transaction from this wallet"),
});

export const findingSchema = z.object({
  id: z.string().describe("Stable for the same condition"),
  check: z.enum(["gas-reserve", "cash-floor", "obligations", "dust", "insufficient", "cost-ratio", "price-impact", "fx-band", "price-stale", "quote-age", "round-trip", "loan-health", "vault-state", "lp-range", "approvals", "recipient", "bridge-destination", "network", "duplicate", "fence-room", "budget", "conflict", "unpriced", "plan-refused"]),
  family: z.enum(["gas", "money", "cost", "risk", "time", "address", "bridge", "network", "approval", "limits"]),
  severity: z.enum(["block", "warn", "note"]).describe("block: cannot be prepared; warn: prepare needs acknowledge: true; note: for the record"),
  title: z.string(),
  why: z.string(),
  say: z.string(),
  figures: z.array(figure),
  change: z.object({ label: z.string(), before: z.string(), after: z.string() }).optional(),
  fixes: z.array(fixSchema),
  step: z.string().optional(),
});

export const preflightResponseSchema = z.object({
  intentId: z.string(),
  at: z.string(),
  findings: z.array(findingSchema),
  gate: z.object({ blocked: z.boolean(), needsAck: z.array(z.string()) }),
});

export const intentResponseSchema = z.object({
  intent: z.object({ id: z.string(), preflight: z.array(findingSchema).optional() }).passthrough(),
  outrun: z.object({}).passthrough(),
  stored: z.boolean(),
}).passthrough();

export const prepareResponseSchema = z.object({
  stepId: z.string(),
  transactions: z.array(z.object({}).passthrough()),
  binding: z.string(),
  memo: z.string(),
  preflight: z.array(findingSchema).optional(),
}).passthrough();
