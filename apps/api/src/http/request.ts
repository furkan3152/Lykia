/**
 * Per-request state (request id, start time) kept in a WeakMap keyed by the
 * Express request, so Express' global types are never augmented and nothing
 * outlives the request. Also the access log and `sendError`.
 */
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Clock } from "../clock.js";
import type { Logger } from "../log.js";
import { describeUpstream, mapError, type LykiaHttpError } from "./errors.js";
import type { ErrorEnvelope } from "./errors.js";
import { CATALOGUES, currentLocale, requestLocale, t, type MessageKey } from "../i18n/index.js";

const REQUEST_ID_HEADER = "x-request-id";
/** Incoming ids are echoed only when they look like ids (no spaces or control characters: they reach the logs). */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/u;

interface RequestState {
  readonly requestId: string;
  readonly startedAt: number;
}

const states = new WeakMap<Request, RequestState>();

function stateOf(req: Request, clock?: Clock): RequestState {
  let state = states.get(req);
  if (!state) {
    const incoming = req.get(REQUEST_ID_HEADER)?.trim();
    state = {
      requestId: incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID(),
      startedAt: clock?.now() ?? Date.now(),
    };
    states.set(req, state);
  }
  return state;
}

export function requestIdOf(req: Request): string {
  return stateOf(req).requestId;
}

/** Path without the query string: queries can carry addresses or references that do not belong in logs. */
function routePath(req: Request): string {
  const url = req.originalUrl || req.url;
  const index = url.indexOf("?");
  return (index === -1 ? url : url.slice(0, index)).slice(0, 200);
}

/** Quiet paths are logged at debug level (health checks would drown the log). */
const QUIET_PATHS = new Set(["/health", "/v1/health"]);

/**
 * First middleware: assigns the request id (echoed in `x-request-id`), and
 * writes one access-log line when the response finishes or the client goes
 * away (SSE streams log on close).
 */
export function requestContext(log: Logger, clock: Clock): RequestHandler {
  return (req, res, next) => {
    const state = stateOf(req, clock);
    res.setHeader(REQUEST_ID_HEADER, state.requestId);
    let logged = false;
    const done = (event: "finish" | "close") => {
      if (logged) return;
      logged = true;
      const path = routePath(req);
      const status = res.statusCode;
      const fields = {
        requestId: state.requestId,
        method: req.method,
        path,
        status,
        durationMs: clock.now() - state.startedAt,
        ...(event === "close" && !res.writableFinished ? { aborted: true } : {}),
      };
      if (status >= 500) log.warn("http request", fields);
      else if (QUIET_PATHS.has(path)) log.debug("http request", fields);
      else log.info("http request", fields);
    };
    res.once("finish", () => done("finish"));
    res.once("close", () => done("close"));
    next();
  };
}

/**
 * Writes the error envelope. Safe after headers were sent (the socket is
 * destroyed instead, which is the only signal left mid-stream).
 */
export function sendError(req: Request, res: Response, error: unknown, log?: Logger): void {
  const mapped = mapError(error);
  const failure: LykiaHttpError = mapped.error;
  const requestId = requestIdOf(req);
  if (mapped.log === "unexpected") {
    log?.error("unhandled error", { requestId, error: error instanceof Error ? error : String(error) });
  } else if (mapped.log === "upstream") {
    log?.warn("upstream error", { requestId, code: failure.code, upstream: describeUpstream(error) });
  }
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (!res.getHeader(REQUEST_ID_HEADER)) res.setHeader(REQUEST_ID_HEADER, requestId);
  res.setHeader("Cache-Control", "no-store");
  if (failure.headers) {
    for (const [name, value] of Object.entries(failure.headers)) res.setHeader(name, value);
  }
  if (failure.status === 401 && !res.getHeader("WWW-Authenticate")) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="lykia"');
  }
  res.status(failure.status).json(localizedEnvelope(failure.envelope(requestId), failure.status, req));
}

/**
 * The envelope in the request's language: the code stays an English constant;
 * the message is the code's message in that language (English keeps the
 * specific message the route wrote).
 */
function localizedEnvelope(envelope: ErrorEnvelope, status: number, req: Request): ErrorEnvelope {
  const locale = currentLocale() !== "en" ? currentLocale() : requestLocale({ header: req.get("accept-language"), query: req.query });
  if (locale === "en") return envelope;
  const byCode = `error.code.${envelope.error.code}`;
  const key = (byCode in CATALOGUES.en ? byCode : status >= 500 ? "error.generic.5xx" : `error.generic.${status}` in CATALOGUES.en ? `error.generic.${status}` : "error.generic.400") as MessageKey;
  return { error: { ...envelope.error, message: t(key, undefined, locale) } };
}

/** Express error middleware built on `sendError`. */
export function errorHandler(log: Logger) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    sendError(req, res, error, log);
  };
}

/** Responses identical for every caller may be cached briefly by browsers and CDNs. */
export function cachePublicly(res: Response, seconds: number): void {
  res.setHeader("Cache-Control", `public, max-age=${Math.max(0, Math.floor(seconds))}`);
}
