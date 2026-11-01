/**
 * Memory references in the composer (pure): `@name` contacts and phrases
 * that point at history ("again", "same as last week", "undo last swap").
 */
export interface ContactRef {
  readonly name: string;
  readonly address: string;
  readonly confirmed: boolean;
}

export const MEMORY_PHRASES = {
  en: ["again", "same as last week", "undo last swap"],
  tr: ["tekrar", "geçen haftaki gibi", "son swap'ı geri al"],
} as const;

/** The `@partial` being typed at the caret, or null. */
export function mentionAt(text: string, caret: number): { readonly start: number; readonly query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([\p{L}\p{N}_.-]{0,32})$/u.exec(before);
  if (!m) return null;
  return { start: before.length - m[2]!.length - 1, query: m[2]!.toLowerCase() };
}

/** Contacts matching a mention query, confirmed first. */
export function matchContacts(contacts: readonly ContactRef[], query: string, limit = 6): ContactRef[] {
  return contacts
    .filter((c) => c.name.toLowerCase().includes(query))
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Replaces the mention at `start` with `@name `. */
export function insertMention(text: string, start: number, caret: number, name: string): { readonly text: string; readonly caret: number } {
  const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
  return { text: next, caret: start + name.length + 2 };
}

/** Badges for parts of a plan that came from memory (`memory` on a step or a proposal). */
export function memoryBadges(item: unknown): string[] {
  if (!item || typeof item !== "object") return [];
  const m = (item as { memory?: unknown }).memory;
  if (!Array.isArray(m)) return [];
  return m.map((x) => (typeof x === "string" ? x : x && typeof x === "object" && typeof (x as { label?: unknown }).label === "string" ? (x as { label: string }).label : "")).filter(Boolean);
}
