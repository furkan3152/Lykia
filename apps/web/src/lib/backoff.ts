/**
 * Exponential backoff with full jitter (pure): attempt 1 waits up to
 * `baseMs`, attempt n up to `baseMs * 2^(n-1)`, never more than `maxMs`,
 * never less than `minMs`. `random` is injectable for tests.
 */
export function backoffDelay(attempt: number, options: { readonly baseMs?: number; readonly maxMs?: number; readonly minMs?: number } = {}, random: () => number = Math.random): number {
  const base = options.baseMs ?? 1_000;
  const max = options.maxMs ?? 30_000;
  const min = options.minMs ?? 250;
  const exponent = Math.max(0, Math.min(16, Math.floor(attempt) - 1));
  const ceiling = Math.min(max, base * 2 ** exponent);
  return Math.round(Math.max(min, Math.min(max, ceiling * (0.5 + random() * 0.5))));
}
