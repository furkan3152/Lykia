import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FENCE,
  applyInvoicePayment,
  budgetFence,
  invoiceIdFromNote,
  invoiceNote,
  invoiceStatusOf,
  isSubFence,
  lineItemsTotal,
  narrowFence,
  parsePayoutCsv,
  payoutNote,
  payoutStatusOf,
  validateAutomationTrigger,
  validateInvoiceInput,
  validatePayoutRows,
} from "../dist/index.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

test("payout rows: registry tokens, precision, references", () => {
  assert.deepEqual(validatePayoutRows([{ to: A, token: "USDC", amount: "10.5", reference: "INV-1" }, { to: B, token: "MXNB", amount: "3" }], "mainnet"), []);
  const issues = validatePayoutRows([{ to: "0x12", token: "NOPE", amount: "0" }, { to: A, token: "USDC", amount: "1.1234567" }], "mainnet");
  assert.deepEqual(issues.map((i) => i.path), ["rows.0.to", "rows.0.token", "rows.0.amount", "rows.1.amount"]);
  assert.equal(validatePayoutRows([], "mainnet")[0].path, "rows");
});

test("payout CSV: header aliases, quotes, comments, header-less order", () => {
  const csv = `﻿Address,Currency,Amount,Ref,Note\n# skipped\n${A},USDC,10,INV-1,"March, part 1"\n${B},EURC,2.5,,\n`;
  const out = parsePayoutCsv(csv);
  assert.deepEqual(out.issues, []);
  assert.deepEqual(out.rows[0], { to: A, token: "USDC", amount: "10", reference: "INV-1", memo: "March, part 1" });
  assert.deepEqual(out.rows[1], { to: B, token: "EURC", amount: "2.5" });
  const bare = parsePayoutCsv(`${A},USDC,1,R-1`);
  assert.equal(bare.rows[0].reference, "R-1");
  assert.equal(parsePayoutCsv("to,amount\nx,1").issues[0].message, "Missing a token column.");
});

test("payout notes and status roll-up", () => {
  assert.equal(payoutNote("po_abc", { reference: "INV|9", memo: "line\nbreak" }), "payout po_abc · ref INV 9 · line break");
  assert.equal(payoutStatusOf([{ status: "settled" }, { status: "refused" }]), "settled");
  assert.equal(payoutStatusOf([{ status: "settled" }, { status: "ready" }]), "partially-settled");
  assert.equal(payoutStatusOf([{ status: "ready" }]), "ready");
  assert.equal(payoutStatusOf([{ status: "refused" }]), "refused");
});

test("invoices: totals, notes, partial payments, overdue, idempotent by hash", () => {
  assert.equal(lineItemsTotal([{ description: "a", quantity: "2", unitAmount: "60.5" }, { description: "b", quantity: "0.5", unitAmount: "3" }]), "122.5");
  assert.deepEqual(validateInvoiceInput({ token: "USDC", payee: A, amount: "122.5", lineItems: [{ description: "a", quantity: "2", unitAmount: "60.5" }, { description: "b", quantity: "0.5", unitAmount: "3" }] }, "mainnet"), []);
  assert.equal(validateInvoiceInput({ token: "USDC", payee: A, amount: "100", lineItems: [{ description: "a", quantity: "1", unitAmount: "99" }] }, "mainnet")[0].path, "amount");
  assert.equal(validateInvoiceInput({ token: "USDC", payee: A }, "mainnet")[0].path, "amount");
  const note = invoiceNote("inv_0123456789ab", "INV-7");
  assert.equal(invoiceIdFromNote(note), "inv_0123456789ab");
  assert.equal(invoiceIdFromNote("payout po_x"), null);
  const now = Date.UTC(2026, 10, 1);
  const base = { schema: "lykia.invoice/v1", id: "inv_0123456789ab", amount: "100", paid: "0", status: "open", dueDate: new Date(now + 86_400_000).toISOString(), voidedAt: null, payments: [] };
  const pay = (hash, amount) => ({ txHash: hash, from: B, amount, at: new Date(now).toISOString(), block: "1", via: "submit" });
  const one = applyInvoicePayment(base, pay("0xaa", "40"), now);
  assert.equal(one.invoice.status, "partially-paid");
  assert.equal(applyInvoicePayment(one.invoice, pay("0xAA", "40"), now).added, false);
  const two = applyInvoicePayment(one.invoice, pay("0xbb", "60.000001"), now);
  assert.deepEqual([two.invoice.status, two.invoice.paid], ["paid", "100.000001"]);
  assert.equal(invoiceStatusOf({ ...base, paid: "1" }, now + 2 * 86_400_000), "overdue");
  assert.equal(invoiceStatusOf({ ...base, voidedAt: "x" }, now), "void");
});

test("agent Fences only narrow", () => {
  const narrowed = budgetFence(narrowFence(DEFAULT_FENCE, ["transfer"], ["arc-transfer"]), { perRunUsd: "200", dailyUsd: "999999" });
  assert.equal(narrowed.caps.perStepUsd, "200");
  assert.equal(narrowed.caps.dailyUsd, DEFAULT_FENCE.caps.dailyUsd);
  assert.deepEqual([...narrowed.kinds.allow].sort(), ["approve", "transfer"]);
  assert.ok(isSubFence(DEFAULT_FENCE, narrowed));
});

test("automation triggers", () => {
  assert.deepEqual(validateAutomationTrigger({ type: "price", feed: "EURC/USD", op: "above", value: "1.12" }), []);
  assert.deepEqual(validateAutomationTrigger({ type: "schedule", every: "week", weekday: "mon", at: "09:00", timezone: "UTC" }), []);
  assert.equal(validateAutomationTrigger({ type: "event", event: "nope" })[0].path, "trigger.event");
  assert.equal(validateAutomationTrigger({ type: "x" })[0].path, "trigger.type");
});
