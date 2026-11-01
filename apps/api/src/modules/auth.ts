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
import { issueToken, mustSession, revokeSession, rolesOf } from "../platform/session.js";
import { issueNonce, verifySiwe } from "../platform/siwe.js";

export const authModule: ApiModule = {
  name: "auth",
  register(router, ctx) {
    router.post("/auth/nonce", ctx.limits.auth, async (req, res) => {
      platformSecret(ctx);
      const body = parseBody(req, z.object({ address: evmAddress.optional(), chainId: z.number().int().positive().optional() }));
      res.json(await issueNonce(ctx, { ...(body.address ? { address: body.address } : {}), ...(body.chainId ? { chainId: body.chainId } : {}) }));
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
    router.post("/auth/logout", async (req, res) => {
      const session = await mustSession(ctx, req).catch(() => {
        throw new LykiaHttpError("UNAUTHORIZED", 401, "No session to log out.");
      });
      await revokeSession(ctx, session.claims);
      res.json({ ok: true });
    });
  },
};
