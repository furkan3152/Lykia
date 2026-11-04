/** Words and small helpers for League views. Pure. */
import type { LeagueCategory, LeagueState, LeagueStatus, ProjectModule } from "@lykia/core";

export const STATE_LABEL: Readonly<Record<LeagueState, string>> = { live: "LIVE", coming: "COMING", paused: "PAUSED" };
export const STATE_TONE: Readonly<Record<LeagueState, "ok" | "ochre" | "bad">> = { live: "ok", coming: "ochre", paused: "bad" };
export const STATUS_LABEL: Readonly<Record<LeagueStatus, string>> = { official: "OFFICIAL CITY", community: "COMMUNITY CITY" };
export const CATEGORY_LABEL: Readonly<Record<LeagueCategory, string>> = { payments: "Payments", agents: "Agents", trading: "Trading", treasury: "Treasury", commerce: "Commerce", tools: "Tools" };

/** Each module in plain words, metaphor first where the app has one. */
export const MODULE_LABEL: Readonly<Record<ProjectModule, string>> = {
  chat: "Ask Lyko · assistant",
  send: "Send",
  swap: "Swap",
  earn: "Earn",
  borrow: "Borrow",
  bridge: "Bridge",
  pack: "Pack · agents",
  fence: "Fence · rules",
  scent: "Scent · token check",
  flock: "Flock · portfolio",
  orders: "Orders",
  ecosystem: "Harbour · ecosystem",
};

/** A page href is a link only when it is a concrete path (no ":param"). */
export function linkable(href: string): boolean {
  return href.startsWith("/") && !href.includes(":");
}

export function usageLine(usage: { readonly last7Days: { readonly requests: number; readonly plans: number } }): string {
  const { requests, plans } = usage.last7Days;
  return `${requests.toLocaleString("en-US")} requests · ${plans.toLocaleString("en-US")} plans in 7 days`;
}
