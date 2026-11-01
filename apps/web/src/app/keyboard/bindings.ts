import { NAV_ITEMS } from "../shell/navItems";
import type { KeyBinding } from "./sequence";

export interface ShortcutDoc {
  readonly keys: readonly string[];
  readonly joiner: "plus" | "then";
  readonly label: string;
}

/** Every global binding: Where to? (⌘K), the shortcuts sheet and "g <key>" navigation. */
export const GLOBAL_BINDINGS: readonly KeyBinding[] = [
  { id: "oracle", keys: "mod+k" },
  { id: "oracle", keys: "/" },
  { id: "shortcuts", keys: "?" },
  ...[...NAV_ITEMS].filter((item) => item.keys).map((item) => ({ id: `go:${item.href}`, keys: item.keys! })),
];

/** What the "?" sheet lists. */
export const SHORTCUT_DOCS: readonly ShortcutDoc[] = [
  { keys: ["mod", "K"], joiner: "plus", label: "Where to? (pages, markets, sentences)" },
  { keys: ["/"], joiner: "plus", label: "Where to?" },
  { keys: ["?"], joiner: "plus", label: "Show these shortcuts" },
  { keys: ["Esc"], joiner: "plus", label: "Close a dialog or sheet" },
  ...[...NAV_ITEMS]
    .filter((item) => item.keys)
    .map((item) => ({ keys: item.keys!.split(" ").map((key) => key.toUpperCase()), joiner: "then" as const, label: `Go to ${item.label}` })),
];
