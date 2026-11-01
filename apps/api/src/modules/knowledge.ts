/**
 * What Lykia knows, and the route search built on it.
 *
 *   GET  /knowledge                     every venue in brief, the token graph, earnable assets
 *   GET  /knowledge/venues/:venue       one venue in full: contracts (with addresses), functions (with selectors), reads, risk, capabilities
 *   GET  /knowledge/contracts/:address  which venue and contract an address is, and what Lykia may call on it
 *   GET  /knowledge/paths?from&to       ways to get from one asset to another over executable venues
 *   POST /routes/search                 the best route for a goal (sentence or actions), its alternatives, and the self-check
 */
import { fenceForProfile, getProtocol, KNOWLEDGE_ROWS, protocolsAt, tokensFor, tokenAddress, venueBrief, venueKnowledge, earnableAssets, type Address } from "@lykia/core";
import { toFunctionSelector } from "viem";
import { z } from "zod";
import { readSentence } from "../language/reader.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { getProfile } from "../personal/profile.js";
import { knowledgePaths } from "../engine/search.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { services } from "../services.js";
import { adapterRows, liveAdapters } from "../integrations/registry.js";
import { adapterKnowledge } from "../integrations/runtime.js";
import { actionsFrom, environmentOf, environmentQuery, environmentSchema, fenceFrom } from "./common.js";

function selector(abi: string): string | null {
  try {
    return toFunctionSelector(abi);
  } catch {
    return null;
  }
}

const searchSchema = z
  .object({
    owner: evmAddress,
    text: z.string().min(1).max(500).optional(),
    actions: z.array(z.unknown()).max(12).optional(),
    environment: environmentSchema.optional(),
    fence: z.unknown().optional(),
    appetite: z.enum(["low", "medium", "high"]).optional(),
    horizonDays: z.number().int().min(1).max(3650).optional(),
    simulate: z.boolean().optional(),
    maxCandidates: z.number().int().min(1).max(24).optional(),
    signer: z.enum(["wallet", "agent"]).optional(),
    agent: z.object({ address: evmAddress, agentId: z.string().regex(/^\d{1,30}$/u).optional() }).optional(),
    /** Store the best route as an intent (not a dry run), ready to prepare and sign. */
    plan: z.boolean().optional(),
    account: z.enum(["eoa", "smart"]).optional(),
  })
  .strict()
  .refine((b) => (b.text === undefined) !== (b.actions === undefined), { message: "Send either text or actions." });

export const knowledgeModule: ApiModule = {
  name: "knowledge",
  register(router, ctx) {
    router.get("/knowledge", async (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      // Approved and routable adapter manifests join the model at runtime (integrations/registry.ts).
      const adapters = await adapterRows(ctx).catch(() => []);
      res.json({
        environment,
        venues: [...KNOWLEDGE_ROWS.map((row) => ({ ...venueBrief(row), executableHere: EXECUTABLE_VENUES[environment].has(row.venue) })), ...adapters.map((row) => ({ ...venueBrief(row), executableHere: row.executable, source: "adapter-manifest" }))],
        tokens: tokensFor(environment).map((t) => ({ symbol: t.symbol, name: t.name, decimals: t.decimals, peg: t.peg, pricing: t.pricing, issuer: t.issuer, address: tokenAddress(t, environment) })),
        earnable: earnableAssets(KNOWLEDGE_ROWS),
        capabilities: KNOWLEDGE_ROWS.flatMap((r) => r.capabilities).length,
        notation: { token: "USDC", position: "USDC@morpho-vaults", debt: "debt:USDC@morpho-blue", remote: "USDC@cctp", gateway: "USDC@gateway", any: "*" },
      });
    });

    router.get("/knowledge/venues/:venue", async (req, res) => {
      const { venue } = parseParams(req, z.object({ venue: z.string().regex(/^[a-z0-9-]{2,48}$/u) }));
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      const adapter = venueKnowledge(venue) ? null : (await liveAdapters(ctx).catch(() => [])).find((a) => a.id === venue) ?? null;
      const row = venueKnowledge(venue) ?? (adapter ? adapterKnowledge(adapter.manifest, adapter.status === "routable") : null);
      if (!row) throw new LykiaHttpError("NOT_FOUND", 404, `Lykia has no knowledge row for ${venue}.`);
      const addresses = adapter ? (adapter.manifest.contracts[environment] ?? {}) : (getProtocol(venue)?.deployments[environment]?.contracts ?? {});
      res.json({
        environment,
        ...row,
        executableHere: adapter ? adapter.status === "routable" : EXECUTABLE_VENUES[environment].has(venue),
        contracts: row.contracts.map((c) => ({ ...c, address: (addresses as Record<string, Address>)[c.key] ?? null })),
        functions: row.functions.map((f) => ({ ...f, selector: selector(f.abi) })),
        reads: row.reads.map((r) => ({ ...r, selector: selector(r.abi) })),
      });
    });

    router.get("/knowledge/contracts/:address", (req, res) => {
      const { address } = parseParams(req, z.object({ address: evmAddress }));
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      const hits = protocolsAt(address, environment).map(({ protocol, name }) => {
        const row = venueKnowledge(protocol.id);
        const functions = (row?.functions ?? []).filter((f) => f.contract === name).map((f) => ({ id: f.id, abi: f.abi, selector: selector(f.abi), purpose: f.purpose }));
        const reads = (row?.reads ?? []).filter((r) => r.contract === name).map((r) => ({ id: r.id, abi: r.abi, selector: selector(r.abi), purpose: r.purpose }));
        return { venue: protocol.id, name: protocol.name, contract: name, role: row?.contracts.find((c) => c.key === name)?.role ?? null, functions, reads, known: row !== null };
      });
      const token = tokensFor(environment).find((t) => tokenAddress(t, environment)?.toLowerCase() === address.toLowerCase());
      if (hits.length === 0 && !token) throw new LykiaHttpError("NOT_FOUND", 404, "That address is not a contract Lykia knows on this environment.");
      res.json({ environment, address, contracts: hits, ...(token ? { token: { symbol: token.symbol, name: token.name, decimals: token.decimals, peg: token.peg } } : {}) });
    });

    router.get("/knowledge/paths", (req, res) => {
      const q = parseQuery(req, z.object({ from: z.string().min(2).max(40), to: z.string().min(2).max(40), maxHops: z.coerce.number().int().min(1).max(4).optional() }));
      res.json({ from: q.from, to: q.to, paths: knowledgePaths(q.from, q.to, q.maxHops ?? 3) });
    });

    router.post("/routes/search", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, searchSchema);
      const owner = body.owner as Address;
      const profile = await getProfile(ctx, owner);
      let actions;
      let source: string;
      if (body.text !== undefined) {
        const parsed = readSentence(body.text);
        if (parsed.clarify.length > 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.clarify.join(" "), { clarify: parsed.clarify, clarifyChoices: parsed.clarifyChoices ?? [] });
        if (parsed.actions.length === 0) throw new LykiaHttpError("NOT_UNDERSTOOD", 422, parsed.reply);
        actions = parsed.actions;
        source = body.text;
      } else {
        actions = actionsFrom(body.actions);
        source = JSON.stringify(actions).slice(0, 500);
      }
      const environment = body.environment ? environmentOf(ctx, body.environment) : profile.updatedAt ? profile.defaultNetwork : environmentOf(ctx, undefined);
      const fence = fenceFrom(body.fence) ?? fenceForProfile(profile);
      const preferences = { favorites: profile.venues.favorites, blocked: profile.venues.blocked, maxRisk: profile.risk };
      const s = services(ctx);
      const result = await s.search.search({
        environment,
        owner,
        actions,
        fence,
        source,
        preferences,
        spent: await s.intents.spent(environment, owner),
        ...(body.appetite ? { appetite: body.appetite } : {}),
        ...(body.horizonDays ? { horizonDays: body.horizonDays } : {}),
        ...(body.simulate !== undefined ? { simulate: body.simulate } : {}),
        ...(body.maxCandidates ? { maxCandidates: body.maxCandidates } : {}),
        ...(body.signer ? { signer: body.signer } : {}),
        ...(body.agent ? { agent: body.agent as { address: Address; agentId?: string } } : {}),
      });
      let intent: unknown = null;
      if (body.plan && result.best) {
        intent = await s.intents.create({ environment, owner, actions: result.best.actions, source, fence, preferences, ...(body.account ? { account: body.account } : {}), ...(body.signer ? { signer: body.signer } : {}), ...(body.agent ? { agent: body.agent as { address: Address; agentId?: string } } : {}) });
      }
      res.json({ ...result, actions, ...(intent ? { intent } : {}) });
    });
  },
};
