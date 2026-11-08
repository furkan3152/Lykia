/**
 * Leashes: a budget an outside agent cannot exceed.
 *
 *   GET  /leashes/templates            the templates and the enforcement split (public)
 *   POST /leashes                      create: Pack agent + carve + unsigned session tx + leash key (once) + MCP snippet [+ Tag tx]
 *   GET  /leashes?owner&environment    the owner's leashes with live usage (spendable() on chain is authoritative)
 *   GET  /leashes/:id                  one leash with usage and its last actions
 *   GET  /leashes/:id/trail            every action, each marked chain-proven or not
 *   POST /leashes/:id/session          bind the session once its transaction landed ({ txHash } or a scan)
 *   POST /leashes/:id/revoke           the key dies now; returns the unsigned revokeSession
 *   POST /leashes/:id/renew            a new carve and a new key; the old leash is revoked
 *   POST /leashes/:id/plan             leash key: plan inside the leash, first step wrapped for the session key
 *   POST /leashes/:id/submit           leash key: report the signed step; the next one comes back prepared
 *
 * Creating, revoking and renewing take the owner: a Lykia-Session, or a
 * secret key with the agents scope acting for its own developer or an owner
 * who gave its project consent. A leash key never reaches these: the gate
 * lets it through to its own leash's read, plan and submit routes and to
 * MCP, nothing else.
 */
import { LEASH_ENFORCEMENT, LEASH_LIMITS, LEASH_TEMPLATE_KEYS, LEASH_TEMPLATES, LEASH_TOOLS, type Address, type LeashTemplateKey, type LeashTool } from "@lykia/core";
import type { Request } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery, txHash } from "../http/validate.js";
import { leashService, type LeashCaller } from "../leash/service.js";
import { keyOf } from "../platform/gate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { projectOf } from "../platform/projects.js";
import { sessionOf } from "../platform/session.js";
import { actionsFrom, authorizeOwner, environmentOf, environmentSchema, ownerProof, publicBaseUrl } from "./common.js";

const usd = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/u, 'A USD amount as a string, e.g. "50".');
const budget = z.object({ perStepUsd: usd, perDayUsd: usd, totalUsd: usd });
const templateSchema = z.enum(LEASH_TEMPLATE_KEYS as unknown as [LeashTemplateKey, ...LeashTemplateKey[]]);
const toolSchema = z.enum(LEASH_TOOLS as unknown as [LeashTool, ...LeashTool[]]);
const LeashParams = z.object({ id: z.string().regex(/^lsh_[a-f0-9]{12}$/u) });

export const createLeashSchema = z
  .object({
    owner: evmAddress.optional().describe("Defaults to the signed-in address; required with a project key acting through consent."),
    environment: environmentSchema.optional(),
    agent: z.object({ name: z.string().min(1).max(LEASH_LIMITS.nameLength), mission: z.string().max(LEASH_LIMITS.missionLength).optional(), signer: evmAddress.describe("The agent's own address: it becomes the LykiaAccount session key. Lykia never sees its private key.") }).optional(),
    parentAgentId: z.string().min(8).max(120).optional().describe("A Pack agent to carve the leash from (its Fence and budget bound the leash)."),
    name: z.string().min(1).max(LEASH_LIMITS.nameLength).optional().describe("With parentAgentId: the new sub-agent's name."),
    signer: evmAddress.optional().describe("With parentAgentId: the new sub-agent's session key address."),
    template: templateSchema.optional(),
    fence: z.record(z.unknown()).optional().describe('"custom" only: a lykia.fence/v1 document.'),
    budget,
    expiresAt: z.string().max(40),
    venues: z.array(z.string().min(2).max(48)).max(20).optional(),
    recipients: z.array(evmAddress).max(LEASH_LIMITS.recipients).optional(),
    maxSlippageBps: z.number().int().min(0).max(LEASH_LIMITS.maxSlippageBps).optional(),
    tools: z.array(toolSchema).max(LEASH_TOOLS.length).optional(),
    maxCalls: z.number().int().min(1).max(LEASH_LIMITS.maxCalls).optional(),
    tag: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.agent) !== Boolean(b.parentAgentId), "Send either agent (a new root agent) or parentAgentId (a sub-agent).")
  .refine((b) => !b.fence || b.template === "custom" || b.template === undefined, 'A Fence goes with template "custom".');

const planSchema = z
  .object({ text: z.string().min(1).max(500).optional(), actions: z.array(z.unknown()).max(12).optional(), dryRun: z.boolean().optional() })
  .refine((b) => (b.text === undefined) !== (b.actions === undefined), "Send either text or actions.");
const submitSchema = z.object({ intentId: z.string().regex(/^out_[A-Za-z0-9_-]{6,32}$/u), stepId: z.string().regex(/^s\d{1,2}$/u), hash: txHash });
const renewSchema = z.object({ budget: budget.optional(), expiresAt: z.string().max(40), recipients: z.array(evmAddress).max(LEASH_LIMITS.recipients).optional(), venues: z.array(z.string().min(2).max(48)).max(20).optional(), signer: evmAddress.optional() });

const ok = z.record(z.unknown());
documentRoutes([
  { method: "get", path: "/v1/leashes/templates", tag: "Leashes", summary: "Leash templates and the enforcement split", description: "pay-invoices, trade-small, earn and custom, with what LykiaAccount enforces on chain and what the API enforces.", auth: "public", response: ok },
  {
    method: "post",
    path: "/v1/leashes",
    tag: "Leashes",
    summary: "Put an agent on a leash",
    description:
      "One call: a Pack agent whose Fence is a strict subset of its parent's, a daily budget carved from the parent, the unsigned LykiaAccount session transaction (createSession from the owner, or createSubSession from the parent agent's session key) with per-token caps, payees, call rules, expiry and the Fence hash, a leash key shown once, a ready MCP config and optionally an ERC-8004 Tag registration. Owner only: a Lykia-Session, or a secret key with the agents scope that may act for the owner.",
    scope: "agents",
    auth: "secret",
    body: createLeashSchema,
    response: ok,
    status: 201,
    idempotent: true,
  },
  { method: "get", path: "/v1/leashes", tag: "Leashes", summary: "List an owner's leashes", description: "Each with live usage: spendable() and getLimit() read from the LykiaAccount are authoritative; Lykia's records count when larger.", scope: "read", auth: "secret", query: z.object({ owner: evmAddress.optional(), environment: environmentSchema.optional() }), response: ok },
  { method: "get", path: "/v1/leashes/:id", tag: "Leashes", summary: "One leash with usage", description: "The owner, or the leash's own key.", scope: "read", auth: "key", params: LeashParams, response: ok },
  { method: "get", path: "/v1/leashes/:id/trail", tag: "Leashes", summary: "Everything done under a leash", description: "Plans, denials and transactions, each cross-checked with the chain: chain-proven when the receipt succeeded, carries AgentCall or AgentTransfer for the session and its AgentMemo names the same intent, step and verdict. Session events Lykia has no record of are listed as source chain.", scope: "read", auth: "key", params: LeashParams, response: ok },
  { method: "post", path: "/v1/leashes/:id/session", tag: "Leashes", summary: "Bind the on-chain session", description: "With txHash: read from its SessionCreated event. Without: found among the session ids issued since the leash was made.", scope: "agents", auth: "secret", params: LeashParams, body: z.object({ txHash: txHash.optional() }), response: ok },
  { method: "post", path: "/v1/leashes/:id/revoke", tag: "Leashes", summary: "Revoke a leash", description: "The leash key stops working at once and the carve returns to the parent. Returns the unsigned revokeSession(id) for the owner's wallet; once signed the session and every sub-session under it end on chain.", scope: "agents", auth: "secret", params: LeashParams, response: ok },
  { method: "post", path: "/v1/leashes/:id/renew", tag: "Leashes", summary: "Renew a leash", description: "A new carve, a new session and a new key; the old leash is revoked. Never an increase in place.", scope: "agents", auth: "secret", params: LeashParams, body: renewSchema, response: ok, status: 201 },
  { method: "post", path: "/v1/leashes/:id/plan", tag: "Leashes", summary: "Plan inside a leash", description: "For the leash key. The Fence with the leash's own spend, the leash's total, spendable() per token and the session's call rules and payees on chain, then a simulation from the session key. Inside: the intent and its first step as one transaction for the session key. Outside: 422 LEASH_DENIED with reason codes and the remaining budget.", scope: "build", auth: "key", params: LeashParams, body: planSchema, response: ok },
  { method: "post", path: "/v1/leashes/:id/submit", tag: "Leashes", summary: "Report a signed leash step", description: "The hash of the transaction the session key sent. Checked against the prepared one, settled from its receipt, counted against the leash; the next step comes back prepared.", scope: "execute", auth: "key", params: LeashParams, body: submitSchema, response: ok },
]);

async function callerOf(ctx: AppContext, req: Request, owner: string): Promise<LeashCaller> {
  await authorizeOwner(ctx, req, owner);
  const key = keyOf(req);
  if (key) return { via: "secret", developer: key.owner.toLowerCase(), ...(key.projectId ? { projectId: key.projectId } : {}), project: projectOf(req) };
  return { via: "session", developer: owner.toLowerCase() };
}

async function ownerOf(ctx: AppContext, req: Request, named: string | undefined): Promise<Address> {
  // The named owner, else the signed-in address, else a secret key's own developer.
  const owner = named ?? (await sessionOf(ctx, req))?.address ?? (keyOf(req)?.kind === "secret" ? keyOf(req)?.owner : undefined);
  if (!owner) throw new LykiaHttpError("UNAUTHORIZED", 401, "Sign in as the owner (Lykia-Session), or name the owner with a key that may act for them.");
  return owner.toLowerCase() as Address;
}

export const leashModule: ApiModule = {
  name: "leash",
  register(router, ctx) {
    const s = () => leashService(ctx);
    /** The owner, or this leash's own key. */
    const mayRead = async (req: Request, leash: { id: string; owner: string }) => {
      if (keyOf(req)?.leashId === leash.id) return;
      if (await ownerProof(ctx, req, leash.owner)) return;
      throw new LykiaHttpError(keyOf(req) || (await sessionOf(ctx, req)) ? "FORBIDDEN" : "UNAUTHORIZED", keyOf(req) || (await sessionOf(ctx, req)) ? 403 : 401, "Only the owner or this leash's own key.");
    };

    router.get("/leashes/templates", (_req, res) => {
      res.json({ templates: Object.values(LEASH_TEMPLATES), enforcement: LEASH_ENFORCEMENT, limits: LEASH_LIMITS });
    });

    router.post("/leashes", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, createLeashSchema);
      const owner = await ownerOf(ctx, req, body.owner);
      const caller = await callerOf(ctx, req, owner);
      const created = await s().create(caller, {
        owner,
        environment: environmentOf(ctx, body.environment),
        ...(body.agent ? { agent: { name: body.agent.name, ...(body.agent.mission ? { mission: body.agent.mission } : {}), signer: body.agent.signer as Address } } : {}),
        ...(body.parentAgentId ? { parentAgentId: body.parentAgentId } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.signer ? { signer: body.signer as Address } : {}),
        template: body.template ?? (body.fence ? "custom" : "trade-small"),
        ...(body.fence ? { fence: body.fence as never } : {}),
        budget: body.budget,
        expiresAt: body.expiresAt,
        ...(body.venues ? { venues: body.venues } : {}),
        ...(body.recipients ? { recipients: body.recipients as Address[] } : {}),
        ...(body.maxSlippageBps !== undefined ? { maxSlippageBps: body.maxSlippageBps } : {}),
        ...(body.tools ? { tools: body.tools } : {}),
        ...(body.maxCalls ? { maxCalls: body.maxCalls } : {}),
        ...(body.tag ? { tag: true } : {}),
        publicBaseUrl: publicBaseUrl(req),
      });
      res.status(201).json(created);
    });

    router.get("/leashes", async (req, res) => {
      const query = parseQuery(req, z.object({ owner: evmAddress.optional(), environment: environmentSchema.optional() }));
      const owner = await ownerOf(ctx, req, query.owner);
      await authorizeOwner(ctx, req, owner);
      res.json({ leashes: await s().list(owner, query.environment) });
    });

    router.get("/leashes/:id", async (req, res) => {
      const { id } = parseParams(req, LeashParams);
      const leash = await s().get(id);
      await mayRead(req, leash);
      res.json(await s().view(leash));
    });

    router.get("/leashes/:id/trail", async (req, res) => {
      const { id } = parseParams(req, LeashParams);
      const leash = await s().get(id);
      await mayRead(req, leash);
      res.json(await s().trail(leash));
    });

    router.post("/leashes/:id/session", async (req, res) => {
      const { id } = parseParams(req, LeashParams);
      const body = parseBody(req, z.object({ txHash: txHash.optional() }));
      const leash = await s().get(id);
      await authorizeOwner(ctx, req, leash.owner);
      res.json(await s().view(await s().bind(leash, body.txHash)));
    });

    router.post("/leashes/:id/revoke", async (req, res) => {
      const { id } = parseParams(req, LeashParams);
      const leash = await s().get(id);
      await authorizeOwner(ctx, req, leash.owner);
      res.json(await s().revoke(leash));
    });

    router.post("/leashes/:id/renew", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, LeashParams);
      const body = parseBody(req, renewSchema);
      const leash = await s().get(id);
      const caller = await callerOf(ctx, req, leash.owner);
      res.status(201).json(await s().renew(caller, leash, { ...(body.budget ? { budget: body.budget } : {}), expiresAt: body.expiresAt, ...(body.recipients ? { recipients: body.recipients as Address[] } : {}), ...(body.venues ? { venues: body.venues } : {}), ...(body.signer ? { signer: body.signer as Address } : {}), publicBaseUrl: publicBaseUrl(req) }));
    });

    router.post("/leashes/:id/plan", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, LeashParams);
      const body = parseBody(req, planSchema);
      const leash = await s().get(id);
      await mayRead(req, leash);
      res.json(await s().plan(leash, { ...(body.text !== undefined ? { text: body.text } : { actions: actionsFrom(body.actions) }), ...(body.dryRun ? { dryRun: true } : {}) }));
    });

    router.post("/leashes/:id/submit", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, LeashParams);
      const body = parseBody(req, submitSchema);
      const leash = await s().get(id);
      await mayRead(req, leash);
      res.json(await s().submit(leash, { intentId: body.intentId, stepId: body.stepId, hash: body.hash }));
    });
  },
};
