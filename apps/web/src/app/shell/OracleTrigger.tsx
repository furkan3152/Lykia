import { Sparkles } from "lucide-react";

import { openOracle } from "../../oracle/oracleStore";
import { buttonClasses } from "../../ui/buttonStyles";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { isApplePlatform } from "../../ui/platform";

/** The top bar's Oracle field: "Speak your intent… ⌘K". A button that looks like an input. */
export function OracleTrigger({ className }: { readonly className?: string }) {
  const apple = isApplePlatform();
  return (
    <button
      type="button"
      onClick={() => openOracle()}
      aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
      className={cx(
        "group flex h-10 w-full min-w-0 items-center gap-3 rounded-xl border border-violet-glow/25 bg-bg-1/70 px-3.5 text-left text-sm text-text-2 transition-[border-color,box-shadow,background-color] duration-base ease-pluck hover:border-violet-glow/50 hover:bg-bg-1 hover:shadow-[0_0_0_4px_rgb(var(--violet)/0.08)]",
        FOCUS_RING,
        className,
      )}
    >
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-gold shadow-glow-gold" />
      <span className="min-w-0 flex-1 truncate group-hover:text-text-1">Speak your intent…</span>
      <span className="hidden shrink-0 items-center gap-1 sm:flex" aria-hidden="true">
        <Kbd>{apple ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

/** Compact icon version for phones. */
export function OracleIconTrigger({ className }: { readonly className?: string }) {
  return (
    <button type="button" onClick={() => openOracle()} aria-label="Speak your intent" className={cx(buttonClasses({ variant: "soft", size: "md", iconOnly: true }), className)}>
      <Sparkles className="h-[18px] w-[18px] text-gold" aria-hidden="true" />
    </button>
  );
}
