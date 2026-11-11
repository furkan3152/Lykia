import { coverageLine } from "@lykia/core";
import { formatUsd, t } from "../../i18n";

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
  /** The protocol's official entry on arc.io/ecosystem, when it has one. */
  readonly arcEcosystem?: string | null;
}

export interface EcosystemView {
  readonly environment: "mainnet" | "testnet";
  readonly positioning: string;
  readonly directory?: { readonly url: string; readonly note: string };
  readonly protocols: readonly EcosystemProtocolView[];
  /** protocols = every registry entry mapped on Arc; routable = venues with an executable adapter. */
  readonly totals: { readonly protocols: number; readonly verified: number; readonly routable: number; readonly routableVia?: number; readonly readOnly?: number; readonly mapped?: number; readonly summary?: string; readonly tvlUsd: number | null; readonly routed: { readonly intents: number; readonly steps: number; readonly usd: string; readonly window: string } };
  readonly circle: readonly { readonly id: string; readonly name: string; readonly state: string; readonly lykia: string; readonly docs: string }[];
  readonly pulse: { readonly block: number; readonly blockTimeMs: number | null; readonly tps: number | null; readonly transferCostUsd: string | null } | null;
  readonly builders: { readonly freeTier: { readonly perMinute: number; readonly perDay: number }; readonly x402: { readonly mode: string; readonly note: string } };
  readonly sources: { readonly tvl: string; readonly tvlAt: string | null };
}

export const POSITIONING = t("ecosystem.model.builtOnArcNetworkAndCircle");

/** The coverage line, computed from the API's registry counts. */
export function coverageSummary(totals: EcosystemView["totals"] | undefined): string | null {
  return totals ? coverageLine(totals) : null;
}

/** The official Arc ecosystem directory; Lykia links to it rather than competing with it. */
export const ARC_ECOSYSTEM_DIRECTORY = "https://www.arc.io/ecosystem";

export function usdShort(value: number | null): string {
  if (value === null) return "n/a";
  if (value >= 1e3) return formatUsd(value, { compact: true, min: 0, max: value >= 1e6 ? 1 : 0 });
  return formatUsd(Math.round(value), { min: 0, max: 0 });
}

/** What each status means, in the words every page uses. */
export const COVERAGE_MEANING: Readonly<Record<EcosystemProtocolView["lykia"], string>> = {
  routes: t("ecosystem.model.lykiaHasAnExecutableAdapterIt"),
  reads: t("ecosystem.model.contractsVerifiedOnArcPricesAnd"),
  lists: t("ecosystem.model.mappedInTheRegistryFromThe"),
};

export const LYKIA_ROLE: Readonly<Record<EcosystemProtocolView["lykia"], { readonly label: string; readonly tone: "ok" | "sea" | "ghost" }>> = {
  routes: { label: "ROUTABLE", tone: "ok" },
  reads: { label: "READ-ONLY", tone: "sea" },
  lists: { label: "MAPPED", tone: "ghost" },
};

/** Circle product states, in plain words. */
export function circleState(state: string): { readonly label: string; readonly tone: "ok" | "sea" | "ochre" | "ghost" } {
  if (state === "live") return { label: "LIVE", tone: "ok" };
  if (state === "configured") return { label: "CONNECTED", tone: "ok" };
  if (state === "needs-key") return { label: t("ecosystem.model.readyNeedsKey"), tone: "ochre" };
  if (state === "console-only") return { label: t("ecosystem.model.circleConsole"), tone: "sea" };
  return { label: t("ecosystem.model.notNeededOnArc"), tone: "ghost" };
}
