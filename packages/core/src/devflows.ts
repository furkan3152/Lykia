/**
 * Developer flow primitives (`lykia.payout/v1`, `lykia.invoice/v1`,
 * `lykia.automation/v1`, `lykia.agent/v1`).
 *
 * Everything here is pure: validation, CSV parsing and payment accounting.
 * Storage, planning, the Fence and the chain live in the API. Value never
 * moves without a Fence verdict and the payer's own signature (or a Circle
 * developer-controlled wallet the developer configured).
 */
import type { Address } from "./contracts.js";
import { isDecimalAmount } from "./amounts.js";
import { findToken } from "./assets.js";
import { cleanNote } from "./memo.js";
import type { ArcEnvironment } from "./networks.js";
import type { PlanAction } from "./actions.js";
import type { Fence } from "./fence.js";
import type { StepKind } from "./intent.js";
import type { PriceFeed } from "./standing.js";
import { PRICE_FEEDS } from "./standing.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const REFERENCE = /^[A-Za-z0-9 _.:#/-]{1,64}$/u;

export interface FlowIssue {
  readonly path: string;
  readonly message: string;
}

function positive(amount: string): boolean {
  return isDecimalAmount(amount) && /[1-9]/u.test(amount);
}

function decimalsOf(amount: string): number {
  return amount.split(".")[1]?.length ?? 0;
}

/* ================================================================ payouts */

export const PAYOUT_SCHEMA = "lykia.payout/v1" as const;
export const PAYOUT_LIMITS = Object.freeze({ rows: 100, reference: 64, memo: 120, csvBytes: 64 * 1024 });

export interface PayoutRowInput {
  readonly to: string;
  /** Registry symbol (USDC, EURC, MXNB, JPYC, ...) or token address. */
  readonly token: string;
  /** Decimal amount the recipient receives; Lykia's fee goes on top. */
  readonly amount: string;
  /** The payer's reference (invoice number, employee id). Carried in the Arc Memo. */
  readonly reference?: string;
  /** Free text for the memo. */
  readonly memo?: string;
}

export type PayoutRowStatus = "refused" | "planned" | "ready" | "submitted" | "settled" | "failed";
export type PayoutStatus = "refused" | "ready" | "partially-settled" | "submitted" | "settled" | "failed" | "dry-run";

export interface PayoutRow {
  readonly index: number;
  readonly to: Address;
  readonly token: string;
  readonly amount: string;
  readonly reference: string | null;
  readonly memo: string | null;
  status: PayoutRowStatus;
  /** Batch number this row is paid in, null when refused. */
  batch: number | null;
  stepId: string | null;
  /** keccak256("lykia:1:<intentId>:<stepId>"): the indexed memo id to find the transfer. */
  memoId: string | null;
  fee: string | null;
  reasons: string[];
  txHash: string | null;
}

export interface PayoutBatch {
  readonly index: number;
  readonly intentId: string;
  readonly verdict: { readonly decision: "allow" | "confirm" | "deny"; readonly digest: string };
  readonly rows: readonly number[];
  /** The unsigned Multicall3From batch; null for dry runs and batches that failed their check. */
  transaction: { readonly chainId: number; readonly from: Address; readonly to: Address; readonly data: `0x${string}`; readonly value: string; readonly label: string } | null;
  readonly binding: string;
  status: "planned" | "ready" | "submitted" | "settled" | "failed";
  simulation: { readonly ok: boolean | null; readonly reason?: string; readonly block?: string | null };
  txHash: string | null;
  circleTransactionId: string | null;
}

export interface PayoutTotal {
  readonly token: string;
  readonly amount: string;
  readonly fees: string;
}

export interface Payout {
  readonly schema: typeof PAYOUT_SCHEMA;
  readonly id: string;
  readonly developer: string;
  readonly projectId: string | null;
  readonly environment: ArcEnvironment;
  readonly payer: Address;
  readonly execution: "wallet" | "circle";
  /** The Circle developer-controlled wallet that executes the batches (execution "circle"). */
  readonly circleWalletId: string | null;
  status: PayoutStatus;
  readonly rows: PayoutRow[];
  readonly batches: PayoutBatch[];
  readonly totals: readonly PayoutTotal[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
  updatedAt: string;
}

/** Row checks that need no chain: address, registry token, amount precision, reference. */
export function validatePayoutRows(rows: readonly PayoutRowInput[], environment: ArcEnvironment): FlowIssue[] {
  const issues: FlowIssue[] = [];
  if (!Array.isArray(rows) || rows.length === 0) return [{ path: "rows", message: "At least one row." }];
  if (rows.length > PAYOUT_LIMITS.rows) issues.push({ path: "rows", message: `At most ${PAYOUT_LIMITS.rows} rows per payout.` });
  rows.forEach((row, i) => {
    const at = (field: string) => `rows.${i}.${field}`;
    if (typeof row.to !== "string" || !ADDRESS.test(row.to) || /^0x0{40}$/u.test(row.to)) issues.push({ path: at("to"), message: "A recipient address (0x + 40 hex)." });
    const token = typeof row.token === "string" ? findToken(environment, row.token) : null;
    if (!token) issues.push({ path: at("token"), message: `Not a registry token on ${environment}.` });
    if (typeof row.amount !== "string" || !positive(row.amount)) issues.push({ path: at("amount"), message: 'A positive decimal amount such as "125.50".' });
    else if (token && decimalsOf(row.amount) > token.decimals) issues.push({ path: at("amount"), message: `${token.symbol} has ${token.decimals} decimals.` });
    if (row.reference !== undefined && (typeof row.reference !== "string" || !REFERENCE.test(row.reference))) issues.push({ path: at("reference"), message: "1 to 64 letters, digits, spaces or _.:#/-" });
    if (row.memo !== undefined && (typeof row.memo !== "string" || row.memo.length > PAYOUT_LIMITS.memo)) issues.push({ path: at("memo"), message: `At most ${PAYOUT_LIMITS.memo} characters.` });
  });
  return issues;
}

/** The note a payout row carries in its Arc Memo: "ref <reference> · <memo>" (single line, at most 200 characters). */
export function payoutNote(payoutId: string, row: Pick<PayoutRowInput, "reference" | "memo">): string {
  const parts = [`payout ${payoutId}`, row.reference ? `ref ${row.reference}` : "", row.memo ?? ""].filter(Boolean);
  return cleanNote(parts.join(" · "));
}

/** Splits a CSV line (RFC 4180 quotes). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

const CSV_COLUMNS: Readonly<Record<string, keyof PayoutRowInput>> = { to: "to", address: "to", recipient: "to", wallet: "to", token: "token", currency: "token", asset: "token", amount: "amount", value: "amount", reference: "reference", ref: "reference", id: "reference", memo: "memo", note: "memo", description: "memo" };

/**
 * Parses a payout CSV. A header row names the columns (to/address,
 * token/currency, amount, reference, memo); without one the order is
 * to,token,amount,reference,memo.
 */
export function parsePayoutCsv(text: string): { readonly rows: PayoutRowInput[]; readonly issues: FlowIssue[] } {
  const issues: FlowIssue[] = [];
  if (text.length > PAYOUT_LIMITS.csvBytes) return { rows: [], issues: [{ path: "csv", message: `At most ${PAYOUT_LIMITS.csvBytes / 1024} KB.` }] };
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter((l) => l.trim().length > 0 && !l.trim().startsWith("#"));
  if (lines.length === 0) return { rows: [], issues: [{ path: "csv", message: "The CSV is empty." }] };
  const head = csvCells(lines[0] as string).map((c) => c.toLowerCase());
  const hasHeader = head.some((c) => c in CSV_COLUMNS) && !ADDRESS.test(head[0] ?? "");
  const columns: (keyof PayoutRowInput | null)[] = hasHeader ? head.map((c) => CSV_COLUMNS[c] ?? null) : ["to", "token", "amount", "reference", "memo"];
  if (hasHeader) for (const need of ["to", "token", "amount"] as const) if (!columns.includes(need)) issues.push({ path: "csv.header", message: `Missing a ${need} column.` });
  const rows: PayoutRowInput[] = [];
  lines.slice(hasHeader ? 1 : 0).forEach((line, i) => {
    const cells = csvCells(line);
    const row: Record<string, string> = {};
    columns.forEach((col, c) => {
      const value = cells[c];
      if (col && value !== undefined && value !== "") row[col] = value;
    });
    if (!row.to && !row.amount) return;
    if (!row.to || !row.token || !row.amount) {
      issues.push({ path: `csv.line.${i + (hasHeader ? 2 : 1)}`, message: "Needs to, token and amount." });
      return;
    }
    rows.push({ to: row.to, token: row.token, amount: row.amount.replace(/_/gu, ""), ...(row.reference ? { reference: row.reference } : {}), ...(row.memo ? { memo: row.memo } : {}) });
  });
  return { rows, issues };
}

/** Rolls row states up into the payout's status. */
export function payoutStatusOf(rows: readonly Pick<PayoutRow, "status">[]): PayoutStatus {
  const live = rows.filter((r) => r.status !== "refused");
  if (live.length === 0) return "refused";
  if (live.every((r) => r.status === "settled")) return "settled";
  if (live.every((r) => r.status === "failed")) return "failed";
  if (live.some((r) => r.status === "settled")) return "partially-settled";
  if (live.some((r) => r.status === "submitted")) return "submitted";
  if (live.every((r) => r.status === "planned")) return "dry-run";
  return "ready";
}

/* ================================================================ invoices */

export const INVOICE_SCHEMA = "lykia.invoice/v1" as const;
export const INVOICE_LIMITS = Object.freeze({ lineItems: 50, description: 160, reference: 64, payments: 50, memo: 200 });

export interface InvoiceLineItem {
  readonly description: string;
  /** Decimal quantity ("1", "2.5"). */
  readonly quantity: string;
  /** Decimal unit price in the invoice token. */
  readonly unitAmount: string;
}

export interface InvoiceInput {
  readonly token: string;
  /** The address that receives the money. */
  readonly payee: string;
  /** Total; computed from the line items when omitted. */
  readonly amount?: string;
  readonly payer?: string;
  /** ISO 8601 date or date-time. */
  readonly dueDate?: string;
  readonly reference?: string;
  readonly memo?: string;
  readonly lineItems?: readonly InvoiceLineItem[];
  /** Let the payer pay part of it (the pay page offers an amount field). Default true. */
  readonly allowPartial?: boolean;
}

export type InvoiceStatus = "open" | "partially-paid" | "paid" | "overdue" | "void";

export interface InvoicePayment {
  readonly txHash: string;
  readonly from: Address;
  /** Decimal amount that reached the payee. */
  readonly amount: string;
  readonly at: string;
  readonly block: string | null;
  /** How it was found: the payer reported the hash, or the reconciliation scan saw the memo. */
  readonly via: "submit" | "scan";
}

export interface Invoice {
  readonly schema: typeof INVOICE_SCHEMA;
  readonly id: string;
  readonly developer: string;
  readonly projectId: string | null;
  readonly environment: ArcEnvironment;
  readonly token: string;
  readonly payee: Address;
  readonly payer: Address | null;
  readonly amount: string;
  paid: string;
  status: InvoiceStatus;
  readonly reference: string | null;
  readonly memo: string | null;
  readonly lineItems: readonly InvoiceLineItem[];
  readonly dueDate: string | null;
  readonly allowPartial: boolean;
  readonly payments: InvoicePayment[];
  /** Block the reconciliation scan has read up to. */
  cursorBlock: string | null;
  readonly createdAt: string;
  updatedAt: string;
  voidedAt: string | null;
}

/** What the hosted pay page reads: no developer or project internals. */
export interface InvoicePublicView {
  readonly id: string;
  readonly environment: ArcEnvironment;
  readonly token: string;
  readonly payee: Address;
  readonly payer: Address | null;
  readonly amount: string;
  readonly paid: string;
  readonly due: string;
  readonly status: InvoiceStatus;
  readonly reference: string | null;
  readonly memo: string | null;
  readonly lineItems: readonly InvoiceLineItem[];
  readonly dueDate: string | null;
  readonly allowPartial: boolean;
  readonly note: string;
  readonly brand: { readonly name: string; readonly primary?: string; readonly logoUrl?: string } | null;
}

/** Fixed-point decimal arithmetic with 18 fraction digits. */
const SCALE = 18;
function toFixed(value: string): bigint {
  const [w = "0", f = ""] = value.split(".");
  return BigInt(w) * 10n ** BigInt(SCALE) + BigInt((f + "0".repeat(SCALE)).slice(0, SCALE) || "0");
}
function fromFixed(value: bigint, digits = SCALE): string {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const whole = v / 10n ** BigInt(SCALE);
  const frac = (v % 10n ** BigInt(SCALE)).toString().padStart(SCALE, "0").slice(0, digits).replace(/0+$/u, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function addDecimal(a: string, b: string): string {
  return fromFixed(toFixed(a) + toFixed(b));
}

export function subDecimal(a: string, b: string): string {
  return fromFixed(toFixed(a) - toFixed(b));
}

export function mulDecimal(a: string, b: string, digits = 6): string {
  return fromFixed((toFixed(a) * toFixed(b)) / 10n ** BigInt(SCALE), digits);
}

export function compareDecimalStrings(a: string, b: string): number {
  const x = toFixed(a);
  const y = toFixed(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

export function lineItemsTotal(items: readonly InvoiceLineItem[], digits = 6): string {
  return items.reduce((sum, item) => addDecimal(sum, mulDecimal(item.quantity, item.unitAmount, digits)), "0");
}

export function validateInvoiceInput(input: InvoiceInput, environment: ArcEnvironment): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const token = typeof input.token === "string" ? findToken(environment, input.token) : null;
  if (!token) issues.push({ path: "token", message: `Not a registry token on ${environment}.` });
  if (typeof input.payee !== "string" || !ADDRESS.test(input.payee)) issues.push({ path: "payee", message: "The payee address (0x + 40 hex)." });
  if (input.payer !== undefined && (typeof input.payer !== "string" || !ADDRESS.test(input.payer))) issues.push({ path: "payer", message: "An address (0x + 40 hex)." });
  const items = input.lineItems ?? [];
  if (items.length > INVOICE_LIMITS.lineItems) issues.push({ path: "lineItems", message: `At most ${INVOICE_LIMITS.lineItems} line items.` });
  items.forEach((item, i) => {
    if (typeof item.description !== "string" || item.description.trim().length === 0 || item.description.length > INVOICE_LIMITS.description) issues.push({ path: `lineItems.${i}.description`, message: `1 to ${INVOICE_LIMITS.description} characters.` });
    if (typeof item.quantity !== "string" || !positive(item.quantity)) issues.push({ path: `lineItems.${i}.quantity`, message: "A positive decimal." });
    if (typeof item.unitAmount !== "string" || !isDecimalAmount(item.unitAmount)) issues.push({ path: `lineItems.${i}.unitAmount`, message: "A decimal amount." });
  });
  if (input.amount === undefined && items.length === 0) issues.push({ path: "amount", message: "Give an amount or line items." });
  if (input.amount !== undefined) {
    if (typeof input.amount !== "string" || !positive(input.amount)) issues.push({ path: "amount", message: 'A positive decimal amount such as "250".' });
    else if (token && decimalsOf(input.amount) > token.decimals) issues.push({ path: "amount", message: `${token.symbol} has ${token.decimals} decimals.` });
    else if (items.length > 0 && issues.length === 0 && compareDecimalStrings(lineItemsTotal(items, token?.decimals ?? 6), input.amount) !== 0) issues.push({ path: "amount", message: "The amount does not match the line items." });
  } else if (items.length > 0 && issues.length === 0 && !positive(lineItemsTotal(items, token?.decimals ?? 6))) issues.push({ path: "lineItems", message: "The line items add up to zero." });
  if (input.dueDate !== undefined && (typeof input.dueDate !== "string" || Number.isNaN(Date.parse(input.dueDate)))) issues.push({ path: "dueDate", message: "An ISO 8601 date." });
  if (input.reference !== undefined && (typeof input.reference !== "string" || !REFERENCE.test(input.reference))) issues.push({ path: "reference", message: "1 to 64 letters, digits, spaces or _.:#/-" });
  if (input.memo !== undefined && (typeof input.memo !== "string" || input.memo.length > INVOICE_LIMITS.memo)) issues.push({ path: "memo", message: `At most ${INVOICE_LIMITS.memo} characters.` });
  return issues;
}

/** The memo note that ties a transfer to an invoice: "invoice inv_xxx". */
export function invoiceNote(id: string, reference?: string | null): string {
  return cleanNote(`invoice ${id}${reference ? ` ref ${reference}` : ""}`);
}

const INVOICE_ID = /\binvoice (inv_[a-z0-9]{12,24})\b/u;

/** The invoice id inside a memo note, or null. */
export function invoiceIdFromNote(note: string | undefined | null): string | null {
  return note ? (INVOICE_ID.exec(note)?.[1] ?? null) : null;
}

export function invoiceStatusOf(invoice: Pick<Invoice, "amount" | "paid" | "dueDate" | "voidedAt">, now: number): InvoiceStatus {
  if (invoice.voidedAt) return "void";
  if (compareDecimalStrings(invoice.paid, invoice.amount) >= 0) return "paid";
  if (invoice.dueDate && Date.parse(invoice.dueDate) < now) return "overdue";
  if (compareDecimalStrings(invoice.paid, "0") > 0) return "partially-paid";
  return "open";
}

/** Records a payment once (by tx hash) and recomputes paid and status. */
export function applyInvoicePayment<T extends Invoice>(invoice: T, payment: InvoicePayment, now: number): { readonly invoice: T; readonly added: boolean } {
  if (invoice.payments.some((p) => p.txHash.toLowerCase() === payment.txHash.toLowerCase())) return { invoice, added: false };
  if (invoice.payments.length >= INVOICE_LIMITS.payments) return { invoice, added: false };
  const payments = [...invoice.payments, payment];
  const paid = payments.reduce((sum, p) => addDecimal(sum, p.amount), "0");
  const next = { ...invoice, payments, paid, updatedAt: new Date(now).toISOString() };
  return { invoice: { ...next, status: invoiceStatusOf(next, now) }, added: true };
}

export function invoiceDue(invoice: Pick<Invoice, "amount" | "paid">): string {
  const left = subDecimal(invoice.amount, invoice.paid);
  return compareDecimalStrings(left, "0") > 0 ? left : "0";
}

/* ================================================================ automations */

export const AUTOMATION_SCHEMA = "lykia.automation/v1" as const;
export const AUTOMATION_EVENTS = ["payout.created", "payout.settled", "payout.failed", "invoice.created", "invoice.paid"] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export type AutomationTrigger =
  | { readonly type: "price"; readonly feed: PriceFeed; readonly op: "above" | "below"; readonly value: string }
  | { readonly type: "schedule"; readonly every: "day" | "week" | "month"; readonly weekday?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; readonly day?: number; readonly at: string; readonly timezone: string }
  | { readonly type: "balance"; readonly token: string; readonly op: "above" | "below"; readonly value: string; readonly address?: string }
  | { readonly type: "event"; readonly event: AutomationEvent };

export type AutomationAction = { readonly type: "plan"; readonly actions?: readonly PlanAction[]; readonly sentence?: string } | { readonly type: "notify"; readonly channel: "webhook" };

export type AutomationSource = "automation" | "standing" | "alert" | "order" | "agent";

export interface UnifiedAutomation {
  readonly schema: typeof AUTOMATION_SCHEMA;
  readonly id: string;
  readonly developer: string;
  readonly owner: Address;
  readonly projectId: string | null;
  readonly environment: ArcEnvironment;
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly action: AutomationAction;
  status: "active" | "paused";
  /** Where it runs: a standing order (plans on price or schedule) or Lykia's own evaluator. */
  readonly backing: { readonly kind: "standing" | "native"; readonly id: string | null };
  readonly maxFiresPerDay: number;
  fired: number;
  lastFiredAt: string | null;
  lastIntentId: string | null;
  lastObservation: string | null;
  readonly createdAt: string;
}

/** One row of GET /v1/automations: unified automations and the older objects they sit beside. */
export interface AutomationListEntry {
  readonly id: string;
  readonly source: AutomationSource;
  readonly name: string;
  readonly trigger: string;
  readonly action: string;
  readonly status: string;
  readonly controllable: boolean;
}

export function validateAutomationTrigger(trigger: AutomationTrigger): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const t = trigger as { type?: string } & Record<string, unknown>;
  if (t.type === "price") {
    if (!PRICE_FEEDS.includes(t.feed as PriceFeed)) issues.push({ path: "trigger.feed", message: `One of ${PRICE_FEEDS.join(", ")}.` });
    if (t.op !== "above" && t.op !== "below") issues.push({ path: "trigger.op", message: "above or below." });
    if (typeof t.value !== "string" || !positive(t.value)) issues.push({ path: "trigger.value", message: "A positive price." });
  } else if (t.type === "schedule") {
    if (!["day", "week", "month"].includes(t.every as string)) issues.push({ path: "trigger.every", message: "day, week or month." });
    if (typeof t.at !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(t.at)) issues.push({ path: "trigger.at", message: '"HH:MM".' });
    if (typeof t.timezone !== "string" || t.timezone.length === 0) issues.push({ path: "trigger.timezone", message: "An IANA time zone." });
  } else if (t.type === "balance") {
    if (typeof t.token !== "string" || t.token.length === 0) issues.push({ path: "trigger.token", message: "A registry token." });
    if (t.op !== "above" && t.op !== "below") issues.push({ path: "trigger.op", message: "above or below." });
    if (typeof t.value !== "string" || !isDecimalAmount(t.value)) issues.push({ path: "trigger.value", message: "A decimal amount." });
    if (t.address !== undefined && (typeof t.address !== "string" || !ADDRESS.test(t.address))) issues.push({ path: "trigger.address", message: "An address." });
  } else if (t.type === "event") {
    if (!AUTOMATION_EVENTS.includes(t.event as AutomationEvent)) issues.push({ path: "trigger.event", message: `One of ${AUTOMATION_EVENTS.join(", ")}.` });
  } else issues.push({ path: "trigger.type", message: "price, schedule, balance or event." });
  return issues;
}

export function describeAutomationTrigger(trigger: AutomationTrigger): string {
  switch (trigger.type) {
    case "price":
      return `${trigger.feed} ${trigger.op} ${trigger.value}`;
    case "schedule":
      return `every ${trigger.every}${trigger.weekday ? ` on ${trigger.weekday}` : ""}${trigger.day ? ` on day ${trigger.day}` : ""} at ${trigger.at} ${trigger.timezone}`;
    case "balance":
      return `${trigger.token} balance ${trigger.op} ${trigger.value}`;
    case "event":
      return `on ${trigger.event}`;
  }
}

/* ================================================================ agents API */

export const AGENT_API_SCHEMA = "lykia.agent/v1" as const;
/** Tools an API agent may be given. `plan` is the only one that proposes value moves. */
export const AGENT_API_TOOLS = ["plan", "flock", "scent", "venues", "prices", "search_routes", "knowledge", "outrun"] as const;
export type AgentApiTool = (typeof AGENT_API_TOOLS)[number];

export interface AgentApiBudget {
  readonly perRunUsd?: string;
  readonly dailyUsd?: string;
  readonly maxRunsPerDay?: number;
}

export interface AgentApiView {
  readonly schema: typeof AGENT_API_SCHEMA;
  readonly id: string;
  readonly developer: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly tools: readonly AgentApiTool[];
  readonly kinds: readonly StepKind[] | null;
  readonly venues: readonly string[] | null;
  /** The effective Fence: a strict subset of the project's Fence, narrowed by kinds, venues and budget. */
  readonly fence: Fence;
  readonly fenceHash: string;
  readonly budget: AgentApiBudget;
  readonly pack: readonly string[];
  readonly persona: string;
  readonly memory: boolean;
  readonly autoPrepare: boolean;
  /** "lykia": the server's model when it has one; "none": the deterministic reader only. */
  readonly llm: { readonly provider: "lykia" | "none" };
  readonly status: "active" | "paused";
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Applies a budget to a Fence: caps only ever get lower. */
export function budgetFence(fence: Fence, budget: AgentApiBudget): Fence {
  const lower = (a: string | undefined, b: string | undefined) => (a === undefined ? b : b === undefined ? a : compareDecimalStrings(a, b) <= 0 ? a : b);
  const caps = { ...(fence.caps ?? {}) } as Record<string, string | undefined>;
  const perStep = lower(caps.perStepUsd, budget.perRunUsd);
  const perIntent = lower(caps.perIntentUsd, budget.perRunUsd);
  const daily = lower(caps.dailyUsd, budget.dailyUsd);
  const next = { ...caps, ...(perStep ? { perStepUsd: perStep } : {}), ...(perIntent ? { perIntentUsd: perIntent } : {}), ...(daily ? { dailyUsd: daily } : {}) };
  return Object.keys(next).length > 0 ? { ...fence, caps: next as Fence["caps"] } : fence;
}

/** Narrows a Fence to step kinds and venues; never widens. */
export function narrowFence(fence: Fence, kinds: readonly StepKind[] | null, venues: readonly string[] | null): Fence {
  let next = fence;
  if (kinds) {
    const base = fence.kinds?.allow;
    const allow = [...new Set<StepKind>(["approve", ...kinds])].filter((k) => !base || base.includes(k));
    next = { ...next, kinds: { allow } };
  }
  if (venues) {
    const base = fence.venues?.allow;
    next = { ...next, venues: { ...(fence.venues ?? {}), allow: venues.filter((v) => !base || base.includes(v)) } };
  }
  return next;
}
