/**
 * Owner profile (`lykia.profile/v1`): how Lykia should feel and decide for
 * one owner. Validated, versioned, stored server-side per SIWE address.
 * Everything here is a preference: the Fence still has the last word, and
 * a profile can only tighten what a Fence allows, never loosen it.
 */
import { DEFAULT_FENCE, normalizeFence, timeMinutes, isSupportedTimeZone, USD_PATTERN, usdMicros, type Fence } from "./fence.js";
import type { ArcEnvironment } from "./networks.js";
import type { RiskTier } from "./routes.js";

export const PROFILE_SCHEMA = "lykia.profile/v1" as const;
export const PROFILE_VERSION = 1;

/**
 * Lyko always replies in English and reads any language, so the only value
 * is "en". Older profiles stored "tr" or "auto"; they load as "en".
 */
export type ProfileLanguage = "en";
export type DisplayCurrency = "USD" | "EUR" | "TRY";
export type LykoTone = "friendly" | "concise" | "formal" | "playful";
export type Verbosity = "short" | "normal" | "detailed";
export type CoatVariant = "cream" | "fawn" | "white" | "sable" | "brindle";
export type Theme = "day" | "night" | "auto";
export type GasSponsorship = "off" | "prefer" | "require";
export type ConfirmationMode = "always" | "above" | "fence";

export const WIDGETS = ["pulse", "flock", "pack", "outruns", "pastures", "insights", "standing", "scent", "memory"] as const;
export type Widget = (typeof WIDGETS)[number];

/** Collar colours the web can draw (mosaic palette). */
export const COLLARS = ["#B8442B", "#B9472E", "#1E8FA3", "#5F8A3A", "#D9A441", "#13233A", "#C8407A"] as const;
export const COATS: readonly CoatVariant[] = ["cream", "fawn", "white", "sable", "brindle"];

export interface LykiaProfile {
  readonly schema: typeof PROFILE_SCHEMA;
  readonly version: number;
  readonly language: ProfileLanguage;
  readonly theme: Theme;
  readonly displayCurrency: DisplayCurrency;
  readonly defaultNetwork: ArcEnvironment;
  /** Risk appetite: picks the default Fence shape and the routing risk ceiling. */
  readonly risk: RiskTier;
  /** Default slippage ceiling for plans (bps); never above the Fence's. */
  readonly defaultSlippageBps: number;
  readonly venues: { readonly favorites: readonly string[]; readonly blocked: readonly string[] };
  readonly persona: { readonly tone: LykoTone; readonly verbosity: Verbosity };
  readonly look: { readonly collar: string; readonly coat: CoatVariant; readonly nameTag: string };
  /** No non-urgent notifications in this window; standing orders still plan. */
  readonly quietHours: { readonly timezone: string; readonly from: string; readonly to: string } | null;
  readonly notifications: { readonly webhook: boolean; readonly telegramChatId: string | null; readonly digest: "off" | "daily" | "weekly" };
  readonly widgets: readonly Widget[];
  readonly gas: { readonly sponsorship: GasSponsorship };
  readonly confirmation: { readonly mode: ConfirmationMode; readonly aboveUsd: string | null };
  /** Plan reasons in plain words, with what each venue is. */
  readonly explainLikeNew: boolean;
  readonly memory: { readonly enabled: boolean; readonly retentionDays: number; readonly learnContacts: boolean };
  readonly updatedAt: string | null;
}

export const DEFAULT_PROFILE: LykiaProfile = Object.freeze({
  schema: PROFILE_SCHEMA,
  version: PROFILE_VERSION,
  language: "en",
  theme: "day",
  displayCurrency: "USD",
  defaultNetwork: "testnet",
  risk: "medium",
  defaultSlippageBps: 50,
  venues: { favorites: [], blocked: [] },
  persona: { tone: "friendly", verbosity: "normal" },
  look: { collar: "#B8442B", coat: "cream", nameTag: "LYKO" },
  quietHours: null,
  notifications: { webhook: true, telegramChatId: null, digest: "off" },
  widgets: ["pulse", "flock", "pack", "outruns", "insights"],
  gas: { sponsorship: "off" },
  confirmation: { mode: "fence", aboveUsd: null },
  explainLikeNew: false,
  memory: { enabled: true, retentionDays: 180, learnContacts: true },
  updatedAt: null,
}) as LykiaProfile;

export interface ProfileIssue {
  readonly path: string;
  readonly message: string;
}

const VENUE_ID = /^[a-z0-9-]{2,48}$/u;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merges a partial update onto a profile (arrays replace). */
export function mergeProfile(base: LykiaProfile, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = (base as unknown as Record<string, unknown>)[key];
    out[key] = isRecord(value) && isRecord(current) ? { ...current, ...value } : value;
  }
  return out;
}

export function validateProfile(input: unknown): { ok: true; profile: LykiaProfile } | { ok: false; issues: ProfileIssue[] } {
  const issues: ProfileIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(input)) return { ok: false, issues: [{ path: "", message: "A profile is an object." }] };
  const p = input as Record<string, unknown>;
  const known = new Set(Object.keys(DEFAULT_PROFILE));
  for (const key of Object.keys(p)) if (!known.has(key)) add(key, "Unknown field.");
  if (p.schema !== PROFILE_SCHEMA) add("schema", `Must be "${PROFILE_SCHEMA}".`);
  // language: any stored value is accepted and read as "en" (see ProfileLanguage).
  if (!["USD", "EUR", "TRY"].includes(p.displayCurrency as string)) add("displayCurrency", "USD, EUR or TRY.");
  if (!["day", "night", "auto"].includes(p.theme as string)) add("theme", "day, night or auto.");
  if (p.defaultNetwork !== "mainnet" && p.defaultNetwork !== "testnet") add("defaultNetwork", "mainnet or testnet.");
  if (!["low", "medium", "high"].includes(p.risk as string)) add("risk", "low, medium or high.");
  if (!(Number.isInteger(p.defaultSlippageBps) && (p.defaultSlippageBps as number) >= 1 && (p.defaultSlippageBps as number) <= 500)) add("defaultSlippageBps", "1 to 500.");
  const venues = p.venues as Record<string, unknown> | undefined;
  if (!isRecord(venues)) add("venues", "An object with favorites and blocked.");
  else {
    for (const k of ["favorites", "blocked"] as const) {
      const list = venues[k];
      if (!Array.isArray(list) || list.length > 30 || !list.every((v) => typeof v === "string" && VENUE_ID.test(v))) add(`venues.${k}`, "Up to 30 venue ids.");
    }
    if (Array.isArray(venues.favorites) && Array.isArray(venues.blocked) && venues.favorites.some((v) => (venues.blocked as unknown[]).includes(v))) add("venues", "A venue cannot be both favourite and blocked.");
  }
  const persona = p.persona as Record<string, unknown> | undefined;
  if (!isRecord(persona) || !["friendly", "concise", "formal", "playful"].includes(persona.tone as string) || !["short", "normal", "detailed"].includes(persona.verbosity as string)) add("persona", "tone friendly|concise|formal|playful and verbosity short|normal|detailed.");
  const look = p.look as Record<string, unknown> | undefined;
  if (!isRecord(look)) add("look", "An object.");
  else {
    if (!(COLLARS as readonly string[]).includes(look.collar as string)) add("look.collar", `One of ${COLLARS.join(", ")}.`);
    if (!(COATS as readonly string[]).includes(look.coat as string)) add("look.coat", `One of ${COATS.join(", ")}.`);
    if (typeof look.nameTag !== "string" || !/^[\p{L}\p{N} .'-]{1,12}$/u.test(look.nameTag)) add("look.nameTag", "1 to 12 letters, digits or spaces.");
  }
  if (p.quietHours !== null) {
    const q = p.quietHours as Record<string, unknown> | undefined;
    if (!isRecord(q) || !isSupportedTimeZone(q.timezone) || typeof q.from !== "string" || typeof q.to !== "string" || timeMinutes(q.from) === null || timeMinutes(q.to) === null) add("quietHours", "null, or { timezone, from: HH:MM, to: HH:MM }.");
  }
  const n = p.notifications as Record<string, unknown> | undefined;
  if (!isRecord(n) || typeof n.webhook !== "boolean" || !(n.telegramChatId === null || (typeof n.telegramChatId === "string" && /^-?\d{3,20}$/u.test(n.telegramChatId))) || !["off", "daily", "weekly"].includes(n.digest as string)) add("notifications", "webhook boolean, telegramChatId null or digits, digest off|daily|weekly.");
  if (!Array.isArray(p.widgets) || p.widgets.length > WIDGETS.length || !p.widgets.every((w) => (WIDGETS as readonly string[]).includes(w as string)) || new Set(p.widgets).size !== p.widgets.length) add("widgets", `Unique widgets from ${WIDGETS.join(", ")}.`);
  const gas = p.gas as Record<string, unknown> | undefined;
  if (!isRecord(gas) || !["off", "prefer", "require"].includes(gas.sponsorship as string)) add("gas.sponsorship", "off, prefer or require.");
  const c = p.confirmation as Record<string, unknown> | undefined;
  if (!isRecord(c) || !["always", "above", "fence"].includes(c.mode as string)) add("confirmation.mode", "always, above or fence.");
  else if (c.mode === "above" && (typeof c.aboveUsd !== "string" || !USD_PATTERN.test(c.aboveUsd))) add("confirmation.aboveUsd", 'A USD amount string, e.g. "250".');
  else if (c.mode !== "above" && c.aboveUsd !== null) add("confirmation.aboveUsd", "Only with mode above.");
  if (typeof p.explainLikeNew !== "boolean") add("explainLikeNew", "true or false.");
  const m = p.memory as Record<string, unknown> | undefined;
  if (!isRecord(m) || typeof m.enabled !== "boolean" || typeof m.learnContacts !== "boolean" || !(Number.isInteger(m.retentionDays) && (m.retentionDays as number) >= 1 && (m.retentionDays as number) <= 730)) add("memory", "enabled, learnContacts booleans and retentionDays 1..730.");
  if (!(Number.isInteger(p.version) && (p.version as number) >= 1)) add("version", "A positive integer.");
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, profile: { ...(input as unknown as LykiaProfile), language: "en" } };
}

/**
 * The Fence a profile implies when the request brings none: the Shepherd
 * default, tightened by risk appetite, slippage habit and confirmation
 * style. A profile never loosens a Fence it is applied to.
 */
export function fenceForProfile(profile: LykiaProfile, base: Fence = DEFAULT_FENCE): Fence {
  const f = normalizeFence(base);
  const baseSlip = f.limits?.maxSlippageBps ?? 1000;
  const riskSlip = profile.risk === "low" ? 30 : profile.risk === "medium" ? 100 : 300;
  const slip = Math.min(baseSlip, riskSlip, profile.defaultSlippageBps);
  const blocked = [...new Set([...(f.venues?.deny ?? []), ...profile.venues.blocked])];
  let confirm = f.confirm;
  if (profile.confirmation.mode === "always") confirm = { ...f.confirm, aboveUsd: "0" };
  else if (profile.confirmation.mode === "above" && profile.confirmation.aboveUsd) {
    const current = f.confirm?.aboveUsd;
    const next = current && usdMicros(current) < usdMicros(profile.confirmation.aboveUsd) ? current : profile.confirmation.aboveUsd;
    confirm = { ...f.confirm, aboveUsd: next };
  }
  return {
    ...f,
    limits: { ...f.limits, maxSlippageBps: slip },
    ...(blocked.length > 0 ? { venues: { ...f.venues, deny: blocked } } : {}),
    ...(confirm ? { confirm } : {}),
    ...(profile.risk === "low" ? { scent: { require: "verified" as const } } : {}),
  };
}

/** True when `now` falls inside the owner's quiet hours. */
export function isQuietHours(profile: LykiaProfile, now: number): boolean {
  const q = profile.quietHours;
  if (!q) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: q.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const minutes = Number(parts.find((x) => x.type === "hour")?.value ?? 0) * 60 + Number(parts.find((x) => x.type === "minute")?.value ?? 0);
  const from = timeMinutes(q.from) ?? 0;
  const to = timeMinutes(q.to) ?? 0;
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** USD decimal string -> display currency string, using a USD->X rate; null when unpriced. */
export function displayAmount(usd: string | null, currency: DisplayCurrency, usdPerUnit: string | null): string | null {
  if (usd === null) return null;
  const value = Number(usd);
  if (!Number.isFinite(value)) return null;
  if (currency === "USD") return `$${value.toFixed(2)}`;
  if (usdPerUnit === null || Number(usdPerUnit) <= 0) return null;
  const converted = value / Number(usdPerUnit);
  return currency === "EUR" ? `€${converted.toFixed(2)}` : `₺${converted.toFixed(2)}`;
}

/* ------------------------------------------------------- the web's dialect */

/** The flat profile shape the Lykia web app keeps locally (lib/profile.ts). */
export interface WebProfile {
  readonly language: ProfileLanguage;
  readonly currency: DisplayCurrency;
  readonly network: ArcEnvironment;
  readonly theme: Theme;
  readonly risk: RiskTier;
  readonly slippageBps: number;
  readonly favoriteVenues: readonly string[];
  readonly blockedVenues: readonly string[];
  readonly tone: LykoTone;
  readonly verbosity: Verbosity;
  readonly look: { readonly collar: string; readonly coat: CoatVariant; readonly tag: string };
  readonly quietHours: { readonly on: boolean; readonly from: string; readonly to: string };
  readonly notify: { readonly webhook: string; readonly telegram: string };
  readonly widgets: readonly string[];
  readonly confirm: "every-step" | "above-cap" | "never";
  readonly explainLikeNew: boolean;
  readonly retentionDays: number;
}

const WEB_KEYS = ["currency", "network", "slippageBps", "favoriteVenues", "blockedVenues", "tone", "notify", "confirm", "retentionDays"];

export function isWebProfile(input: unknown): boolean {
  return isRecord(input) && input.schema === undefined && WEB_KEYS.some((k) => k in input);
}

export function toWebProfile(p: LykiaProfile): WebProfile {
  return {
    language: p.language,
    currency: p.displayCurrency,
    network: p.defaultNetwork,
    theme: p.theme,
    risk: p.risk,
    slippageBps: p.defaultSlippageBps,
    favoriteVenues: p.venues.favorites,
    blockedVenues: p.venues.blocked,
    tone: p.persona.tone,
    verbosity: p.persona.verbosity,
    look: { collar: p.look.collar, coat: p.look.coat, tag: p.look.nameTag },
    quietHours: p.quietHours ? { on: true, from: p.quietHours.from, to: p.quietHours.to } : { on: false, from: "22:00", to: "08:00" },
    notify: { webhook: p.notifications.webhook ? "on" : "", telegram: p.notifications.telegramChatId ?? "" },
    widgets: p.widgets,
    confirm: p.confirmation.mode === "always" ? "every-step" : "above-cap",
    explainLikeNew: p.explainLikeNew,
    retentionDays: p.memory.enabled ? p.memory.retentionDays : 0,
  };
}

/** A partial core profile from the web's flat document (unknown or junk fields are ignored; the result is validated after merging). */
export function fromWebProfile(input: Record<string, unknown>, current: LykiaProfile): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  // "language" is ignored: replies are always in English.
  if (str("currency")) patch.displayCurrency = input.currency;
  if (str("network")) patch.defaultNetwork = input.network;
  if (str("theme")) patch.theme = input.theme;
  if (str("risk")) patch.risk = input.risk;
  if (typeof input.slippageBps === "number") patch.defaultSlippageBps = Math.min(500, Math.max(1, Math.round(input.slippageBps)));
  if (Array.isArray(input.favoriteVenues) || Array.isArray(input.blockedVenues)) {
    const fav = (Array.isArray(input.favoriteVenues) ? input.favoriteVenues : current.venues.favorites).filter((v): v is string => typeof v === "string");
    const blocked = (Array.isArray(input.blockedVenues) ? input.blockedVenues : current.venues.blocked).filter((v): v is string => typeof v === "string");
    patch.venues = { favorites: fav.filter((v) => !blocked.includes(v)).slice(0, 30), blocked: blocked.slice(0, 30) };
  }
  if (str("tone") || str("verbosity")) patch.persona = { ...(str("tone") ? { tone: input.tone } : {}), ...(str("verbosity") ? { verbosity: input.verbosity } : {}) };
  if (isRecord(input.look)) patch.look = { ...(typeof input.look.collar === "string" ? { collar: input.look.collar } : {}), ...(typeof input.look.coat === "string" ? { coat: input.look.coat } : {}), ...(typeof input.look.tag === "string" ? { nameTag: input.look.tag.slice(0, 12) || "LYKO" } : {}) };
  if (isRecord(input.quietHours)) patch.quietHours = input.quietHours.on === true ? { timezone: current.quietHours?.timezone ?? "Europe/Istanbul", from: input.quietHours.from, to: input.quietHours.to } : null;
  if (isRecord(input.notify)) patch.notifications = { webhook: typeof input.notify.webhook === "string" && input.notify.webhook.length > 0, telegramChatId: typeof input.notify.telegram === "string" && /^-?\d{3,20}$/u.test(input.notify.telegram) ? input.notify.telegram : null };
  if (Array.isArray(input.widgets)) patch.widgets = [...new Set(input.widgets.filter((w): w is Widget => (WIDGETS as readonly string[]).includes(w as string)))];
  if (str("confirm")) patch.confirmation = input.confirm === "every-step" ? { mode: "always", aboveUsd: null } : { mode: "fence", aboveUsd: null };
  if (typeof input.explainLikeNew === "boolean") patch.explainLikeNew = input.explainLikeNew;
  if (typeof input.retentionDays === "number") patch.memory = input.retentionDays <= 0 ? { enabled: false } : { enabled: true, retentionDays: Math.min(730, Math.max(1, Math.round(input.retentionDays))) };
  return patch;
}
