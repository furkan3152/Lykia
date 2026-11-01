import type { RouteId } from "../routes/routeTable";

/**
 * Every page is a stop on the trail: number and name per route, printed in
 * the header strip ("STOP 02 · FLOCK") and the footer title block.
 */
export interface SheetInfo {
  readonly number: string;
  readonly name: string;
}

const SHEETS: Partial<Record<RouteId, SheetInfo>> = {
  landing: { number: "01", name: "The valley" },
  deck: { number: "01", name: "Deck" },
  flock: { number: "02", name: "Flock" },
  fence: { number: "03", name: "Fence" },
  scent: { number: "04", name: "Scent" },
  kunye: { number: "05", name: "Künye" },
  outrun: { number: "06", name: "Outrun" },
  developers: { number: "07", name: "Developers" },
  lykaion: { number: "∞", name: "Lykaion" },
};

export function sheetFor(id: RouteId): SheetInfo {
  return SHEETS[id] ?? { number: "00", name: "Off the trail" };
}

/** "STOP 02 · FLOCK" */
export function sheetLabel(id: RouteId): string {
  const sheet = sheetFor(id);
  return `Stop ${sheet.number} · ${sheet.name}`.toUpperCase();
}
