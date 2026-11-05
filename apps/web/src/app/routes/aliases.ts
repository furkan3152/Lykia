/**
 * Where old addresses go. The developer portal used to be /build with its
 * tabs in component state (and /developers before that); it is The Mint at
 * /mint/:section now. The owner console moved to Letoon. Pure.
 */

/** Old /build tab ids (and hashes) mapped to The Mint's sections. */
const MINT_ALIASES: Readonly<Record<string, string>> = {
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

/* ------------------------------------------------------------- the Fold */

/** What an old Move tab asks Ask Lyko for. Trailing spaces leave the caret where the owner types next. */
const MOVE_INTENTS: Readonly<Record<string, string>> = {
  send: "Pay ",
  receive: "Show me a payment link for my wallet",
  swap: "Convert ",
  earn: "Put my idle USDC to work",
  borrow: "Borrow ",
  bridge: "Bridge ",
};

/** Routes whose old form still opens as an "edit the details" step when a link carries one of these. */
const DETAIL_PARAMS = ["draft", "edit"] as const;

export type LegacyDecision = { readonly kind: "page" } | { readonly kind: "redirect"; readonly to: string };

/** `/app?intent=…`: Ask Lyko with the composer filled in (never sent on its own). */
export function askWith(intent: string): string {
  return `/app?intent=${encodeURIComponent(intent)}`;
}

function param(search: string, name: string): string | null {
  try {
    return new URLSearchParams(search).get(name);
  } catch {
    return null;
  }
}

/**
 * Where an old page goes. Pure: the router's LegacyPage applies it.
 *
 *   /app/move/:tab            Ask Lyko with the intent (a shared pay link keeps its recipient and amount)
 *   /app/flock/:address       The Fold · Flock (any address stays readable: ?address=)
 *   /app/orders|alerts|automations   The Fold · Herding, on that kind
 *   /app/activity             The Fold · Trails
 *   /app/whatif               The Fold · Flock, with the what-if open
 *   /app/fence                The Fold · Fence
 *   /app/pack                 The Fold · Pack (an agent's own page, /app/pack/:id, stays)
 *   /app/memory               Your Lyko · Memory
 *
 * A `?draft=` or `?edit=` link opens the old form instead: it is the
 * "edit the details" step of something Lyko drafted.
 */
export function legacyDecision(routeId: string, params: Readonly<Record<string, string | undefined>>, search = ""): LegacyDecision {
  const detail = DETAIL_PARAMS.some((p) => param(search, p) !== null);
  switch (routeId) {
    case "move": {
      const tab = params.tab ?? "send";
      const to = param(search, "to");
      if (tab === "send" && to && /^0x[0-9a-fA-F]{40}$/u.test(to)) {
        const amount = param(search, "amount");
        const token = (param(search, "token") ?? "USDC").replace(/[^A-Za-z]/gu, "").slice(0, 8) || "USDC";
        return { kind: "redirect", to: askWith(`Pay ${amount && /^\d+(?:\.\d+)?$/u.test(amount) ? `${amount} ` : ""}${token} to ${to}`) };
      }
      if (tab === "receive") return { kind: "redirect", to: "/app/fold/flock" };
      return { kind: "redirect", to: askWith(MOVE_INTENTS[tab] ?? "") };
    }
    case "flock":
      return { kind: "redirect", to: params.address && /^0x[0-9a-fA-F]{40}$/u.test(params.address) ? `/app/fold/flock?address=${params.address}` : "/app/fold/flock" };
    case "orders":
    case "alerts":
    case "automations":
      return detail ? { kind: "page" } : { kind: "redirect", to: `/app/fold/herding?show=${routeId === "automations" ? "rounds" : routeId}` };
    case "activity":
      return { kind: "redirect", to: "/app/fold/trails" };
    case "whatif":
      return { kind: "redirect", to: "/app/fold/flock?whatif=1" };
    case "fence":
      return detail ? { kind: "page" } : { kind: "redirect", to: "/app/fold/fence" };
    case "pack":
      return params.id ? { kind: "page" } : { kind: "redirect", to: "/app/fold/pack" };
    case "memory":
      return { kind: "redirect", to: "/app/you?tab=memory" };
    default:
      return { kind: "redirect", to: "/app" };
  }
}
