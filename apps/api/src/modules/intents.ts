/**
 * Intents: plan (sentence or actions) with the Fence, read, prepare unsigned
 * calls, submit hashes, stop, stream. The server never signs.
 *
 *   POST /intents                                plan (+ store unless dryRun)
 *   GET  /intents/:id                            graph + outrun
 *   GET  /intents/:id/outrun                     where the money is
 *   POST /intents/:id/steps/:sid/prepare         unsigned calls + binding + memo
 *   POST /intents/:id/steps/:sid/submit          hashes -> verified on Arc
 *   GET  /intents/:id/steps/:sid/attestation     CCTP attestation once complete
 *   POST /intents/:id/stop                       stop every unstarted step
 *   GET  /intents/:id/stream                     SSE: intent, outrun
 */
import type { Address } from "@lykia/core";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { openSse } from "../http/sse.js";
import { evmAddress, parseBody, parseParams, txHash } from "../http/validate.js";
import { readSentence } from "../language/reader.js";
import { services } from "../services.js";
import { actionsFrom, environmentOf, environmentSchema, fenceFrom } from "./common.js";

export const POLL_INTERVAL_MS = 15_000;
const IdParams = z.object({ id: z.string().regex(/^out_[A-Za-z0-9_-]{6,32}$/u) });
const StepParams = IdParams.extend({ sid: z.string().regex(/^s\d{1,2}$/u) });

export const createSchema = z
  .object({
    text: z.string().min(1).max(500).optional(),
    actions: z.array(z.unknown()).max(12).optional(),
    owner: evmAddress,
    environment: environmentSchema.optional(),
    fence: z.unknown().optional(),
    signer: z.enum(["wallet", "agent"]).optional(),
    agent: z.object({ address: evmAddress, agentId: z.string().regex(/^\d{1,30}$/u).optional() }).optional(),
    account: z.enum(["eoa", "smart"]).optional(),
    dryRun: z.boolean().optional(),
    proposedByAgent: z.boolean().optional(),
  })
  .refine((b) => (b.text === undefined) !== (b.actions === undefined), "Send either text or actions.");

const pollers = new WeakMap<AppContext, NodeJS.Timeout>();

export const intentsModule: ApiModule = {
  name: "intents",
  register(router, ctx) {
    router.post("/intents", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, createSchema);
      let actions;
      let source: string;
      if (body.text !== undefined) {
        const parsed = readSentence(body.text);
        if (parsed.clarify.length > 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.clarify.join(" "), { clarify: parsed.clarify, clarifyChoices: parsed.clarifyChoices ?? [], lang: parsed.lang });
        if ((parsed.standing ?? []).length > 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.lang === "tr" ? "Bu bir bekleyen emir: kurmak için POST /v1/standing." : "That is a standing order: arm it with POST /v1/standing.", { standing: parsed.standing, lang: parsed.lang });
        if (parsed.actions.length === 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.reply, { lang: parsed.lang });
        actions = parsed.actions;
        source = body.text;
      } else {
        actions = actionsFrom(body.actions);
        source = JSON.stringify(actions).slice(0, 500);
      }
      const fence = fenceFrom(body.fence);
      const result = await services(ctx).intents.create({
        environment: environmentOf(ctx, body.environment),
        owner: body.owner as Address,
        actions,
        source,
        ...(fence ? { fence } : {}),
        ...(body.signer ? { signer: body.signer } : {}),
        ...(body.agent ? { agent: { address: body.agent.address as Address, ...(body.agent.agentId ? { agentId: body.agent.agentId } : {}) } } : {}),
        ...(body.account ? { account: body.account } : {}),
        ...(body.dryRun ? { dryRun: true } : {}),
        ...(body.proposedByAgent ? { proposedByAgent: true } : {}),
      });
      res.status(result.stored ? 201 : 200).json(result);
    });

    router.get("/intents/:id", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await services(ctx).intents.get(id));
    });

    router.get("/intents/:id/outrun", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json((await services(ctx).intents.get(id)).outrun);
    });

    router.post("/intents/:id/steps/:sid/prepare", ctx.limits.heavy, async (req, res) => {
      const { id, sid } = parseParams(req, StepParams);
      const body = parseBody(req, z.object({ confirm: z.boolean().optional() }).default({}));
      res.json(await services(ctx).intents.prepare(id, sid, body.confirm ? { confirm: true } : {}));
    });

    router.post("/intents/:id/steps/:sid/submit", ctx.limits.heavy, async (req, res) => {
      const { id, sid } = parseParams(req, StepParams);
      const body = parseBody(req, z.object({ hashes: z.array(txHash).min(1).max(4) }));
      res.json(await services(ctx).intents.submit(id, sid, body.hashes));
    });

    router.get("/intents/:id/steps/:sid/attestation", async (req, res) => {
      const { id, sid } = parseParams(req, StepParams);
      const { doc } = await services(ctx).intents.load(id);
      const entry = doc.cctp?.[sid];
      if (!entry) throw new LykiaHttpError("NOT_FOUND", 404, "No CCTP attestation for that step yet.");
      res.json({ stepId: sid, ...entry, note: "Call receiveMessage(message, attestation) on the destination MessageTransmitterV2 to mint, or let any relayer do it." });
    });

    router.post("/intents/:id/stop", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await services(ctx).intents.stop(id));
    });

    router.get("/intents/:id/stream", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const current = await services(ctx).intents.get(id);
      const stream = openSse(req, res, { slots: ctx.limits.streams });
      stream.send("intent", current.intent);
      stream.send("outrun", current.outrun);
      const off = ctx.bus.on("intent.updated", (event) => {
        if (event.id !== id) return;
        stream.send("intent", event.intent);
        stream.send("outrun", event.outrun);
      });
      stream.onClose(off);
    });
  },
  start(ctx) {
    const tick = async () => {
      try {
        await services(ctx).intents.poll();
      } catch (error) {
        ctx.log.debug("intent poll failed", { error: error instanceof Error ? error.message : String(error) });
      }
      const timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      timer.unref();
      pollers.set(ctx, timer);
    };
    const timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    timer.unref();
    pollers.set(ctx, timer);
  },
  stop(ctx) {
    const timer = pollers.get(ctx);
    if (timer) clearTimeout(timer);
    pollers.delete(ctx);
  },
};
