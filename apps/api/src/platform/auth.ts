/**
 * Who is calling a developer route: a SIWE session with the developer role,
 * or a secret API key (the gate already checked its scope for the route).
 * Keys let servers and the CLI manage keys, webhooks, logs and billing
 * without a browser.
 */
import type { Request } from "express";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { keyOf } from "./gate.js";
import type { StoredKey } from "./keys.js";
import { sessionOf } from "./session.js";

export interface DeveloperCaller {
  readonly address: string;
  readonly via: "session" | "key";
  readonly key: StoredKey | null;
  readonly admin: boolean;
}

export async function mustDeveloper(ctx: AppContext, req: Request): Promise<DeveloperCaller> {
  const session = await sessionOf(ctx, req);
  if (session) {
    if (!session.roles.includes("developer")) throw new LykiaHttpError("FORBIDDEN", 403, "This needs the developer role.");
    return { address: session.address, via: "session", key: null, admin: session.roles.includes("admin") };
  }
  const key = keyOf(req);
  if (key) {
    if (key.kind !== "secret") throw new LykiaHttpError("FORBIDDEN", 403, "Use a secret key (never a publishable key) for account routes.");
    // Legacy keys (lk_sk_) keep their old reach: account routes stay session-only for them.
    if (!key.mode) throw new LykiaHttpError("FORBIDDEN", 403, "Account routes need a lk_live_ or lk_test_ key (or a wallet session).");
    return { address: key.owner, via: "key", key, admin: false };
  }
  throw new LykiaHttpError("UNAUTHORIZED", 401, "Sign in with your wallet (Lykia-Session) or send a secret key (Lykia-Key).");
}
