import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReference, substituteContacts, untrustedContacts, computePreferences, detectPatterns, inverseAction, usualVenue, summarizeMemory, scaleActions, validateContact } from "../dist/index.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const day = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 12);

function rec(over) {
  return { id: "mem_x", intentId: "out_abc123", at: new Date(NOW - day).toISOString(), environment: "mainnet", source: "s", actions: [], resolved: [], venues: [], usd: null, outcome: "settled", ...over };
}
const swap = rec({ intentId: "out_swap01", source: "convert 100 USDC to EURC", actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "100" } }], resolved: [{ verb: "fx", venue: "uniswap-v3", tokenIn: "USDC", amountIn: "100", tokenOut: "EURC", amountOut: "89.6" }] });
const earn = rec({ intentId: "out_earn01", at: new Date(NOW - 7 * day).toISOString(), source: "put half my USDC to work", actions: [{ verb: "earn", token: "USDC", amount: { percent: 50 } }], resolved: [{ verb: "deposit", venue: "morpho-vaults", tokenIn: "USDC", amountIn: "250", tokenOut: "vUSDC", amountOut: "249" }] });
const send = rec({ intentId: "out_send01", at: new Date(NOW - 2 * day).toISOString(), source: "send 5 USDC", actions: [{ verb: "send", token: "USDC", amount: { exact: "5" }, to: A }], resolved: [{ verb: "transfer", venue: "arc-transfer", tokenIn: "USDC", amountIn: "5", recipient: A }] });
const memory = { intents: [swap, earn, send], contacts: [] };

test("undo plans the inverse at fresh prices; sends cannot be undone", () => {
  const u = resolveReference("undo the last swap", memory, NOW);
  assert.equal(u.kind, "undo");
  assert.deepEqual(u.actions, [{ verb: "fx", from: "EURC", to: "USDC", amount: { exact: "89.6" } }]);
  const conversion = resolveReference("undo the last conversion", memory, NOW);
  assert.equal(conversion.kind, "undo");
  const s = resolveReference("undo the last payment", memory, NOW);
  assert.equal(s.kind, "cannot-undo");
  const dep = resolveReference("undo the deposit", memory, NOW);
  assert.deepEqual(dep.actions, [{ verb: "withdraw", token: "USDC", amount: { exact: "250" }, venue: "morpho-vaults" }]);
});

test("again repeats the money that moved; same as last week finds the week-old plan", () => {
  const again = resolveReference("do it again", memory, NOW);
  assert.equal(again.kind, "repeat");
  assert.equal(again.from.intentId, "out_swap01");
  const week = resolveReference("same as last week", memory, NOW);
  assert.equal(week.kind, "repeat");
  assert.deepEqual(week.actions, [{ verb: "earn", token: "USDC", amount: { exact: "250" } }]);
  assert.equal(resolveReference("send 5 USDC to my friend and then do it again tomorrow please now", memory, NOW).kind, "none");
});

test("more than last time asks how much, then scales", () => {
  const m = resolveReference("send more than last time", memory, NOW);
  assert.equal(m.kind, "more-than-last");
  assert.deepEqual(scaleActions(m.base.actions, 25)[0].amount, { exact: "6.25" });
});

test("contacts: possessives, longest first, never trusted until confirmed", () => {
  const contacts = [
    { id: "ct_1", name: "Ahmet", aliases: ["Ahmet Bey"], address: A, origin: "learned", confirmedSends: 0, createdAt: "", lastUsedAt: null },
    { id: "ct_2", name: "Ayla", aliases: [], address: B, origin: "manual", confirmedSends: 2, createdAt: "", lastUsedAt: null },
  ];
  const r = substituteContacts("pay Ahmet 200 EURC, and send Ayla's wallet 5 USDC", contacts);
  assert.equal(r.text, `pay ${A} 200 EURC, and send ${B} wallet 5 USDC`);
  assert.equal(r.used.length, 2);
  const u = untrustedContacts([{ verb: "send", token: "EURC", amount: { exact: "200" }, to: A }, { verb: "send", token: "USDC", amount: { exact: "5" }, to: B }], contacts);
  assert.deepEqual(u.map((c) => c.name), ["Ahmet"]);
  assert.equal(substituteContacts("pay ahmetcan 5 usdc", contacts).used.length, 0);
  assert.ok(validateContact({ name: "", address: "0x1" }).length >= 2);
});

test("preferences, patterns, usual venue and the model summary", () => {
  const prefs = computePreferences(memory.intents);
  assert.equal(prefs.venues.deposit, "morpho-vaults");
  assert.equal(usualVenue("put 100 USDC in my usual vault", prefs)?.venue, "morpho-vaults");
  assert.equal(usualVenue("deposit 50 USDC as usual", prefs)?.venue, "morpho-vaults");
  const fridays = [0, 7, 14].map((w) => rec({ at: new Date(Date.UTC(2026, 9, 2 + w, 9)).toISOString(), actions: [{ verb: "send", token: "USDC", amount: { exact: "200" }, to: B }] }));
  const p = detectPatterns(fridays);
  assert.equal(p.length, 1);
  assert.equal(p[0].day, 5);
  assert.match(p[0].text, /every Friday send 200 USDC/u);
  const summary = summarizeMemory(memory, prefs);
  assert.match(summary, /preferred_venues=/u);
  assert.ok(summary.length <= 900);
  assert.equal(inverseAction({ verb: "transfer", venue: "x", tokenIn: "USDC", amountIn: "1" }), null);
});
