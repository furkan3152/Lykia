/** The League council's choices, as pure functions (tested without a browser). */
import type { LeagueAction, ProjectLeague } from "@lykia/core";

/** The decisions that apply to a city as it stands (the server checks them again). */
export function actionsFor(league: ProjectLeague): LeagueAction[] {
  const out: LeagueAction[] = [];
  if (league.review === "requested") out.push("approve", "reject");
  if (league.listed) out.push(league.featured ? "unfeature" : "feature", "delist");
  if (!league.listed && (league.status === "official" || league.review === "delisted")) out.push("relist");
  if (league.state === "paused") out.push("resume");
  else out.push("pause");
  if (league.state === "coming") out.push("launch");
  return out;
}

