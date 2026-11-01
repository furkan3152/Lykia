/**
 * The whistle box's brain (pure): what a line typed into ⌘K or the deck
 * means. Sheepdog commands and hidden words come from core lore; pages and
 * tokens are recognised here; anything else is a sentence for the planner.
 */
import { COMMANDS, EASTER_EGGS, commandOf, easterEggOf, type CommandAction, type CommandWord, type EasterEggWord } from "@lykia/core";

export type Destination = "deck" | "flock" | "fence" | "scent" | "kunye" | "developers" | "landing";

export type Resolution =
  | { readonly kind: "empty" }
  | { readonly kind: "command"; readonly word: CommandWord; readonly action: CommandAction; readonly meaning: string }
  | { readonly kind: "egg"; readonly word: EasterEggWord; readonly scene: string; readonly line: string; readonly href: string | null }
  | { readonly kind: "page"; readonly destination: Destination }
  | { readonly kind: "token"; readonly address: string }
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "sentence"; readonly text: string };

const PAGE_WORDS: ReadonlyArray<readonly [Destination, readonly string[]]> = [
  ["deck", ["deck", "masa", "app", "home"]],
  ["flock", ["flock", "sürü", "suru", "portfolio", "portföy", "portfoy", "balances", "bakiye"]],
  ["fence", ["fence", "çit", "cit", "rules", "kurallar", "rule book", "whistle", "düdük", "duduk"]],
  ["scent", ["scent", "koku", "sniff", "shield", "token check"]],
  ["kunye", ["künye", "kunye", "licence", "license", "agent id", "erc-8004", "erc8004"]],
  ["developers", ["developers", "geliştiriciler", "gelistiriciler", "api", "mcp", "x402", "docs"]],
  ["landing", ["valley", "vadi", "about", "hakkında"]],
];

/** Scenes that open the hidden Arcadia page. */
const ARCADIA_EGGS: ReadonlySet<EasterEggWord> = new Set(["lykaion", "arcadia", "et in arcadia ego"]);

export function resolveInput(raw: string): Resolution {
  const text = raw.trim();
  if (text.length === 0) return { kind: "empty" };
  const word = commandOf(text);
  if (word) return { kind: "command", word, action: COMMANDS[word].action, meaning: COMMANDS[word].meaning };
  const egg = easterEggOf(text);
  if (egg) {
    const entry = EASTER_EGGS[egg];
    return { kind: "egg", word: egg, scene: entry.scene, line: entry.line, href: ARCADIA_EGGS.has(egg) ? "/lykaion" : null };
  }
  if (/^0x[0-9a-fA-F]{40}$/u.test(text)) return { kind: "token", address: text };
  const agent = /^(?:agent|künye|kunye)\s*#?\s*(\d{1,12})$/iu.exec(text);
  if (agent) return { kind: "agent", agentId: agent[1]! };
  const lower = text.toLowerCase();
  for (const [destination, words] of PAGE_WORDS) if (words.includes(lower)) return { kind: "page", destination };
  return { kind: "sentence", text };
}

/** Direction Lyko runs his arc for a command: clockwise, counter-clockwise or none. */
export function arcDirection(action: CommandAction): "cw" | "ccw" | null {
  if (action === "rescan") return "cw";
  if (action === "resniff") return "ccw";
  return null;
}

export const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"] as const;

/** Feeds keys into a Konami matcher; returns the new progress and whether it completed. */
export function konamiStep(progress: number, key: string): { readonly progress: number; readonly done: boolean } {
  const expected = KONAMI[progress];
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === expected) {
    const next = progress + 1;
    return next === KONAMI.length ? { progress: 0, done: true } : { progress: next, done: false };
  }
  return { progress: k === KONAMI[0] ? 1 : 0, done: false };
}
