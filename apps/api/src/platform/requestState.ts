/**
 * Per-request platform state: the resolved API version, the key mode and the
 * environment lock of test keys. Kept in a WeakMap keyed by the request (like
 * http/request.ts) plus an AsyncLocalStorage, so code that has no request in
 * hand (`environmentOf` in modules/common.ts) still sees the lock.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import { LATEST_API_VERSION, type ApiKeyMode } from "@lykia/core/api/platform";
import type { ArcEnvironment } from "@lykia/core";
import { LykiaHttpError } from "../http/errors.js";

export interface PlatformRequestState {
  apiVersion: string;
  mode: ApiKeyMode | null;
  /** "testnet" when a test key made the request: mainnet is refused. */
  environmentLock: ArcEnvironment | null;
  idempotentReplay: boolean;
}

const STATES = new WeakMap<Request, PlatformRequestState>();
const ALS = new AsyncLocalStorage<PlatformRequestState>();

export function platformState(req: Request): PlatformRequestState {
  let state = STATES.get(req);
  if (!state) {
    state = { apiVersion: LATEST_API_VERSION, mode: null, environmentLock: null, idempotentReplay: false };
    STATES.set(req, state);
  }
  return state;
}

/** Runs `next` inside the request's async context (call once the state is final). */
export function runWithState(req: Request, next: () => void): void {
  ALS.run(platformState(req), next);
}

/** The API version this request is served under (Lykia-Version header, else the key's pin, else the latest). */
export function apiVersionOf(req: Request): string {
  return platformState(req).apiVersion;
}

/** The environment lock of the current request, if any (test keys lock to testnet). */
export function currentEnvironmentLock(): ArcEnvironment | null {
  return ALS.getStore()?.environmentLock ?? null;
}

export function testKeyMainnetError(): LykiaHttpError {
  return new LykiaHttpError("LIVE_MODE_REQUIRED", 403, "Test keys (lk_test_…) only work on testnet. Use a live key for mainnet.");
}

/** Throws when the request is locked to testnet and asks for mainnet. */
export function assertEnvironmentAllowed(req: Request, environment: ArcEnvironment): void {
  if (platformState(req).environmentLock === "testnet" && environment === "mainnet") throw testKeyMainnetError();
}
