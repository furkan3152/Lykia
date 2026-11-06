/**
 * Sign-in with Ethereum.
 *
 *   POST /auth/nonce     { address?, chainId? } -> nonce (+ a ready EIP-4361 message)
 *   POST /auth/verify    { message, signature } -> { token, address, roles, expiresAt }
 *   GET  /auth/session   the current session (Lykia-Session header)
 *   POST /auth/logout    revokes the current session
 */
import type { SessionView } from "@lykia/core/api/platform";
import { z } from "zod";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody } from "../http/validate.js";
import { platformSecret } from "../platform/crypto.js";
import { issueToken, mustSession, revokeSession, rolesOf, verifyToken } from "../platform/session.js";
import { issueNonce, verifySiwe } from "../platform/siwe.js";

export const authModule: ApiModule = {
  name: "auth",
  register(router, ctx) {
    router.post("/auth/nonce", ctx.limits.auth, async (req, res) => {
      platformSecret(ctx);
      const body = parseBody(req, z.object({ address: evmAddress.optional(), chainId: z.number().int().positive().optional() }));
      res.json(await issueNonce(ctx, { ...(body.address ? { address: body.address } : {}), ...(body.chainId ? { chainId: body.chainId } : {}), ...(req.get("origin") ? { origin: req.get("origin") as string } : {}) }));
    });
    router.post("/auth/verify", ctx.limits.auth, async (req, res) => {
      const body = parseBody(req, z.object({ message: z.string().min(20).max(4_000), signature: z.string().min(4).max(20_000) }));
      const verified = await verifySiwe(ctx, body.message, body.signature);
      const { token, claims } = issueToken(ctx, verified.address);
      const view: SessionView = { token, address: claims.sub, roles: await rolesOf(ctx, claims.sub), expiresAt: new Date(claims.exp).toISOString() };
      res.json(view);
    });
    router.get("/auth/session", async (req, res) => {
      const session = await mustSession(ctx, req);
      res.json({ address: session.address, roles: session.roles, expiresAt: new Date(session.claims.exp).toISOString() });
    });
    // A read-only token for the MCP personal tools (memory, contacts, profile), so no one pastes a full session into a third-party client.
    router.post("/auth/mcp-token", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req);
      const body = parseBody(req, z.object({ ttlHours: z.number().int().min(1).max(168).optional() }).default({}));
      const { token, claims } = issueToken(ctx, session.address, (body.ttlHours ?? 24) * 3_600_000, "personal-read");
      res.status(201).json({ token, scope: "personal-read", sid: claims.sid, expiresAt: new Date(claims.exp).toISOString(), note: "Read-only: the MCP tools lykia_memory, lykia_contacts and lykia_profile accept it. It cannot sign in, plan, save or change anything. Revoke it with POST /v1/auth/mcp-token/revoke." });
    });
    router.post("/auth/mcp-token/revoke", ctx.limits.auth, async (req, res) => {
      const session = await mustSession(ctx, req);
      const body = parseBody(req, z.object({ token: z.string().min(20).max(2_048) }));
      const claims = verifyToken(ctx, body.token);
      if (!claims || claims.scope !== "personal-read" || claims.sub !== session.address) throw new LykiaHttpError("NOT_FOUND", 404, "Not a live MCP token of this address.");
      await revokeSession(ctx, claims);
      res.json({ revoked: true });
    });
    router.post("/auth/logout", async (req, res) => {
      const session = await mustSession(ctx, req).catch(() => {
        throw new LykiaHttpError("UNAUTHORIZED", 401, "No session to log out.");
      });
      await revokeSession(ctx, session.claims);
      res.json({ ok: true });
    });
  },
};
