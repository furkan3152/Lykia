/**
 * Intents: plan (sentence or actions) with the Fence, read, prepare unsigned
 * calls, submit hashes, stop, stream. The server never signs.
 *
 *   POST /intents                                plan (+ store unless dryRun)
 *   GET  /intents/:id                            graph + outrun
 *   GET  /intents/:id/outrun                     where the money is
 *   POST /intents/:id/steps/:sid/prepare         unsigned calls + binding + memo
 *   POST /intents/:id/steps/:sid/submit          hashes, or a userOpHash for smart accounts -> verified on Arc
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
import { fenceForProfile, projectFence, tightenFence } from "@lykia/core";
import { countProject, integratorFeeOf, projectOf } from "../platform/projects.js";
import { memoryService } from "../personal/memory.js";
import { screenAddress } from "../circle/compliance.js";
import { deviationBps, pythPrices } from "../oracles/pyth.js";

const ORACLE_GAP_BPS = 50;
import { getProfile } from "../personal/profile.js";
import { readWithMemory } from "../personal/reader.js";
import { services } from "../services.js";
import { securityPostflight, securityPreflight } from "../security/index.js";
import { actionsFrom, environmentOf, environmentSchema, fenceFrom, ownerProof } from "./common.js";
import { keyOf } from "../platform/gate.js";
import { sessionOf } from "../platform/session.js";
import { typedCollection } from "../platform/typed.js";

const POLL_INTERVAL_MS = 15_000;
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
    const creators = typedCollection<{ creator: string }>(ctx, "intent_creators");
    router.post("/intents", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, createSchema);
      let actions;
      let source: string;
      let memoryNote: unknown;
      let confirmContacts: readonly { name: string; address: string }[] = [];
      const owner = body.owner as Address;
      const profile = await getProfile(ctx, owner);
      if (body.text !== undefined) {
        const parsed = await readWithMemory(ctx, owner, body.text);
        if (parsed.clarify.length > 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.clarify.join(" "), { clarify: parsed.clarify, clarifyChoices: parsed.clarifyChoices ?? [] });
        if ((parsed.standing ?? []).length > 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, "That is a standing order: arm it with POST /v1/standing.", { standing: parsed.standing });
        if (parsed.actions.length === 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.reply);
        actions = parsed.actions;
        source = body.text;
        memoryNote = parsed.memory;
        confirmContacts = parsed.confirmContacts;
      } else {
        actions = actionsFrom(body.actions);
        source = JSON.stringify(actions).slice(0, 500);
      }
      // The request's Fence wins; without one the owner's profile shapes the default. A profile never loosens a Fence.
      // Through a project key: the project's Fence is the default, and its caps and modules tighten any Fence.
      const project = projectOf(req);
      let fence = fenceFrom(body.fence) ?? (project ? projectFence(project) : fenceForProfile(profile));
      if (project) fence = tightenFence(fence, project);
      if (confirmContacts.length > 0) fence = { ...fence, confirm: { ...fence.confirm, when: [...new Set([...(fence.confirm?.when ?? []), "external-recipient" as const])] } };
      const environment = body.environment ? environmentOf(ctx, body.environment) : project ? environmentOf(ctx, project.network) : profile.updatedAt ? profile.defaultNetwork : environmentOf(ctx, undefined);
      const notes: string[] = [];
      // Circle Compliance Engine (when configured): a DENIED recipient joins the Fence's deny list, so the Fence refuses it with a reason.
      const apiKey = ctx.config.circle.apiKey;
      if (apiKey) {
        const recipients = [...new Set(actions.flatMap((a) => (a.verb === "send" && a.to.toLowerCase() !== owner.toLowerCase() ? [a.to] : [])))];
        for (const address of recipients) {
          const screened = await screenAddress(ctx.fetch, apiKey, environment, address, ctx.clock.now()).catch(() => null);
          if (screened?.result === "DENIED") {
            fence = { ...fence, recipients: { ...fence.recipients, deny: [...(fence.recipients?.deny ?? []), address as Address] } };
            notes.push(`${address} was denied by Circle Compliance screening${screened.ruleName ? ` (${screened.ruleName})` : ""}.`);
          } else if (!screened || screened.result === "UNKNOWN") {
            // Never read silence as approval: say the recipient was not screened, and why.
            notes.push(`${address} was not screened by Circle Compliance${screened?.reason ? ` (${screened.reason})` : ""}.`);
          }
        }
      }
      // A second oracle opinion on conversions: Chainlink vs Pyth.
      if (actions.some((a) => a.verb === "fx" || a.verb === "swap" || a.verb === "rebalance")) {
        const [cl, py] = await Promise.all([services(ctx).prices.prices(["EURC", "cirBTC"]), pythPrices(ctx.chains, ["EURC", "cirBTC"], ctx.clock.now())]);
        for (const s of ["EURC", "cirBTC"]) {
          const gap = deviationBps(cl[s]?.usd ?? null, py[s]?.price ?? null);
          if (gap !== null && gap > ORACLE_GAP_BPS) notes.push(`Chainlink and Pyth disagree on ${s} by ${gap} bps; check the conversion price.`);
        }
      }
      const result = await services(ctx).intents.create({
        environment,
        owner,
        actions,
        source,
        fence,
        ...(body.signer ? { signer: body.signer } : {}),
        ...(body.agent ? { agent: { address: body.agent.address as Address, ...(body.agent.agentId ? { agentId: body.agent.agentId } : {}) } } : {}),
        ...(body.account ? { account: body.account } : {}),
        ...(body.dryRun ? { dryRun: true } : {}),
        ...(body.proposedByAgent ? { proposedByAgent: true } : {}),
        preferences: { favorites: profile.venues.favorites, blocked: profile.venues.blocked, maxRisk: profile.risk },
        ...(integratorFeeOf(project) ? { integrator: integratorFeeOf(project) } : {}),
      });
      // A project key never subscribes the named owner to the project's webhook: that takes the owner's consent (POST /v1/consents).
      if (project) await countProject(ctx, project.id, "plans").catch(() => undefined);
      if (result.stored) {
        await memoryService(ctx).record(owner, result.intent, { source, actions }).catch(() => null);
        // Who planned it (a key's developer or a signed-in address): besides the owner, only they may stop it.
        const creator = keyOf(req)?.owner ?? (await sessionOf(ctx, req))?.address ?? null;
        if (creator) await creators.put(result.intent.id, { creator: creator.toLowerCase() }, { ttlMs: 30 * 86_400_000 }).catch(() => undefined);
      }
      const contactNotes = confirmContacts.map((c) => `${c.name} (${c.address}) comes from memory and has no confirmed send yet: confirm the first payment yourself.`);
      const extra = { ...(memoryNote ? { memory: memoryNote } : {}), ...(confirmContacts.length > 0 ? { confirmContacts } : {}), ...(notes.length + contactNotes.length > 0 ? { notes: [...notes, ...contactNotes] } : {}) };
      res.status(result.stored ? 201 : 200).json({ ...result, ...extra });
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
      const prepared = await services(ctx).intents.prepare(id, sid, body.confirm ? { confirm: true } : {});
      res.json({ ...prepared, security: await securityPreflight(ctx, { intentId: id, stepId: sid, prepared }) });
    });

    router.post("/intents/:id/steps/:sid/submit", ctx.limits.heavy, async (req, res) => {
      const { id, sid } = parseParams(req, StepParams);
      const body = parseBody(req, z.union([z.object({ hashes: z.array(txHash).min(1).max(4) }), z.object({ userOpHash: txHash })]));
      const submitted = "userOpHash" in body ? await services(ctx).intents.submitUserOp(id, sid, body.userOpHash) : await services(ctx).intents.submit(id, sid, body.hashes);
      await securityPostflight(ctx, { intentId: id, stepId: sid, result: submitted, references: "userOpHash" in body ? [body.userOpHash] : body.hashes });
      res.json(submitted);
    });

    router.get("/intents/:id/steps/:sid/attestation", async (req, res) => {
      const { id, sid } = parseParams(req, StepParams);
      const { doc } = await services(ctx).intents.load(id);
      const entry = doc.cctp?.[sid];
      if (!entry) throw new LykiaHttpError("NOT_FOUND", 404, "No CCTP attestation for that step yet.");
      res.json({ stepId: sid, ...entry, note: entry.forwarded ? "Circle's Forwarding Service minted on the destination; nothing to do." : "Call receiveMessage(message, attestation) on the destination MessageTransmitterV2 to mint, or let any relayer do it." });
    });

    // Stopping is the owner's call (session, or a key that may act for the owner), or whoever planned it.
    // Submitting needs no such proof: every hash is checked on Arc against the prepared, bound transaction.
    router.post("/intents/:id/stop", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const { intent } = await services(ctx).intents.get(id);
      if (!(await ownerProof(ctx, req, intent.owner))) {
        const caller = keyOf(req)?.owner ?? (await sessionOf(ctx, req))?.address ?? null;
        const planned = (await creators.get(id))?.value.creator ?? null;
        if (!caller || caller.toLowerCase() !== planned) throw new LykiaHttpError(caller ? "FORBIDDEN" : "UNAUTHORIZED", caller ? 403 : 401, "Only the plan's owner (Lykia-Session) or whoever planned it can stop it.");
      }
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
