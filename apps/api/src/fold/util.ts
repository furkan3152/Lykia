/** Small helpers for the Fold's reads. */

/** Resolves to null after `ms`; the timer is cleared as soon as either side settles, so nothing lingers. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A failed read becomes its fallback (it only hides its own part). */
export async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}
