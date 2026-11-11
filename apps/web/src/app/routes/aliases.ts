/**
 * Where old addresses go. The developer portal used to be /build with its
 * tabs in component state (and /developers before that), then /mint; it is
 * The Forge at /forge/:section now, and every /mint path lands on its /forge
 * twin (vercel.json answers them with a 308 first). The owner console moved
 * to Letoon. Pure.
 */
import { alertDraftOf, automationDraftOf, decodeDraft, describeAlert, describeAutomationTrigger } from "@lykia/core";
import { t } from "../../i18n";

/** Old /build tab ids (and hashes) mapped to The Forge's sections. */
const FORGE_ALIASES: Readonly<Record<string, string>> = {
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

/** The Forge section for an old tab id or hash ("#keys", "logs"), or null. */
export function forgeSectionFor(alias: string): string | null {
  return FORGE_ALIASES[alias.replace(/^#/u, "").toLowerCase()] ?? null;
}

export function aliasTarget(pathname: string, hash = "", search = ""): string {
  if (pathname === "/owner") return `/letoon${search}`;
  // The developer portal was called The Mint: /mint/keys is /forge/keys, with its query and hash.
  const old = /^\/mint(?:\/(.*))?$/u.exec(pathname);
  if (old) return `/forge${old[1] ? `/${old[1]}` : ""}${search}${hash}`;
  const section = hash ? forgeSectionFor(hash) : null;
  if (!section) return `/forge${search}${hash}`;
  // Anchors inside a section (#integrate, #mcp) stay as hashes so the section can open on them.
  const keep = ANCHORS.has(hash.replace(/^#/u, "").toLowerCase()) ? hash : "";
  return `/forge/${section}${search}${keep}`;
}

/* ------------------------------------------------------------- the Fold */

/** What an old Move tab asks Ask Lyko for. Trailing spaces leave the caret where the owner types next. */
const MOVE_INTENTS: Readonly<Record<string, string>> = {
  send: t("app.routes.aliases.pay"),
  receive: t("app.routes.aliases.showMeAPaymentLinkFor"),
  swap: t("app.routes.aliases.convert"),
  earn: t("app.routes.aliases.putMyIdleUsdcToWork"),
  borrow: t("app.routes.aliases.borrow"),
  bridge: t("app.routes.aliases.bridge"),
};

/** The questions the pages that became Ask answers open with. */
export const PAGE_QUESTIONS: Readonly<Record<"pastures" | "discover" | "markets", string>> = {
  pastures: t("app.routes.aliases.whereCanIEarnOnUsdc"),
  discover: t("app.routes.aliases.whatAreTheNewPoolsOn"),
  markets: t("app.routes.aliases.showMeThePerpsMarkets"),
};

export type LegacyDecision = { readonly kind: "redirect"; readonly to: string };

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

/** The sentence a `?draft=` link carried, for Ask Lyko to start from; null when the draft does not decode. */
function draftSentence(routeId: string, search: string): string | null {
  const draft = decodeDraft(param(search, "draft"));
  if (routeId === "alerts") {
    const a = alertDraftOf(draft);
    return a ? t("app.routes.aliases.watchAndTellMe", { what: describeAlert(a).replace(/^Any /u, "my "), channel: a.channels?.includes("telegram") ? "telegram" : a.channels?.includes("webhook") ? "webhook" : "inbox" }) : null;
  }
  if (routeId === "automations") {
    const a = automationDraftOf(draft);
    if (!a) return null;
    return `${describeAutomationTrigger(a.trigger)}, ${a.action.type === "plan" ? a.action.sentence : t("app.routes.aliases.notifyMyWebhooks")}`;
  }
  return null;
}

/**
 * Where an old page goes. Pure: the router's LegacyPage applies it. Every old
 * address redirects; no form page is left.
 *
 *   /app/move/:tab            Ask Lyko with the intent (a shared pay link keeps its recipient and amount)
 *   /app/flock/:address       The Fold · Flock (any address stays readable: ?address=)
 *   /app/orders|alerts|automations   The Fold · Herding (Running), on that kind
 *       ?draft=…              Ask Lyko with what the draft said, ready to review
 *       ?edit=…               Ask Lyko: "Change my …", with the item named
 *   /app/activity             The Fold · Trails
 *   /app/whatif               The Fold · Flock, with the what-if open
 *   /app/fence                The Fold · Fence (Safety is a section of it)
 *   /app/security             The Fold · Fence, at Safety
 *   /app/pack, /app/pack/:id  The Fold · Pack (an agent's card is on it)
 *   /app/pastures             Ask Lyko: "Where can I earn on USDC?"
 *   /app/discover             Ask Lyko: "What are the new pools on Arc?"
 *   /app/markets              Ask Lyko: "Show me the perps markets"
 *   /app/memory               Your Lyko · Memory
 */
export function legacyDecision(routeId: string, params: Readonly<Record<string, string | undefined>>, search = ""): LegacyDecision {
  const edit = param(search, "edit");
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
    case "automations": {
      const noun = routeId === "orders" ? "order" : routeId === "alerts" ? "watch" : "automation";
      const said = draftSentence(routeId, search);
      if (said) return { kind: "redirect", to: askWith(said) };
      if (param(search, "draft") !== null) return { kind: "redirect", to: askWith(routeId === "orders" ? "Draft an order: " : routeId === "alerts" ? "Watch " : "Every ") };
      if (edit !== null) return { kind: "redirect", to: askWith(`Change my ${noun} ${edit.replace(/[^A-Za-z0-9:_-]/gu, "").slice(0, 80)}: `) };
      return { kind: "redirect", to: `/app/fold/herding?show=${routeId === "orders" ? "orders" : routeId === "alerts" ? "watches" : "automations"}` };
    }
    case "activity":
      return { kind: "redirect", to: "/app/fold/trails" };
    case "whatif":
      return { kind: "redirect", to: "/app/fold/flock?whatif=1" };
    case "fence":
      return { kind: "redirect", to: param(search, "draft") !== null || edit !== null ? askWith("Change my Fence: ") : "/app/fold/fence" };
    case "security":
      return { kind: "redirect", to: "/app/fold/fence#safety" };
    case "pack":
      return { kind: "redirect", to: param(search, "draft") !== null ? askWith(t("fold.tabs.packTab.createSeed")) : "/app/fold/pack" };
    case "pastures":
    case "discover":
    case "markets":
      return { kind: "redirect", to: askWith(PAGE_QUESTIONS[routeId]) };
    case "memory":
      return { kind: "redirect", to: "/app/you?tab=memory" };
    default:
      return { kind: "redirect", to: "/app" };
  }
}
