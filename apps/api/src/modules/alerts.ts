/**
 * Alerts, the in-app inbox and the Telegram bot.
 *
 *   GET    /alerts                     the session owner's rules
 *   POST   /alerts                     { kind, token?, threshold?, channels?, cooldownSeconds?, environment? }
 *   PATCH  /alerts/:id                 { paused }
 *   DELETE /alerts/:id
 *   GET    /alerts/inbox               firings, newest first
 *   POST   /alerts/inbox/read          mark all read
 *   POST   /alerts/check               run one pass now (admin or CRON_SECRET)
 *   POST   /telegram/link-code         a /start code for the bot (session)
 *   GET    /telegram/status            linked? configured?
 *   DELETE /telegram/link
 *   POST   /telegram/webhook           Telegram updates (secret header)
 *   POST   /telegram/setup             point the bot at this API (admin)
 */
import { createHash } from "node:crypto";
import { cronAuthorized, secretMatches } from "../platform/crypto.js";
import { ALERT_CHANNELS, ALERT_KINDS, type AlertChannel, type AlertKind } from "@lykia/core";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { alertsService, ALERT_CHECK_MS } from "../alerts/service.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { parseBody, parseParams, parseQuery } from "../http/validate.js";
import { sessionAddress, sessionOf } from "../platform/session.js";
import { environmentOf, environmentSchema } from "./common.js";

const IdParams = z.object({ id: z.string().regex(/^al_[0-9a-f]{16}$/u) });
const createSchema = z.object({
  kind: z.enum(ALERT_KINDS as unknown as [AlertKind, ...AlertKind[]]),
  token: z.string().max(10).optional(),
  threshold: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u).optional(),
  channels: z.array(z.enum(ALERT_CHANNELS as unknown as [AlertChannel, ...AlertChannel[]])).max(3).optional(),
  cooldownSeconds: z.number().int().min(60).max(7 * 86_400).optional(),
  environment: environmentSchema.optional(),
});

const timers = new WeakMap<AppContext, NodeJS.Timeout>();

function telegramSecret(ctx: AppContext): string | null {
  const token = ctx.config.telegramBotToken;
  return token ? createHash("sha256").update(`lykia-telegram:${token}`).digest("hex").slice(0, 48) : null;
}

async function isAdminOrCron(ctx: AppContext, req: Parameters<typeof sessionOf>[1]): Promise<boolean> {
  if (cronAuthorized(req.headers.authorization)) return true;
  const session = await sessionOf(ctx, req);
  return Boolean(session && ctx.config.platform.adminAddresses.includes(session.address.toLowerCase()));
}

export const alertsModule: ApiModule = {
  name: "alerts",
  register(router, ctx) {
    const s = () => alertsService(ctx);
    const owner = (req: Parameters<typeof sessionOf>[1]) => sessionAddress(ctx, req);

    router.get("/alerts", async (req, res) => {
      res.json({ alerts: await s().list(await owner(req)) });
    });
    router.post("/alerts", async (req, res) => {
      const b = parseBody(req, createSchema);
      res.status(201).json(await s().create({ ...b, owner: await owner(req), environment: environmentOf(ctx, b.environment) }));
    });
    router.patch("/alerts/:id", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const b = parseBody(req, z.object({ paused: z.boolean() }));
      res.json(await s().update(await owner(req), id, b));
    });
    router.delete("/alerts/:id", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json({ deleted: await s().remove(await owner(req), id) });
    });
    router.get("/alerts/inbox", async (req, res) => {
      res.json({ firings: await s().inbox(await owner(req)) });
    });
    router.post("/alerts/inbox/read", async (req, res) => {
      res.json({ marked: await s().markRead(await owner(req)) });
    });
    router.post("/alerts/check", ctx.limits.heavy, async (req, res) => {
      if (!(await isAdminOrCron(ctx, req))) throw new LykiaHttpError("NOT_FOUND", 404, "Not found.");
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      res.json(await s().tick(environmentOf(ctx, q.environment)));
    });

    router.post("/telegram/link-code", async (req, res) => {
      res.json(await s().linkCode(await owner(req)));
    });
    router.get("/telegram/status", async (req, res) => {
      res.json(await s().linkStatus(await owner(req)));
    });
    router.delete("/telegram/link", async (req, res) => {
      await s().unlink(await owner(req));
      res.json({ unlinked: true });
    });
    router.post("/telegram/webhook", async (req, res) => {
      const expected = telegramSecret(ctx);
      if (!secretMatches(req.get("x-telegram-bot-api-secret-token"), expected)) throw new LykiaHttpError("NOT_FOUND", 404, "Not found.");
      await s().telegramUpdate(req.body as never);
      res.json({ ok: true });
    });
    router.post("/telegram/setup", async (req, res) => {
      if (!(await isAdminOrCron(ctx, req))) throw new LykiaHttpError("NOT_FOUND", 404, "Not found.");
      const b = parseBody(req, z.object({ publicApiUrl: z.string().url().startsWith("https://") }));
      const secret = telegramSecret(ctx);
      if (!secret) throw new LykiaHttpError("INVALID_REQUEST", 400, "Set TELEGRAM_BOT_TOKEN first.");
      res.json(await s().telegramSetup(b.publicApiUrl, secret));
    });
  },
  start(ctx) {
    const loop = async () => {
      for (const env of ["mainnet", "testnet"] as const) await alertsService(ctx).tick(env).catch(() => undefined);
      const t = setTimeout(() => void loop(), ALERT_CHECK_MS);
      t.unref();
      timers.set(ctx, t);
    };
    const t = setTimeout(() => void loop(), ALERT_CHECK_MS);
    t.unref();
    timers.set(ctx, t);
  },
  stop(ctx) {
    const t = timers.get(ctx);
    if (t) clearTimeout(t);
    timers.delete(ctx);
  },
};
