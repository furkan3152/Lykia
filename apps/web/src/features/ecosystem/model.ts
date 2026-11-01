/** GET /v1/ecosystem, as the web reads it. */
export interface EcosystemProtocolView {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly summary: string;
  readonly website: string | null;
  readonly status: "verified" | "announced";
  readonly lykia: "routes" | "reads" | "lists";
  readonly verbs: readonly string[];
  readonly tvlUsd: number | null;
  readonly routed: { readonly steps: number; readonly usd: string };
}

export interface EcosystemView {
  readonly environment: "mainnet" | "testnet";
  readonly positioning: string;
  readonly protocols: readonly EcosystemProtocolView[];
  readonly totals: { readonly protocols: number; readonly verified: number; readonly routable: number; readonly tvlUsd: number | null; readonly routed: { readonly intents: number; readonly steps: number; readonly usd: string; readonly window: string } };
  readonly circle: readonly { readonly id: string; readonly name: string; readonly state: string; readonly lykia: string; readonly docs: string }[];
  readonly pulse: { readonly block: number; readonly blockTimeMs: number | null; readonly tps: number | null; readonly transferCostUsd: string | null } | null;
  readonly builders: { readonly freeTier: { readonly perMinute: number; readonly perDay: number }; readonly x402: { readonly mode: string; readonly note: string } };
  readonly sources: { readonly tvl: string; readonly tvlAt: string | null };
}

export const POSITIONING = "Built on Circle's rails, routing value to every Arc protocol, keeping every agent inside its Fence.";

export function usdShort(value: number | null): string {
  if (value === null) return "n/a";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

export const LYKIA_ROLE: Readonly<Record<EcosystemProtocolView["lykia"], { readonly label: string; readonly tone: "ok" | "sea" | "ghost" }>> = {
  routes: { label: "ROUTED", tone: "ok" },
  reads: { label: "READ", tone: "sea" },
  lists: { label: "LISTED", tone: "ghost" },
};

/** Circle product states, in plain words. */
export function circleState(state: string): { readonly label: string; readonly tone: "ok" | "sea" | "ochre" | "ghost" } {
  if (state === "live") return { label: "LIVE", tone: "ok" };
  if (state === "configured") return { label: "CONNECTED", tone: "ok" };
  if (state === "needs-key") return { label: "READY · NEEDS KEY", tone: "ochre" };
  if (state === "console-only") return { label: "CIRCLE CONSOLE", tone: "sea" };
  return { label: "NOT NEEDED ON ARC", tone: "ghost" };
}
