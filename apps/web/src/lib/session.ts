/**
 * The SIWE session (Lykia-Session token), persisted through the guarded
 * storage. The API client sends it on every request when present.
 */
import { create } from "zustand";

import { readStorage, removeStorage, writeStorage } from "../app/state/storage";

const KEY = "lykia.session";

export interface SessionInfo {
  readonly token: string;
  readonly address: string;
  readonly roles: readonly string[];
  readonly expiresAt: string;
}

function stored(): SessionInfo | null {
  const raw = readStorage(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SessionInfo;
    return s && typeof s.token === "string" && Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch {
    return null;
  }
}

interface SessionState {
  readonly session: SessionInfo | null;
  set(session: SessionInfo | null): void;
}

export const useSession = create<SessionState>()((set) => ({
  session: stored(),
  set: (session) => {
    if (session) writeStorage(KEY, JSON.stringify(session));
    else removeStorage(KEY);
    set({ session });
  },
}));

export function sessionToken(): string | null {
  const s = useSession.getState().session;
  return s && Date.parse(s.expiresAt) > Date.now() ? s.token : null;
}
