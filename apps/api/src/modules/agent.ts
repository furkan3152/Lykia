/**
 * Lyko and the Pack.
 *
 *   POST /agent/chat                     SSE: thread, reading, task, tool, step, block, thinking-summary, proposal, clarify, draft, text, error, done
 *                                        (Accept: application/json returns the same events as one JSON document)
 *   GET  /agent/threads?owner            thread list (owner session or agents key)   GET /agent/threads/:id?owner   one thread
 *   POST /agent/threads                  open an empty thread
 *   GET  /agent/insights?owner&environment
 *   GET  /agent/automations?owner (owner session or agents key)   POST /agent/automations   POST /agent/automations/:id/(enable|disable)
 *   POST /agent/automations/run          evaluate the owner's automations now (proposals only)
 *   POST /agent/check                    a Fence verdict for an agent's own facts
 *
 *   GET  /pack?owner&environment         the owner's agent tree with budgets
 *   POST /pack                           create a root agent
 *   GET  /pack/:id                       POST /pack/:id/spawn   POST /pack/:id/revoke (cascades)
 *   POST /pack/:id/(pause|resume)        GET /pack/:id/budget
 *   POST /pack/:id/session-tx            unsigned LykiaAccount createSession / createSubSession
 *   POST /pack/:id/session               record the session once the transaction landed
 *   POST /pack/whistle                   the Whistle (same as POST /v1/whistle) + unsigned blowWhistle() + whistle.blown webhook
 *
 * Writes to the Pack need a Lykia-Session for the owner, or a secret API
 * key with the agents scope (a developer acting for its users). Nothing
 * here signs or moves funds.
 */
import { LOCALES } from "@lykia/core";
import { englishOf, localizeOut, nextLabel } from "../i18n/index.js";
import { ownerFence } from "../personal/fence.js";
import { DEFAULT_FENCE, evaluateFence, PACK_ROLES, type Address, type ArcEnvironment, type FenceFacts, type PackAgent, type PackRole } from "@lykia/core";
import type { Request, Response } from "express";
import { encodeFunctionData, type Hex } from "viem";
import { z } from "zod";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { openSse } from "../http/sse.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { agentServices } from "../agents/index.js";
import { publicPackView } from "../agents/pack.js";
import { readSentence } from "../language/reader.js";
import { projectFence, projectPromptBlock, tightenFence } from "@lykia/core";
import { projectOf } from "../platform/projects.js";
import { createAutomation, listAutomations, ownerFenceOf, runAutomations, setAutomationEnabled } from "../agents/automations.js";
import { chatTurn } from "../agents/chat.js";
import type { ThreadMessage } from "@lykia/core/api/agents";
import { insightsFor } from "../agents/insights.js";
import { createProposal } from "../fold/proposals.js";
import { appendMessages, getThread, listThreads, openThread } from "../agents/memory.js";
import { buildSessionTx, lykiaAccountFor } from "../agents/onchain.js";
import type { Emit } from "../agents/orchestrator.js";
import { flags } from "../platform/admin.js";
import { sessionOf } from "../platform/session.js";
import { sharedLimit } from "../http/sharedLimits.js";
import { authorizeOwner, environmentOf, environmentSchema, fenceFrom, ownerProof } from "./common.js";
import { factsSchema } from "./fence.js";
import { leashService } from "../leash/service.js";
import { blowWhistle } from "../whistle/service.js";

import { tx } from "@lykia/core";
const ownerQuery = z.object({ owner: evmAddress, environment: environmentSchema.optional() });
const idParams = z.object({ id: z.string().min(8).max(120) });
const roleSchema = z.enum(PACK_ROLES as unknown as [PackRole, ...PackRole[]]);

/** The address sample plans are made for when no wallet is connected; plans for it are always dry runs. */
export const SAMPLE_OWNER = "0x000000000000000000000000000000000000dEaD";

const BLOW_WHISTLE_ABI = [{ type: "function", name: "blowWhistle", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const;

export const agentModule: ApiModule = {
  name: "agent",
  register(router, ctx) {
    const s = () => agentServices(ctx);
    // Counted across every instance (the heavy bucket counts per process): chat can reach the model provider.
    const shared = sharedLimit(ctx, "chat", ctx.config.rateLimits.sharedPerMinute ?? 20);

    router.post("/agent/chat", ctx.limits.heavy, shared, async (req: Request, res: Response) => {
      const body = parseBody(
        req,
        z.object({
          message: z.string().min(1).max(4_000).optional(),
          messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4_000) })).min(1).max(30).optional(),
          owner: evmAddress.optional(),
          environment: environmentSchema.optional(),
          threadId: z.string().max(120).optional(),
          fence: z.unknown().optional(),
          origin: z.enum(["ask", "fold"]).optional(),
          context: z.string().max(1_000).optional(),
          locale: z.enum(LOCALES).optional(),
        }),
      );
      const message = body.message ?? body.messages?.[body.messages.length - 1]?.content;
      const watching = body.origin === "fold";
      if (!message) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send a message.");
      const environment = environmentOf(ctx, body.environment);
      const session = await sessionOf(ctx, req);
      const named = ((body.owner as string | undefined) ?? session?.address ?? null) as Address | null;
      // Without a wallet Lyko still plans, as a clearly labelled dry run for a sample address.
      // Clients that send the sample address themselves get the same treatment.
      const realOwner = named && named.toLowerCase() === SAMPLE_OWNER.toLowerCase() ? null : named;
      const sample = realOwner === null;
      const owner = (realOwner ?? SAMPLE_OWNER) as Address;
      // Tools that save state (alerts, automations) save only for an owner this request proved control of.
      const proof = await ownerProof(ctx, req, realOwner);
      // Through a project key: the project's Fence is the default, and its caps and modules tighten any Fence.
      const project = projectOf(req);
      // Private state (profile, memory, the Pack's names and missions, saved threads) is used only for a proven owner.
      const proven = proof !== null ? realOwner : null;
      // The Fence is the server's: the project's through a project key, else the proven owner's own (GET /v1/me/fence),
      // else the Balanced preset. A Fence in the request is ignored (the field stays in the schema for older clients).
      const ownFence = project ? projectFence(project) : proven ? await ownerFence(ctx, proven) : DEFAULT_FENCE;
      const baseFence = project ? tightenFence(ownFence, project) : ownFence;
      const fence = sample ? { ...baseFence, mode: "dry-run" as const } : baseFence;
      const pack = proven ? (await s().pack.ownedBy(proven, environment)).filter((a) => a.status === "active") : [];
      // Unproven chats live in anonymous threads: a thread under an owner's prefix holds that owner's conversation.
      const thread = await openThread(ctx, proven, environment, body.threadId, message);
      // The Fold's sample flock is a fixture: what Lyko on watch says about it never enters a thread Ask Lyko reads.
      const fixtureTurn = watching && sample;
      const now = new Date(ctx.clock.now()).toISOString();
      const stored: readonly ThreadMessage[] = fixtureTurn ? [] : thread.messages.length > 0 ? thread.messages : (body.messages ?? []).slice(0, -1).map((m) => ({ role: m.role, text: m.content, at: now }));
      const client = (await flags(ctx))["agents.llm"] ? s().llm() : null;
      // A chip tapped in the owner's language is read as the sentence behind it.
      const lastAsked = [...stored].reverse().find((m) => m.role === "assistant");
      const tapped = lastAsked?.shown?.indexOf(message.trim()) ?? -1;
      const asked = tapped >= 0 && lastAsked?.options?.[tapped] ? lastAsked.options[tapped]! : message;

      // SSE unless the client asks for JSON, or uses the original `messages` contract without asking for a stream.
      const accept = req.get("accept") ?? "";
      const wantsJson = !accept.includes("text/event-stream") && (accept.includes("application/json") || body.message === undefined);
      const events: { event: string; data: unknown }[] = [];
      const blocks: unknown[] = [];
      const stream = wantsJson ? null : openSse(req, res, { slots: ctx.limits.streams });
      const emit: Emit = (event, raw) => {
        // Known phrases (card labels, status words, constants) leave in the request's language.
        const labelled = event === "text" && raw && typeof (raw as { text?: unknown }).text === "string" ? { ...(raw as Record<string, unknown>), text: nextLabel((raw as { text: string }).text) } : raw;
        const data = localizeOut(labelled);
        events.push({ event, data });
        if (event === "block") blocks.push(data);
        stream?.send(event, data);
      };
      emit("thread", { threadId: thread.id, mode: client ? "llm" : "reader", ...(sample ? { sample: true } : {}), ...(watching ? { origin: "fold" } : {}), ...(fixtureTurn ? { fixture: true } : {}) });
      // No wallet: the answer is about a sample, and says so in its first line and on a card (agents/chat.ts).
      if (sample) emit("notice", { kind: "sample", text: watching ? "No wallet connected: these figures are the Fold's sample flock, not read from Arc." : `No wallet connected: reads and plans here are for a sample address (${SAMPLE_OWNER}), not your wallet. Connect a wallet to see and plan your own.` });
      let text = "";
      let proposals: readonly unknown[] = [];
      let stopReason: string;
      let meant: string | null = null;
      let options: readonly string[] = [];
      try {
        const appContext = project ? projectPromptBlock(project) : "";
        const result = await chatTurn({ ctx, client, environment, owner, proof, fence, pack, thread: stored, message: asked, origin: watching ? "fold" : "ask", emit, threadId: thread.id, personal: proven !== null, ...(body.context ? { context: body.context } : {}), ...(appContext ? { appContext } : {}) });
        // The "**Next:**" label is written once in code and shown in the request's language.
        text = nextLabel(result.text);
        proposals = result.proposals;
        stopReason = result.stopReason;
        meant = result.meant;
        options = result.options;
      } catch (error) {
        stopReason = "error";
        const failure = error instanceof LykiaHttpError ? { code: error.code, message: error.message } : { code: "AGENT_FAILED", message: tx("Lyko could not finish this turn. Try again shortly.") };
        ctx.log.warn("agent turn failed", { code: failure.code, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
        emit("error", failure);
      }
      if (!fixtureTurn) {
        await appendMessages(ctx, thread, [
          { role: "user", text: message, origin: body.origin ?? "ask", meant },
          // The chips are kept as the English sentences the reader understands, and as the owner saw them.
          { role: "assistant", text: text || tx("(no answer)"), proposals: proposals as never, blocks: blocks as never, origin: body.origin ?? "ask", options: options.map(englishOf), shown: options, english: englishOf(text) },
        ]).catch(() => undefined);
      }
      emit("done", { threadId: thread.id, stopReason });
      if (stream) stream.close();
      else {
        const parsed = readSentence(message);
        res.json({ threadId: thread.id, mode: client ? "llm" : "reader", reply: text, proposals, stopReason, events, command: parsed.command, easterEgg: parsed.easterEgg });
      }
    });

    router.get("/agent/threads", async (req, res) => {
      const { owner } = parseQuery(req, ownerQuery);
      // Titles are the owner's own words and the ids open whole conversations: only the owner lists them.
      await authorizeOwner(ctx, req, owner);
      res.json({ threads: await listThreads(ctx, owner as Address) });
    });
    router.get("/agent/threads/:id", async (req, res) => {
      const { owner } = parseQuery(req, ownerQuery);
      const { id } = parseParams(req, idParams);
      // A thread holds the owner's whole conversation: only the owner reads it.
      await authorizeOwner(ctx, req, owner);
      res.json(await getThread(ctx, owner as Address, id));
    });
    router.post("/agent/threads", async (req, res) => {
      const body = parseBody(req, z.object({ owner: evmAddress, environment: environmentSchema.optional(), title: z.string().min(1).max(80).optional() }));
      await authorizeOwner(ctx, req, body.owner);
      res.status(201).json(await openThread(ctx, body.owner as Address, environmentOf(ctx, body.environment), undefined, body.title ?? tx("New thread")));
    });

    router.get("/agent/insights", ctx.limits.heavy, async (req, res) => {
      const { owner, environment } = parseQuery(req, ownerQuery);
      res.json(await insightsFor(ctx, environmentOf(ctx, environment), owner as Address));
    });

    router.get("/agent/automations", async (req, res) => {
      const { owner } = parseQuery(req, ownerQuery);
      await authorizeOwner(ctx, req, owner);
      res.json({ automations: await listAutomations(ctx, owner as Address) });
    });
    router.post("/agent/automations", async (req, res) => {
      const body = parseBody(
        req,
        z.object({
          owner: evmAddress,
          environment: environmentSchema.optional(),
          agentId: z.string().max(120).nullable().optional(),
          when: z.union([z.object({ insight: z.enum(["idle-cash", "concentration", "health-factor", "fx-exposure", "stale-approval", "scent-warning", "unpriced", "low-gas"]) }), z.object({ everyMinutes: z.number().int().min(15).max(10_080) })]),
          sentence: z.string().min(3).max(400),
          mode: z.enum(["propose", "session"]).default("propose"),
          maxRunsPerDay: z.number().int().min(1).max(6).optional(),
        }),
      );
      await authorizeOwner(ctx, req, body.owner);
      res.status(201).json(await createAutomation(ctx, s().pack, { owner: body.owner as Address, environment: environmentOf(ctx, body.environment), agentId: body.agentId ?? null, when: body.when, sentence: body.sentence, mode: body.mode, ...(body.maxRunsPerDay ? { maxRunsPerDay: body.maxRunsPerDay } : {}) }));
    });
    for (const action of ["enable", "disable"] as const) {
      router.post(`/agent/automations/:id/${action}`, async (req, res) => {
        const { id } = parseParams(req, idParams);
        const { owner } = parseBody(req, z.object({ owner: evmAddress }));
        await authorizeOwner(ctx, req, owner);
        res.json(await setAutomationEnabled(ctx, owner as Address, id, action === "enable"));
      });
    }
    router.post("/agent/automations/run", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, z.object({ owner: evmAddress, environment: environmentSchema.optional() }));
      await authorizeOwner(ctx, req, body.owner);
      const environment = environmentOf(ctx, body.environment);
      const fired: Promise<unknown>[] = [];
      // Agent automations run under the owner's own Fence (their profile and preferences), never a default one.
      const ownerFence = await ownerFenceOf(ctx, body.owner as Address);
      const runs = await runAutomations(ctx, s().pack, body.owner as Address, environment, (a, p) => {
        void s().webhooks.emit("standing_order.fired", a.owner, { automationId: a.id, intentId: p.intentId, decision: p.decision, steps: [...p.steps] }).catch(() => undefined);
        // What an automation produced waits in the Fold's Herding inbox for a signature, instead of vanishing.
        fired.push(createProposal(ctx, { owner: a.owner, environment, fence: ownerFence, source: { kind: "automation", ref: a.id }, title: a.sentence, planned: { intentId: p.intentId, decision: p.decision, reasons: p.reasons, steps: p.steps } }).catch(() => undefined));
      }, ownerFence);
      await Promise.all(fired);
      res.json({ runs });
    });

    router.post("/agent/check", (req, res) => {
      const body = parseBody(req, z.object({ fence: z.unknown().optional(), facts: factsSchema }));
      const fence = fenceFrom(body.fence) ?? DEFAULT_FENCE;
      res.json(evaluateFence(fence, { ...body.facts, now: body.facts.now ?? ctx.clock.now() } as FenceFacts));
    });

    /* ------------------------------------------------------------ Pack */

    // Public: what a chain explorer shows. Names, missions, Fences and budgets only for the proven owner.
    router.get("/pack", async (req, res) => {
      const { owner, environment } = parseQuery(req, ownerQuery);
      const agents = await s().pack.tree(owner, environment);
      if (await ownerProof(ctx, req, owner)) return void res.json({ agents, redacted: false });
      res.json({ agents: agents.map(publicPackView), redacted: true });
    });

    router.post("/pack", async (req, res) => {
      const body = parseBody(
        req,
        z.object({
          owner: evmAddress,
          environment: environmentSchema.optional(),
          name: z.string().min(1).max(48),
          role: roleSchema,
          fence: z.unknown().optional(),
          mission: z.string().max(400).optional(),
          signer: evmAddress.optional(),
          agentId: z.string().regex(/^\d{1,30}$/u).optional(),
        }),
      );
      await authorizeOwner(ctx, req, body.owner);
      const fence = fenceFrom(body.fence);
      const agent = await s().pack.create({
        owner: body.owner as Address,
        environment: environmentOf(ctx, body.environment),
        name: body.name,
        role: body.role,
        ...(fence ? { fence } : {}),
        ...(body.mission ? { mission: body.mission } : {}),
        ...(body.signer ? { signer: body.signer as Address } : {}),
        ...(body.agentId ? { agentId: body.agentId } : {}),
      });
      res.status(201).json(await s().pack.view(agent.id));
    });

    router.post("/pack/whistle", async (req, res) => {
      const body = parseBody(req, z.object({ owner: evmAddress, environment: environmentSchema.optional(), account: evmAddress.optional(), by: z.string().max(120).optional(), reason: z.string().max(300).optional() }));
      await authorizeOwner(ctx, req, body.owner);
      const environment = environmentOf(ctx, body.environment);
      let by: PackAgent | null = null;
      if (body.by) {
        by = await s().pack.get(body.by);
        if (by.owner !== body.owner.toLowerCase() || !by.capabilities.includes("whistle")) throw new LykiaHttpError("FORBIDDEN", 403, "That agent may not blow the whistle for this owner.");
      }
      // One Whistle: the same server-side stop as POST /v1/whistle (automations, standing orders, agent automations,
      // Pack agents, leashes and Autopilot), plus blowWhistle() for the account named here or the owner's LykiaAccount.
      const whistle = await blowWhistle(ctx, body.owner as Address, environment, body.reason ?? (by ? tx("blown by {name}", { name: by.name }) : undefined));
      const transaction = body.account
        ? { chainId: environment === "mainnet" ? 5042 : 5042002, from: (by?.signer ?? body.owner) as Address, to: body.account as Address, data: encodeFunctionData({ abi: BLOW_WHISTLE_ABI, functionName: "blowWhistle" }) as Hex, value: "0", label: tx("Blow the whistle on the LykiaAccount") }
        : whistle.transaction;
      const autopilot = whistle.items.find((i) => i.kind === "autopilot" && i.environment === environment && i.state === "paused");
      res.json({ transaction, whistle, autopilot: autopilot ? { stopped: true, paused: true } : null, note: whistle.note });
    });

    router.get("/pack/account", async (req, res) => {
      const query = parseQuery(req, z.object({ owner: evmAddress, environment: z.enum(["mainnet", "testnet"]).optional(), guardian: evmAddress.optional() }));
      const environment = (query.environment ?? ctx.config.mode) as ArcEnvironment;
      const info = await lykiaAccountFor(ctx, query.owner as Address, environment, (query.guardian ?? undefined) as Address | undefined);
      if (!info) throw new LykiaHttpError("NOT_FOUND", 404, `LykiaAccountFactory is not deployed on Arc ${environment}.`);
      res.json(info);
    });

    router.get("/pack/:id", async (req, res) => {
      const { id } = parseParams(req, idParams);
      const view = await s().pack.view(id);
      res.json((await ownerProof(ctx, req, view.owner)) ? view : publicPackView(view));
    });

    router.get("/pack/:id/budget", async (req, res) => {
      const { id } = parseParams(req, idParams);
      const view = await s().pack.view(id);
      await authorizeOwner(ctx, req, view.owner);
      res.json(view.budget);
    });

    router.post("/pack/:id/spawn", async (req, res) => {
      const { id } = parseParams(req, idParams);
      const body = parseBody(req, z.object({ name: z.string().min(1).max(48), role: roleSchema, fence: z.unknown().optional(), mission: z.string().max(400).optional(), signer: evmAddress.optional(), agentId: z.string().regex(/^\d{1,30}$/u).optional() }));
      const parent = await s().pack.get(id);
      await authorizeOwner(ctx, req, parent.owner);
      const fence = fenceFrom(body.fence);
      const child = await s().pack.spawn(id, {
        name: body.name,
        role: body.role,
        ...(fence ? { fence } : {}),
        ...(body.mission ? { mission: body.mission } : {}),
        ...(body.signer ? { signer: body.signer as Address } : {}),
        ...(body.agentId ? { agentId: body.agentId } : {}),
      });
      res.status(201).json(await s().pack.view(child.id));
    });

    router.post("/pack/:id/revoke", async (req, res) => {
      const { id } = parseParams(req, idParams);
      const agent = await s().pack.get(id);
      await authorizeOwner(ctx, req, agent.owner);
      const revoked = await s().pack.revoke(id, agent.owner);
      // A leash on any of these agents ends with it: its key stops at once.
      await leashService(ctx).revokeForAgents(agent.owner, revoked.map((a) => a.id));
      res.json({ revoked: revoked.map((a) => a.id), note: revoked.some((a) => a.session) ? tx("Agents with on-chain sessions: also send revokeSession on the LykiaAccount (a parent's revocation already invalidates its sub-sessions there).") : null });
    });

    for (const action of ["pause", "resume"] as const) {
      router.post(`/pack/:id/${action}`, async (req, res) => {
        const { id } = parseParams(req, idParams);
        const agent = await s().pack.get(id);
        await authorizeOwner(ctx, req, agent.owner);
        res.json(await s().pack.setStatus(id, agent.owner, action === "pause" ? "paused" : "active"));
      });
    }

    router.post("/pack/:id/session-tx", async (req, res) => {
      const { id } = parseParams(req, idParams);
      const body = parseBody(
        req,
        z.object({
          // Optional: without it, the owner's LykiaAccount on the deployed factory is used (created first if needed).
          account: evmAddress.optional(),
          key: evmAddress.optional(),
          validDays: z.number().int().min(1).max(365).default(30),
          maxCalls: z.number().int().min(1).max(100_000).default(500),
          calls: z.array(z.object({ target: evmAddress, selector: z.string().regex(/^0x[0-9a-fA-F]{8}$/u), receiverWords: z.number().int().min(0).max(0xffffffff), homeward: z.boolean() })).max(32).optional(),
        }),
      );
      const agent = await s().pack.get(id);
      await authorizeOwner(ctx, req, agent.owner);
      if (!(await flags(ctx))["pack.onchain"]) throw new LykiaHttpError("FORBIDDEN", 403, "On-chain sessions are switched off on this server.");
      if (agent.status !== "active") throw new LykiaHttpError("CONFLICT", 409, `${agent.name} is ${agent.status}.`);
      const key = (body.key ?? agent.signer) as Address | undefined;
      if (!key) throw new LykiaHttpError("INVALID_REQUEST", 400, "Give the session key address (the agent's signer).");
      const parent = agent.parentId ? await s().pack.get(agent.parentId) : null;
      const lykiaAccount = body.account ? null : await lykiaAccountFor(ctx, agent.owner as Address, agent.environment as ArcEnvironment);
      if (!body.account && !lykiaAccount) throw new LykiaHttpError("INVALID_REQUEST", 400, "LykiaAccountFactory is not deployed on this environment; pass the account address.");
      const account = (body.account ?? lykiaAccount?.address) as Address;
      const built = await buildSessionTx(ctx, { agent, parent, account, key, validDays: body.validDays, maxCalls: body.maxCalls, ...(body.calls ? { calls: body.calls as never } : {}) }, agent.environment as ArcEnvironment);
      res.json({
        agentId: agent.id,
        limits: { fenceHash: agent.fenceHash, maxPerTxUnits: built.spec.tokens[0]?.perCall.toString() ?? "0", maxPerDayUnits: built.spec.tokens[0]?.daily.toString() ?? "0", expiresAt: Number(built.spec.validUntil), whistle: agent.fence.mode === "whistle" },
        spec: JSON.parse(JSON.stringify(built.spec, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))),
        account,
        // Send first when present: creates the owner's LykiaAccount on the deployed factory.
        accountTransaction: lykiaAccount?.transaction ?? null,
        transaction: built.transaction,
        note: built.note,
      });
    });

    router.post("/pack/:id/session", async (req, res) => {
      const { id } = parseParams(req, idParams);
      const body = parseBody(req, z.object({ account: evmAddress, sessionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/u), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/u).optional() }));
      const agent = await s().pack.get(id);
      await authorizeOwner(ctx, req, agent.owner);
      res.json(await s().pack.bindSession(id, { account: body.account as Address, sessionId: body.sessionId, ...(body.txHash ? { txHash: body.txHash as `0x${string}` } : {}) }));
    });
  },
};
