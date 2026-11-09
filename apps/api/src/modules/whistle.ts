/**
 * The Whistle: stop everything that acts for the owner, from one call.
 *
 *   GET  /whistle?owner&environment     what the Whistle holds now
 *   POST /whistle                       blow it: pause automations, standing orders, agent automations, Pack agents,
 *                                       leashes (their keys are refused) and Autopilot; returns each stopped item and
 *                                       the unsigned blowWhistle() for the owner's LykiaAccount
 *   POST /whistle/resume                let one item run again ({ kind, id }), or everything (no item)
 *
 * The owner's session, or a secret key with the agents scope acting for the owner.
 */
import type { Address } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseQuery } from "../http/validate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { blowWhistle, resumeWhistle, whistleState } from "../whistle/service.js";
import { authorizeOwner, environmentOf, environmentSchema } from "./common.js";

const KIND = z.enum(["automation", "standing", "agent-automation", "agent", "leash", "autopilot", "alert"]);
const item = z.object({ kind: KIND, id: z.string(), label: z.string(), environment: z.string().nullable(), state: z.enum(["paused", "resumed"]) });
const response = z.object({
  owner: z.string(),
  blownAt: z.string().nullable(),
  items: z.array(item),
  transaction: z.object({ chainId: z.number(), from: z.string(), to: z.string(), data: z.string(), value: z.string(), label: z.string() }).passthrough().nullable(),
  account: z.string().nullable(),
  counts: z.record(z.number()),
  note: z.string(),
});
const blowBody = z.object({ owner: evmAddress, environment: environmentSchema.optional(), reason: z.string().max(300).optional() });
const resumeBody = z.object({ owner: evmAddress, environment: environmentSchema.optional(), kind: KIND.optional(), id: z.string().min(1).max(160).optional() });

documentRoutes([
  { method: "get", path: "/v1/whistle", tag: "Pack", summary: "What the Whistle holds for the owner: every automation, standing order, agent automation, Pack agent, leash and Autopilot it stopped, each with its state", auth: "session", query: z.object({ owner: evmAddress, environment: environmentSchema.optional() }), response },
  { method: "post", path: "/v1/whistle", tag: "Pack", summary: "Blow the Whistle: pause every automation, standing order and recurring payment, agent automation, Pack agent, leash (its key is refused) and Autopilot for the owner, on the server, at once. Returns exactly what was stopped and the unsigned blowWhistle() for the owner's LykiaAccount when it exists", auth: "session", body: blowBody, response },
  { method: "post", path: "/v1/whistle/resume", tag: "Pack", summary: "Let one item the Whistle stopped run again ({ kind, id }), or every item when none is named. Things that were paused before the Whistle stay paused", auth: "session", body: resumeBody, response },
]);

export const whistleModule: ApiModule = {
  name: "whistle",
  register(router, ctx) {
    router.get("/whistle", async (req, res) => {
      const q = parseQuery(req, z.object({ owner: evmAddress, environment: environmentSchema.optional() }));
      await authorizeOwner(ctx, req, q.owner);
      res.json(await whistleState(ctx, q.owner as Address, environmentOf(ctx, q.environment)));
    });
    router.post("/whistle", async (req, res) => {
      const body = parseBody(req, blowBody);
      await authorizeOwner(ctx, req, body.owner);
      res.json(await blowWhistle(ctx, body.owner as Address, environmentOf(ctx, body.environment), body.reason));
    });
    router.post("/whistle/resume", async (req, res) => {
      const body = parseBody(req, resumeBody);
      await authorizeOwner(ctx, req, body.owner);
      res.json(await resumeWhistle(ctx, body.owner as Address, environmentOf(ctx, body.environment), body.kind && body.id ? { kind: body.kind, id: body.id } : undefined));
    });
  },
};
