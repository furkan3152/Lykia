/**
 * A newcomer to the Fold (pure): signed in with their own wallet, and
 * nothing of theirs is running, waiting, leashed or on the trail yet. Their
 * Herding, Pack and Fence tabs then show one friendly state with one action
 * instead of panels full of zeros. Unknown (still loading) is not a newcomer.
 */
import { t } from "../../i18n";
export interface NewcomerFacts {
  readonly signedIn: boolean;
  readonly sample: boolean;
  /** Running items and drafts waiting; undefined while loading. */
  readonly running: number | undefined;
  readonly waiting: number | undefined;
  /** Agents (Lyko himself not counted), leashes and an Autopilot that is or was on. */
  readonly agents: number | undefined;
  readonly leashes: number | undefined;
  readonly autopilot: boolean | undefined;
  readonly trail: number | undefined;
}

export function isNewcomer(f: NewcomerFacts): boolean {
  if (!f.signedIn || f.sample) return false;
  const counts = [f.running, f.waiting, f.agents, f.leashes, f.trail];
  if (counts.some((n) => n === undefined) || f.autopilot === undefined) return false;
  return counts.every((n) => n === 0) && !f.autopilot;
}

export type NewcomerTab = "herding" | "pack" | "fence";

/** The one state each tab shows a newcomer: a title, one line, and the one thing to do (filled into Ask Lyko). */
export const NEWCOMER: Readonly<Record<NewcomerTab, { readonly title: string; readonly line: string; readonly action: string; readonly ask: string }>> = {
  herding: { title: t("fold.newcomer.nothingIsRunningYet"), line: t("fold.newcomer.repeatsOrdersWatchesAndPaymentLinks"), action: "START ONE IN ASK LYKO", ask: t("fold.newcomer.everyFridayPay") },
  pack: { title: t("fold.newcomer.noAgentsWorkForYouYet"), line: t("fold.newcomer.anAgentOrAnOutsideBot"), action: "GIVE A BOT A LEASH", ask: t("fold.newcomer.giveMyBot") },
  fence: { title: t("fold.newcomer.yourFenceIsOn"), line: t("fold.newcomer.theseRulesCheckEveryPlanBefore"), action: "MAKE A FIRST PLAN", ask: t("fold.newcomer.bridgeAmountUsdcToChain") },
};
