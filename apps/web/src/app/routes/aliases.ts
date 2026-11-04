/**
 * Where old addresses go. The developer portal used to be /build with its
 * tabs in component state (and /developers before that); it is The Mint at
 * /mint/:section now. The owner console moved to Letoon. Pure.
 */

/** Old /build tab ids (and hashes) mapped to The Mint's sections. */
export const MINT_ALIASES: Readonly<Record<string, string>> = {
  start: "strike",
  quickstart: "strike",
  strike: "strike",
  studio: "workshop",
  playground: "workshop",
  workshop: "workshop",
  projects: "cities",
  cities: "cities",
  keys: "keys",
  fee: "keys",
  usage: "usage",
  logs: "usage",
  webhooks: "webhooks",
  reference: "reference",
  parser: "reference",
  mcp: "reference",
  sdk: "reference",
  circle: "reference",
  arc: "reference",
  integrate: "reference",
};

/** Hashes that open a tab inside a section rather than naming the section. */
const ANCHORS: ReadonlySet<string> = new Set(["integrate", "mcp", "sdk", "parser", "circle", "arc"]);

/** The Mint section for an old tab id or hash ("#keys", "logs"), or null. */
export function mintSectionFor(alias: string): string | null {
  return MINT_ALIASES[alias.replace(/^#/u, "").toLowerCase()] ?? null;
}

export function aliasTarget(pathname: string, hash = "", search = ""): string {
  if (pathname === "/owner") return `/letoon${search}`;
  const section = hash ? mintSectionFor(hash) : null;
  if (!section) return `/mint${search}${hash}`;
  // Anchors inside a section (#integrate, #mcp) stay as hashes so the section can open on them.
  const keep = ANCHORS.has(hash.replace(/^#/u, "").toLowerCase()) ? hash : "";
  return `/mint/${section}${search}${keep}`;
}
