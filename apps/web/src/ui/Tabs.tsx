import React, { useId, useRef, useState } from "react";

import { cx, FOCUS_RING } from "./cx";

export interface TabItem<V extends string = string> {
  readonly id: V;
  readonly label: React.ReactNode;
  /** Small count or status after the label. */
  readonly badge?: React.ReactNode;
  readonly disabled?: boolean;
  /** Panel content; omit to render panels yourself from `value`. */
  readonly content?: React.ReactNode;
}

export interface TabsProps<V extends string = string> {
  readonly items: readonly TabItem<V>[];
  /** Controlled value; omit for uncontrolled with `defaultValue`. */
  readonly value?: V;
  readonly defaultValue?: V;
  readonly onChange?: (value: V) => void;
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly variant?: "underline" | "pill";
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly panelClassName?: string;
}

/**
 * Tabs with the WAI-ARIA pattern: roving focus, arrows/Home/End, automatic
 * activation. Only the active panel is mounted.
 */
export function Tabs<V extends string = string>({
  items,
  value,
  defaultValue,
  onChange,
  label,
  variant = "underline",
  size = "md",
  className,
  panelClassName,
}: TabsProps<V>) {
  const baseId = useId();
  const [inner, setInner] = useState<V | undefined>(defaultValue ?? items.find((item) => !item.disabled)?.id);
  const active = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (next: V) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };

  const focusAt = (index: number) => {
    const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    const target = enabled.includes(index) ? index : enabled[0]!;
    const item = items[target];
    if (!item) return;
    select(item.id);
    refs.current[target]?.focus();
  };

  const step = (from: number, delta: number) => {
    const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);
    const position = enabled.indexOf(from);
    const next = enabled[(position + delta + enabled.length) % enabled.length];
    if (next !== undefined) focusAt(next);
  };

  const activeItem = items.find((item) => item.id === active);
  const hasPanels = items.some((item) => item.content !== undefined);

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        className={cx(
          "scrollbar-none flex items-center overflow-x-auto",
          variant === "underline" ? "gap-1 border-b-2 border-rule" : "gap-[2px] bg-paper-2 p-[2px] px-frame-thin",
        )}
      >
        {items.map((item, index) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              id={`${baseId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={hasPanels ? `${baseId}-panel-${item.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  step(index, 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  step(index, -1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  focusAt(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  step(0, -1);
                }
              }}
              className={cx(
                "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-tag uppercase tracking-[0.04em] transition-colors duration-fast disabled:opacity-40",
                size === "sm" ? "h-8 px-2.5 text-[11px]" : "h-10 px-3.5 text-[13px]",
                variant === "underline"
                  ? cx(
                      "-mb-[2px] border-b-4",
                      selected ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink",
                    )
                  : cx(selected ? "px-btn px-btn-thin px-btn-accent text-accent-ink" : "bg-card text-ink-2 hover:bg-paper hover:text-ink"),
                FOCUS_RING,
              )}
            >
              {item.label}
              {item.badge !== undefined ? <span className="tnum bg-current/10 px-1 font-mono text-[11px] font-semibold tracking-normal opacity-80 px-frame-thin">{item.badge}</span> : null}
            </button>
          );
        })}
      </div>
      {hasPanels && activeItem ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          tabIndex={0}
          className={cx("pt-4 outline-none focus-visible:outline-none", panelClassName)}
        >
          {activeItem.content}
        </div>
      ) : null}
    </div>
  );
}
