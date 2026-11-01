/**
 * Typed in-process event bus. Delivery is synchronous and in subscription
 * order; a throwing listener is logged and never stops the others.
 *
 * Feature modules add their own events by augmenting `LykiaEvents`:
 *
 *   declare module "../../bus.js" {
 *     interface LykiaEvents { "alerts.fired": AlertFired }
 *   }
 */
import type { ArcPulse } from "@lykia/core/api/arc";
import type { Logger } from "./log.js";

export interface LykiaEvents {
  /** Rolling Arc chain health while the poller runs. */
  "arc.pulse": ArcPulse;
}

export type EventListener<T> = (payload: T) => void;

export class EventBus<Events extends object = LykiaEvents> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<never>>>();

  constructor(private readonly log?: Logger) {}

  on<K extends keyof Events>(type: K, listener: EventListener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    // A wrapper per registration so the same function can be registered twice and removed independently.
    const entry: EventListener<Events[K]> = (payload) => listener(payload);
    set.add(entry as EventListener<never>);
    return () => {
      const current = this.listeners.get(type);
      if (!current) return;
      current.delete(entry as EventListener<never>);
      if (current.size === 0) this.listeners.delete(type);
    };
  }

  once<K extends keyof Events>(type: K, listener: EventListener<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set] as Array<EventListener<Events[K]>>) {
      try {
        listener(payload);
      } catch (error) {
        this.log?.error("event listener failed", { event: String(type), error });
      }
    }
  }

  listenerCount(type: keyof Events): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
