import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/** Tabbable descendants in DOM order, skipping hidden ones. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("inert") && element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0,
  );
}

/**
 * Keeps Tab and Shift+Tab inside `container`. Returns true when it handled
 * the key (the caller then prevents default).
 */
export function trapTab(event: KeyboardEvent | ReactKeyboardEvent, container: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const items = focusableWithin(container);
  if (items.length === 0) {
    container.focus();
    return true;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    last.focus();
    return true;
  }
  if (!event.shiftKey && (active === last || !container.contains(active))) {
    first.focus();
    return true;
  }
  return false;
}

let locks = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

/** Locks page scroll while any modal layer is open (nested layers count). Returns the release. */
export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const body = document.body;
  if (locks === 0) {
    saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0 && saved) {
      body.style.overflow = saved.overflow;
      body.style.paddingRight = saved.paddingRight;
      saved = null;
    }
  };
}
