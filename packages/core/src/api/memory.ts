/** Contract types for /v1/memory and /v1/contacts. */
import type { Contact, IntentRecord, PatternSuggestion, Preferences } from "../memory.js";

/** One learned preference as a row the owner can see and delete (DELETE /v1/memory/:id). */
export interface PreferenceItem {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly source?: string;
}

/** A recurring pattern offered as a standing order. */
export interface SuggestionItem {
  readonly id: string;
  readonly sentence: string;
  readonly cadence?: string;
  readonly count?: number;
}

/** A contact as the UI shows it. */
export type ContactView = Contact & { readonly confirmed: boolean; readonly learned: boolean };

/** A remembered intent as the UI shows it (`text` mirrors `source`). */
export type IntentView = IntentRecord & { readonly text: string };

export interface MemoryView {
  readonly owner: string;
  readonly enabled: boolean;
  readonly retentionDays: number;
  readonly preferences: readonly PreferenceItem[];
  /** The structured preferences the planner and Lyko use. */
  readonly learned: Preferences;
  readonly suggestions: readonly SuggestionItem[];
  readonly patterns: readonly PatternSuggestion[];
  readonly contacts: readonly ContactView[];
  readonly recent: readonly IntentView[];
  /** The data-only summary Lyko's model sees. */
  readonly summary: string;
}

export interface MemoryIntentsResponse {
  readonly intents: readonly IntentView[];
}

export interface MemoryExport {
  readonly schema: "lykia.memory/v1";
  readonly owner: string;
  readonly exportedAt: string;
  readonly intents: readonly IntentRecord[];
  readonly contacts: readonly Contact[];
}

export interface ContactsResponse {
  readonly contacts: readonly ContactView[];
}
