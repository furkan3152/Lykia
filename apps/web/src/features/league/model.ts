/** Words and small helpers for League views. Pure. */
import type { LeagueCategory, LeagueState, LeagueStatus, ProjectModule } from "@lykia/core";
import { intlLocale, t } from "../../i18n";

export const STATE_LABEL: Readonly<Record<LeagueState, string>> = { live: "LIVE", coming: "COMING", paused: "PAUSED" };
export const STATE_TONE: Readonly<Record<LeagueState, "ok" | "ochre" | "bad">> = { live: "ok", coming: "ochre", paused: "bad" };
export const STATUS_LABEL: Readonly<Record<LeagueStatus, string>> = { official: t("league.model.officialCity"), community: t("league.model.communityCity") };
export const CATEGORY_LABEL: Readonly<Record<LeagueCategory, string>> = { payments: t("league.model.payments"), agents: t("league.model.agents"), trading: t("league.model.trading"), treasury: t("league.model.treasury"), commerce: t("league.model.commerce"), tools: t("league.model.tools") };

/** Each module in plain words, metaphor first where the app has one. */
export const MODULE_LABEL: Readonly<Record<ProjectModule, string>> = {
  chat: t("league.model.askLykoYourAgent"),
  send: t("league.model.send"),
  swap: t("league.model.swap"),
  earn: t("league.model.earn"),
  borrow: t("league.model.borrow"),
  bridge: t("league.model.bridge"),
  pack: t("league.model.packAgents"),
  fence: t("league.model.fenceRules"),
  scent: t("league.model.scentTokenCheck"),
  flock: t("league.model.flockHoldings"),
  orders: t("league.model.orders"),
  ecosystem: t("league.model.harbourEcosystem"),
};

/** A page href is a link only when it is a concrete path (no ":param"). */
export function linkable(href: string): boolean {
  return href.startsWith("/") && !href.includes(":");
}

export function usageLine(usage: { readonly last7Days: { readonly requests: number; readonly plans: number } }): string {
  const { requests, plans } = usage.last7Days;
  return t("league.model.requestsPlansIn7Days", { requests: requests.toLocaleString(intlLocale()), plans: plans.toLocaleString(intlLocale()) });
}
