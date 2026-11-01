/**
 * Global keyboard model (pure). Chords ("mod+k") and two-key sequences
 * ("g t") resolve to action ids. Plain keys never fire while the user is
 * typing in a field; chords with a modifier do (⌘K must work everywhere).
 */

export interface KeyLike {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
}

export interface TargetLike {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly type?: string;
  readonly getAttribute?: (name: string) => string | null;
}

/**
 * Canonical key: "mod+k" (⌘ on Apple, Ctrl elsewhere: both accepted), "g",
 * "?", "escape". Null for bare modifiers, key repeats and AltGr-style combos.
 */
export function normalizeKey(event: KeyLike): string | null {
  if (event.repeat) return null;
  const key = event.key;
  if (!key || key === "Meta" || key === "Control" || key === "Alt" || key === "Shift" || key === "Dead" || key === "Unidentified") return null;
  const lower = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  if (event.metaKey || event.ctrlKey) {
    if (event.altKey) return null;
    return `mod+${lower}`;
  }
  if (event.altKey) return null;
  return lower;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);

/** True when keystrokes belong to a field (input, textarea, select, contenteditable, role=textbox). */
export function isEditableTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return TEXT_INPUT_TYPES.has((target.type ?? "").toLowerCase());
  return target.getAttribute?.("role") === "textbox";
}

export interface KeyBinding {
  readonly id: string;
  /** Space-separated: "mod+k", "?", "g t". */
  readonly keys: string;
}

export interface SequenceMatcherOptions {
  /** Max gap between the keys of a sequence (default 900 ms). */
  readonly timeoutMs?: number;
}

/**
 * Feeds normalised keys and returns the action id when a binding completes.
 * A key that starts a sequence ("g") is swallowed (`pending`) until the next
 * key or the timeout.
 */
export class SequenceMatcher {
  private readonly bindings: ReadonlyArray<{ readonly id: string; readonly parts: readonly string[] }>;
  private buffer: string[] = [];
  private lastAt = Number.NEGATIVE_INFINITY;
  private readonly timeoutMs: number;

  constructor(bindings: readonly KeyBinding[], options: SequenceMatcherOptions = {}) {
    this.bindings = bindings.map((binding) => ({ id: binding.id, parts: binding.keys.trim().split(/\s+/u) }));
    this.timeoutMs = options.timeoutMs ?? 900;
  }

  /** True while a sequence prefix is waiting for its next key. */
  get pending(): boolean {
    return this.buffer.length > 0;
  }

  reset(): void {
    this.buffer = [];
  }

  feed(key: string, now: number): string | null {
    if (now - this.lastAt > this.timeoutMs) this.buffer = [];
    this.lastAt = now;
    const candidate = [...this.buffer, key];
    const exact = this.bindings.find((binding) => binding.parts.length === candidate.length && binding.parts.every((part, index) => part === candidate[index]));
    if (exact) {
      this.buffer = [];
      return exact.id;
    }
    const prefix = this.bindings.some((binding) => binding.parts.length > candidate.length && candidate.every((part, index) => binding.parts[index] === part));
    if (prefix) {
      this.buffer = candidate;
      return null;
    }
    // Not part of a sequence: try the key alone (a fresh start).
    this.buffer = [];
    if (candidate.length > 1) return this.feed(key, now);
    return null;
  }
}
