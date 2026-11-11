/**
 * A newcomer to the Fold (pure): signed in with their own wallet, and
 * nothing of theirs is running, waiting, leashed or on the trail yet. Their
 * Herding, Pack and Fence tabs then show one friendly state with one action
 * instead of panels full of zeros. Unknown (still loading) is not a newcomer.
 */
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
  herding: { title: "Nothing is running yet", line: "Repeats, orders, watches and payment links you start in Ask Lyko show up here, one row each, with a Stop button.", action: "START ONE IN ASK LYKO", ask: "Every Friday pay " },
  pack: { title: "No agents work for you yet", line: "An agent or an outside bot gets a leash: a budget it cannot go past, until a date you choose. You set it up in Ask Lyko and sign once.", action: "GIVE A BOT A LEASH", ask: "Give my bot " },
  fence: { title: "Your Fence is on", line: "These rules check every plan before you sign. Nothing has been checked yet: the first plan you make in Ask Lyko is checked here.", action: "MAKE A FIRST PLAN", ask: "Bridge [amount] USDC to [chain]" },
};
