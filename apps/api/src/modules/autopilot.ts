/**
 * Lyko Autopilot: Lyko signs the owner's own automations inside a leash on
 * the owner's own LykiaAccount, with a Circle developer-controlled wallet as
 * the session key. Off by default.
 *
 *   GET  /autopilot                    the offer (ceilings, acknowledgement, trust), the owner's Autopilot, its leash and last runs
 *   POST /autopilot/enable             ack digest + limits [+ payees] -> the leash's unsigned createSession for the owner's wallet
 *   POST /autopilot/stop               the kill switch: server signing stops now; returns revokeSession
 *   POST /autopilot/resume             after a pause (the anomaly guard or the owner)
 *   POST /autopilot/pause              the owner pauses it without ending the session
 *   POST /autopilot/tasks              add a task: repay, dca, sweep, pay, or a watch that ends in an action
 *   POST /autopilot/tasks/:id/:action  pause | resume | remove | run
 *
 * Owner only, signed in (a Lykia-Session): no API key can turn Autopilot on,
 * add tasks to it or run it.
 */
import { AUTOPILOT_LIMITS, AUTOPILOT_TASK_KINDS, WATCH_KINDS, type Address, type AutopilotTaskInput } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { LykiaHttpError } from "../http/errors.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { autopilotService } from "../autopilot/service.js";
import { keyOf } from "../platform/gate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { mustSession } from "../platform/session.js";
import { environmentOf, environmentSchema, publicBaseUrl } from "./common.js";

const usd = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/u, 'A USD amount as a string, e.g. "50".');
const limits = z.object({ perStepUsd: usd, perDayUsd: usd, days: z.number().int().min(AUTOPILOT_LIMITS.minDays).max(AUTOPILOT_LIMITS.maxDays) });
const enableSchema = z.object({
  environment: environmentSchema.optional(),
  ack: z.string().max(80).describe("The digest of the acknowledgement text from GET /v1/autopilot (offer.ack.digest)."),
  limits,
  payees: z.array(evmAddress).max(AUTOPILOT_LIMITS.payees).optional().describe("Addresses Autopilot may pay (recurring invoices). Money to you is always allowed."),
});
const every = z.enum(["day", "week", "month"]);
const condition = z.object({ kind: z.enum(WATCH_KINDS as unknown as [string, ...string[]]), threshold: z.string().max(12).optional(), venue: z.string().max(48).optional(), token: z.string().max(8).optional(), amount: z.string().max(16).optional(), percent: z.string().max(8).optional() });
export const taskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("repay"), amountUsd: usd, floor: z.string().max(8), venue: z.literal("aave-v4").optional() }),
  z.object({ kind: z.literal("dca"), amountUsd: usd, every, to: z.enum(["EURC", "USDC"]) }),
  z.object({ kind: z.literal("sweep"), amountUsd: usd, keepUsd: usd, vault: z.string().min(2).max(48) }),
  z.object({ kind: z.literal("pay"), amountUsd: usd, every, payee: evmAddress, note: z.string().max(40).optional() }),
  z.object({ kind: z.literal("watch"), watchId: z.string().max(80), condition: condition.optional().describe("Ignored: the watch's own condition is used."), sentence: z.string().min(4).max(200), amountUsd: usd }),
]);
const TaskParams = z.object({ id: z.string().regex(/^apt_[a-f0-9]{8}$/u), action: z.enum(["pause", "resume", "remove", "run"]) });
const envBody = z.object({ environment: environmentSchema.optional(), reason: z.string().max(200).optional() });

const ok = z.record(z.unknown());
documentRoutes([
  { method: "get", path: "/v1/autopilot", tag: "Autopilot", summary: "The owner's Autopilot", description: `Whether this server can sign for Autopilot, its ceilings (at most the lower of $100 a step and $300 a day and the mainnet beta cap), the acknowledgement and its digest, who holds what, and the owner's Autopilot with its leash, today's spend and the last runs. Task kinds: ${AUTOPILOT_TASK_KINDS.join(", ")}.`, auth: "session", query: z.object({ environment: environmentSchema.optional() }), response: ok },
  { method: "post", path: "/v1/autopilot/enable", tag: "Autopilot", summary: "Turn Autopilot on", description: "Needs LYKIA_CIRCLE_SERVER_WALLETS=true on the server (403 otherwise), the acknowledgement digest (400 AUTOPILOT_ACK_REQUIRED otherwise) and limits under the ceilings. Makes (or reuses) the owner's Circle EOA wallet and a leash on the owner's LykiaAccount with that wallet as its session key; returns the transactions the owner signs once. Nothing is signed by the server before that session lands.", auth: "session", body: enableSchema, response: ok, status: 201 },
  { method: "post", path: "/v1/autopilot/stop", tag: "Autopilot", summary: "Stop Autopilot", description: "The kill switch. Server signing stops at once, the leash and its Pack agent are revoked, and revokeSession comes back for the owner's wallet.", auth: "session", body: envBody, response: ok },
  { method: "post", path: "/v1/autopilot/pause", tag: "Autopilot", summary: "Pause Autopilot", description: "Nothing is signed until it is resumed; the session stays.", auth: "session", body: envBody, response: ok },
  { method: "post", path: "/v1/autopilot/resume", tag: "Autopilot", summary: "Resume Autopilot", description: "After a pause by the owner or by the anomaly guard (repeated refusals, unusual spend velocity).", auth: "session", body: envBody, response: ok },
  { method: "post", path: "/v1/autopilot/tasks", tag: "Autopilot", summary: "Add an Autopilot task", description: "repay (when the account's health factor drops below a floor), dca (convert on a schedule), sweep (idle USDC above an amount into a vault), pay (a payee named when Autopilot was turned on, on a schedule), watch (one of the owner's watches, then an action). Every run is planned under the Autopilot leash and checked again before Circle signs.", auth: "session", body: z.object({ environment: environmentSchema.optional(), task: taskSchema }), response: ok, status: 201 },
  { method: "post", path: "/v1/autopilot/tasks/:id/:action", tag: "Autopilot", summary: "Pause, resume, remove or run a task", description: "run plans it now with the same checks as a scheduled run.", auth: "session", params: TaskParams, body: z.object({ environment: environmentSchema.optional() }), response: ok },
]);

export const autopilotModule: ApiModule = {
  name: "autopilot",
  register(router, ctx) {
    const s = () => autopilotService(ctx);
    /** The signed-in owner. A key never reaches Autopilot. */
    const owner = async (req: Parameters<typeof mustSession>[1]): Promise<Address> => {
      if (keyOf(req)) throw new LykiaHttpError("FORBIDDEN", 403, "Autopilot is managed by the owner, signed in with their wallet; API keys cannot reach it.");
      return (await mustSession(ctx, req)).address.toLowerCase() as Address;
    };

    router.get("/autopilot", async (req, res) => {
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      res.json(await s().view(await owner(req), environmentOf(ctx, q.environment)));
    });

    router.post("/autopilot/enable", ctx.limits.heavy, async (req, res) => {
      const b = parseBody(req, enableSchema);
      res.status(201).json(await s().enable({ owner: await owner(req), environment: environmentOf(ctx, b.environment), ack: b.ack, limits: b.limits, ...(b.payees ? { payees: b.payees as Address[] } : {}), publicBaseUrl: publicBaseUrl(req) }));
    });

    router.post("/autopilot/stop", async (req, res) => {
      const b = parseBody(req, envBody);
      res.json(await s().stop(await owner(req), environmentOf(ctx, b.environment), "owner", b.reason));
    });

    router.post("/autopilot/pause", async (req, res) => {
      const b = parseBody(req, envBody);
      const who = await owner(req);
      const ap = await s().get(who, environmentOf(ctx, b.environment));
      if (!ap || ap.status !== "on") throw new LykiaHttpError("CONFLICT", 409, "Autopilot is not on.");
      res.json({ autopilot: await s().pause(ap, "owner", b.reason ?? "Paused by the owner.") });
    });

    router.post("/autopilot/resume", async (req, res) => {
      const b = parseBody(req, envBody);
      res.json({ autopilot: await s().resume(await owner(req), environmentOf(ctx, b.environment)) });
    });

    router.post("/autopilot/tasks", async (req, res) => {
      const b = parseBody(req, z.object({ environment: environmentSchema.optional(), task: taskSchema }));
      res.status(201).json({ autopilot: await s().addTask(await owner(req), environmentOf(ctx, b.environment), b.task as AutopilotTaskInput) });
    });

    router.post("/autopilot/tasks/:id/:action", ctx.limits.heavy, async (req, res) => {
      const { id, action } = parseParams(req, TaskParams);
      const b = parseBody(req, z.object({ environment: environmentSchema.optional() }));
      const who = await owner(req);
      const environment = environmentOf(ctx, b.environment);
      if (action === "run") res.json({ run: await s().runTask(who, environment, id) });
      else res.json({ autopilot: await s().setTask(who, environment, id, action) });
    });
  },
};
