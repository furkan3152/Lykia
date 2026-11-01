import { test } from "node:test";
import assert from "node:assert/strict";
import { outrunOf, unlockSteps, topologicalOrder, validateIntentGraph, DEFAULT_FENCE, evaluateFence, commandOf, easterEggOf, lykoMood, waypointName } from "../dist/index.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const USDC = "0x3600000000000000000000000000000000000000";
const amt = (amount) => ({ symbol: "USDC", token: USDC, decimals: 6, amount, usd: "1" });

function graph() {
  const verdict = evaluateFence(DEFAULT_FENCE, { environment: "testnet", signer: "wallet", owner: OWNER, steps: [], now: 0 });
  return {
    spec: "lykia.intent/v1", id: "out_1", environment: "testnet", createdAt: "2026-11-01T00:00:00Z", source: "test", owner: OWNER, verdict, warnings: [],
    steps: [
      { id: "s1", kind: "approve", venue: "vault", summary: "Approve", signer: "wallet", account: OWNER, dependsOn: [], inputs: [], outputs: [], settlement: { kind: "receipt" }, status: "settled", references: ["0xabc"] },
      { id: "s2", kind: "deposit", venue: "vault", summary: "Deposit 100 USDC", signer: "wallet", account: OWNER, dependsOn: ["s1"], inputs: [amt("100000000")], outputs: [{ ...amt("99000000"), symbol: "vUSDC" }], settlement: { kind: "receipt" }, status: "blocked" },
    ],
  };
}

test("outrun names waypoints along the Lycian Way and finds the fold", () => {
  const g = graph();
  assert.deepEqual(validateIntentGraph(g), []);
  assert.deepEqual(unlockSteps(g), ["s2"]);
  const o = outrunOf(g);
  assert.deepEqual(o.waypoints.map((w) => w.name), ["Ölüdeniz", "Faralya"]);
  assert.equal(o.current, 1);
  assert.equal(o.waypoints[1].turn, "signer");
  assert.deepEqual(o.fold, ["99 vUSDC"]);
  assert.equal(o.progress, 0.5);
  assert.match(o.waypoints[0].explorer[0], /explorer\.testnet\.arc\.io\/tx\/0xabc/u);
});

test("cycles are caught", () => {
  assert.throws(() => topologicalOrder([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }]));
});

test("lore: commands, eggs, moods", () => {
  assert.equal(commandOf("That'll do!"), "that'll do");
  assert.equal(commandOf("come bye"), "come bye");
  assert.equal(commandOf("send 5 usdc"), null);
  assert.equal(easterEggOf("Lykaion"), "lykaion");
  assert.equal(lykoMood({ whistle: false, threats: 3, running: 0, settledJustNow: false, idleMinutes: 0 }), "growling");
  assert.equal(waypointName(12), "Ölüdeniz");
});
