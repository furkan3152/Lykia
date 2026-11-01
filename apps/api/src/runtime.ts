/**
 * Where the API runs. On Vercel Functions (VERCEL=1) every instance is a
 * short-lived serverless function: event streams must end before the
 * function's max duration (300 s in apps/api/vercel.json) so EventSource
 * reconnects with Last-Event-ID instead of being cut mid-event.
 */
export type Runtime = "serverless" | "server";

export function detectRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  return env.VERCEL === "1" || env.AWS_LAMBDA_FUNCTION_NAME !== undefined ? "serverless" : "server";
}

export const RUNTIME: Runtime = detectRuntime();

/** Stream lifetime: long on a server, safely under the function limit when serverless. */
export const SERVERLESS_STREAM_MS = 280_000;
