/**
 * The Fold: everything an owner holds and everything in motion, and Lyko on
 * watch, the portfolio assistant docked beside it.
 *
 *   GET  /fold/insights/:address          deterministic insights (+ handled flags and the morning brief for the owner)
 *   POST /fold/seen                       the owner saw the brief; the next one lists only what changed after now
 *   GET  /fold/summary/:address           the Fold bar: today's spend, caps, counts
 *   GET  /fold/instructions?owner         Herding: every standing instruction + proposals waiting for a signature
 *   GET  /fold/proposals?owner&status     proposals (reconciled with their plans)
 *   POST /fold/proposals                  draft one (from an insight, a holding, a chat, a Fence edit)
 *   POST /fold/proposals/:id/(approve|done|stop)
 *   GET  /fold/feed?owner                 every proposal transition, 30 days
 *   GET  /fold/trails?owner               Trails: settled steps with memo, verdict and fee; plans; failures; refusals
 *   GET  /fold/explain?owner&question     a structured artifact (yield, whatif, week, approvals)
 *   GET  /fold/whatif/:address            the shared shock model on the live Flock
 *   GET  /fold/positions/:address         every position in every venue Lykia supports (?venues= to read some)
 *   POST /fold/answer                     a follow-up chip, answered and written to the shared thread
 *   GET|PUT|DELETE /me/preferences        "Your Lyko" (backed by the owner's memory and profile)
 *   GET  /me/threads                      the shared threads (Ask Lyko and Lyko on watch write to the same ones)
 *
 * Personal routes need the owner's SIWE session (or a secret key with the
 * agents scope). Nothing here signs or moves funds: drafts are plans under
 * the owner's Fence, with Lykia's fee and the beta cap, for the owner to sign.
 */
import { DEFAULT_FENCE, FOLD_INSIGHT_KINDS, isSampleOwner, POSITION_STATES, POSITION_VENUES, fenceForProfile, foldPreferenceEffects, NO_SHOCK, riskTierOf, type Address, type FoldShocks } from "@lykia/core";
import type { FoldSummaryResponse, PreferencesResponse } from "@lykia/core/api/fold";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { agentServices } from "../agents/index.js";
import { threadSummaries } from "../agents/memory.js";
import { answer, explain, whatIfFor } from "../fold/answers.js";
import { foldInsights, markSeen } from "../fold/insights.js";
import { readPositions } from "../positions/service.js";
import { instructionsView } from "../fold/instructions.js";
import { getPreferences, resetPreferences, updatePreferences } from "../fold/preferences.js";
import { createProposal, getProposal, listFeed, listProposals, moveProposal } from "../fold/proposals.js";
import { trailsFor } from "../fold/trails.js";
import { getProfile } from "../personal/profile.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { sessionAddress } from "../platform/session.js";
import { services } from "../services.js";
import { authorizeOwner, environmentOf, environmentSchema, fenceFrom, ownerProof } from "./common.js";

const AddressParams = z.object({ address: evmAddress });
const OwnerQuery = z.object({ owner: evmAddress, environment: environmentSchema.optional() });
const ProposalParams = z.object({ id: z.string().regex(/^0x[0-9a-f]{40}:prp_[0-9a-f]{12}$/u) });
const statusSchema = z.enum(["proposed", "approved", "done", "stopped"]);
const questionSchema = z.enum(["yield", "whatif", "week", "approvals"]);
const shockSchema = z.object({ EURC: z.number().min(-90).max(90).default(0), cirBTC: z.number().min(-90).max(90).default(0), ratesBps: z.number().int().min(-1000).max(1000).default(0) });
const createBody = z.object({
  owner: evmAddress,
  environment: environmentSchema.optional(),
  source: z.object({ kind: z.enum(["insight", "chat", "fence", "holding"]), ref: z.string().max(120).nullable().default(null) }),
  title: z.string().min(1).max(160).optional(),
  sentence: z.string().min(3).max(400).optional(),
  fencePatch: z.record(z.unknown()).optional(),
  fence: z.unknown().optional(),
});
const moveBody = z.object({ owner: evmAddress, note: z.string().max(200).optional() });
const preferencesPatch = z.record(z.unknown());

const insight = z.object({ id: z.string(), kind: z.enum(FOLD_INSIGHT_KINDS as unknown as [string, ...string[]]), severity: z.enum(["info", "watch", "act"]), title: z.string(), explain: z.string(), figures: z.array(z.object({ label: z.string(), value: z.string() })), draft: z.object({ label: z.string(), sentence: z.string().nullable() }).passthrough().nullable(), handled: z.boolean() });
const proposal = z.object({ id: z.string(), owner: z.string(), status: statusSchema, title: z.string(), sentence: z.string().nullable(), intentId: z.string().nullable(), decision: z.string(), reasons: z.array(z.string()), steps: z.array(z.string()) }).passthrough();
const instruction = z.object({ id: z.string(), source: z.string(), sourceLabel: z.string(), name: z.string(), status: z.string(), trigger: z.string(), nextRunAt: z.string().nullable(), nextRunLabel: z.string(), lastRunAt: z.string().nullable(), lastResult: z.string().nullable(), controllable: z.boolean(), editSentence: z.string() }).passthrough();
const artifact = z.object({ kind: questionSchema, title: z.string(), summary: z.string(), lines: z.array(z.object({ label: z.string(), value: z.string(), note: z.string().nullable() })), sources: z.array(z.string()), at: z.string() });

const positionAsset = z.object({ symbol: z.string(), token: z.string().nullable(), amount: z.string(), valueUsd: z.string().nullable(), role: z.string() });
const position = z
  .object({
    id: z.string(),
    venue: z.string(),
    venueName: z.string(),
    venueKind: z.string(),
    label: z.string(),
    assets: z.array(positionAsset),
    amount: z.string(),
    symbol: z.string(),
    valueUsd: z.string().nullable().describe("Signed USD value (debt is negative); null when unpriced, never zero"),
    counts: z.enum(["net", "overlay"]).describe("overlay: money already counted elsewhere (orders, scheduled payments)"),
    state: z.enum(POSITION_STATES as unknown as [string, ...string[]]),
    doing: z.string().describe("What the position is doing, in one plain line"),
    apy: z.object({ percent: z.string(), kind: z.string(), source: z.string() }).optional(),
    earned: z.object({ usd: z.string(), since: z.string(), method: z.string() }).optional(),
    health: z.object({ factor: z.string().nullable(), liquidationAtPercent: z.string().nullable(), ltvPercent: z.string().nullable(), floor: z.string() }).optional(),
    range: z.object({ tickLower: z.number(), tickUpper: z.number(), tick: z.number(), lower: z.string(), upper: z.string(), price: z.string(), quote: z.string(), inRange: z.boolean() }).optional(),
    fees: z.object({ assets: z.array(positionAsset), valueUsd: z.string().nullable(), method: z.string() }).optional(),
    collateral: z.boolean().optional(),
    since: z.string().nullable().optional(),
    facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    actions: z.array(z.object({ kind: z.string(), label: z.string(), sentence: z.string(), mode: z.enum(["draft", "ask"]) })),
    source: z.enum(["chain", "api", "history"]),
    readAt: z.string(),
    block: z.string().nullable(),
    explorer: z.string().nullable(),
  })
  .passthrough();
const venueRead = z.object({ venue: z.string(), venueName: z.string(), venueKind: z.string(), status: z.enum(["ok", "unavailable", "private"]), reason: z.string().optional(), positions: z.array(position), source: z.string(), method: z.string(), coverage: z.string().optional(), readAt: z.string(), block: z.string().nullable(), ms: z.number() });
const positionsResponse = z.object({
  address: z.string(),
  environment: z.string(),
  at: z.string(),
  block: z.string().nullable(),
  venues: z.array(venueRead),
  summary: z.object({ netUsd: z.string().nullable(), pricedNetUsd: z.string(), byState: z.record(z.string()), weightedApyPercent: z.string().nullable(), yearlyYieldUsd: z.string().nullable(), lowestHealth: z.object({ venue: z.string(), label: z.string(), factor: z.string() }).nullable(), positions: z.number(), unpriced: z.number(), unavailable: z.array(z.string()) }),
  personal: z.boolean(),
  healthFloor: z.string(),
});
const venueIds = [...new Set([...POSITION_VENUES.mainnet, ...POSITION_VENUES.testnet].map((v) => v.id))];
const PositionsQuery = z.object({
  environment: environmentSchema.optional(),
  venues: z
    .string()
    .max(400)
    .optional()
    .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter((x) => venueIds.includes(x)) : undefined))
    .describe(`Comma-separated venue ids to read (default all): ${venueIds.join(", ")}`),
});

documentRoutes([
  { method: "get", path: "/v1/fold/positions/:address", tag: "Fold", summary: "Every position the address holds in every venue Lykia supports on Arc: the wallet, Aave V4 (Main and Forex Spokes), Morpho vaults (by curator: Galaxy, Keyrock, Steakhouse, Gauntlet, Bitwise) and Morpho Blue markets, Uniswap v3 and v4, Aerodrome Slipstream, Archery, Unitflow Finance V3 and SushiSwap V3 LP NFTs, USYC, the Circle Gateway unified balance and, for the proven owner, CCTP and Relay transfers in flight, open LykiaOrders orders and scheduled payments. Each position carries its amount, USD value, state (earning, idle, borrowing, at-risk, out-of-range, pending, escrowed, committed), what it is doing, APY, health, range and fees where they apply, one-tap Lyko actions, its source (chain, api, history), the block and an explorer link. A venue that cannot be read comes back unavailable with the reason, never as zero. Each venue is read with its own time limit and cached for 20 seconds per address.", auth: "public", params: AddressParams, query: PositionsQuery, response: positionsResponse },
  { method: "get", path: "/v1/fold/insights/:address", tag: "Fold", summary: "Lyko on watch: deterministic insights for an address (idle USDC, health factor, FX drift, runway, approvals, red-flag tokens, gas, caps, orders, agent budgets, unsettled steps, better rates), each with the figures behind it and an optional one-tap draft. Signed in as the owner: preferences, handled flags and the morning brief apply.", auth: "public", params: AddressParams, query: z.object({ environment: environmentSchema.optional() }), response: z.object({ owner: z.string(), environment: z.string(), at: z.string(), insights: z.array(insight), brief: z.object({ since: z.string().nullable(), lines: z.array(z.string()) }), personal: z.boolean() }) },
  { method: "post", path: "/v1/fold/seen", tag: "Fold", summary: "Mark the morning brief as seen: the next brief lists only what changed after now", auth: "session", body: z.object({ owner: evmAddress, environment: environmentSchema.optional() }), response: z.object({ at: z.string() }) },
  { method: "get", path: "/v1/fold/summary/:address", tag: "Fold", summary: "The Fold bar: today's spend against the Fence's daily cap and the beta cap, and the counts of rules running, orders waiting, agents working and proposals waiting", auth: "public", params: AddressParams, query: z.object({ environment: environmentSchema.optional() }) },
  { method: "get", path: "/v1/fold/instructions", tag: "Fold", summary: "Herding: one list of every standing instruction (automations, standing orders and recurring payments, alerts, agent automations, LykiaOrders orders) with next run, last result and the expected Fence verdict, plus the proposals waiting for a signature", auth: "session", query: OwnerQuery, response: z.object({ owner: z.string(), at: z.string(), instructions: z.array(instruction), waiting: z.array(proposal), counts: z.object({ running: z.number(), paused: z.number(), ordersWaiting: z.number(), waitingSignature: z.number() }) }) },
  { method: "get", path: "/v1/fold/proposals", tag: "Fold", summary: "The owner's proposals, newest first; plans that settled become done and plans that failed become stopped", auth: "session", query: OwnerQuery.extend({ status: statusSchema.optional() }), response: z.object({ proposals: z.array(proposal) }) },
  { method: "post", path: "/v1/fold/proposals", tag: "Fold", summary: "Draft a proposal: from an insight (its server-side draft is used), a holding action or a chat sentence (planned under the owner's Fence with the fee and the beta cap), or a Fence edit. Nothing is signed.", auth: "session", body: createBody, response: proposal, status: 201 },
  { method: "post", path: "/v1/fold/proposals/:id/approve", tag: "Fold", summary: "The owner accepted or started signing a proposal (proposed → approved)", auth: "session", params: ProposalParams, body: moveBody, response: proposal },
  { method: "post", path: "/v1/fold/proposals/:id/done", tag: "Fold", summary: "A proposal finished (approved → done)", auth: "session", params: ProposalParams, body: moveBody, response: proposal },
  { method: "post", path: "/v1/fold/proposals/:id/stop", tag: "Fold", summary: "Stop a proposal (its plan is stopped too)", auth: "session", params: ProposalParams, body: moveBody, response: proposal },
  { method: "get", path: "/v1/fold/feed", tag: "Fold", summary: "Every proposal transition of the last 30 days", auth: "session", query: OwnerQuery },
  { method: "get", path: "/v1/fold/trails", tag: "Fold", summary: "Trails: settled steps with their Arc Memo, Fence verdict and digest and fee; plans running; failed and refused attempts; orders, alerts and proposals", auth: "session", query: OwnerQuery },
  { method: "get", path: "/v1/fold/explain", tag: "Fold", summary: "A structured explanation (yield and fees, a what-if, this week's runs, open approvals) as label, value and note lines", auth: "session", query: OwnerQuery.extend({ question: questionSchema }), response: artifact },
  { method: "get", path: "/v1/fold/whatif/:address", tag: "Fold", summary: "The shared shock model on the live Flock: EURC and cirBTC price moves (percent) and a lending rate change (bps), with health factors and one sentence", auth: "public", params: AddressParams, query: z.object({ environment: environmentSchema.optional(), eurc: z.coerce.number().optional(), btc: z.coerce.number().optional(), rates: z.coerce.number().optional() }) },
  { method: "post", path: "/v1/fold/answer", tag: "Fold", summary: "Answer a follow-up chip and write the exchange to the owner's shared thread", auth: "session", body: z.object({ owner: evmAddress, environment: environmentSchema.optional(), question: questionSchema, threadId: z.string().max(120).optional(), shocks: shockSchema.partial().optional() }), response: z.object({ threadId: z.string(), question: z.string(), reply: z.string(), artifact }) },
  { method: "get", path: "/v1/me/preferences", tag: "Fold", summary: "Your Lyko: risk profile, liquidity floor, target mix, gas floor, insights and notifications and the Fold's layout, with the effect of each", auth: "session" },
  { method: "put", path: "/v1/me/preferences", tag: "Fold", summary: "Update Your Lyko (partial; validated; the risk profile is written through to the profile)", auth: "session", body: preferencesPatch },
  { method: "delete", path: "/v1/me/preferences", tag: "Fold", summary: "Back to the default preferences", auth: "session" },
  { method: "get", path: "/v1/me/threads", tag: "Fold", summary: "The owner's shared threads (Ask Lyko and Lyko on watch), newest first, with size, last line and origin", auth: "session" },
]);

function shocksFrom(q: { eurc?: number | undefined; btc?: number | undefined; rates?: number | undefined }): FoldShocks {
  const clamp = (v: number | undefined, lo: number, hi: number) => (v === undefined || !Number.isFinite(v) ? 0 : Math.min(hi, Math.max(lo, v)));
  return { EURC: clamp(q.eurc, -90, 90), cirBTC: clamp(q.btc, -90, 90), ratesBps: Math.round(clamp(q.rates, -1000, 1000)) };
}

async function preferencesView(ctx: AppContext, owner: Address): Promise<PreferencesResponse> {
  const preferences = await getPreferences(ctx, owner);
  return { owner: owner.toLowerCase(), preferences, effects: foldPreferenceEffects(preferences) };
}

export const foldModule: ApiModule = {
  name: "fold",
  register(router, ctx) {
    router.get("/fold/insights/:address", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const { environment } = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      const personal = (await ownerProof(ctx, req, address)) !== null;
      res.json(await foldInsights(ctx, environmentOf(ctx, environment), address as Address, personal));
    });

    router.get("/fold/positions/:address", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const q = parseQuery(req, PositionsQuery);
      // Positions are public on chain; Lykia's own records (orders, transfers in flight, scheduled payments) need the owner's proof.
      const personal = (await ownerProof(ctx, req, address)) !== null;
      res.json(await readPositions(ctx, environmentOf(ctx, q.environment), address as Address, { personal, ...(q.venues ? { venues: q.venues } : {}) }));
    });

    router.post("/fold/seen", async (req, res) => {
      const body = parseBody(req, z.object({ owner: evmAddress, environment: environmentSchema.optional() }));
      await authorizeOwner(ctx, req, body.owner);
      res.json(await markSeen(ctx, environmentOf(ctx, body.environment), body.owner as Address));
    });

    router.get("/fold/summary/:address", async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const environment = environmentOf(ctx, parseQuery(req, z.object({ environment: environmentSchema.optional() })).environment);
      const owner = address as Address;
      const personal = (await ownerProof(ctx, req, address)) !== null;
      const [spent, profile, prefs] = await Promise.all([services(ctx).intents.spent(environment, owner), getProfile(ctx, personal ? owner : null), getPreferences(ctx, personal ? owner : null)]);
      const fence = fenceForProfile({ ...profile, risk: riskTierOf(prefs.risk) });
      let counts: FoldSummaryResponse["counts"] = { rules: 0, ordersWaiting: 0, agentsWorking: 0, proposalsWaiting: 0 };
      if (personal) {
        const [view, pack] = await Promise.all([instructionsView(ctx, owner), agentServices(ctx).pack.ownedBy(owner, environment).catch(() => [])]);
        counts = { rules: view.counts.running - view.counts.ordersWaiting, ordersWaiting: view.counts.ordersWaiting, agentsWorking: pack.filter((a) => a.status === "active").length, proposalsWaiting: view.counts.waitingSignature };
      }
      const body: FoldSummaryResponse = { owner: owner.toLowerCase() as Address, environment, at: new Date(ctx.clock.now()).toISOString(), spent: { dayUsd: spent.dayUsd }, beta: environment === "mainnet" && ctx.config.beta ? { perDayUsd: ctx.config.beta.perDayUsd } : null, fenceDailyUsd: fence.caps?.dailyUsd ?? null, counts };
      res.json(body);
    });

    router.get("/fold/instructions", async (req, res) => {
      const { owner } = parseQuery(req, OwnerQuery);
      await authorizeOwner(ctx, req, owner);
      res.json(await instructionsView(ctx, owner as Address));
    });

    router.get("/fold/proposals", async (req, res) => {
      const { owner, status } = parseQuery(req, OwnerQuery.extend({ status: statusSchema.optional() }));
      await authorizeOwner(ctx, req, owner);
      res.json({ proposals: await listProposals(ctx, owner as Address, status ? { status } : {}) });
    });

    router.post("/fold/proposals", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, createBody);
      await authorizeOwner(ctx, req, body.owner);
      const owner = body.owner as Address;
      const environment = environmentOf(ctx, body.environment);
      const [profile, prefs] = await Promise.all([getProfile(ctx, owner), getPreferences(ctx, owner)]);
      const fence = fenceFrom(body.fence) ?? fenceForProfile({ ...profile, risk: riskTierOf(prefs.risk) }, DEFAULT_FENCE);
      if (body.source.kind === "insight") {
        // The draft comes from the server's own insight, never from the request.
        if (!body.source.ref) throw new LykiaHttpError("INVALID_REQUEST", 400, "Name the insight (source.ref).");
        const found = (await foldInsights(ctx, environment, owner, true)).insights.find((i) => i.id === body.source.ref);
        if (!found) throw new LykiaHttpError("CONFLICT", 409, "That insight no longer applies; the Fold has changed since it was shown.");
        if (!found.draft) throw new LykiaHttpError("CONFLICT", 409, "That insight has nothing to draft.");
        return void res.status(201).json(await createProposal(ctx, { owner, environment, fence, source: { kind: "insight", ref: found.id }, title: found.title, sentence: found.draft.sentence, ...(found.draft.transactions ? { transactions: found.draft.transactions } : {}), insightFingerprint: found.title }));
      }
      if (body.source.kind === "fence") {
        if (!body.fencePatch) throw new LykiaHttpError("INVALID_REQUEST", 400, "A Fence edit needs fencePatch.");
        return void res.status(201).json(await createProposal(ctx, { owner, environment, fence, source: { kind: "fence", ref: body.source.ref }, title: body.title ?? "Edit the Fence", fencePatch: body.fencePatch }));
      }
      if (!body.sentence) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send the sentence to plan.");
      res.status(201).json(await createProposal(ctx, { owner, environment, fence, source: { kind: body.source.kind, ref: body.source.ref }, title: body.title ?? body.sentence, sentence: body.sentence }));
    });

    for (const [verb, status] of [["approve", "approved"], ["done", "done"], ["stop", "stopped"]] as const) {
      router.post(`/fold/proposals/:id/${verb}`, async (req, res) => {
        const { id } = parseParams(req, ProposalParams);
        const body = parseBody(req, moveBody);
        await authorizeOwner(ctx, req, body.owner);
        await getProposal(ctx, body.owner as Address, id);
        res.json(await moveProposal(ctx, body.owner as Address, id, status, body.note ?? null));
      });
    }

    router.get("/fold/feed", async (req, res) => {
      const { owner } = parseQuery(req, OwnerQuery);
      await authorizeOwner(ctx, req, owner);
      res.json({ entries: await listFeed(ctx, owner as Address) });
    });

    router.get("/fold/trails", async (req, res) => {
      const { owner } = parseQuery(req, OwnerQuery);
      await authorizeOwner(ctx, req, owner);
      res.json(await trailsFor(ctx, owner as Address));
    });

    router.get("/fold/explain", ctx.limits.heavy, async (req, res) => {
      const { owner, environment, question } = parseQuery(req, OwnerQuery.extend({ question: questionSchema }));
      // The sample flock is public: signed out, the Fold explains the same fixture it shows.
      if (!isSampleOwner(owner)) await authorizeOwner(ctx, req, owner);
      res.json(await explain(ctx, environmentOf(ctx, environment), owner as Address, question));
    });

    router.get("/fold/whatif/:address", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional(), eurc: z.coerce.number().optional(), btc: z.coerce.number().optional(), rates: z.coerce.number().optional() }));
      res.json(await whatIfFor(ctx, environmentOf(ctx, q.environment), address as Address, shocksFrom(q)));
    });

    router.post("/fold/answer", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, z.object({ owner: evmAddress, environment: environmentSchema.optional(), question: questionSchema, threadId: z.string().max(120).optional(), shocks: shockSchema.partial().optional() }));
      // The sample flock is public: a signed-out visitor's chip is answered from the same fixture the Fold shows (nothing is stored).
      if (!isSampleOwner(body.owner)) await authorizeOwner(ctx, req, body.owner);
      const shocks = body.shocks ? { ...NO_SHOCK, ...body.shocks } : undefined;
      res.json(await answer(ctx, environmentOf(ctx, body.environment), body.owner as Address, body.question, body.threadId, shocks));
    });

    router.get("/me/preferences", async (req, res) => {
      res.json(await preferencesView(ctx, await sessionAddress(ctx, req)));
    });
    router.put("/me/preferences", async (req, res) => {
      const owner = await sessionAddress(ctx, req);
      const patch = parseBody(req, preferencesPatch);
      await updatePreferences(ctx, owner, patch);
      res.json(await preferencesView(ctx, owner));
    });
    router.delete("/me/preferences", async (req, res) => {
      const owner = await sessionAddress(ctx, req);
      await resetPreferences(ctx, owner);
      res.json(await preferencesView(ctx, owner));
    });
    router.get("/me/threads", async (req, res) => {
      res.json({ threads: await threadSummaries(ctx, await sessionAddress(ctx, req)) });
    });
  },
};
