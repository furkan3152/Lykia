/** Wall clock seam: every time-dependent component reads `now()` from here so tests can drive time. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: Clock = Object.freeze({ now: () => Date.now() });

/** A clock tests move by hand. */
export class ManualClock implements Clock {
  constructor(private current = 1_800_000_000_000) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(ms: number): void {
    this.current = ms;
  }
}
