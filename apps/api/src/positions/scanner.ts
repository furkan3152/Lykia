/**
 * Event discovery for positions that cannot be enumerated on chain (Uniswap
 * v4 position NFTs, Morpho Blue markets an address touched). Arc's RPC
 * answers eth_getLogs over at most 9,999 blocks, so the scan walks windows:
 * forward from the last block it covered up to the head, then backward
 * toward the contract's first block, a bounded number of windows per read,
 * in parallel. What it found and how far it reached are kept per owner in
 * the store, so a second read only covers the new blocks and the backfill
 * continues where it stopped. Coverage is reported, never assumed.
 */
import type { Address, ArcEnvironment } from "@lykia/core";
import type { Hex } from "viem";
import type { AppContext } from "../context.js";
import { typedCollection } from "../platform/typed.js";

export const LOG_WINDOW = 9_999n;

export interface ScanSpec {
  /** Store key part: what is scanned ("v4-posm", "morpho-blue"). */
  readonly key: string;
  readonly address: Address;
  /** topics[0..3]; null = any. */
  readonly topics: readonly (Hex | readonly Hex[] | null)[];
  /** The contract's first block (documented in the reader). */
  readonly fromBlock: bigint;
  /** Picks the id each matching log contributes (token id, market id). */
  readonly extract: (log: { readonly topics: readonly Hex[]; readonly data: Hex }) => string | null;
}

export interface ScanResult {
  readonly ids: readonly string[];
  /** Blocks [bottom, top] are covered. */
  readonly top: bigint;
  readonly bottom: bigint;
  readonly complete: boolean;
  /** Share of the contract's history covered, 0..1. */
  readonly covered: number;
}

interface ScanDoc {
  readonly ids: readonly string[];
  readonly top: string;
  readonly bottom: string;
}

export interface ScanOptions {
  /** Wall-clock budget for one read. */
  readonly budgetMs: number;
  /** Windows in flight at once. */
  readonly parallel: number;
  readonly now?: () => number;
}

export type LogFetcher = (from: bigint, to: bigint) => Promise<readonly { readonly topics: readonly Hex[]; readonly data: Hex }[]>;

/** The scan itself, over an injected log fetcher and store (pure enough to test with mocks). */
export async function scanWindows(spec: Pick<ScanSpec, "fromBlock" | "extract">, head: bigint, prior: ScanDoc | null, fetchOnce: LogFetcher, options: ScanOptions): Promise<{ doc: ScanDoc; result: ScanResult }> {
  // A public RPC drops the odd request under load: each window is tried up to three times before the scan stops there.
  const fetchLogs: LogFetcher = async (from, to) => {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fetchOnce(from, to);
      } catch (error) {
        last = error;
      }
    }
    throw last;
  };
  const now = options.now ?? Date.now;
  const started = now();
  const ids = new Set(prior?.ids ?? []);
  let top = prior ? BigInt(prior.top) : head;
  let bottom = prior ? BigInt(prior.bottom) : head + 1n;
  const take = (logs: readonly { readonly topics: readonly Hex[]; readonly data: Hex }[]) => {
    for (const log of logs) {
      const id = spec.extract(log);
      if (id !== null) ids.add(id);
    }
  };
  const windows = (from: bigint, to: bigint, downward: boolean): [bigint, bigint][] => {
    const out: [bigint, bigint][] = [];
    if (downward) for (let hi = to; hi >= from; hi -= LOG_WINDOW + 1n) out.push([hi - LOG_WINDOW < from ? from : hi - LOG_WINDOW, hi]);
    else for (let lo = from; lo <= to; lo += LOG_WINDOW + 1n) out.push([lo, lo + LOG_WINDOW > to ? to : lo + LOG_WINDOW]);
    return out;
  };
  // Forward: new blocks since the last read (all of them; a gap of a day is a handful of windows).
  if (prior && head > top) {
    const fwd = windows(top + 1n, head, false);
    for (let i = 0; i < fwd.length; i += options.parallel) {
      const batch = fwd.slice(i, i + options.parallel);
      const results = await Promise.allSettled(batch.map(([a, b]) => fetchLogs(a, b)));
      let ok = true;
      for (let j = 0; j < results.length; j++) {
        const r = results[j]!;
        if (r.status === "rejected") {
          ok = false;
          break;
        }
        take(r.value);
        top = batch[j]![1];
      }
      if (!ok || now() - started > options.budgetMs) break;
    }
  }
  // Backward: continue the backfill toward the first block while the budget lasts.
  while (bottom > spec.fromBlock && now() - started <= options.budgetMs) {
    const hi = bottom - 1n;
    const batch = windows(spec.fromBlock, hi, true).slice(0, options.parallel);
    const results = await Promise.allSettled(batch.map(([a, b]) => fetchLogs(a, b)));
    let ok = true;
    for (let j = 0; j < results.length; j++) {
      const r = results[j]!;
      if (r.status === "rejected") {
        ok = false;
        break;
      }
      take(r.value);
      bottom = batch[j]![0];
    }
    if (!ok) break;
  }
  const span = head - spec.fromBlock + 1n;
  const coveredBlocks = top - bottom + 1n;
  const covered = span <= 0n ? 1 : Math.max(0, Math.min(1, Number((coveredBlocks * 10_000n) / span) / 10_000));
  const doc: ScanDoc = { ids: [...ids], top: top.toString(), bottom: bottom.toString() };
  return { doc, result: { ids: [...ids], top, bottom, complete: bottom <= spec.fromBlock, covered } };
}

const docs = (ctx: AppContext) => typedCollection<ScanDoc>(ctx, "position_scans");

/** Scans `spec` for `owner`, continuing from what earlier reads covered. */
export async function scanForOwner(ctx: AppContext, environment: ArcEnvironment, owner: Address, spec: ScanSpec, options: Partial<ScanOptions> = {}): Promise<ScanResult> {
  const client = ctx.chains.client(environment);
  const id = `${environment}:${spec.key}:${owner.toLowerCase()}`;
  const prior = (await docs(ctx).get(id).catch(() => null))?.value ?? null;
  const head = await client.getBlockNumber();
  const fetchLogs: LogFetcher = async (from, to) => {
    const logs = (await client.request({
      method: "eth_getLogs",
      params: [{ address: spec.address, topics: spec.topics as Hex[], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }],
    } as never)) as { topics: Hex[]; data: Hex }[];
    return logs;
  };
  const { doc, result } = await scanWindows(spec, head, prior, fetchLogs, { budgetMs: options.budgetMs ?? 8_000, parallel: options.parallel ?? 30, ...(options.now ? { now: options.now } : {}) });
  await docs(ctx).put(id, doc, { ttlMs: 180 * 86_400_000 }).catch(() => undefined);
  return result;
}

/** "Covered back to block 1,955,896 (all history)" or "Covered 38% of history so far". */
export function coverageLine(r: ScanResult): string | undefined {
  if (r.complete) return undefined;
  return `Event history read for ${Math.round(r.covered * 100)}% of blocks so far; older positions appear as the scan continues on the next reads.`;
}

/** An address as a 32-byte topic. */
export function addressTopic(address: Address): Hex {
  return `0x${address.toLowerCase().slice(2).padStart(64, "0")}` as Hex;
}
