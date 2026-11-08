/**
 * Instructions between the two agents on the owner's shared thread.
 *
 *   GET  /agent/instructions?owner&environment&to&kind&status   the owner's hand-offs, newest first
 *   POST /agent/instructions                                     hand one over:
 *        { kind: "plan", from: "watch", to: "ask", insightId }   Lyko on watch -> Ask Lyko (a staged plan)
 *        { kind: "watch", from: "ask", to: "watch", condition }  Ask Lyko -> Lyko on watch (a watch task)
 *        { kind: "watch", from: "ask", to: "watch", intentId }   "Watch this position" after a plan settled
 *   POST /agent/instructions/:id/(pause|resume|remove)           a watch task
 *
 * Every route needs the owner's proof (a Lykia-Session for the owner, or a
 * secret key with the agents scope). Nothing here signs or moves funds: a
 * plan is planned under the owner's Fence for the owner to sign.
 */
import { DEFAULT_FENCE, fenceForProfile, riskTierOf, type Address, type WatchCondition } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { assertRouting, createWatch, getInstruction, handInsightToAsk, listInstructions, moveWatch } from "../agents/instructions.js";
import { getPreferences } from "../fold/preferences.js";
import { getProfile } from "../personal/profile.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { authorizeOwner, environmentOf, environmentSchema, fenceFrom } from "./common.js";

const role = z.enum(["watch", "ask"]);
const decimal = z.string().max(20).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u);
const venue = z.string().regex(/^[a-z0-9-]{2,40}$/u);
export const watchConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("health-below"), threshold: decimal, venue: venue.optional() }).strict(),
  z.object({ kind: z.literal("lp-out-of-range"), venue: venue.optional() }).strict(),
  z.object({ kind: z.literal("idle-above"), token: z.enum(["USDC", "EURC"]), amount: decimal }).strict(),
  z.object({ kind: z.literal("apy-below"), percent: decimal, venue: venue.optional() }).strict(),
]);
const threadId = z.string().max(120).optional();
const createBody = z.discriminatedUnion("kind", [
  z.object({ owner: evmAddress, environment: environmentSchema.optional(), kind: z.literal("plan"), from: role, to: role, insightId: z.string().min(2).max(120), threadId, fence: z.unknown().optional() }),
  z.object({ owner: evmAddress, environment: environmentSchema.optional(), kind: z.literal("watch"), from: role, to: role, condition: watchConditionSchema.optional(), intentId: z.string().regex(/^out_[A-Za-z0-9_-]{6,32}$/u).optional(), threadId }),
]);
const listQuery = z.object({ owner: evmAddress, environment: environmentSchema.optional(), to: role.optional(), kind: z.enum(["plan", "watch"]).optional(), status: z.string().max(20).optional() });
const idParams = z.object({ id: z.string().regex(/^0x[0-9a-f]{40}:ins_[0-9a-f]{16}$/u) });
const moveBody = z.object({ owner: evmAddress });

const instruction = z
  .object({
    id: z.string(),
    owner: z.string(),
    environment: z.string(),
    from: role,
    to: role,
    kind: z.enum(["plan", "watch"]),
    payload: z.record(z.unknown()).describe("plan: sentence, title, reason, insightId, intentId. watch: condition, label, fired, lastFiredAt, observation."),
    status: z.string().describe("plan: pending, planned, signed, done, refused, stopped. watch: active, paused, removed."),
    threadId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

documentRoutes([
  { method: "get", path: "/v1/agent/instructions", tag: "Agents", summary: "The owner's hand-offs between Lyko on watch and Ask Lyko (plans and watch tasks), newest first; plan statuses follow their plans", auth: "session", query: listQuery, response: z.object({ instructions: z.array(instruction) }) },
  {
    method: "post",
    path: "/v1/agent/instructions",
    tag: "Agents",
    summary: "Hand work to the other agent: a plan from an insight (Lyko on watch to Ask Lyko, planned under the owner's Fence as a staged plan and written to the shared thread), or a watch task (Ask Lyko to Lyko on watch) from a condition or from a settled plan",
    auth: "session",
    body: createBody,
    response: z.object({ instruction, proposal: z.record(z.unknown()).optional(), threadId: z.string().optional() }),
  },
  { method: "post", path: "/v1/agent/instructions/:id/pause", tag: "Agents", summary: "Pause a watch task", auth: "session", params: idParams, body: moveBody, response: z.object({ instruction }) },
  { method: "post", path: "/v1/agent/instructions/:id/resume", tag: "Agents", summary: "Resume a watch task", auth: "session", params: idParams, body: moveBody, response: z.object({ instruction }) },
  { method: "post", path: "/v1/agent/instructions/:id/remove", tag: "Agents", summary: "Remove a watch task", auth: "session", params: idParams, body: moveBody, response: z.object({ instruction }) },
]);

export const instructionsModule: ApiModule = {
  name: "instructions",
  register(router, ctx) {
    router.get("/agent/instructions", async (req, res) => {
      const q = parseQuery(req, listQuery);
      await authorizeOwner(ctx, req, q.owner);
      const list = await listInstructions(ctx, q.owner as Address, { ...(q.to ? { to: q.to } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(q.environment ? { environment: environmentOf(ctx, q.environment) } : {}) });
      res.json({ instructions: q.status ? list.filter((i) => i.status === q.status) : list });
    });

    router.post("/agent/instructions", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, createBody);
      await authorizeOwner(ctx, req, body.owner);
      assertRouting(body);
      const owner = body.owner as Address;
      const environment = environmentOf(ctx, body.environment);
      const [profile, prefs] = await Promise.all([getProfile(ctx, owner), getPreferences(ctx, owner)]);
      const ownerFence = fenceForProfile({ ...profile, risk: riskTierOf(prefs.risk) }, DEFAULT_FENCE);
      if (body.kind === "plan") {
        const fence = fenceFrom(body.fence) ?? ownerFence;
        const handed = await handInsightToAsk(ctx, { owner, environment, insightId: body.insightId, fence, threadId: body.threadId ?? null });
        return void res.status(201).json(handed);
      }
      const floor = ownerFence.lending?.minHealthFactor ?? "1.5";
      const made = await createWatch(ctx, { owner, environment, ...(body.condition ? { condition: body.condition as WatchCondition } : {}), ...(body.intentId ? { intentId: body.intentId } : {}), threadId: body.threadId ?? null, floor, note: true });
      res.status(201).json({ instruction: made });
    });

    for (const action of ["pause", "resume", "remove"] as const) {
      router.post(`/agent/instructions/:id/${action}`, async (req, res) => {
        const { id } = parseParams(req, idParams);
        const body = parseBody(req, moveBody);
        await authorizeOwner(ctx, req, body.owner);
        await getInstruction(ctx, body.owner as Address, id);
        res.json({ instruction: await moveWatch(ctx, body.owner as Address, id, action) });
      });
    }
  },
};

