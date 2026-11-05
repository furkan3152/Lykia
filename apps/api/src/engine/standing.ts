/**
 * Standing orders: kept in the store, checked by a scheduler against
 * Chainlink prices, the clock and lending health factors. When one fires it
 * PLANS a new intent for the owner (or the agent) through the intent
 * engine, with the owner's Fence. It never signs and never prepares calls:
 * the owner sees the plan in the deck (or gets a webhook) and signs it.
 * Unknown facts never fire an order.
 */
import { randomBytes } from "node:crypto";
import {
  checkTrigger,
  defaultMaxFires,
  getProtocol,
  nextScheduleRun,
  STANDING_SCHEMA,
  validateStandingDraft,
  type Address,
  type ArcEnvironment,
  type Fence,
  type PriceFeed,
  type StandingOrder,
  type StandingOrderDraft,
  type TriggerFacts,
} from "@lykia/core";
import type { EventBus } from "../bus.js";
import type { ArcChains } from "../chains/arc.js";
import type { Clock } from "../clock.js";
import { LykiaHttpError } from "../http/errors.js";
import type { Logger } from "../log.js";
import type { JsonValue, Store } from "../store/types.js";
import { AGGREGATOR_ABI, scaledToDecimal } from "../arc/prices.js";
import type { IntentService } from "./service.js";
import { aaveSpokes, readAaveAccount, wadToRatio } from "./venues/aave.js";
import { morphoPositions, projectMorphoHealth } from "./venues/morphoBlue.js";

declare module "../bus.js" {
  interface LykiaEvents {
    "standing.fired": { readonly order: StandingOrder; readonly intentId: string; readonly observation: string };
    "standing.failed": { readonly order: StandingOrder; readonly message: string };
  }
}

export const STANDING_CHECK_MS = 30_000;
const MAX_ORDERS_PER_OWNER = 50;
/** After this many failed plans in a row, an order pauses itself. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Chainlink feed keys in the registry row, per trigger feed. */
const FEED_KEYS: Readonly<Record<PriceFeed, { key: string; maxAgeSeconds: number }>> = {
  "EURC/USD": { key: "eurcUsd", maxAgeSeconds: 26 * 3600 },
  "BTC/USD": { key: "btcUsd", maxAgeSeconds: 2 * 3600 },
  "ETH/USD": { key: "ethUsd", maxAgeSeconds: 2 * 3600 },
  "EUR/USD": { key: "eurUsd", maxAgeSeconds: 26 * 3600 },
  "USDC/USD": { key: "usdcUsd", maxAgeSeconds: 26 * 3600 },
  "JPY/USD": { key: "jpyUsd", maxAgeSeconds: 26 * 3600 },
  "BRL/USD": { key: "brlUsd", maxAgeSeconds: 26 * 3600 },
  "MXN/USD": { key: "mxnUsd", maxAgeSeconds: 26 * 3600 },
  "PAXG/USD": { key: "paxgUsd", maxAgeSeconds: 26 * 3600 },
};

export interface StoredStanding {
  readonly order: StandingOrder;
  readonly fence?: Fence;
  readonly failures: number;
}

export interface CreateStandingInput {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly draft: StandingOrderDraft;
  readonly signer?: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
  readonly fence?: Fence;
}

export class StandingService {
  constructor(
    private readonly deps: {
      readonly chains: ArcChains;
      readonly store: Store;
      readonly clock: Clock;
      readonly bus: EventBus;
      readonly log: Logger;
      readonly intents: () => IntentService;
    },
  ) {}

  private col() {
    return this.deps.store.collection<JsonValue>("standing");
  }

  async create(input: CreateStandingInput): Promise<StandingOrder> {
    const issues = validateStandingDraft(input.draft);
    if (issues.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, "The standing order is invalid.", { issues });
    const existing = await this.list(input.owner);
    if (existing.filter((o) => o.status === "active").length >= MAX_ORDERS_PER_OWNER) throw new LykiaHttpError("INVALID_REQUEST", 400, `At most ${MAX_ORDERS_PER_OWNER} active standing orders per owner.`);
    const now = this.deps.clock.now();
    const createdAt = new Date(now).toISOString();
    const order: StandingOrder = {
      schema: STANDING_SCHEMA,
      id: `so_${randomBytes(9).toString("base64url")}`,
      owner: input.owner,
      environment: input.environment,
      signer: input.signer ?? "wallet",
      ...(input.agent ? { agent: input.agent } : {}),
      trigger: input.draft.trigger,
      actions: input.draft.actions,
      text: input.draft.text,
      maxFires: input.draft.maxFires === undefined ? defaultMaxFires(input.draft.trigger) : input.draft.maxFires,
      ...(input.draft.expiresAt ? { expiresAt: input.draft.expiresAt } : {}),
      status: "active",
      createdAt,
      fired: 0,
      ...(input.draft.trigger.kind === "schedule" ? { nextRunAt: new Date(nextScheduleRun(input.draft.trigger, now)).toISOString() } : {}),
    };
    await this.col().put(order.id, { order, ...(input.fence ? { fence: input.fence } : {}), failures: 0 } as unknown as JsonValue);
    return order;
  }

  async get(id: string): Promise<StandingOrder> {
    const doc = await this.col().get(id);
    if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such standing order.");
    return (doc.value as unknown as StoredStanding).order;
  }

  async list(owner?: Address): Promise<StandingOrder[]> {
    const docs = await this.col().list({ limit: 1000 });
    return docs.map((d) => (d.value as unknown as StoredStanding).order).filter((o) => !owner || o.owner.toLowerCase() === owner.toLowerCase());
  }

  async setStatus(id: string, status: "active" | "paused" | "cancelled"): Promise<StandingOrder> {
    const doc = await this.col().get(id);
    if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such standing order.");
    const stored = doc.value as unknown as StoredStanding;
    if (stored.order.status === "cancelled" || stored.order.status === "done") throw new LykiaHttpError("INVALID_REQUEST", 409, `The order is ${stored.order.status}.`);
    const order: StandingOrder = { ...stored.order, status };
    await this.col().put(id, { ...stored, order, failures: status === "active" ? 0 : stored.failures } as unknown as JsonValue);
    return order;
  }

  /** Latest Chainlink prices for the feeds the given orders watch (null = stale/unreadable). */
  async prices(feeds: readonly PriceFeed[]): Promise<Partial<Record<PriceFeed, string | null>>> {
    const row = getProtocol("chainlink")?.deployments.mainnet?.contracts ?? {};
    const out: Partial<Record<PriceFeed, string | null>> = {};
    const client = this.deps.chains.client("mainnet");
    await Promise.all(
      [...new Set(feeds)].map(async (feed) => {
        const spec = FEED_KEYS[feed];
        const address = row[spec.key];
        if (!address) return void (out[feed] = null);
        try {
          const [decimals, round] = await Promise.all([client.readContract({ address, abi: AGGREGATOR_ABI, functionName: "decimals" }), client.readContract({ address, abi: AGGREGATOR_ABI, functionName: "latestRoundData" })]);
          const age = this.deps.clock.now() / 1000 - Number(round[3]);
          out[feed] = round[1] <= 0n || age > spec.maxAgeSeconds ? null : scaledToDecimal(round[1], Number(decimals));
        } catch {
          out[feed] = null;
        }
      }),
    );
    return out;
  }

  /** Health factors by venue for an owner (null = unreadable; absent = no debt there). */
  async health(environment: ArcEnvironment, owner: Address): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (const spoke of aaveSpokes(environment)) {
      const account = await readAaveAccount(this.deps.chains, environment, spoke.address, owner);
      if (account === null) out["aave-v4"] = out["aave-v4"] ?? null;
      else if (account.debtValueRay > 0n) out["aave-v4"] = wadToRatio(account.healthFactorWad);
    }
    try {
      for (const { market, position } of await morphoPositions(this.deps.chains, environment, owner)) {
        if (position.borrowAssets > 0n) out["morpho-blue"] = wadToRatio(projectMorphoHealth(market, position, 0n, 0n));
      }
    } catch {
      /* no Morpho here */
    }
    return out;
  }

  /** Checks one order now; fires it (plans an intent) when due. */
  async check(id: string, options: { readonly force?: boolean } = {}): Promise<{ order: StandingOrder; due: boolean; observation: string; intentId?: string }> {
    const doc = await this.col().get(id);
    if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such standing order.");
    const stored = doc.value as unknown as StoredStanding;
    const order = stored.order;
    const now = this.deps.clock.now();
    const facts: TriggerFacts = {
      now,
      prices: order.trigger.kind === "price" ? await this.prices([order.trigger.feed]) : {},
      ...(order.trigger.kind === "health" ? { health: await this.health(order.environment, order.agent?.address ?? order.owner) } : {}),
    };
    const result = checkTrigger(order, facts);
    const due = result.due || (options.force === true && order.status === "active");
    let next: StandingOrder = { ...order, lastCheckedAt: new Date(now).toISOString(), lastObservation: result.observation };
    let failures = stored.failures;
    let intentId: string | undefined;
    if (due) {
      try {
        const created = await this.deps.intents().create({
          environment: order.environment,
          owner: order.owner,
          actions: order.actions,
          source: `standing order ${order.id}: ${order.text}`.slice(0, 500),
          ...(stored.fence ? { fence: stored.fence } : {}),
          signer: order.signer,
          ...(order.agent ? { agent: order.agent } : {}),
        });
        intentId = created.intent.id;
        const fired = order.fired + 1;
        const max = order.maxFires === undefined ? defaultMaxFires(order.trigger) : order.maxFires;
        next = {
          ...next,
          fired,
          lastFiredAt: new Date(now).toISOString(),
          lastIntentId: intentId,
          status: max !== null && fired >= max ? "done" : next.status,
          ...(order.trigger.kind === "schedule" ? { nextRunAt: new Date(nextScheduleRun(order.trigger, now)).toISOString() } : {}),
        };
        failures = 0;
        this.deps.bus.emit("standing.fired", { order: next, intentId, observation: result.observation });
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        next = {
          ...next,
          lastObservation: `${result.observation} Planning failed: ${message}`,
          ...(failures >= MAX_CONSECUTIVE_FAILURES ? { status: "paused" as const } : {}),
          ...(order.trigger.kind === "schedule" ? { nextRunAt: new Date(nextScheduleRun(order.trigger, now)).toISOString() } : {}),
        };
        this.deps.bus.emit("standing.failed", { order: next, message });
      }
    }
    await this.col().put(id, { ...stored, order: next, failures } as unknown as JsonValue);
    return { order: next, due, observation: next.lastObservation ?? result.observation, ...(intentId ? { intentId } : {}) };
  }

  /** One scheduler pass over every active order. Returns how many fired. */
  async tick(): Promise<number> {
    let fired = 0;
    for (const order of await this.list()) {
      if (order.status !== "active") continue;
      try {
        const result = await this.check(order.id);
        if (result.intentId) fired += 1;
      } catch (error) {
        this.deps.log.debug("standing check failed", { id: order.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return fired;
  }
}
