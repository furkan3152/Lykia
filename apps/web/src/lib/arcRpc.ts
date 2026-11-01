/**
 * A tiny read-only Arc RPC client for the browser fallback: when the Lykia
 * API is unreachable, the pulse reads Arc's public RPC directly (it serves
 * open CORS) and the interface says so. Pure apart from `fetch`.
 */
import { networkFor, type ArcEnvironment } from "@lykia/core";

import type { ArcPulse } from "./types";

async function rpc<T>(url: string, method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(body.error?.message ?? `${method} failed`);
  return body.result;
}

/** Gwei with up to 3 decimals from a hex wei value: "0x4a817c800" -> "20". */
export function hexWeiToGwei(hex: string): string {
  const wei = BigInt(hex);
  const whole = wei / 1_000_000_000n;
  const frac = ((wei % 1_000_000_000n) / 1_000_000n).toString().padStart(3, "0").replace(/0+$/u, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** A pulse read straight from Arc: head, gas price and the interval over the last 20 blocks. */
export async function pulseFromRpc(environment: ArcEnvironment, signal?: AbortSignal): Promise<ArcPulse> {
  const url = networkFor(environment).rpcUrls[0]!;
  const [headHex, gasHex] = await Promise.all([rpc<string>(url, "eth_blockNumber", [], signal), rpc<string>(url, "eth_gasPrice", [], signal)]);
  const head = Number(BigInt(headHex));
  let blockTimeMs: number | null;
  try {
    const [latest, earlier] = await Promise.all([
      rpc<{ timestamp: string }>(url, "eth_getBlockByNumber", [headHex, false], signal),
      rpc<{ timestamp: string }>(url, "eth_getBlockByNumber", [`0x${(head - 20).toString(16)}`, false], signal),
    ]);
    const seconds = Number(BigInt(latest.timestamp) - BigInt(earlier.timestamp));
    blockTimeMs = seconds > 0 ? Math.round((seconds * 1000) / 20) : null;
  } catch {
    blockTimeMs = null;
  }
  return { environment, block: head, blockTimeMs, gasPriceGwei: hexWeiToGwei(gasHex), tps: null, finality: "deterministic", at: new Date().toISOString() };
}
