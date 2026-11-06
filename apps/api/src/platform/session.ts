/**
 * Session tokens and roles.
 *
 *   token = "lk1." + base64url(JSON claims) + "." + base64url(HMAC-SHA256(k_session, "lk1." + claims))
 *
 * Tokens travel in the `Lykia-Session` header (never cookies, so no CSRF
 * surface). Roles: `user` for any valid session, `developer` once the
 * address registered a developer profile, `admin` for LYKIA_ADMIN_ADDRESSES.
 * Developer and admin are re-checked on every request, never trusted from
 * the token. Logging out revokes the session id until it expires.
 */
import { createHmac } from "node:crypto";
import type { Request } from "express";
import type { Address } from "@lykia/core";
import { SESSION_HEADER, type SessionRole } from "@lykia/core/api/platform";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { purposeKey, randomHex, safeEqual } from "./crypto.js";

const SESSION_TTL_MS = 24 * 60 * 60_000;
const PREFIX = "lk1";
const MAX_TOKEN_LENGTH = 2_048;

export interface SessionClaims {
  readonly sub: string;
  readonly sid: string;
  readonly iat: number;
  readonly exp: number;
  /**
   * A narrowed token: "personal-read" tokens only read the owner's memory,
   * contacts and profile through the MCP personal tools. They are never a
   * session (sessionOf ignores them), so a token pasted into a third-party
   * client cannot sign in, plan, save or change anything.
   */
  readonly scope?: "personal-read";
}

export interface SessionContext {
  readonly claims: SessionClaims;
  readonly address: string;
  readonly roles: readonly SessionRole[];
}

function sign(ctx: AppContext, body: string): string {
  return createHmac("sha256", purposeKey(ctx, "session")).update(`${PREFIX}.${body}`, "utf8").digest("base64url");
}

export function issueToken(ctx: AppContext, address: string, ttlMs = SESSION_TTL_MS, scope?: SessionClaims["scope"]): { readonly token: string; readonly claims: SessionClaims } {
  const now = ctx.clock.now();
  const claims: SessionClaims = { sub: address.toLowerCase(), sid: `ses_${randomHex(12)}`, iat: now, exp: now + ttlMs, ...(scope ? { scope } : {}) };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return { token: `${PREFIX}.${body}.${sign(ctx, body)}`, claims };
}

export function verifyToken(ctx: AppContext, token: string): SessionClaims | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const [prefix, body, mac] = token.split(".");
  if (prefix !== PREFIX || !body || !mac || !safeEqual(mac, sign(ctx, body))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.sub !== "string" || typeof claims.sid !== "string" || typeof claims.exp !== "number") return null;
    return claims.exp > ctx.clock.now() ? claims : null;
  } catch {
    return null;
  }
}

export async function rolesOf(ctx: AppContext, address: string): Promise<SessionRole[]> {
  const roles: SessionRole[] = ["user"];
  if (await ctx.store.collection("developers").get(address.toLowerCase())) roles.push("developer");
  if (ctx.config.platform.adminAddresses.includes(address.toLowerCase())) roles.push("admin");
  return roles;
}

export async function revokeSession(ctx: AppContext, claims: SessionClaims): Promise<void> {
  const ttl = Math.max(1, claims.exp - ctx.clock.now());
  await ctx.store.collection("revoked_sessions").put(claims.sid, { at: ctx.clock.now() }, { ttlMs: ttl });
}

const SESSIONS = new WeakMap<Request, SessionContext | null>();

/** The request's session, or null (no header, bad token, revoked). Cached per request. */
export async function sessionOf(ctx: AppContext, req: Request): Promise<SessionContext | null> {
  if (SESSIONS.has(req)) return SESSIONS.get(req) ?? null;
  const header = req.get(SESSION_HEADER) ?? (req.get("authorization")?.startsWith("Bearer lk1.") ? req.get("authorization")?.slice(7) : undefined);
  let session: SessionContext | null = null;
  if (header) {
    const claims = verifyToken(ctx, header.trim());
    // A narrowed token (scope set) is never a session.
    if (claims && !claims.scope && !(await ctx.store.collection("revoked_sessions").get(claims.sid))) session = { claims, address: claims.sub, roles: await rolesOf(ctx, claims.sub) };
  }
  SESSIONS.set(req, session);
  return session;
}

/** The signed-in address, for routes about the caller's own data (401 without a session). */
export async function sessionAddress(ctx: AppContext, req: Request): Promise<Address> {
  return (await mustSession(ctx, req)).address as Address;
}

export async function mustSession(ctx: AppContext, req: Request, role: SessionRole = "user"): Promise<SessionContext> {
  const session = await sessionOf(ctx, req);
  if (!session) throw new LykiaHttpError("UNAUTHORIZED", 401, `Sign in with your wallet first (send the ${SESSION_HEADER} header).`);
  if (!session.roles.includes(role)) throw new LykiaHttpError("FORBIDDEN", 403, `This needs the ${role} role.`);
  return session;
}
