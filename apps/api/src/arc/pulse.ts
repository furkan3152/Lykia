/**
 * The Arc pulse: block height, block time, gas price in USDC, throughput
 * and what a plain USDC transfer costs right now. One poller per
 * environment starts with the first subscriber and stops 30 s after the
 * last one leaves; the last pulse stays readable.
 */
import type { ArcEnvironment } from "@lykia/core";
import type { ArcPulse } from "@lykia/core/api/arc";
import type { EventBus } from "../bus.js";
import type { ArcChains } from "../chains/arc.js";
import type { Clock } from "../clock.js";
import type { Logger } from "../log.js";

export const PULSE_INTERVAL_MS = 1_500;
export const PULSE_IDLE_STOP_MS = 30_000;
export const PULSE_WINDOW = 60;
export const MAX_HEADERS_PER_POLL = 24;
/** Gas of a plain ERC-20 transfer, used for the transfer cost figure. */
export const TRANSFER_GAS = 65_000n;

export interface PulseFeed {
  latest(environment: ArcEnvironment): ArcPulse | null;
  /** Waits up to `timeoutMs` for a first pulse (starting the poller). */
  current(environment: ArcEnvironment, timeoutMs?: number): Promise<ArcPulse | null>;
  subscribe(environment: ArcEnvironment, listener: (pulse: ArcPulse) => void): () => void;
  close(): void;
}

interface Sample {
  readonly number: bigint;
  readonly timestamp: bigint;
  readonly txs: number;
  readonly baseFee: bigint | null;
}

interface Poller {
  timer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  running: boolean;
  samples: Sample[];
  latest: ArcPulse | null;
  listeners: Set<(pulse: ArcPulse) => void>;
}

/** gwei with up to 3 decimals, from wei of native USDC. */
export function weiToGwei(wei: bigint): string {
  const milli = (wei + 500_000n) / 1_000_000n;
  const whole = milli / 1000n;
  const fraction = (milli % 1000n).toString().padStart(3, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** USD (decimal string, 6 decimals max) of `gas` at `baseFee` wei of native USDC. */
export function gasCostUsd(baseFee: bigint, gas: bigint): string {
  const micros = (baseFee * gas + 500_000_000_000n) / 1_000_000_000_000n;
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function summarize(environment: ArcEnvironment, samples: readonly Sample[], at: number): ArcPulse | null {
  const last = samples[samples.length - 1];
  if (!last) return null;
  const first = samples[0] as Sample;
  const blocks = Number(last.number - first.number);
  const seconds = Number(last.timestamp - first.timestamp);
  const txs = samples.slice(1).reduce((sum, s) => sum + s.txs, 0);
  return {
    environment,
    block: Number(last.number),
    blockTimeMs: blocks > 0 && seconds > 0 ? Math.round((seconds * 1000) / blocks) : null,
    gasPriceGwei: last.baseFee === null ? null : weiToGwei(last.baseFee),
    tps: seconds > 0 ? Math.round((txs / seconds) * 10) / 10 : null,
    transferCostUsd: last.baseFee === null ? null : gasCostUsd(last.baseFee, TRANSFER_GAS),
    finality: "deterministic",
    at: new Date(at).toISOString(),
  };
}

export class PulseService implements PulseFeed {
  private readonly pollers = new Map<ArcEnvironment, Poller>();
  private closed = false;

  constructor(private readonly deps: { readonly chains: ArcChains; readonly clock: Clock; readonly log: Logger; readonly bus?: EventBus; readonly intervalMs?: number }) {}

  latest(environment: ArcEnvironment): ArcPulse | null {
    return this.pollers.get(environment)?.latest ?? null;
  }

  async current(environment: ArcEnvironment, timeoutMs = 4_000): Promise<ArcPulse | null> {
    const existing = this.latest(environment);
    if (existing) {
      this.touch(environment);
      return existing;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        stop();
        resolve(this.latest(environment));
      }, timeoutMs);
      const stop = this.subscribe(environment, (pulse) => {
        clearTimeout(timer);
        stop();
        resolve(pulse);
      });
    });
  }

  subscribe(environment: ArcEnvironment, listener: (pulse: ArcPulse) => void): () => void {
    const poller = this.poller(environment);
    poller.listeners.add(listener);
    if (poller.idleTimer) {
      clearTimeout(poller.idleTimer);
      poller.idleTimer = null;
    }
    this.start(environment, poller);
    return () => {
      poller.listeners.delete(listener);
      if (poller.listeners.size === 0) this.scheduleStop(poller);
    };
  }

  close(): void {
    this.closed = true;
    for (const poller of this.pollers.values()) {
      if (poller.timer) clearTimeout(poller.timer);
      if (poller.idleTimer) clearTimeout(poller.idleTimer);
      poller.timer = null;
      poller.idleTimer = null;
      poller.listeners.clear();
    }
  }

  private touch(environment: ArcEnvironment): void {
    const poller = this.poller(environment);
    this.start(environment, poller);
    if (poller.listeners.size === 0) this.scheduleStop(poller);
  }

  private poller(environment: ArcEnvironment): Poller {
    let poller = this.pollers.get(environment);
    if (!poller) {
      poller = { timer: null, idleTimer: null, running: false, samples: [], latest: null, listeners: new Set() };
      this.pollers.set(environment, poller);
    }
    return poller;
  }

  private scheduleStop(poller: Poller): void {
    if (poller.idleTimer) clearTimeout(poller.idleTimer);
    poller.idleTimer = setTimeout(() => {
      if (poller.listeners.size > 0) return;
      if (poller.timer) clearTimeout(poller.timer);
      poller.timer = null;
      poller.idleTimer = null;
    }, PULSE_IDLE_STOP_MS);
    poller.idleTimer.unref?.();
  }

  private start(environment: ArcEnvironment, poller: Poller): void {
    if (this.closed || poller.timer || poller.running) return;
    const tick = async () => {
      poller.running = true;
      try {
        await this.poll(environment, poller);
      } catch (error) {
        this.deps.log.debug("pulse poll failed", { environment, error: error instanceof Error ? error.message : String(error) });
      } finally {
        poller.running = false;
        if (!this.closed && (poller.listeners.size > 0 || poller.idleTimer)) {
          poller.timer = setTimeout(() => void tick(), this.deps.intervalMs ?? PULSE_INTERVAL_MS);
          poller.timer.unref?.();
        } else {
          poller.timer = null;
        }
      }
    };
    poller.timer = setTimeout(() => void tick(), 0);
  }

  private async poll(environment: ArcEnvironment, poller: Poller): Promise<void> {
    const client = this.deps.chains.client(environment);
    const head = await client.getBlockNumber({ cacheTime: 0 });
    const last = poller.samples[poller.samples.length - 1];
    if (last && head <= last.number) return;
    const from = last ? last.number + 1n : head - BigInt(Math.min(PULSE_WINDOW, 12)) + 1n;
    const start = head - from + 1n > BigInt(MAX_HEADERS_PER_POLL) ? head - BigInt(MAX_HEADERS_PER_POLL) + 1n : from;
    if (last && start > last.number + 1n) poller.samples = [];
    const numbers: bigint[] = [];
    for (let n = start; n <= head; n += 1n) numbers.push(n);
    const blocks = await Promise.all(numbers.map((blockNumber) => client.getBlock({ blockNumber })));
    for (const block of blocks) {
      if (block.number === null) continue;
      poller.samples.push({ number: block.number, timestamp: block.timestamp, txs: block.transactions.length, baseFee: block.baseFeePerGas ?? null });
    }
    if (poller.samples.length > PULSE_WINDOW) poller.samples = poller.samples.slice(-PULSE_WINDOW);
    const pulse = summarize(environment, poller.samples, this.deps.clock.now());
    if (!pulse) return;
    poller.latest = pulse;
    this.deps.bus?.emit("arc.pulse", pulse);
    for (const listener of [...poller.listeners]) listener(pulse);
  }
}
