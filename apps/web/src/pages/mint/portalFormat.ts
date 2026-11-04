/** Formatting helpers for the developer portal tabs. */
export function statusTone(status: number): "ok" | "bad" | "ochre" {
  return status >= 500 ? "bad" : status >= 400 ? "ochre" : "ok";
}

/** "11-01 12:00:01" from an ISO time. */
export const shortTime = (iso: string) => iso.replace("T", " ").slice(5, 19);
