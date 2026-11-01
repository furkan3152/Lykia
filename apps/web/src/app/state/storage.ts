import type { StateStorage } from "zustand/middleware";

/**
 * Browser storage can throw (private mode, blocked site data, quota, sandboxed
 * frames, embedded webviews). Every read and write goes through
 * these helpers so a storage failure never breaks rendering; callers treat a
 * missing value as "unset".
 */

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStorage(key: string): string | null {
  try {
    return local()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    local()?.setItem(key, value);
  } catch {
    // Storage is a convenience; failing to persist must not interrupt the user.
  }
}

export function removeStorage(key: string): void {
  try {
    local()?.removeItem(key);
  } catch {
    // See writeStorage.
  }
}

export function readSessionStorage(key: string): string | null {
  try {
    return session()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeSessionStorage(key: string, value: string): void {
  try {
    session()?.setItem(key, value);
  } catch {
    // See writeStorage.
  }
}

/** zustand `persist` adapter backed by the guarded helpers above. */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => readStorage(name),
  setItem: (name, value) => writeStorage(name, value),
  removeItem: (name) => removeStorage(name),
};

function createMemoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(String(key)) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => void items.delete(String(key)),
    setItem: (key: string, value: string) => void items.set(String(key), String(value)),
  };
}

/**
 * When the browser refuses site data, merely reading `window.localStorage`
 * throws a SecurityError, and wallet libraries read it directly while
 * rendering. Replace each refused storage with an in-memory one for this page
 * load: nothing persists, which is exactly what the visitor asked for.
 */
export function installMemoryStorageFallback(): void {
  if (typeof window === "undefined") return;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      void window[name];
      continue;
    } catch {
      // Refused: fall through to the in-memory replacement.
    }
    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: true, value: createMemoryStorage() });
    } catch {
      // Not configurable here; callers keep using the guarded helpers above.
    }
  }
}
