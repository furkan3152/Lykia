/** `@lykia/sdk/invoices`: invoices, hosted payment links (/pay/:id) and reconciliation by memo. */
import type { Address, ArcEnvironment, Invoice, InvoiceInput, InvoicePublicView } from "@lykia/core";
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import { q, type LykiaTransport } from "./transport.js";

export type InvoiceWithUrl = Invoice & { readonly url: string };

export function invoicesApi(t: LykiaTransport) {
  const id = (value: string) => encodeURIComponent(value);
  return {
    create: (input: InvoiceInput & { projectId?: string; environment?: ArcEnvironment }) => t.request<InvoiceWithUrl>("POST", "/v1/invoices", { ...input, environment: t.env(input.environment) }),
    list: (filter: { projectId?: string; status?: string } = {}) => t.request<{ invoices: Invoice[] }>("GET", `/v1/invoices${q(filter)}`),
    get: (invoiceId: string) => t.request<InvoiceWithUrl>("GET", `/v1/invoices/${id(invoiceId)}`),
    void: (invoiceId: string) => t.request<Invoice>("POST", `/v1/invoices/${id(invoiceId)}/void`, {}),
    /** What the hosted page reads (no key needed). */
    public: (invoiceId: string) => t.request<InvoicePublicView & { url: string }>("GET", `/v1/invoices/${id(invoiceId)}/public`),
    /** Plans the payer's transfer (unsigned); prepare and submit it with `lykia.intents`. */
    pay: (invoiceId: string, input: { payer: Address; amount?: string; account?: "eoa" | "smart" }) => t.request<{ invoice: InvoicePublicView; plan: CreateIntentResponse }>("POST", `/v1/invoices/${id(invoiceId)}/pay`, input),
    /** Reconciles a payment by transaction hash (the memo must name the invoice). */
    reportPayment: (invoiceId: string, hash: string) => t.request<{ added: boolean; invoice: InvoicePublicView }>("POST", `/v1/invoices/${id(invoiceId)}/payments`, { hash }),
  };
}

export type InvoicesApi = ReturnType<typeof invoicesApi>;
export type { Invoice, InvoiceInput, InvoicePublicView };
