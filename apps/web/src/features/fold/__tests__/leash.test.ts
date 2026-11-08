import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeDraft, leashDraftLink, leashDraftOf } from "@lykia/core";

import { budgetOf, destinationsLabel, draftFromParam, emptyForm, formFromDraft, formIssues, gatewayOptionOf, meterOf, nearCap, requestOf, sampleLeashes, spendFromLabel, stepLeft, timeLeft, toggleDestination, withSpendFrom, withTemplate } from "../leash/model";

const NOW = Date.UTC(2026, 10, 8, 12);
const OWNER = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";

describe("the New leash sheet", () => {
  it("opens prefilled from Ask Lyko's draft link, and refuses a tampered one", () => {
    const link = leashDraftLink({ name: "Invoice bot", template: "pay-invoices", perDayUsd: "20", days: 7 });
    const param = new URL(`https://lykiaai.com${link}`).searchParams.get("leash");
    const draft = draftFromParam(param, decodeDraft);
    assert.deepEqual(draft, { name: "Invoice bot", template: "pay-invoices", perDayUsd: "20", days: 7 });
    const form = formFromDraft(draft!);
    assert.equal(form.perStepUsd, "20");
    assert.deepEqual(budgetOf(form), { perStepUsd: "20", perDayUsd: "20", totalUsd: "140.00" });
    assert.equal(draftFromParam("not-base64!", decodeDraft), null);
    assert.equal(leashDraftOf({ name: "x", template: "custom", perDayUsd: "20", days: 7 }), null, "custom never comes from a link");
    assert.equal(leashDraftOf({ name: "x", template: "earn", perDayUsd: "20", days: 400 }), null);
  });

  it("checks each step before moving on", () => {
    const blank = emptyForm("pay-invoices");
    assert.ok(formIssues(blank, "who", OWNER).some((i) => i.field === "name"));
    assert.deepEqual(formIssues({ ...blank, name: "Bot" }, "who", OWNER), []);
    assert.ok(formIssues({ ...blank, name: "Bot", keyMode: "own", signer: OWNER }, "who", OWNER).some((i) => i.field === "signer"), "the owner's wallet is not the agent's key");
    assert.ok(formIssues({ ...blank, name: "Bot" }, "limits", OWNER).some((i) => i.field === "recipients"), "invoices need a payee");
    assert.deepEqual(formIssues({ ...blank, name: "Bot", recipients: PAYEE }, "limits", OWNER), []);
    assert.ok(formIssues({ ...blank, name: "Bot", recipients: PAYEE, perStepUsd: "30", perDayUsd: "20" }, "limits", OWNER).some((i) => i.field === "perStepUsd"));
    assert.ok(formIssues({ ...blank, name: "Bot", recipients: PAYEE, days: "120" }, "limits", OWNER).some((i) => i.field === "days"));
    const trade = withTemplate({ ...blank, name: "Bot" }, "trade-small");
    assert.deepEqual(trade.venues, ["uniswap-v3", "archery", "unitflow-finance-v3"]);
    assert.ok(formIssues({ ...trade, venues: [] }, "limits", OWNER).some((i) => i.field === "venues"));
  });

  it("sends the request the API expects", () => {
    const form = { ...emptyForm("pay-invoices"), name: " Invoice bot ", recipients: `${PAYEE}\n${PAYEE.toUpperCase().replace("0X", "0x")}`, perDayUsd: "20", perStepUsd: "15", days: "7" };
    const body = requestOf(form, { owner: OWNER, environment: "mainnet", signer: "0x7777777777777777777777777777777777777777", now: NOW });
    assert.deepEqual(body.budget, { perStepUsd: "15", perDayUsd: "20", totalUsd: "140.00" });
    assert.deepEqual(body.recipients, [PAYEE]);
    assert.equal(body.agent?.name, "Invoice bot");
    assert.equal(body.expiresAt, new Date(NOW + 7 * 86_400_000).toISOString());
    assert.equal(body.venues, undefined, "the template's venues are the default");
    const trade = requestOf({ ...withTemplate(form, "trade-small"), venues: ["uniswap-v3"] }, { owner: OWNER, environment: "mainnet", signer: "0x7777777777777777777777777777777777777777", now: NOW });
    assert.deepEqual(trade.venues, ["uniswap-v3"]);
    assert.equal(trade.recipients, undefined);
  });
});

describe("leash cards", () => {
  it("shows the sample invoice bot near its cap with what is left for the next step", () => {
    const [bot, trader] = sampleLeashes(NOW);
    assert.equal(nearCap(bot!), true);
    assert.equal(nearCap(trader!), false);
    assert.equal(meterOf(bot!.usage.day).tone, "warn");
    assert.equal(stepLeft(bot!), "2.83");
    assert.equal(timeLeft(bot!.expiresAt, NOW), "4 d 6 h left");
    assert.equal(timeLeft(new Date(NOW + 5 * 3_600_000).toISOString(), NOW), "5 h left");
    assert.equal(timeLeft(new Date(NOW - 1).toISOString(), NOW), "expired");
  });
});

describe("spend from a Gateway balance", () => {
  const offer = { available: { mainnet: true }, destinations: [{ key: "arc", name: "Arc", domain: 26 }, { key: "base", name: "Base", domain: 6 }], ceilings: { perStepUsd: "100", perDayUsd: "300" } };

  it("is coming soon wherever the API does not offer it", () => {
    assert.deepEqual(gatewayOptionOf(undefined, "mainnet"), { available: false, reason: "Coming soon.", destinations: [] });
    assert.equal(gatewayOptionOf(offer, "testnet").available, false);
    assert.equal(gatewayOptionOf(offer, "mainnet").available, true);
  });

  it("takes the Pay invoices template, needs a chain, and keeps to the Stile ceilings", () => {
    const trade = withTemplate({ ...emptyForm("pay-invoices"), name: "Bot" }, "trade-small");
    const gw = withSpendFrom(trade, "gateway");
    assert.equal(gw.template, "pay-invoices");
    assert.deepEqual(gw.destinations, ["arc"]);
    assert.deepEqual(formIssues(gw, "from", OWNER), []);
    assert.ok(formIssues(toggleDestination(gw, "arc"), "from", OWNER).some((i) => i.field === "destinations"));
    const big = { ...toggleDestination(gw, "base"), recipients: PAYEE, perStepUsd: "150", perDayUsd: "400" };
    const issues = formIssues(big, "limits", OWNER).map((i) => i.message).join(" ");
    assert.match(issues, /\$100 per transfer/u);
    assert.match(issues, /\$300 a day/u);
    assert.equal(withTemplate(gw, "earn").spendFrom, "arc", "other templates spend from the Arc wallet");
  });

  it("sends spendFrom and the destinations, never venues", () => {
    const gw = { ...toggleDestination(withSpendFrom({ ...emptyForm("pay-invoices"), name: "Payouts" }, "gateway"), "base"), recipients: PAYEE, perDayUsd: "50", perStepUsd: "25", days: "5" };
    const body = requestOf(gw, { owner: OWNER, environment: "mainnet", signer: "0x7777777777777777777777777777777777777777", now: NOW });
    assert.equal(body.spendFrom, "gateway");
    assert.deepEqual(body.destinations, ["arc", "base"]);
    assert.equal(body.venues, undefined);
    assert.equal(body.template, "pay-invoices");
    assert.equal(requestOf({ ...emptyForm("pay-invoices"), name: "x", recipients: PAYEE }, { owner: OWNER, environment: "mainnet", signer: "0x7777777777777777777777777777777777777777", now: NOW }).spendFrom, undefined);
  });

  it("shows the source and the chains on the card", () => {
    const [bot, , runner] = sampleLeashes(NOW);
    assert.equal(spendFromLabel(bot!), "Arc wallet");
    assert.equal(destinationsLabel(bot!), null);
    assert.equal(spendFromLabel(runner!), "Gateway balance");
    assert.equal(destinationsLabel(runner!, offer), "Base, Arbitrum, Arc");
  });
});
