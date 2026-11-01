/**
 * zod validation for request parts. A failure is 400 INVALID_REQUEST with
 * `details.issues` ([{ path, message }], at most 20), prefixed by the part
 * ("query.network", "body.amount", "params.id").
 *
 * Express 5 exposes `req.query` as a getter: validators return the parsed
 * value instead of writing it back.
 */
import type { Request } from "express";
import { isAddress } from "viem";
import { z, type ZodTypeAny } from "zod";
import { invalidRequest, zodIssues } from "./errors.js";

export type RequestPart = "query" | "body" | "params" | "headers";

export function parseWith<S extends ZodTypeAny>(schema: S, value: unknown, part: RequestPart): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.output<S>;
  throw invalidRequest(`The request ${part} is invalid.`, { issues: zodIssues(result.error, part) });
}

export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.output<S> {
  return parseWith(schema, req.query, "query");
}

export function parseBody<S extends ZodTypeAny>(req: Request, schema: S): z.output<S> {
  return parseWith(schema, req.body ?? {}, "body");
}

export function parseParams<S extends ZodTypeAny>(req: Request, schema: S): z.output<S> {
  return parseWith(schema, req.params, "params");
}

/* ---------------------------------------------------- shared schemas */

/**
 * A single query string value. Express parses `?a=1&a=2` into an array and
 * `?a[b]=1` into an object; both are refused rather than coerced.
 */
export function queryString(maxLength = 128) {
  return z.string({ invalid_type_error: "Expected a single value." }).max(maxLength);
}

export const queryBoolean = z
  .enum(["true", "false", "1", "0"], { errorMap: () => ({ message: "Expected true or false." }) })
  .transform((value) => value === "true" || value === "1");

export function queryInteger(min: number, max: number) {
  return z
    .string({ invalid_type_error: "Expected a single value." })
    .regex(/^-?\d{1,15}$/u, "Expected an integer.")
    .transform(Number)
    .refine((value) => value >= min && value <= max, `Expected an integer from ${min} to ${max}.`);
}

/** Comma-separated list of short tokens (`?coins=BTC,ETH`), deduplicated, order kept. */
export function queryList(maxItems: number, item: ZodTypeAny = z.string().min(1).max(64)) {
  return queryString(maxItems * 66)
    .transform((value) => [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))])
    .pipe(z.array(item).max(maxItems, `At most ${maxItems} items.`));
}

/** A 20-byte hex address, returned lowercase (checksums are accepted but not required). */
export const evmAddress = z
  .string()
  .trim()
  .refine((value) => isAddress(value, { strict: false }), "Expected a 0x-prefixed 20-byte hex address.")
  .transform((value) => value.toLowerCase() as `0x${string}`);

export const txHash = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{64}$/u, "Expected a 0x-prefixed 32-byte hex hash.")
  .transform((value) => value.toLowerCase() as `0x${string}`);
