/**
 * Same-document View Transitions with a safe fallback (ported from Kletia).
 * Tiny and dependency free: the router and the theme toggle use it.
 */
import { prefersReducedMotion } from "./useReducedMotion";

export type ViewTransitionKind = "route" | "theme";

interface ViewTransitionLike {
  readonly finished: Promise<unknown>;
  readonly ready: Promise<unknown>;
  readonly updateCallbackDone: Promise<unknown>;
  readonly skipTransition?: () => void;
}

type StartViewTransition = (update: () => void) => ViewTransitionLike;

function starter(): StartViewTransition | null {
  if (typeof document === "undefined") return null;
  const start = (document as Document & { startViewTransition?: unknown }).startViewTransition;
  return typeof start === "function" ? (start.bind(document) as StartViewTransition) : null;
}

export function supportsViewTransitions(): boolean {
  return starter() !== null;
}

let sequence = 0;

function reportUpdateError(error: unknown) {
  // Surface the bug without breaking navigation.
  queueMicrotask(() => {
    throw error;
  });
}

/**
 * Runs `update` inside `document.startViewTransition` when supported, the page
 * is visible and motion is allowed; otherwise calls it synchronously. Sets
 * `html[data-el-vt=kind]` for the duration (it scopes the CSS) and
 * `--el-vt-x` / `--el-vt-y` from `origin` (viewport px). Never throws, and
 * `update` always runs exactly once.
 */
export function runViewTransition(kind: ViewTransitionKind, update: () => void, options: { origin?: { x: number; y: number } } = {}): Promise<void> {
  const start = starter();
  const visible = typeof document !== "undefined" && document.visibilityState !== "hidden";
  if (!start || !visible || prefersReducedMotion()) {
    try {
      update();
    } catch (error) {
      reportUpdateError(error);
    }
    return Promise.resolve();
  }

  const root = document.documentElement;
  const token = (sequence += 1);
  root.dataset.elVt = kind;
  if (options.origin) {
    root.style.setProperty("--el-vt-x", `${Math.round(options.origin.x)}px`);
    root.style.setProperty("--el-vt-y", `${Math.round(options.origin.y)}px`);
  }
  const cleanup = () => {
    if (token !== sequence) return;
    delete root.dataset.elVt;
    root.style.removeProperty("--el-vt-x");
    root.style.removeProperty("--el-vt-y");
  };

  let ran = false;
  const guardedUpdate = () => {
    if (ran) return;
    ran = true;
    try {
      update();
    } catch (error) {
      reportUpdateError(error);
    }
  };

  let transition: ViewTransitionLike;
  try {
    transition = start(guardedUpdate);
  } catch {
    guardedUpdate();
    cleanup();
    return Promise.resolve();
  }
  transition.ready.catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
  return transition.finished.then(cleanup, () => {
    guardedUpdate();
    cleanup();
  });
}
