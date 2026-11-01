import { useEffect, useMemo } from "react";

import { useOracleStore } from "../../oracle/oracleStore";
import { KbdCombo } from "../../ui/Kbd";
import { Sheet } from "../../ui/Sheet";
import { navigate } from "../routes/history";
import { GLOBAL_BINDINGS, SHORTCUT_DOCS } from "./bindings";
import { isEditableTarget, normalizeKey, SequenceMatcher } from "./sequence";
import { useShortcutsStore } from "./shortcutsStore";

/**
 * The global keyboard layer: ⌘K/Ctrl+K and "/" open the Oracle, "?" the
 * shortcuts sheet, "g t" Trade, "g p" Portfolio (and the other "g" keys).
 * Plain keys are ignored while typing in a field or while a dialog is open.
 */
export function GlobalKeys() {
  const shortcutsOpen = useShortcutsStore((state) => state.open);
  const setShortcutsOpen = useShortcutsStore((state) => state.setOpen);
  const matcher = useMemo(() => new SequenceMatcher(GLOBAL_BINDINGS), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = normalizeKey(event);
      if (!key) return;
      const chord = key.startsWith("mod+");
      const target = event.target as (Element & { isContentEditable?: boolean; type?: string }) | null;
      const typing = isEditableTarget(target);
      const modalOpen = document.querySelector('[aria-modal="true"]') !== null;
      if (!chord && (typing || modalOpen)) return;
      const action = matcher.feed(key, performance.now());
      if (!action) {
        if (matcher.pending) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (action === "oracle") {
        const oracle = useOracleStore.getState();
        if (oracle.open) oracle.closeOracle();
        else oracle.openOracle();
      } else if (action === "shortcuts") {
        useShortcutsStore.getState().setOpen(true);
      } else if (action.startsWith("go:")) {
        navigate(action.slice(3));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matcher]);

  return (
    <Sheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" description="Every action in Lykia is reachable from the keyboard.">
      <ul className="divide-y divide-rule">
        {SHORTCUT_DOCS.map((doc) => (
          <li key={`${doc.label}-${doc.keys.join("")}`} className="flex items-center justify-between gap-4 py-2.5 text-sm">
            <span className="text-ink-2">{doc.label}</span>
            <KbdCombo keys={doc.keys} joiner={doc.joiner} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
