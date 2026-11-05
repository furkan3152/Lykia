/**
 * Circle Agent Marketplace discovery (public, keyless): x402 services that
 * accept USDC, filtered to what an agent on Arc can pay for.
 * https://developers.circle.com/agent-stack/agent-marketplace/discovery-api
 */
import type { X402DiscoveryResponse, X402Service } from "@lykia/core/api/circle";
import type { FetchLike } from "../health/dependencies.js";
import { circleFetch } from "./http.js";
import { LykiaHttpError } from "../http/errors.js";

const DISCOVERY_URL = "https://api.circle.com/v2/x402/discovery/resources";
export const ARC_NETWORKS = { mainnet: "eip155:5042", testnet: "eip155:5042002" } as const;

interface RawItem {
  resource: string;
  accepts?: { scheme: string; network: string; asset: string; payTo: string; amount?: string; maxAmountRequired?: string }[];
  metadata?: { provider?: { name?: string; category?: string }; description?: string; method?: string };
}

const CACHE = new Map<string, { at: number; value: X402DiscoveryResponse }>();

export async function discoverServices(fetchImpl: FetchLike, input: { network?: string; category?: string; query?: string; maxUsdPrice?: number; limit?: number }, now: number): Promise<X402DiscoveryResponse> {
  const params = new URLSearchParams();
  if (input.network) params.set("network", input.network);
  if (input.category) params.set("category", input.category);
  if (input.query) params.set("query", input.query);
  if (input.maxUsdPrice !== undefined) params.set("maxUsdPrice", String(input.maxUsdPrice));
  params.set("limit", String(Math.min(input.limit ?? 25, 100)));
  const url = `${DISCOVERY_URL}?${params.toString()}`;
  const hit = CACHE.get(url);
  if (hit && now - hit.at < 5 * 60_000) return hit.value;
  const response = await circleFetch(fetchImpl, url, { signal: AbortSignal.timeout(8_000) }, "Circle's discovery API");
  if (!response.ok) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, `Circle's discovery API answered ${response.status}.`);
  const json = (await response.json()) as { items?: RawItem[] };
  const services: X402Service[] = (json.items ?? []).map((item) => {
    const accepts = item.accepts ?? [];
    const arc = accepts.find((a) => a.network === ARC_NETWORKS.mainnet || a.network === ARC_NETWORKS.testnet);
    const amount = arc?.amount ?? arc?.maxAmountRequired;
    return {
      resource: item.resource,
      provider: item.metadata?.provider?.name ?? new URL(item.resource).hostname,
      category: item.metadata?.provider?.category ?? null,
      description: item.metadata?.description ?? null,
      method: item.metadata?.method ?? null,
      arc: arc && amount ? { network: arc.network, amount, payTo: arc.payTo, asset: arc.asset, priceUsdc: (Number(amount) / 1e6).toString() } : null,
      networks: [...new Set(accepts.map((a) => a.network))],
      gateway: accepts.some((a) => a.scheme.toLowerCase().includes("gateway")),
    };
  });
  const value = { services, source: DISCOVERY_URL };
  CACHE.set(url, { at: now, value });
  return value;
}
