import { useEffect } from "react";

import { konamiStep } from "../../lib/commands";
import { useLangStore } from "../../lib/i18n";
import { toast } from "../../ui/toast";

/** ↑ ↑ ↓ ↓ ← → ← → B A: Lyko wags his tail. Nothing else happens. */
export function KonamiWink() {
  useEffect(() => {
    let progress = 0;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const step = konamiStep(progress, event.key);
      progress = step.progress;
      if (step.done) {
        const tr = useLangStore.getState().lang === "tr";
        toast.success(tr ? "Lyko kuyruğunu sallıyor" : "Lyko wags his tail", { description: tr ? "Eski bir şifre, eski bir dost." : "An old code, an old friend.", from: "LYKO", id: "konami" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
