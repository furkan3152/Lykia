/**
 * One shared animation clock for every pixel canvas (no per-component rAF).
 * The loop runs only while some subscriber is on screen, the tab is visible
 * and motion is allowed (the OS setting and Lykia's Motion switch). Each
 * subscriber can cap its own frame rate: pixel art steps, it does not glide.
 */

export interface TickerEnv {
  /** ms */
  now(): number;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
  /** The tab is hidden. */
  hidden(): boolean;
  /** Reduced motion (OS or the Motion switch). */
  reduced(): boolean;
}

/** Called with the shared clock in seconds and the seconds since this subscriber last ran. */
export type TickFn = (seconds: number, delta: number) => void;

export interface TickerSubscription {
  /** On screen or not (an IntersectionObserver usually sets this). */
  setVisible(visible: boolean): void;
  remove(): void;
}

export interface SubscribeOptions {
  /** Frame cap (default 30 fps). */
  readonly fps?: number;
  /** Starts on screen (default true, so content above the fold never waits). */
  readonly visible?: boolean;
}

interface Entry {
  readonly fn: TickFn;
  readonly interval: number;
  visible: boolean;
  last: number;
}

export interface Ticker {
  subscribe(fn: TickFn, options?: SubscribeOptions): TickerSubscription;
  /** Re-checks hidden/reduced and starts or stops the loop. Call after those change. */
  refresh(): void;
  /** The loop is scheduled. */
  running(): boolean;
  /** Subscribers that would run if the loop ran. */
  activeCount(): number;
  /** The shared clock (seconds since the ticker was made). */
  seconds(): number;
}

export function createTicker(env: TickerEnv): Ticker {
  const entries = new Set<Entry>();
  const origin = env.now();
  let handle: number | null = null;

  const allowed = () => !env.hidden() && !env.reduced();
  const active = () => {
    let n = 0;
    for (const entry of entries) if (entry.visible) n += 1;
    return n;
  };

  const frame = (time: number) => {
    handle = null;
    if (!allowed() || active() === 0) return;
    const seconds = (time - origin) / 1000;
    for (const entry of [...entries]) {
      if (!entry.visible || !entries.has(entry)) continue;
      if (time - entry.last < entry.interval - 1) continue;
      const delta = entry.last < 0 ? 0 : Math.min(0.25, (time - entry.last) / 1000);
      entry.last = time;
      entry.fn(seconds, delta);
    }
    schedule();
  };

  function schedule() {
    if (handle !== null) return;
    if (!allowed() || active() === 0) return;
    handle = env.requestFrame(frame);
  }

  function stop() {
    if (handle === null) return;
    env.cancelFrame(handle);
    handle = null;
  }

  function refresh() {
    if (allowed() && active() > 0) schedule();
    else stop();
  }

  return {
    subscribe(fn, options = {}) {
      const entry: Entry = { fn, interval: 1000 / Math.max(1, options.fps ?? 30), visible: options.visible ?? true, last: -1 };
      entries.add(entry);
      refresh();
      return {
        setVisible(visible) {
          entry.visible = visible;
          if (visible) entry.last = -1;
          refresh();
        },
        remove() {
          entries.delete(entry);
          refresh();
        },
      };
    },
    refresh,
    running: () => handle !== null,
    activeCount: active,
    seconds: () => (env.now() - origin) / 1000,
  };
}
