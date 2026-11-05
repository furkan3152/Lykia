/**
 * Developer APIs for money flows and Lykia's agents.
 *
 *   Payouts      POST /payouts · POST /payouts/import · POST /payouts/parse-csv · GET /payouts · GET /payouts/:id
 *                POST /payouts/:id/batches/:index/submit · POST /payouts/:id/execute
 *   Invoices     POST /invoices · GET /invoices · GET /invoices/:id · POST /invoices/:id/void
 *                GET /invoices/:id/public · POST /invoices/:id/pay · POST /invoices/:id/payments   (hosted page: /pay/:id)
 *   Agents       POST /agents · GET /agents · GET|PATCH|DELETE /agents/:id · POST /agents/:id/run
 *                GET /agents/:id/threads · GET /agents/:id/threads/:threadId · POST /agents/:id/tag
 *   Verdicts     GET /verdicts/:digest · POST /verdicts/verify
 *   Automations  POST /automations · GET /automations · GET /automations/:id · POST /automations/:id/(pause|resume) · DELETE /automations/:id
 *   Reconcile    POST /reconcile/tick (admin or CRON_SECRET)
 *
 * Writes need a secret key or a SIWE session; publishable keys only reach
 * the public invoice and verdict routes. Nothing here signs or broadcasts,
 * except a payout the developer explicitly executes from its own Circle
 * developer-controlled wallet.
 */
import { AGENT_API_TOOLS, PRICE_FEEDS, STEP_KINDS, AUTOMATION_EVENTS, parsePayoutCsv, type Address, type FenceFacts, type PlanAction, type StepKind } from "@lykia/core";
import type { Request } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery, txHash } from "../http/validate.js";
import { documentRoutes } from "../platform/openapi/registry.js";
import { sessionOf } from "../platform/session.js";
import { flowCaller } from "../devflows/access.js";
import { agentTagDraft, createAgent, deleteAgent, getAgentThread, listAgents, listAgentThreads, loadAgent, agentView, runAgent, updateAgent } from "../devflows/agents.js";
import { controlAutomation, createAutomation, getAutomation, listAllAutomations, wireAutomationEvents } from "../devflows/automations.js";
import { createInvoice, getInvoice, listInvoices, payUrl, planInvoicePayment, publicInvoice, recordInvoicePayment, voidInvoice } from "../devflows/invoices.js";
import { createPayout, executeWithCircle, getPayout, listPayouts, payoutView, submitBatch } from "../devflows/payouts.js";
import { flowTick } from "../devflows/tick.js";
import { verifySupplied, verifyVerdict } from "../devflows/verdicts.js";
import { environmentSchema, fenceFrom, publicBaseUrl } from "./common.js";
import { factsSchema } from "./fence.js";

/* ------------------------------------------------------------ schemas */

const decimal = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/u, 'A decimal amount such as "125.50".');
const projectId = z.string().regex(/^prj_[a-z0-9]{12}$/u);
const fenceDoc = z.record(z.unknown()).describe("A lykia.fence/v1 document (see /v1/fence/templates).");
const weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const schedule = z.object({ every: z.enum(["day", "week", "month"]), weekday: weekday.optional(), day: z.number().int().min(1).max(28).optional(), at: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u), timezone: z.string().min(1).max(64) });

const payoutRow = z.object({ to: z.string().max(42), token: z.string().min(2).max(42), amount: z.string().max(40), reference: z.string().max(64).optional(), memo: z.string().max(120).optional() });
const payoutBase = z.object({
  payer: evmAddress,
  projectId: projectId.optional(),
  environment: environmentSchema.optional(),
  fence: fenceDoc.optional(),
  circleWalletId: z.string().uuid().optional().describe("Execute from this Circle developer-controlled wallet (its address is the payer)."),
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
});
const payoutSchema = payoutBase.extend({ rows: z.array(payoutRow).min(1).max(100) });
const payoutImportSchema = payoutBase.extend({ csv: z.string().min(1).max(64 * 1024) });
const PayoutParams = z.object({ id: z.string().regex(/^po_[a-z0-9]{12}$/u) });
const BatchParams = PayoutParams.extend({ index: z.coerce.number().int().min(0).max(99) });

const lineItem = z.object({ description: z.string().min(1).max(160), quantity: z.string().max(24), unitAmount: z.string().max(40) });
const invoiceSchema = z.object({
  projectId: projectId.optional(),
  environment: environmentSchema.optional(),
  token: z.string().min(2).max(42),
  payee: evmAddress,
  amount: decimal.optional(),
  payer: evmAddress.optional(),
  dueDate: z.string().max(40).optional(),
  reference: z.string().max(64).optional(),
  memo: z.string().max(200).optional(),
  lineItems: z.array(lineItem).max(50).optional(),
  allowPartial: z.boolean().optional(),
});
const InvoiceParams = z.object({ id: z.string().regex(/^inv_[a-z0-9]{12}$/u) });

const budget = z.object({ perRunUsd: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/u).optional(), dailyUsd: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/u).optional(), maxRunsPerDay: z.number().int().min(1).max(1000).optional() });
const agentSchema = z.object({
  projectId: projectId.optional(),
  name: z.string().min(2).max(64),
  owner: evmAddress,
  environment: environmentSchema.optional(),
  tools: z.array(z.enum(AGENT_API_TOOLS as unknown as [string, ...string[]])).max(AGENT_API_TOOLS.length).optional(),
  kinds: z.array(z.enum(STEP_KINDS as unknown as [StepKind, ...StepKind[]])).max(20).nullable().optional(),
  venues: z.array(z.string().min(1).max(48)).max(40).nullable().optional(),
  fence: fenceDoc.optional(),
  budget: budget.optional(),
  pack: z.array(z.string().min(8).max(120)).max(16).optional(),
  persona: z.string().max(2400).optional(),
  memory: z.boolean().optional(),
  autoPrepare: z.boolean().optional(),
  llm: z.object({ provider: z.enum(["lykia", "none"]) }).optional(),
  status: z.enum(["active", "paused"]).optional(),
});
const AgentParams = z.object({ id: z.string().regex(/^agt_[a-z0-9]{12}$/u) });
const runSchema = z.object({ message: z.string().min(1).max(4000), threadId: z.string().max(80).optional(), autoPrepare: z.boolean().optional(), dryRun: z.boolean().optional() });

const trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("price"), feed: z.enum(PRICE_FEEDS as unknown as [string, ...string[]]), op: z.enum(["above", "below"]), value: decimal }),
  schedule.extend({ type: z.literal("schedule") }),
  z.object({ type: z.literal("balance"), token: z.string().min(2).max(42), op: z.enum(["above", "below"]), value: decimal, address: evmAddress.optional() }),
  z.object({ type: z.literal("event"), event: z.enum(AUTOMATION_EVENTS as unknown as [string, ...string[]]) }),
]);
const action = z.discriminatedUnion("type", [z.object({ type: z.literal("plan"), actions: z.array(z.unknown()).max(12).optional(), sentence: z.string().min(3).max(400).optional() }), z.object({ type: z.literal("notify"), channel: z.literal("webhook") })]);
const automationSchema = z.object({ projectId: projectId.optional(), owner: evmAddress, name: z.string().min(1).max(120), environment: environmentSchema.optional(), trigger, action, fence: fenceDoc.optional(), maxFiresPerDay: z.number().int().min(1).max(24).optional() });
const AutomationParams = z.object({ id: z.string().min(3).max(140) });

const digestParam = z.object({ digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u) });

/* ------------------------------------------------------------ OpenAPI */

const ok = z.record(z.unknown());
documentRoutes([
  { method: "post", path: "/v1/payouts", tag: "Payouts", summary: "Create a payout batch", description: "Up to 100 rows (token, amount, reference, memo each). Checked by the security layer, the payer's balances, the Fence and the beta cap; built as Multicall3From batches with an Arc Memo per transfer.", scope: "payouts", auth: "secret", body: payoutSchema, response: ok, idempotent: true },
  { method: "post", path: "/v1/payouts/import", tag: "Payouts", summary: "Create a payout from CSV", description: "Columns: to, token, amount, reference, memo (header optional).", scope: "payouts", auth: "secret", body: payoutImportSchema, response: ok, idempotent: true },
  { method: "post", path: "/v1/payouts/parse-csv", tag: "Payouts", summary: "Preview a payout CSV", scope: "read", auth: "secret", body: z.object({ csv: z.string() }), response: ok },
  { method: "get", path: "/v1/payouts", tag: "Payouts", summary: "List payouts", scope: "read", auth: "secret", query: z.object({ projectId: projectId.optional(), status: z.string().optional() }), response: ok },
  { method: "get", path: "/v1/payouts/:id", tag: "Payouts", summary: "Payout status, row by row", scope: "read", auth: "secret", params: PayoutParams, response: ok },
  { method: "post", path: "/v1/payouts/:id/batches/:index/submit", tag: "Payouts", summary: "Report a broadcast batch", description: "The transaction must be exactly the prepared batch; rows settle from the receipt's Memo events.", scope: "payouts", auth: "secret", params: BatchParams, body: z.object({ hash: txHash }), response: ok, idempotent: true },
  { method: "post", path: "/v1/payouts/:id/execute", tag: "Payouts", summary: "Execute from the payout's Circle developer-controlled wallet", scope: "payouts", auth: "secret", params: PayoutParams, response: ok, idempotent: true },
  { method: "post", path: "/v1/invoices", tag: "Invoices", summary: "Create an invoice and its payment link", scope: "payouts", auth: "secret", body: invoiceSchema, response: ok, idempotent: true },
  { method: "get", path: "/v1/invoices", tag: "Invoices", summary: "List invoices", scope: "read", auth: "secret", query: z.object({ projectId: projectId.optional(), status: z.string().optional() }), response: ok },
  { method: "get", path: "/v1/invoices/:id", tag: "Invoices", summary: "One invoice with its payments", scope: "read", auth: "secret", params: InvoiceParams, response: ok },
  { method: "post", path: "/v1/invoices/:id/void", tag: "Invoices", summary: "Void an unpaid invoice", scope: "payouts", auth: "secret", params: InvoiceParams, response: ok },
  { method: "get", path: "/v1/invoices/:id/public", tag: "Invoices", summary: "What the hosted pay page reads", auth: "public", params: InvoiceParams, response: ok },
  { method: "post", path: "/v1/invoices/:id/pay", tag: "Invoices", summary: "Plan the payer's transfer (unsigned)", auth: "public", params: InvoiceParams, body: z.object({ payer: evmAddress, amount: decimal.optional(), account: z.enum(["eoa", "smart"]).optional() }), response: ok },
  { method: "post", path: "/v1/invoices/:id/payments", tag: "Invoices", summary: "Reconcile a payment by transaction hash", auth: "public", params: InvoiceParams, body: z.object({ hash: txHash }), response: ok },
  { method: "post", path: "/v1/agents", tag: "Agents", summary: "Create an agent", scope: "agents", auth: "secret", body: agentSchema, response: ok },
  { method: "get", path: "/v1/agents", tag: "Agents", summary: "List agents", scope: "read", auth: "secret", response: ok },
  { method: "get", path: "/v1/agents/:id", tag: "Agents", summary: "One agent", scope: "read", auth: "secret", params: AgentParams, response: ok },
  { method: "patch", path: "/v1/agents/:id", tag: "Agents", summary: "Reconfigure an agent", scope: "agents", auth: "secret", params: AgentParams, body: agentSchema.partial(), response: ok },
  { method: "delete", path: "/v1/agents/:id", tag: "Agents", summary: "Delete an agent", scope: "agents", auth: "secret", params: AgentParams, response: ok },
  { method: "post", path: "/v1/agents/:id/run", tag: "Agents", summary: "Sentence to plan under the agent's Fence", scope: "agents", auth: "secret", params: AgentParams, body: runSchema, response: ok, idempotent: true },
  { method: "get", path: "/v1/agents/:id/threads", tag: "Agents", summary: "Conversation threads", scope: "read", auth: "secret", params: AgentParams, response: ok },
  { method: "get", path: "/v1/agents/:id/threads/:threadId", tag: "Agents", summary: "One thread", scope: "read", auth: "secret", params: AgentParams.extend({ threadId: z.string() }), response: ok },
  { method: "post", path: "/v1/agents/:id/tag", tag: "Agents", summary: "ERC-8004 registration (card + unsigned register call)", scope: "agents", auth: "secret", params: AgentParams, body: z.object({ description: z.string().max(500).optional(), agentWallet: evmAddress.optional() }), response: ok },
  { method: "get", path: "/v1/verdicts/:digest", tag: "Verdicts", summary: "Recompute and verify a Fence verdict", auth: "public", params: digestParam, response: ok },
  { method: "post", path: "/v1/verdicts/verify", tag: "Verdicts", summary: "Verify a verdict from a Fence and facts", auth: "public", body: z.object({ digest: z.string(), fence: fenceDoc, facts: factsSchema }), response: ok },
  { method: "post", path: "/v1/automations", tag: "Automations", summary: "Create an automation (price, schedule, balance or event; plan or notify)", scope: "automation", auth: "secret", body: automationSchema, response: ok, idempotent: true },
  { method: "get", path: "/v1/automations", tag: "Automations", summary: "Unified list (with the owner's standing orders, alerts, agent automations and orders)", scope: "read", auth: "secret", query: z.object({ owner: evmAddress.optional() }), response: ok },
  { method: "get", path: "/v1/automations/:id", tag: "Automations", summary: "One automation", scope: "read", auth: "secret", params: AutomationParams, response: ok },
  { method: "post", path: "/v1/reconcile/tick", tag: "Payouts", summary: "One reconciliation pass (payout receipts, invoice memos, automations)", auth: "secret", response: ok },
  { method: "post", path: "/v1/automations/:id/pause", tag: "Automations", summary: "Pause", scope: "automation", auth: "secret", params: AutomationParams, response: ok },
  { method: "post", path: "/v1/automations/:id/resume", tag: "Automations", summary: "Resume", scope: "automation", auth: "secret", params: AutomationParams, response: ok },
  { method: "delete", path: "/v1/automations/:id", tag: "Automations", summary: "Delete", scope: "automation", auth: "secret", params: AutomationParams, response: ok },
]);

/* ------------------------------------------------------------ helpers */

function issuesError(issues: readonly { path: string; message: string }[], what: string): LykiaHttpError {
  return new LykiaHttpError("INVALID_REQUEST", 400, `Invalid ${what}: ${issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join("; ")}`, { issues });
}

async function mayTick(ctx: AppContext, req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === `Bearer ${secret}`) return true;
  const session = await sessionOf(ctx, req);
  return Boolean(session && ctx.config.platform.adminAddresses.includes(session.address.toLowerCase()));
}

const timers = new WeakMap<AppContext, NodeJS.Timeout>();
const FLOW_TICK_MS = 60_000;

/* ------------------------------------------------------------ module */

export const devflowsModule: ApiModule = {
  name: "devflows",
  register(router, ctx) {
    wireAutomationEvents(ctx);

    /* ---------------- payouts */
    router.post("/payouts", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, payoutSchema);
      const caller = await flowCaller(ctx, req, "payouts", { projectId: body.projectId ?? null });
      const payout = await createPayout(ctx, caller, { ...body, payer: body.payer as Address, ...(body.fence ? { fence: fenceFrom(body.fence)! } : {}) } as Parameters<typeof createPayout>[2]);
      res.status(body.dryRun ? 200 : 201).json(payoutView(payout));
    });
    router.post("/payouts/parse-csv", async (req, res) => {
      const body = parseBody(req, z.object({ csv: z.string().min(1).max(64 * 1024) }));
      await flowCaller(ctx, req, "read");
      res.json(parsePayoutCsv(body.csv));
    });
    router.post("/payouts/import", ctx.limits.heavy, async (req, res) => {
      const { csv, ...body } = parseBody(req, payoutImportSchema);
      const caller = await flowCaller(ctx, req, "payouts", { projectId: body.projectId ?? null });
      const parsed = parsePayoutCsv(csv);
      if (parsed.issues.length > 0) throw issuesError(parsed.issues, "CSV");
      const payout = await createPayout(ctx, caller, { ...body, rows: parsed.rows, payer: body.payer as Address, ...(body.fence ? { fence: fenceFrom(body.fence)! } : {}) } as Parameters<typeof createPayout>[2]);
      res.status(body.dryRun ? 200 : 201).json(payoutView(payout));
    });
    router.get("/payouts", async (req, res) => {
      const q = parseQuery(req, z.object({ projectId: projectId.optional(), status: z.string().max(32).optional() }));
      const caller = await flowCaller(ctx, req, "read");
      res.json({ payouts: (await listPayouts(ctx, caller, { ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.status ? { status: q.status } : {}) })).map(payoutView) });
    });
    router.get("/payouts/:id", async (req, res) => {
      const { id } = parseParams(req, PayoutParams);
      res.json(payoutView(await getPayout(ctx, await flowCaller(ctx, req, "read"), id)));
    });
    router.post("/payouts/:id/batches/:index/submit", ctx.limits.heavy, async (req, res) => {
      const { id, index } = parseParams(req, BatchParams);
      const { hash } = parseBody(req, z.object({ hash: txHash }));
      res.json(payoutView(await submitBatch(ctx, await flowCaller(ctx, req, "payouts"), id, index, hash)));
    });
    router.post("/payouts/:id/execute", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, PayoutParams);
      res.json(payoutView(await executeWithCircle(ctx, await flowCaller(ctx, req, "payouts"), id)));
    });

    /* ---------------- invoices */
    router.post("/invoices", async (req, res) => {
      const body = parseBody(req, invoiceSchema);
      const caller = await flowCaller(ctx, req, "payouts", { projectId: body.projectId ?? null });
      const { projectId: _p, ...input } = body;
      const invoice = await createInvoice(ctx, caller, input as Parameters<typeof createInvoice>[2]);
      res.status(201).json({ ...invoice, url: payUrl(ctx, invoice.id) });
    });
    router.get("/invoices", async (req, res) => {
      const q = parseQuery(req, z.object({ projectId: projectId.optional(), status: z.string().max(32).optional() }));
      const caller = await flowCaller(ctx, req, "read");
      res.json({ invoices: await listInvoices(ctx, caller, { ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.status ? { status: q.status } : {}) }) });
    });
    router.get("/invoices/:id", async (req, res) => {
      const { id } = parseParams(req, InvoiceParams);
      const invoice = await getInvoice(ctx, await flowCaller(ctx, req, "read"), id);
      res.json({ ...invoice, url: payUrl(ctx, invoice.id) });
    });
    router.post("/invoices/:id/void", async (req, res) => {
      const { id } = parseParams(req, InvoiceParams);
      res.json(await voidInvoice(ctx, await flowCaller(ctx, req, "payouts"), id));
    });
    router.get("/invoices/:id/public", async (req, res) => {
      const { id } = parseParams(req, InvoiceParams);
      res.json({ ...(await publicInvoice(ctx, id)), url: payUrl(ctx, id) });
    });
    router.post("/invoices/:id/pay", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, InvoiceParams);
      const body = parseBody(req, z.object({ payer: evmAddress, amount: decimal.optional(), account: z.enum(["eoa", "smart"]).optional() }));
      res.status(201).json(await planInvoicePayment(ctx, id, { payer: body.payer as Address, ...(body.amount ? { amount: body.amount } : {}), ...(body.account ? { account: body.account } : {}) }));
    });
    router.post("/invoices/:id/payments", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, InvoiceParams);
      const { hash } = parseBody(req, z.object({ hash: txHash }));
      const result = await recordInvoicePayment(ctx, id, hash, "submit");
      res.json({ added: result.added, invoice: await publicInvoice(ctx, id) });
    });

    /* ---------------- agents */
    router.post("/agents", async (req, res) => {
      const body = parseBody(req, agentSchema);
      const caller = await flowCaller(ctx, req, "agents", { projectId: body.projectId ?? null });
      const { projectId: _p, fence, ...rest } = body;
      res.status(201).json(await createAgent(ctx, caller, { ...rest, ...(fence ? { fence: fenceFrom(fence)! } : {}) } as Parameters<typeof createAgent>[2]));
    });
    router.get("/agents", async (req, res) => {
      res.json({ agents: await listAgents(ctx, await flowCaller(ctx, req, "read")) });
    });
    router.get("/agents/:id", async (req, res) => {
      const { id } = parseParams(req, AgentParams);
      res.json(agentView(await loadAgent(ctx, await flowCaller(ctx, req, "read"), id)));
    });
    router.patch("/agents/:id", async (req, res) => {
      const { id } = parseParams(req, AgentParams);
      const body = parseBody(req, agentSchema.partial());
      const caller = await flowCaller(ctx, req, "agents");
      const current = await loadAgent(ctx, caller, id);
      const scoped = current.projectId ? await flowCaller(ctx, req, "agents", { projectId: current.projectId }) : caller;
      const { projectId: _p, fence, ...rest } = body;
      res.json(await updateAgent(ctx, scoped, id, { ...rest, ...(fence ? { fence: fenceFrom(fence)! } : {}) } as Parameters<typeof updateAgent>[3]));
    });
    router.delete("/agents/:id", async (req, res) => {
      const { id } = parseParams(req, AgentParams);
      res.json(await deleteAgent(ctx, await flowCaller(ctx, req, "agents"), id));
    });
    router.post("/agents/:id/run", ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, AgentParams);
      const body = parseBody(req, runSchema);
      const caller = await flowCaller(ctx, req, "agents");
      const agent = await loadAgent(ctx, caller, id);
      const scoped = agent.projectId ? await flowCaller(ctx, req, "agents", { projectId: agent.projectId }) : caller;
      res.json(await runAgent(ctx, scoped, id, body));
    });
    router.get("/agents/:id/threads", async (req, res) => {
      const { id } = parseParams(req, AgentParams);
      res.json({ threads: await listAgentThreads(ctx, await flowCaller(ctx, req, "read"), id) });
    });
    router.get("/agents/:id/threads/:threadId", async (req, res) => {
      const { id, threadId } = parseParams(req, AgentParams.extend({ threadId: z.string().min(10).max(80) }));
      res.json(await getAgentThread(ctx, await flowCaller(ctx, req, "read"), id, threadId));
    });
    router.post("/agents/:id/tag", async (req, res) => {
      const { id } = parseParams(req, AgentParams);
      const body = parseBody(req, z.object({ description: z.string().max(500).optional(), agentWallet: evmAddress.optional() }).default({}));
      res.json(await agentTagDraft(ctx, await flowCaller(ctx, req, "agents"), id, { ...(body.description ? { description: body.description } : {}), ...(body.agentWallet ? { agentWallet: body.agentWallet as Address } : {}), publicBaseUrl: publicBaseUrl(req) }));
    });

    /* ---------------- verdicts */
    router.get("/verdicts/:digest", async (req, res) => {
      const { digest } = parseParams(req, digestParam);
      res.json(await verifyVerdict(ctx, digest));
    });
    router.post("/verdicts/verify", (req, res) => {
      const body = parseBody(req, z.object({ digest: z.string().regex(/^sha256:[0-9a-f]{64}$/u), fence: z.unknown(), facts: factsSchema }));
      const fence = fenceFrom(body.fence);
      if (!fence) throw new LykiaHttpError("INVALID_FENCE", 400, "Send the Fence the verdict was made under.");
      res.json(verifySupplied(ctx, body.digest, fence, body.facts as FenceFacts));
    });

    /* ---------------- automations */
    router.post("/automations", async (req, res) => {
      const body = parseBody(req, automationSchema);
      const caller = await flowCaller(ctx, req, "automation", { projectId: body.projectId ?? null });
      const { projectId: _p, fence, action: act, ...rest } = body;
      const actionInput = act.type === "plan" ? { type: "plan" as const, ...(act.actions ? { actions: act.actions as PlanAction[] } : {}), ...(act.sentence ? { sentence: act.sentence } : {}) } : act;
      res.status(201).json(await createAutomation(ctx, caller, { ...rest, owner: rest.owner as Address, action: actionInput, ...(fence ? { fence: fenceFrom(fence)! } : {}) } as Parameters<typeof createAutomation>[2]));
    });
    router.get("/automations", async (req, res) => {
      const q = parseQuery(req, z.object({ owner: evmAddress.optional() }));
      res.json(await listAllAutomations(ctx, await flowCaller(ctx, req, "read"), q.owner as Address | undefined));
    });
    router.get("/automations/:id", async (req, res) => {
      const { id } = parseParams(req, AutomationParams);
      res.json(await getAutomation(ctx, await flowCaller(ctx, req, "read"), id));
    });
    for (const verb of ["pause", "resume"] as const) {
      router.post(`/automations/:id/${verb}`, async (req, res) => {
        const { id } = parseParams(req, AutomationParams);
        const q = parseQuery(req, z.object({ owner: evmAddress.optional() }));
        res.json(await controlAutomation(ctx, await flowCaller(ctx, req, "automation"), id, verb, q.owner as Address | undefined));
      });
    }
    router.delete("/automations/:id", async (req, res) => {
      const { id } = parseParams(req, AutomationParams);
      const q = parseQuery(req, z.object({ owner: evmAddress.optional() }));
      res.json(await controlAutomation(ctx, await flowCaller(ctx, req, "automation"), id, "delete", q.owner as Address | undefined));
    });

    router.post("/reconcile/tick", ctx.limits.heavy, async (req, res) => {
      if (!(await mayTick(ctx, req))) throw new LykiaHttpError("NOT_FOUND", 404, "Not found.");
      res.json(await flowTick(ctx));
    });
  },
  start(ctx) {
    const loop = async () => {
      try {
        await flowTick(ctx);
      } catch (error) {
        ctx.log.debug("flow tick failed", { error: error instanceof Error ? error.message : String(error) });
      }
      const t = setTimeout(() => void loop(), FLOW_TICK_MS);
      t.unref();
      timers.set(ctx, t);
    };
    const t = setTimeout(() => void loop(), FLOW_TICK_MS);
    t.unref();
    timers.set(ctx, t);
  },
  stop(ctx) {
    const t = timers.get(ctx);
    if (t) clearTimeout(t);
    timers.delete(ctx);
  },
};
