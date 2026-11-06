/**
 * The personal-data guard. An owner's profile, memory (intent history,
 * learned preferences) and contacts are read or written during an HTTP
 * request only when that request proved control of the owner: a SIWE
 * session for the address, or a secret key with the agents scope that may
 * act for it (its own developer, or an owner who consented to the key's
 * project). A bare `owner` in a body or query proves nothing, so unproven
 * requests see the default profile and an empty memory, and write nothing.
 *
 * Background work (schedulers, cron routes, bus listeners) runs outside any
 * request and is not limited; `asSystem` leaves a request's scope on purpose.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { AppContext } from "../context.js";
import { keyMayActFor } from "../platform/consent.js";
import { keyOf } from "../platform/gate.js";
import { sessionOf } from "../platform/session.js";

interface Scope {
  readonly ctx: AppContext;
  readonly req: Request;
  readonly proven: Map<string, Promise<boolean>>;
}

const ALS = new AsyncLocalStorage<Scope>();

/** Mounted on /v1 after the developer gate: every request handler runs inside its own scope. */
export function personalGuard(ctx: AppContext) {
  return (req: Request, _res: Response, next: NextFunction) => {
    ALS.run({ ctx, req, proven: new Map() }, next);
  };
}

async function proves(scope: Scope, owner: string): Promise<boolean> {
  const session = await sessionOf(scope.ctx, scope.req).catch(() => null);
  if (session && session.address.toLowerCase() === owner) return true;
  const key = keyOf(scope.req);
  if (!key || key.kind !== "secret" || !key.scopes.includes("agents")) return false;
  return keyMayActFor(scope.ctx, key, owner);
}

/** Whether personal data of `owner` may be used here: always outside a request, else only with proof. */
export function mayUsePersonal(owner: string | null | undefined): Promise<boolean> {
  if (!owner) return Promise.resolve(false);
  const scope = ALS.getStore();
  if (!scope) return Promise.resolve(true);
  const who = owner.toLowerCase();
  let hit = scope.proven.get(who);
  if (!hit) {
    hit = proves(scope, who).catch(() => false);
    scope.proven.set(who, hit);
  }
  return hit;
}

/** Records that the current request proved `owner` another way (a read-only MCP token). */
export function markProven(owner: string): void {
  ALS.getStore()?.proven.set(owner.toLowerCase(), Promise.resolve(true));
}

/** Runs `fn` outside the current request's scope (work the system does for every owner, not for the caller). */
export function asSystem<T>(fn: () => T): T {
  return ALS.exit(fn);
}
