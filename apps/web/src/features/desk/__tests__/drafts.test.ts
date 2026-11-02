import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alertDraftLink, automationDraftLink, encodeDraft } from "@lykia/core";

import { reduce, assistantDraft, EMPTY } from "../../ask/model";
import { alertFormFromSearch, automationFormFromSearch, automationRequest } from "../drafts";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41";
const searchOf = (link: string) => link.slice(link.indexOf("?"));

describe("prefill from Lyko's drafts", () => {
  it("prefills the Alerts form from ?draft=", () => {
    const form = alertFormFromSearch(searchOf(alertDraftLink({ kind: "price-below", token: "EURC", threshold: "1.05", channels: ["inbox", "telegram"], cooldownSeconds: 3600 })));
    assert.deepEqual(form, { kind: "price-below", token: "EURC", threshold: "1.05", channels: ["inbox", "telegram"], cooldownSeconds: 3600 });
    assert.deepEqual(alertFormFromSearch(searchOf(alertDraftLink({ kind: "health-below", threshold: "1.4" })))?.channels, ["inbox"]);
  });

  it("ignores missing, malformed or out-of-range alert drafts", () => {
    assert.equal(alertFormFromSearch(""), null);
    assert.equal(alertFormFromSearch("?draft=%%%"), null);
    assert.equal(alertFormFromSearch(`?draft=${encodeDraft({ kind: "drain-wallet" })}`), null);
    assert.equal(alertFormFromSearch(`?draft=${encodeDraft({ kind: "price-above", token: "USDC", threshold: "1" })}`), null);
    assert.equal(alertFormFromSearch(`?draft=${encodeDraft({ kind: "price-above", token: "EURC", threshold: "-1" })}`), null);
    assert.equal(alertFormFromSearch(`?draft=${encodeDraft({ kind: "health-below", threshold: "1.2", channels: ["sms"] })}`), null);
    assert.equal(alertFormFromSearch(`?draft=${"A".repeat(5000)}`), null);
  });

  it("prefills the Automations form and turns it back into the API body", () => {
    const draft = { name: "Friday USDC sweep", trigger: { type: "schedule" as const, every: "week" as const, weekday: "fri" as const, at: "17:00", timezone: "Europe/Istanbul" }, action: { type: "plan" as const, sentence: "keep 1 USDC liquid and earn the rest" } };
    const form = automationFormFromSearch(searchOf(automationDraftLink(draft)));
    assert.ok(form);
    assert.equal(form.name, "Friday USDC sweep");
    assert.equal(form.triggerType, "schedule");
    assert.equal(form.weekday, "fri");
    assert.equal(form.timezone, "Europe/Istanbul");
    assert.equal(form.sentence, "keep 1 USDC liquid and earn the rest");
    assert.deepEqual(automationRequest(form, OWNER, "mainnet"), { owner: OWNER, environment: "mainnet", name: "Friday USDC sweep", trigger: draft.trigger, action: draft.action, maxFiresPerDay: 1 });
  });

  it("ignores automation drafts that do not check out", () => {
    const base = { name: "x", action: { type: "plan", sentence: "keep 1 USDC liquid and earn the rest" } };
    assert.equal(automationFormFromSearch(`?draft=${encodeDraft({ ...base, trigger: { type: "schedule", every: "week", at: "17:00", timezone: "UTC" } })}`), null);
    assert.equal(automationFormFromSearch(`?draft=${encodeDraft({ ...base, trigger: { type: "schedule", every: "day", at: "25:00", timezone: "UTC" } })}`), null);
    assert.equal(automationFormFromSearch(`?draft=${encodeDraft({ ...base, trigger: { type: "price", feed: "DOGE/USD", op: "above", value: "1" } })}`), null);
    assert.equal(automationFormFromSearch(`?draft=${encodeDraft({ ...base, trigger: { type: "event", event: "invoice.paid" }, action: { type: "send", to: OWNER } })}`), null);
  });

  it("shows only in-app draft links from chat", () => {
    const start = { ...EMPTY, messages: [assistantDraft()] };
    const ok = reduce(start, { event: "draft", data: { kind: "alert", saved: false, label: "EURC below $1.05", href: alertDraftLink({ kind: "price-below", token: "EURC", threshold: "1.05" }) } });
    assert.equal(ok.messages[0]?.drafts?.length, 1);
    const evil = reduce(start, { event: "draft", data: { kind: "alert", saved: false, label: "x", href: "https://example.com/app/alerts" } });
    assert.equal(evil.messages[0]?.drafts, undefined);
  });
});
