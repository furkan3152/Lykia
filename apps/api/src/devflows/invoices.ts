/**
 * Invoices and payment links. An invoice names a payee, a token and an
 * amount (or line items); its hosted page (/pay/:id on the web app) plans
 * the payer's transfer through the normal planner (Lykia's fee, the beta
 * cap and a Fence that admits only this payee and token) with the memo note
 * "invoice inv_…". Payments are reconciled from receipts: the Memo event
 * must carry the invoice id, and the amount is what the Transfer events
 * delivered to the payee. Partial payments add up; overpayments are kept.
 */
import {
  applyInvoicePayment,
  DEFAULT_FENCE,
  decodeMemo,
  findToken,
  fromBaseUnits,
  invoiceDue,
  invoiceIdFromNote,
  invoiceNote,
  invoiceStatusOf,
  lineItemsTotal,
  compareDecimalStrings,
  tokenAddress,
  validateInvoiceInput,
  type Address,
  type ArcEnvironment,
  type Fence,
  type Invoice,
  type InvoiceInput,
  type InvoicePublicView,
} from "@lykia/core";
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import { parseAbiItem } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { randomHex } from "../platform/crypto.js";
import { getProject } from "../platform/projects.js";
import { services } from "../services.js";
import type { FlowCaller } from "./access.js";
import { memoEvents, transferEvents, type ReceiptLog } from "./batch.js";
import { businessEvent } from "./events.js";
import { invoices, listOwned, RECORD_TTL_MS } from "./stores.js";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
export const INVOICE_ID = /^inv_[a-z0-9]{12}$/u;

export function payUrl(ctx: AppContext, id: string): string {
  const origin = ctx.config.webOrigins.find((o) => o.startsWith("https://")) ?? ctx.config.webOrigins[0] ?? "https://lykia.app";
  return `${origin.replace(/\/$/u, "")}/pay/${id}`;
}

export async function createInvoice(ctx: AppContext, caller: FlowCaller, input: InvoiceInput & { readonly environment?: ArcEnvironment }): Promise<Invoice> {
  const environment = input.environment ?? caller.project?.network ?? ctx.config.mode;
  const issues = validateInvoiceInput(input, environment);
  if (issues.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Invalid invoice: ${issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join("; ")}`, { issues });
  const token = findToken(environment, input.token)!;
  const now = ctx.clock.now();
  const dueDate = input.dueDate ? new Date(input.dueDate).toISOString() : null;
  const invoice: Invoice = {
    schema: "lykia.invoice/v1",
    id: `inv_${randomHex(6)}`,
    developer: caller.developer,
    projectId: caller.project?.id ?? null,
    environment,
    token: token.symbol,
    payee: input.payee.toLowerCase() as Address,
    payer: input.payer ? (input.payer.toLowerCase() as Address) : null,
    amount: input.amount ?? lineItemsTotal(input.lineItems ?? [], token.decimals),
    paid: "0",
    status: "open",
    reference: input.reference ?? null,
    memo: input.memo ?? null,
    lineItems: input.lineItems ?? [],
    dueDate,
    allowPartial: input.allowPartial ?? true,
    payments: [],
    cursorBlock: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    voidedAt: null,
  };
  await invoices(ctx).put(invoice.id, invoice, { ttlMs: RECORD_TTL_MS });
  await businessEvent(ctx, "invoice.created", { id: invoice.id, amount: invoice.amount, token: invoice.token, payee: invoice.payee, reference: invoice.reference, url: payUrl(ctx, invoice.id) }, { developer: caller.developer, projectId: invoice.projectId, owner: invoice.payee });
  return invoice;
}

async function load(ctx: AppContext, id: string): Promise<Invoice> {
  const doc = INVOICE_ID.test(id) ? (await invoices(ctx).get(id))?.value : null;
  if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such invoice.");
  return { ...doc, status: invoiceStatusOf(doc, ctx.clock.now()) };
}

export async function getInvoice(ctx: AppContext, caller: FlowCaller, id: string): Promise<Invoice> {
  const invoice = await load(ctx, id).catch(() => null);
  if (!invoice || invoice.developer !== caller.developer) throw new LykiaHttpError("NOT_FOUND", 404, "No such invoice.");
  return invoice;
}

export async function listInvoices(ctx: AppContext, caller: FlowCaller, filter: { readonly projectId?: string; readonly status?: string } = {}): Promise<Invoice[]> {
  const now = ctx.clock.now();
  return (await listOwned(invoices(ctx), caller.developer, (i) => !filter.projectId || i.projectId === filter.projectId)).map((i) => ({ ...i, status: invoiceStatusOf(i, now) })).filter((i) => !filter.status || i.status === filter.status);
}

export async function voidInvoice(ctx: AppContext, caller: FlowCaller, id: string): Promise<Invoice> {
  const invoice = await getInvoice(ctx, caller, id);
  if (invoice.status === "paid") throw new LykiaHttpError("CONFLICT", 409, "A paid invoice cannot be voided.");
  if (invoice.status === "void") return invoice;
  const at = new Date(ctx.clock.now()).toISOString();
  const next: Invoice = { ...invoice, voidedAt: at, updatedAt: at, status: "void" };
  await invoices(ctx).put(id, next, { ttlMs: RECORD_TTL_MS });
  return next;
}

export async function publicInvoice(ctx: AppContext, id: string): Promise<InvoicePublicView> {
  const invoice = await load(ctx, id);
  const project = invoice.projectId ? await getProject(ctx, invoice.projectId) : null;
  return {
    id: invoice.id,
    environment: invoice.environment,
    token: invoice.token,
    payee: invoice.payee,
    payer: invoice.payer,
    amount: invoice.amount,
    paid: invoice.paid,
    due: invoiceDue(invoice),
    status: invoice.status,
    reference: invoice.reference,
    memo: invoice.memo,
    lineItems: invoice.lineItems,
    dueDate: invoice.dueDate,
    allowPartial: invoice.allowPartial,
    note: invoiceNote(invoice.id, invoice.reference),
    brand: project ? { name: project.name, ...(project.brand.colors?.primary ? { primary: project.brand.colors.primary } : {}), ...(project.brand.logoUrl ? { logoUrl: project.brand.logoUrl } : {}) } : null,
  };
}

/** The Fence a payer pays an invoice under: this payee, this token, the shepherd's caps and confirmations. */
export function invoiceFence(invoice: Pick<Invoice, "payee" | "token">): Fence {
  return { ...DEFAULT_FENCE, label: "Invoice payment", recipients: { mode: "allowlist", allow: [invoice.payee] }, tokens: { allow: [invoice.token], unlisted: "deny" } };
}

/** Plans the payer's transfer (stored intent, unsigned). The page then prepares and submits it through /v1/intents. */
export async function planInvoicePayment(ctx: AppContext, id: string, input: { readonly payer: Address; readonly amount?: string; readonly account?: "eoa" | "smart" }): Promise<{ invoice: InvoicePublicView; plan: CreateIntentResponse }> {
  const invoice = await load(ctx, id);
  if (invoice.status === "void") throw new LykiaHttpError("CONFLICT", 409, "This invoice was voided.");
  if (invoice.status === "paid") throw new LykiaHttpError("CONFLICT", 409, "This invoice is already paid.");
  if (invoice.payer && invoice.payer !== input.payer.toLowerCase()) throw new LykiaHttpError("FORBIDDEN", 403, "This invoice is addressed to another payer.");
  const due = invoiceDue(invoice);
  const amount = input.amount ?? due;
  if (!invoice.allowPartial && compareDecimalStrings(amount, due) !== 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `This invoice must be paid in full (${due} ${invoice.token}).`);
  if (compareDecimalStrings(amount, due) > 0 || compareDecimalStrings(amount, "0") <= 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Pay between 0 and ${due} ${invoice.token}.`);
  const project = invoice.projectId ? await getProject(ctx, invoice.projectId) : null;
  const integrator = project && project.fee.bps > 0 && project.fee.recipient ? { bps: project.fee.bps, recipient: project.fee.recipient, projectId: project.id } : undefined;
  const plan = await services(ctx).intents.create({
    environment: invoice.environment,
    owner: input.payer,
    actions: [{ verb: "send", token: invoice.token, amount: { exact: amount }, to: invoice.payee, memo: invoiceNote(invoice.id, invoice.reference) }],
    source: `pay invoice ${invoice.id}`,
    fence: invoiceFence(invoice),
    ...(input.account ? { account: input.account } : {}),
    ...(integrator ? { integrator } : {}),
  });
  return { invoice: await publicInvoice(ctx, id), plan };
}

/**
 * Reconciles one transaction against an invoice: it must have succeeded,
 * carry a Lykia memo naming the invoice and move the invoice token to the
 * payee. Returns the invoice and whether a new payment was added.
 */
export async function recordInvoicePayment(ctx: AppContext, id: string, hash: string, via: "submit" | "scan"): Promise<{ invoice: Invoice; added: boolean }> {
  const invoice = await load(ctx, id);
  if (invoice.payments.some((p) => p.txHash.toLowerCase() === hash.toLowerCase())) return { invoice, added: false };
  const receipt = (await ctx.chains.getTxReceipt(invoice.environment, hash)) as { status: string; logs?: readonly ReceiptLog[]; blockNumber?: bigint; from?: string } | null;
  if (!receipt) throw new LykiaHttpError("NOT_FOUND", 404, `Arc has no receipt for ${hash} yet. Try again once it is mined.`);
  if (receipt.status !== "success") throw new LykiaHttpError("CONFLICT", 409, "That transaction reverted on Arc.");
  const memos = memoEvents(receipt.logs).map((m) => decodeMemo(m.memo)).filter((m) => m !== null);
  if (!memos.some((m) => invoiceIdFromNote(m.note) === invoice.id)) throw new LykiaHttpError("NOT_AN_INVOICE_PAYMENT", 422, "That transaction carries no memo for this invoice.");
  const token = findToken(invoice.environment, invoice.token);
  const address = token ? tokenAddress(token, invoice.environment)?.toLowerCase() : null;
  const moved = transferEvents(receipt.logs).filter((t) => t.token === address && t.to === invoice.payee.toLowerCase());
  const total = moved.reduce((s, t) => s + t.value, 0n);
  if (!token || total === 0n) throw new LykiaHttpError("NOT_AN_INVOICE_PAYMENT", 422, `That transaction moved no ${invoice.token} to the payee.`);
  const before = invoice.status;
  const result = applyInvoicePayment(invoice, { txHash: hash.toLowerCase(), from: (moved[0]?.from ?? receipt.from ?? "0x0000000000000000000000000000000000000000") as Address, amount: fromBaseUnits(total, token.decimals), at: new Date(ctx.clock.now()).toISOString(), block: receipt.blockNumber !== undefined ? receipt.blockNumber.toString() : null, via }, ctx.clock.now());
  if (!result.added) return { invoice, added: false };
  await invoices(ctx).put(id, result.invoice, { ttlMs: RECORD_TTL_MS });
  const scope = { developer: invoice.developer, projectId: invoice.projectId, owner: invoice.payee };
  const data = { id, status: result.invoice.status, amount: result.invoice.amount, paid: result.invoice.paid, token: invoice.token, txHash: hash.toLowerCase(), reference: invoice.reference, partial: result.invoice.status !== "paid" };
  if (result.invoice.status === "paid" && before !== "paid") await businessEvent(ctx, "invoice.paid", data, scope);
  return { invoice: result.invoice, added: true };
}

/** First block of a scan: just after the cursor, else the last 500 blocks, never more than 9,000 back. */
function scanStart(cursor: string | null, head: bigint): bigint {
  const floor = head - 9_000n;
  const from = cursor ? BigInt(cursor) + 1n : head - 500n;
  return from < floor ? floor : from;
}

/** One pass over open invoices: transfers to the payee are checked for the invoice memo. */
export async function tickInvoices(ctx: AppContext): Promise<{ checked: number; payments: number }> {
  let checked = 0;
  let found = 0;
  const now = ctx.clock.now();
  const open = (await invoices(ctx).list({ limit: 2000 })).map((d) => d.value).filter((i) => !i.voidedAt && invoiceStatusOf(i, now) !== "paid");
  const heads = new Map<ArcEnvironment, bigint | null>();
  for (const invoice of open) {
    try {
      const client = ctx.chains.client(invoice.environment) as unknown as { getBlockNumber(): Promise<bigint>; getLogs(a: unknown): Promise<readonly { transactionHash: string | null }[]> };
      if (!heads.has(invoice.environment)) heads.set(invoice.environment, await client.getBlockNumber().catch(() => null));
      const head = heads.get(invoice.environment);
      if (head === null || head === undefined) continue;
      const token = findToken(invoice.environment, invoice.token);
      const address = token ? tokenAddress(token, invoice.environment) : null;
      if (!address) continue;
      checked += 1;
      const logs = await client.getLogs({ address, event: TRANSFER, args: { to: invoice.payee }, fromBlock: scanStart(invoice.cursorBlock, head), toBlock: head });
      const hashes = [...new Set(logs.map((l) => l.transactionHash).filter((h): h is string => Boolean(h)))].slice(0, 20);
      for (const hash of hashes) {
        const r = await recordInvoicePayment(ctx, invoice.id, hash, "scan").catch(() => null);
        if (r?.added) found += 1;
      }
      const latest = (await invoices(ctx).get(invoice.id))?.value ?? invoice;
      await invoices(ctx).put(invoice.id, { ...latest, cursorBlock: head.toString() }, { ttlMs: RECORD_TTL_MS });
    } catch (error) {
      ctx.log.debug("invoice scan failed", { invoice: invoice.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked, payments: found };
}
