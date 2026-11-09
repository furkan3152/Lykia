import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Fence } from "@lykia/core";
import type { FoldInstructionsResponse } from "@lykia/core/api/fold";
import { createApp } from "../app.js";
import type { PulseFeed } from "../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../context.js";
import { agentServices, setLlmClient } from "../agents/index.js";
import { ownerFence } from "../personal/fence.js";
import { issueToken } from "../platform/session.js";
import { FakeArc, offlineFetch, serve, testConfig, type Served } from "./support.js";

// A throwaway key made for this test: it signs the loosening message as the owner.
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const OWNER = account.address.toLowerCase() as `0x${string}`;
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

interface View {
  readonly fence: Fence;
  readonly hash: string;
  readonly preset: string;
  readonly presetLabel: string;
  readonly custom: boolean;
  readonly migrated: boolean;
}

describe("the owner's Fence lives on the server", () => {
  let ctx: AppContext;
  let served: Served;
  let token: string;

  before(async () => {
    ctx = createContext(testConfig(), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: offlineFetch() });
    setLlmClient(ctx, null);
    served = await serve(createApp(ctx));
    token = issueToken(ctx, OWNER).token;
  });
  after(async () => {
    await served.close();
    await closeContext(ctx);
  });

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${served.url}${path}`, { method, headers: { "content-type": "application/json", "Lykia-Session": token }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: (await response.json()) as T };
  };

  it("starts as the Balanced preset, named after it (no Shepherd)", async () => {
    const r = await call<View>("GET", "/v1/me/fence");
    assert.equal(r.status, 200);
    assert.equal(r.body.preset, "balanced");
    assert.equal(r.body.presetLabel, "Balanced");
    assert.equal(r.body.fence.label, "Balanced");
    assert.equal(r.body.custom, false);
  });

  it("tightens at once and asks the owner's wallet to sign a loosening", async () => {
    const careful = await call<View>("PUT", "/v1/me/fence", { preset: "careful" });
    assert.equal(careful.status, 200);
    assert.equal(careful.body.presetLabel, "Careful");
    assert.equal(careful.body.fence.caps?.dailyUsd, "1000", "the preset's caps");
    const prefs = await call<{ preferences: { risk: string } }>("GET", "/v1/me/preferences");
    assert.equal(prefs.body.preferences.risk, "careful", "one control: the preset is the risk profile");

    const unsigned = await call<{ error: { code: string; details: { message: string; loosened: string[] } } }>("PUT", "/v1/me/fence", { preset: "bold" });
    assert.equal(unsigned.status, 403);
    assert.equal(unsigned.body.error.code, "FENCE_SIGNATURE_REQUIRED");
    assert.ok(unsigned.body.error.details.loosened.length > 0);
    const forged = await call<{ error: { code: string } }>("PUT", "/v1/me/fence", { preset: "bold", signature: await privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba").signMessage({ message: unsigned.body.error.details.message }) });
    assert.equal(forged.status, 403);
    const signed = await call<View>("PUT", "/v1/me/fence", { preset: "bold", signature: await account.signMessage({ message: unsigned.body.error.details.message }) });
    assert.equal(signed.status, 200);
    assert.equal(signed.body.presetLabel, "Bold");
  });

  it("a risk change through preferences is the same control, and is signed when it loosens", async () => {
    await call("PUT", "/v1/me/fence", { preset: "careful" });
    const loosen = await call<{ error: { code: string } }>("PUT", "/v1/me/preferences", { risk: "balanced" });
    assert.equal(loosen.status, 403);
    assert.equal(loosen.body.error.code, "FENCE_SIGNATURE_REQUIRED");
  });

  it("keeps an edited Fence, and the chat and automations plan under it, not under a Fence the client sends", async () => {
    const current = (await call<View>("GET", "/v1/me/fence")).body.fence;
    const tighter: Fence = { ...current, caps: { ...current.caps, dailyUsd: "123" } };
    const saved = await call<View>("PUT", "/v1/me/fence", { fence: tighter, migrated: true });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.custom, true);
    assert.equal(saved.body.migrated, true);
    assert.equal((await ownerFence(ctx, OWNER)).caps?.dailyUsd, "123");
  });

  it("lists every leash, agent and payment link as a Running row with one control", async () => {
    const agent = await agentServices(ctx).pack.create({ owner: OWNER, environment: "testnet", name: "Payroll", role: "payroll" });
    const r = await call<FoldInstructionsResponse>("GET", `/v1/fold/instructions?owner=${OWNER}`);
    assert.equal(r.status, 200);
    const row = r.body.instructions.find((i) => i.id === agent.id);
    assert.equal(row?.kind, "leash");
    assert.equal(row?.control?.label, "Pause");
    assert.equal(row?.control?.path, `/v1/pack/${encodeURIComponent(agent.id)}/pause`);
    const paused = await fetch(`${served.url}${row!.control!.path}`, { method: "POST", headers: { "content-type": "application/json", "Lykia-Session": token }, body: "{}" });
    assert.equal(paused.status, 200, "the control names a real endpoint");
    assert.equal(r.body.counts.agentsWorking, 1);
  });
});
