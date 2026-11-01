/**
 * Standing orders: conditional and scheduled intents. They plan a new
 * intent when they fire; they never sign.
 *
 *   POST   /standing              arm from a sentence or a draft
 *   GET    /standing?owner=0x…    list an owner's orders
 *   GET    /standing/:id          one order
 *   POST   /standing/:id/check    check now (fires when due; `force` plans it regardless of the trigger)
 *   POST   /standing/:id/pause | /resume
 *   DELETE /standing/:id          cancel
 */
import type { Address, StandingOrderDraft } from "@lykia/core";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { readSentence } from "../language/reader.js";
import { STANDING_CHECK_MS } from "../engine/standing.js";
import { services } from "../services.js";
import { environmentOf, environmentSchema, fenceFrom } from "./common.js";

const IdParams = z.object({ id: z.string().regex(/^so_[A-Za-z0-9_-]{6,32}$/u) });

const createSchema = z
  .object({
    text: z.string().min(1).max(500).optional(),
    draft: z.unknown().optional(),
    owner: evmAddress,
    environment: environmentSchema.optional(),
    signer: z.enum(["wallet", "agent"]).optional(),
    agent: z.object({ address: evmAddress, agentId: z.string().regex(/^\d{1,30}$/u).optional() }).optional(),
    fence: z.unknown().optional(),
    timezone: z.string().max(64).optional(),
  })
  .refine((b) => (b.text === undefined) !== (b.draft === undefined), "Send either text or draft.");

const timers = new WeakMap<AppContext, NodeJS.Timeout>();

export const standingModule: ApiModule = {
  name: "standing",
  register(router, ctx) {
    router.post("/standing", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, createSchema);
      let drafts: StandingOrderDraft[];
      if (body.text !== undefined) {
        const parsed = readSentence(body.text, body.timezone ? { timezone: body.timezone } : {});
        if (parsed.clarify.length > 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.clarify.join(" "), { clarify: parsed.clarify, clarifyChoices: parsed.clarifyChoices ?? [], lang: parsed.lang });
        drafts = [...(parsed.standing ?? [])];
        if (drafts.length === 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.lang === "tr" ? "Bu bir koşul ya da zamanlama içermiyor; hemen yapmak için /v1/intents kullan." : "That has no condition or schedule; plan it now with /v1/intents.", { actions: parsed.actions });
      } else drafts = [body.draft as StandingOrderDraft];
      const fence = fenceFrom(body.fence);
      const environment = environmentOf(ctx, body.environment);
      const orders = [];
      for (const draft of drafts) {
        orders.push(
          await services(ctx).standing.create({
            owner: body.owner as Address,
            environment,
            draft,
            ...(body.signer ? { signer: body.signer } : {}),
            ...(body.agent ? { agent: { address: body.agent.address as Address, ...(body.agent.agentId ? { agentId: body.agent.agentId } : {}) } } : {}),
            ...(fence ? { fence } : {}),
          }),
        );
      }
      res.status(201).json({ orders });
    });

    router.get("/standing", async (req, res) => {
      const { owner } = parseQuery(req, z.object({ owner: evmAddress }));
      res.json({ orders: await services(ctx).standing.list(owner as Address) });
    });

    router.get("/standing/:id", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await services(ctx).standing.get(id));
    });

    router.post("/standing/:id/check", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const body = parseBody(req, z.object({ force: z.boolean().optional() }).default({}));
      res.json(await services(ctx).standing.check(id, body.force ? { force: true } : {}));
    });

    router.post("/standing/:id/pause", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await services(ctx).standing.setStatus(id, "paused"));
    });

    router.post("/standing/:id/resume", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await services(ctx).standing.setStatus(id, "active"));
    });

    router.delete("/standing/:id", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await services(ctx).standing.setStatus(id, "cancelled"));
    });
  },
  start(ctx) {
    const tick = async () => {
      try {
        const fired = await services(ctx).standing.tick();
        if (fired > 0) ctx.log.info("standing orders fired", { fired });
      } catch (error) {
        ctx.log.debug("standing tick failed", { error: error instanceof Error ? error.message : String(error) });
      }
      const timer = setTimeout(() => void tick(), STANDING_CHECK_MS);
      timer.unref();
      timers.set(ctx, timer);
    };
    const timer = setTimeout(() => void tick(), STANDING_CHECK_MS);
    timer.unref();
    timers.set(ctx, timer);
  },
  stop(ctx) {
    const timer = timers.get(ctx);
    if (timer) clearTimeout(timer);
    timers.delete(ctx);
  },
};
