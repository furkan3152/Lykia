/**
 * The owner's profile: language, display currency, network, risk, slippage,
 * venues, Lyko's persona and look, quiet hours, notifications, dashboard
 * order, confirmations and the "explain like I'm new" mode. Kept locally and
 * synced to GET/PUT /v1/profile when a SIWE session exists.
 */
import { create } from "zustand";

import { readStorage, writeStorage } from "../app/state/storage";
import { DEFAULT_LOOK, type LykoLook } from "../mosaic/sprites";

export type Theme = "day" | "night" | "auto";
export type Currency = "USD" | "EUR" | "TRY";
export type Risk = "low" | "medium" | "high";
export type Tone = "friendly" | "concise" | "formal" | "playful";
export type Verbosity = "short" | "normal" | "detailed";
export type ConfirmStyle = "every-step" | "above-cap" | "never";

export const WIDGETS = ["flock", "insights", "outruns", "pack", "pulse", "standing"] as const;
export type Widget = (typeof WIDGETS)[number];

export interface Profile {
  /** Always "en": Lyko replies in English and reads any language. Older stored values load as "en". */
  readonly language: "en";
  readonly currency: Currency;
  readonly network: "mainnet" | "testnet";
  readonly theme: Theme;
  readonly risk: Risk;
  readonly slippageBps: number;
  readonly favoriteVenues: readonly string[];
  readonly blockedVenues: readonly string[];
  readonly tone: Tone;
  readonly verbosity: Verbosity;
  readonly look: LykoLook;
  readonly quietHours: { readonly on: boolean; readonly from: string; readonly to: string };
  readonly notify: { readonly webhook: string; readonly telegram: string };
  readonly widgets: readonly Widget[];
  readonly confirm: ConfirmStyle;
  readonly explainLikeNew: boolean;
  readonly retentionDays: number;
}

export const DEFAULT_PROFILE: Profile = {
  language: "en",
  currency: "USD",
  network: "mainnet",
  theme: "day",
  risk: "medium",
  slippageBps: 50,
  favoriteVenues: [],
  blockedVenues: [],
  tone: "friendly",
  verbosity: "normal",
  look: DEFAULT_LOOK,
  quietHours: { on: false, from: "22:00", to: "08:00" },
  notify: { webhook: "", telegram: "" },
  widgets: [...WIDGETS],
  confirm: "above-cap",
  explainLikeNew: false,
  retentionDays: 90,
};

const KEY = "lykia.profile";

/** Fills gaps and drops junk so an old or foreign document never breaks the page. */
export function sanitizeProfile(raw: unknown): Profile {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Profile>;
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const widgets = Array.isArray(v.widgets) ? v.widgets.filter((w): w is Widget => (WIDGETS as readonly string[]).includes(w as string)) : [];
  return {
    language: "en",
    currency: pick(v.currency, ["USD", "EUR", "TRY"], DEFAULT_PROFILE.currency),
    network: pick(v.network, ["mainnet", "testnet"], DEFAULT_PROFILE.network),
    theme: pick(v.theme, ["day", "night", "auto"], DEFAULT_PROFILE.theme),
    risk: pick(v.risk, ["low", "medium", "high"], DEFAULT_PROFILE.risk),
    slippageBps: Number.isInteger(v.slippageBps) && (v.slippageBps as number) >= 0 && (v.slippageBps as number) <= 1000 ? (v.slippageBps as number) : DEFAULT_PROFILE.slippageBps,
    favoriteVenues: Array.isArray(v.favoriteVenues) ? v.favoriteVenues.filter((x) => typeof x === "string").slice(0, 50) : [],
    blockedVenues: Array.isArray(v.blockedVenues) ? v.blockedVenues.filter((x) => typeof x === "string").slice(0, 50) : [],
    tone: pick(v.tone, ["friendly", "concise", "formal", "playful"], DEFAULT_PROFILE.tone),
    verbosity: pick(v.verbosity, ["short", "normal", "detailed"], DEFAULT_PROFILE.verbosity),
    look: { ...DEFAULT_LOOK, ...(v.look ?? {}) },
    quietHours: { ...DEFAULT_PROFILE.quietHours, ...(v.quietHours ?? {}) },
    notify: { ...DEFAULT_PROFILE.notify, ...(v.notify ?? {}) },
    widgets: [...widgets, ...WIDGETS.filter((w) => !widgets.includes(w))],
    confirm: pick(v.confirm, ["every-step", "above-cap", "never"], DEFAULT_PROFILE.confirm),
    explainLikeNew: v.explainLikeNew === true,
    retentionDays: Number.isInteger(v.retentionDays) && (v.retentionDays as number) >= 0 && (v.retentionDays as number) <= 3650 ? (v.retentionDays as number) : DEFAULT_PROFILE.retentionDays,
  };
}

/** Moves `item` to `to` in a widget order (drag and drop). */
export function moveWidget(order: readonly Widget[], item: Widget, to: number): Widget[] {
  const rest = order.filter((w) => w !== item);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

function stored(): Profile {
  try {
    const raw = readStorage(KEY);
    return sanitizeProfile(raw ? JSON.parse(raw) : {});
  } catch {
    return DEFAULT_PROFILE;
  }
}

interface ProfileState {
  readonly profile: Profile;
  readonly synced: "local" | "synced" | "soon";
  set(profile: Profile, synced?: ProfileState["synced"]): void;
}

export const useProfile = create<ProfileState>()((set) => ({
  profile: stored(),
  synced: "local",
  set: (profile, synced = "local") => {
    writeStorage(KEY, JSON.stringify(profile));
    set({ profile, synced });
  },
}));
