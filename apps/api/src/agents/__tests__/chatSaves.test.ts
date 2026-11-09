import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { alertDraftOf, automationDraftOf, decodeDraft, DEFAULT_FENCE, type Address } from "@lykia/core";
import type { ChatDraftLink } from "@lykia/core/api/agents";
import { createApp } from "../../app.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "../../__tests__/support.js";
import { alertsService } from "../../alerts/service.js";
import { listAllAutomations } from "../../devflows/automations.js";
import { issueToken } from "../../platform/session.js";
import { setLlmClient } from "../index.js";
import type { LlmClient, LlmResponse } from "../llm.js";
import { runTool, type ToolContext } from "../tools.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const FRIDAY_SWEEP = { name: "Friday USDC sweep", trigger: { type: "schedule", every: "week", weekday: "fri", at: "17:00", timezone: "Europe/Istanbul" }, action: { type: "plan", sentence: "keep 1 USDC liquid and earn the rest" } };

function toolContext(ctx: AppContext, owner: Address, ownerVerified: boolean): ToolContext & { drafts: ChatDraftLink[] } {
  return { ctx, environment: "mainnet", owner, ownerVerified, agent: { name: "Lyko", role: "orchestrator", fence: DEFAULT_FENCE, capabilities: ["read", "propose"] }, proposals: [], drafts: [] };
}

const dataOf = (content: string) => JSON.parse(/^<tool_data untrusted="true">([\s\S]*)<\/tool_data>$/u.exec(content)?.[1] ?? "null") as Record<string, unknown>;

describe("chat tools that save for the owner", () => {
  let ctx: AppContext;
  before(() => {
    ctx = createContext(testConfig(), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: offlineFetch() });
  });
  after(() => closeContext(ctx));

  it("create_alert arms the alert for a verified owner", async () => {
    const owner = "0x1000000000000000000000000000000000000001" as Address;
    const tc = toolContext(ctx, owner, true);
    const out = await runTool("create_alert", { kind: "price-below", token: "eurc", threshold: "1.05", channels: ["inbox", "telegram"] }, tc);
    assert.equal(out.ok, true, out.summary);
    const data = dataOf(out.content);
    assert.equal(data.saved, true);
    const rules = await alertsService(ctx).list(owner);
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.token, "EURC");
    assert.deepEqual(rules[0]!.channels, ["inbox", "telegram"]);
    assert.deepEqual(tc.drafts, [{ kind: "alert", saved: true, label: "EURC below $1.05", href: "/app/fold/herding?show=watches" }]);
  });

  it("create_alert saves nothing for an unverified owner and returns a prefilled link", async () => {
    const owner = "0x1000000000000000000000000000000000000002" as Address;
    const tc = toolContext(ctx, owner, false);
    const out = await runTool("create_alert", { kind: "health-below", threshold: "1.4", cooldownSeconds: 3600 }, tc);
    assert.equal(out.ok, true, out.summary);
    const data = dataOf(out.content);
    assert.equal(data.saved, false);
    assert.equal((await alertsService(ctx).list(owner)).length, 0);
    const link = String(data.link);
    assert.match(link, /^\/app\/alerts\?draft=[A-Za-z0-9_-]+$/u);
    assert.deepEqual(alertDraftOf(decodeDraft(link.split("draft=")[1])), { kind: "health-below", threshold: "1.4", cooldownSeconds: 3600 });
    assert.equal(tc.drafts[0]?.saved, false);
    assert.equal(tc.drafts[0]?.href, link);
  });

  it("create_alert refuses what the Alerts service refuses, before saving anything", async () => {
    const owner = "0x1000000000000000000000000000000000000003" as Address;
    const out = await runTool("create_alert", { kind: "price-above", token: "USDC", threshold: "1" }, toolContext(ctx, owner, true));
    assert.equal(out.ok, false);
    assert.match(out.summary, /unit of account/u);
    const bad = await runTool("create_alert", { kind: "price-above", token: "EURC", threshold: "-1" }, toolContext(ctx, owner, true));
    assert.equal(bad.ok, false);
    assert.equal((await alertsService(ctx).list(owner)).length, 0);
  });

  it("draft_automation saves the Friday sweep for a verified owner, under the Fence", async () => {
    const owner = "0x1000000000000000000000000000000000000004" as Address;
    const tc = toolContext(ctx, owner, true);
    const out = await runTool("draft_automation", FRIDAY_SWEEP, tc);
    assert.equal(out.ok, true, out.summary);
    const data = dataOf(out.content);
    assert.equal(data.saved, true);
    const { automations } = await listAllAutomations(ctx, { developer: owner, project: null, via: "session" });
    assert.equal(automations.length, 1);
    const saved = automations[0]!;
    assert.equal(saved.owner, owner);
    assert.equal(saved.backing.kind, "standing");
    assert.deepEqual(saved.fence, DEFAULT_FENCE);
    assert.deepEqual(saved.trigger, FRIDAY_SWEEP.trigger);
    assert.equal(saved.action.type, "plan");
    assert.equal(tc.drafts[0]?.href, "/app/fold/herding?show=automations");
  });

  it("draft_automation saves nothing for an unverified owner and returns a prefilled link", async () => {
    const owner = "0x1000000000000000000000000000000000000005" as Address;
    const tc = toolContext(ctx, owner, false);
    const out = await runTool("draft_automation", FRIDAY_SWEEP, tc);
    assert.equal(out.ok, true, out.summary);
    const data = dataOf(out.content);
    assert.equal(data.saved, false);
    assert.equal((await listAllAutomations(ctx, { developer: owner, project: null, via: "session" })).automations.length, 0);
    assert.equal((await ctx.store.collection("standing").list({ limit: 500 })).filter((d) => JSON.stringify(d.value).includes(owner)).length, 0);
    const link = String(data.link);
    assert.match(link, /^\/app\/automations\?draft=[A-Za-z0-9_-]+$/u);
    assert.deepEqual(automationDraftOf(decodeDraft(link.split("draft=")[1])), FRIDAY_SWEEP);
  });

  it("draft_automation checks the trigger and the sentence", async () => {
    const owner = "0x1000000000000000000000000000000000000006" as Address;
    const noWeekday = await runTool("draft_automation", { ...FRIDAY_SWEEP, trigger: { type: "schedule", every: "week", at: "17:00", timezone: "UTC" } }, toolContext(ctx, owner, true));
    assert.equal(noWeekday.ok, false);
    assert.match(noWeekday.summary, /weekday/u);
    const vague = await runTool("draft_automation", { ...FRIDAY_SWEEP, action: { type: "plan", sentence: "do something nice" } }, toolContext(ctx, owner, true));
    assert.equal(dataOf(vague.content).saved, false);
    assert.equal((await listAllAutomations(ctx, { developer: owner, project: null, via: "session" })).automations.length, 0);
  });
});

describe("POST /agent/chat: saving needs proof of the owner", () => {
  let ctx: AppContext;
  let served: Served;
  before(async () => {
    ctx = createContext(testConfig(), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: offlineFetch() });
    served = await serve(createApp(ctx));
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  let n = 0;
  const alertingModel = (): LlmClient => {
    let i = 0;
    return {
      model: "test-model",
      async turn() {
        i += 1;
        const content = i === 1 ? [{ type: "tool_use", id: `tu_${++n}`, name: "create_alert", input: { kind: "price-above", token: "cirBTC", threshold: "150000" } }] : [{ type: "text", text: "Done.", citations: null }];
        return { content: content as never, stop_reason: (i === 1 ? "tool_use" : "end_turn") as LlmResponse["stop_reason"] };
      },
    };
  };
  const chat = async (headers: Record<string, string>) => {
    setLlmClient(ctx, alertingModel());
    const res = await fetch(`${served.url}/v1/agent/chat`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify({ message: "tell me when cirBTC goes above 150000", owner: OWNER, environment: "mainnet" }) });
    return (await res.json()) as { events: { event: string; data: ChatDraftLink }[] };
  };

  it("an owner named in the body without a session gets a draft link and nothing is saved", async () => {
    const json = await chat({});
    const draft = json.events.find((e) => e.event === "draft")?.data;
    assert.equal(draft?.saved, false);
    assert.match(draft?.href ?? "", /^\/app\/alerts\?draft=/u);
    assert.equal((await alertsService(ctx).list(OWNER)).length, 0);
  });

  it("another address's session proves nothing either", async () => {
    const json = await chat({ "lykia-session": issueToken(ctx, "0x1111111111111111111111111111111111111111").token });
    assert.equal(json.events.find((e) => e.event === "draft")?.data.saved, false);
    assert.equal((await alertsService(ctx).list(OWNER)).length, 0);
  });

  it("the owner's own session saves the alert", async () => {
    const json = await chat({ "lykia-session": issueToken(ctx, OWNER).token });
    assert.equal(json.events.find((e) => e.event === "draft")?.data.saved, true);
    assert.equal((await alertsService(ctx).list(OWNER)).length, 1);
  });
});
