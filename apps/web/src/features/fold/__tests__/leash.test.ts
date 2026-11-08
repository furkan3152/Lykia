import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeDraft, leashDraftLink, leashDraftOf } from "@lykia/core";

import { budgetOf, draftFromParam, emptyForm, formFromDraft, formIssues, meterOf, nearCap, requestOf, sampleLeashes, stepLeft, timeLeft, withTemplate } from "../leash/model";

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
