/**
 * Toast store (ported from Kletia): a module-level queue with listeners and no
 * React import, so any module can emit toasts cheaply. `Toaster.tsx` renders
 * them; toasts emitted before it mounts wait in the queue.
 *
 * A toast is never the only way to an action or a piece of information:
 * every action button must also exist inline.
 */

export type ToastTone = "info" | "success" | "error" | "warning";

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  readonly action?: ToastAction;
  /** ms, or "persistent" (until dismissed). Default: info/success 4 s, warning 6 s, error 8 s. */
  readonly duration?: number | "persistent";
  /** Same id replaces the existing toast instead of stacking. */
  readonly id?: string;
  /** Who is on the radio ("BASE", "GUIDE", "FLOOR"). Default: BASE. */
  readonly from?: string;
}

export interface ToastRecord {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly tone: ToastTone;
  readonly action?: ToastAction;
  readonly duration: number | "persistent";
  /** Increments when a toast with the same id is replaced (restarts its timer). */
  readonly revision: number;
  readonly leaving: boolean;
  readonly from?: string;
  /** Wall clock (ms) when it was sent; shown as the radio timestamp. */
  readonly at?: number;
}

export const DEFAULT_TOAST_DURATION: Readonly<Record<ToastTone, number>> = Object.freeze({
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 8000,
});

export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_EXIT_MS = 160;

type Listener = () => void;

let toasts: readonly ToastRecord[] = [];
let counter = 0;
const listeners = new Set<Listener>();
const removals = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of [...listeners]) listener();
}

/** Pure: builds a record from options. */
export function createToastRecord(options: ToastOptions, id: string, revision = 0, at?: number): ToastRecord {
  const tone = options.tone ?? "info";
  const duration =
    options.duration === "persistent"
      ? "persistent"
      : typeof options.duration === "number" && Number.isFinite(options.duration) && options.duration > 0
        ? options.duration
        : DEFAULT_TOAST_DURATION[tone];
  return { id, title: options.title, description: options.description, tone, action: options.action, duration, revision, leaving: false, from: options.from, at };
}

/** Pure: inserts `record`, replacing (in place) a toast with the same id. */
export function upsertToast(list: readonly ToastRecord[], record: ToastRecord): readonly ToastRecord[] {
  const index = list.findIndex((item) => item.id === record.id);
  if (index < 0) return [...list, record];
  const next = [...list];
  next[index] = { ...record, revision: list[index]!.revision + 1 };
  return next;
}

export function getToasts(): readonly ToastRecord[] {
  return toasts;
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function show(options: ToastOptions): string {
  const id = options.id ?? `el-toast-${(counter += 1)}`;
  const pending = removals.get(id);
  if (pending !== undefined) {
    clearTimeout(pending);
    removals.delete(id);
  }
  toasts = upsertToast(toasts, createToastRecord(options, id, 0, Date.now()));
  emit();
  return id;
}

function remove(id: string) {
  removals.delete(id);
  const next = toasts.filter((item) => item.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/** Starts the exit of one toast (by id) or of every toast. */
function dismiss(id?: string) {
  let changed = false;
  toasts = toasts.map((item) => {
    if ((id !== undefined && item.id !== id) || item.leaving) return item;
    changed = true;
    removals.set(
      item.id,
      setTimeout(() => remove(item.id), TOAST_EXIT_MS),
    );
    return { ...item, leaving: true };
  });
  if (changed) emit();
}

type ShortcutOptions = Omit<ToastOptions, "title" | "tone">;

/**
 *   toast({ title: "Plan ready", description: "2 steps · 1 signature", tone: "success" });
 *   toast.success("Address copied", { id: "copy" });
 *   toast.error("Could not reach the API", { description, action: { label: "Retry", onClick: retry } });
 */
export const toast = Object.assign(show, {
  success: (title: string, options: ShortcutOptions = {}) => show({ ...options, title, tone: "success" }),
  error: (title: string, options: ShortcutOptions = {}) => show({ ...options, title, tone: "error" }),
  info: (title: string, options: ShortcutOptions = {}) => show({ ...options, title, tone: "info" }),
  warning: (title: string, options: ShortcutOptions = {}) => show({ ...options, title, tone: "warning" }),
  dismiss,
});

export type ToastApi = typeof toast;
