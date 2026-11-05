/**
 * Dependency probes for GET /v1/health and GET /v1/networks: each Arc RPC
 * endpoint (eth_chainId must match, plus eth_blockNumber) and the store.
 * Cached 15 s; concurrent callers share one round; probes never throw and
 * never return endpoint paths (only scheme://host).
 */
import type { ArcNetwork, ArcNetworkKey } from "@lykia/core";
import type { Clock } from "../clock.js";
import type { Store } from "../store/types.js";

const HEALTH_CACHE_MS = 15_000;
const PROBE_TIMEOUT_MS = 4_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RpcProbe {
  readonly endpoint: string;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly head: number | null;
  readonly problem?: "timeout" | "unreachable" | "chain_mismatch" | "invalid_response";
}

export interface NetworkProbe {
  readonly network: ArcNetworkKey;
  readonly reachable: boolean;
  readonly head: number | null;
  readonly latencyMs: number | null;
  readonly endpoints: readonly RpcProbe[];
}

export interface DependencyReport {
  readonly checkedAt: number;
  readonly networks: Readonly<Partial<Record<ArcNetworkKey, NetworkProbe>>>;
  readonly store: { readonly kind: Store["kind"]; readonly ok: boolean; readonly latencyMs: number };
}

function endpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "invalid-url";
  }
}

export class DependencyMonitor {
  private cached: DependencyReport | null = null;
  private inflight: Promise<DependencyReport> | null = null;

  constructor(
    private readonly options: {
      readonly networks: Readonly<Record<ArcNetworkKey, ArcNetwork>>;
      readonly store: Store;
      readonly clock: Clock;
      readonly fetch: FetchLike;
      readonly cacheMs?: number;
      readonly timeoutMs?: number;
    },
  ) {}

  async report(): Promise<DependencyReport> {
    const now = this.options.clock.now();
    if (this.cached && now - this.cached.checkedAt < (this.options.cacheMs ?? HEALTH_CACHE_MS)) return this.cached;
    if (this.inflight) return this.inflight;
    const round = this.probeAll()
      .then((report) => {
        this.cached = report;
        return report;
      })
      .finally(() => {
        this.inflight = null;
      });
    this.inflight = round;
    return round;
  }

  private async probeAll(): Promise<DependencyReport> {
    const networks = Object.values(this.options.networks);
    const [probes, store] = await Promise.all([Promise.all(networks.map((n) => this.probeNetwork(n))), this.probeStore()]);
    const out: Partial<Record<ArcNetworkKey, NetworkProbe>> = {};
    for (const probe of probes) out[probe.network] = probe;
    return { checkedAt: this.options.clock.now(), networks: out, store };
  }

  private async probeNetwork(network: ArcNetwork): Promise<NetworkProbe> {
    const endpoints = await Promise.all(network.rpcUrls.map((url) => this.probeRpc(url, network.chainId)));
    const ok = endpoints.filter((e) => e.ok);
    return {
      network: network.key,
      reachable: ok.length > 0,
      head: ok.reduce<number | null>((max, e) => (e.head !== null && (max === null || e.head > max) ? e.head : max), null),
      latencyMs: ok.length > 0 ? Math.min(...ok.map((e) => e.latencyMs)) : null,
      endpoints,
    };
  }

  private async probeRpc(url: string, chainId: number): Promise<RpcProbe> {
    const started = this.options.clock.now();
    const endpoint = endpointLabel(url);
    try {
      const response = await this.options.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
          { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
        ]),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? PROBE_TIMEOUT_MS),
      });
      const body = (await response.json()) as Array<{ id?: number; result?: unknown }>;
      const latencyMs = this.options.clock.now() - started;
      if (!Array.isArray(body)) return { endpoint, ok: false, latencyMs, head: null, problem: "invalid_response" };
      const chain = body.find((b) => b.id === 1)?.result;
      const head = body.find((b) => b.id === 2)?.result;
      if (typeof chain !== "string" || Number.parseInt(chain, 16) !== chainId) return { endpoint, ok: false, latencyMs, head: null, problem: "chain_mismatch" };
      return { endpoint, ok: true, latencyMs, head: typeof head === "string" ? Number.parseInt(head, 16) : null };
    } catch (error) {
      const latencyMs = this.options.clock.now() - started;
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { endpoint, ok: false, latencyMs, head: null, problem: timeout ? "timeout" : "unreachable" };
    }
  }

  private async probeStore(): Promise<DependencyReport["store"]> {
    const started = this.options.clock.now();
    try {
      await this.options.store.ping();
      return { kind: this.options.store.kind, ok: true, latencyMs: this.options.clock.now() - started };
    } catch {
      return { kind: this.options.store.kind, ok: false, latencyMs: this.options.clock.now() - started };
    }
  }
}
