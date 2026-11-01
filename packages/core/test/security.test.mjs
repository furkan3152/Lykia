import { test } from "node:test";
import assert from "node:assert/strict";
import { bytecodeTraits, contractFindings, findLookalike, monitorFindings, nextAuditEntry, recipientFindings, venueBreaker, verifyAuditChain, whistleAction, DEFAULT_MONITOR_POLICY, decisionOf } from "../dist/security/index.js";

const OWNER = "0x82916bee18fcef517b26c72d7cb5f13694e1db41";
const FRIEND = "0x1234567890abcdef1234567890abcdef12345678";

test("look-alikes match the characters wallets show", () => {
  assert.equal(findLookalike(FRIEND, [FRIEND]), null);
  assert.equal(findLookalike("0x1234000000000000000000000000000000005678", [FRIEND])?.strength, "strong");
  assert.equal(findLookalike("0x1230000000000000000000000000000000000678", [FRIEND])?.strength, "weak");
  assert.equal(findLookalike("0x9999000000000000000000000000000000005678", [FRIEND]), null);
});

test("recipient findings: poisoning blocks, blocklist blocks, strangers warn", () => {
  const base = { owner: OWNER, known: [FRIEND], zeroValueSenders: [], isContract: false, blocklisted: false, screening: null };
  const weak = "0x1230000000000000000000000000000000000678";
  assert.equal(recipientFindings({ ...base, recipient: weak }).find((f) => f.rule === "address.lookalike").severity, "warn");
  assert.equal(recipientFindings({ ...base, recipient: weak, zeroValueSenders: [weak] }).find((f) => f.rule === "address.lookalike").severity, "block");
  assert.equal(decisionOf(recipientFindings({ ...base, recipient: "0x5555555555555555555555555555555555555555", blocklisted: true })), "block");
  assert.equal(decisionOf(recipientFindings({ ...base, recipient: "0x5555555555555555555555555555555555555555", screening: "DENIED" })), "block");
  assert.deepEqual(recipientFindings({ ...base, recipient: FRIEND }), []);
  assert.deepEqual(recipientFindings({ ...base, recipient: OWNER }), []);
  assert.ok(recipientFindings({ ...base, recipient: "0x5555555555555555555555555555555555555555" }).some((f) => f.rule === "address.first-time"));
});

test("bytecode traits skip PUSH data", () => {
  assert.equal(bytecodeTraits("0x60ff").selfdestruct, false, "0xff inside PUSH1 is data");
  assert.equal(bytecodeTraits("0x6000ff").selfdestruct, true);
  assert.equal(bytecodeTraits("0x5af4").delegatecall, true);
  assert.equal(bytecodeTraits("0x").hasCode, false);
  assert.equal(bytecodeTraits("0x363d3d373d3d3d363d73" + "ab".repeat(20) + "5af43d82803e903d91602b57fd5bf3").minimalProxy, true);
  const facts = { traits: bytecodeTraits("0x6000ff"), implementation: "0x" + "11".repeat(20), admin: null, ageSeconds: 3600, verified: false, listed: false };
  const rules = contractFindings("0x" + "22".repeat(20), facts).map((f) => f.rule);
  assert.deepEqual(rules.sort(), ["contract.proxy", "contract.selfdestruct", "contract.unverified", "contract.young"]);
  assert.ok(contractFindings("0x" + "22".repeat(20), { ...facts, listed: true }).every((f) => f.severity === "info"));
});

test("the audit chain detects edits, removals and reordering", () => {
  const entries = [];
  for (let i = 0; i < 4; i++) entries.push(nextAuditEntry(entries.at(-1) ?? null, { kind: "prepare", actor: OWNER, subject: `out_x:s${i}`, data: { i } }, `2026-11-01T00:00:0${i}.000Z`));
  assert.deepEqual(verifyAuditChain(entries), { ok: true, brokenAt: null });
  assert.equal(verifyAuditChain(entries.slice(2)).ok, true, "a page from the middle verifies on its own links");
  assert.equal(verifyAuditChain([entries[0], entries[2], entries[3]]).ok, false);
  assert.equal(verifyAuditChain([{ ...entries[0], data: { i: 9 } }, ...entries.slice(1)]).brokenAt, 1);
  assert.equal(verifyAuditChain([entries[1], entries[0]]).ok, false);
});

test("monitor: velocity blocks, anomalies warn, the Auto-Whistle pauses only keeper runs", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const ev = (minsAgo, usd, extra = {}) => ({ at: now - minsAgo * 60_000, kind: "prepare", usd, venue: "aave-v4", recipient: null, ...extra });
  const policy = { ...DEFAULT_MONITOR_POLICY, txPerMinute: 2, usdPerHour: 1000 };
  assert.ok(monitorFindings([ev(0.2, 1), ev(0.5, 1)], { at: now, usd: 1, venue: "aave-v4", recipient: null }, policy).some((f) => f.rule === "monitor.velocity-tx" && f.severity === "block"));
  assert.ok(monitorFindings([ev(30, 900)], { at: now, usd: 200, venue: "aave-v4", recipient: null }, policy).some((f) => f.rule === "monitor.velocity-usd"));
  const history = [ev(300, 10), ev(290, 12), ev(280, 9), ev(270, 11), ev(260, 10)];
  const spike = monitorFindings(history, { at: now, usd: 500, venue: "uniswap-v4", recipient: null }, { ...policy, usdPerHour: 10_000 });
  assert.deepEqual(spike.map((f) => f.rule).sort(), ["monitor.spend-spike", "monitor.unusual-venue"]);
  const burst = [ev(3, 1, { recipient: "0x" + "a1".repeat(20) }), ev(2, 1, { recipient: "0x" + "a2".repeat(20) })];
  assert.ok(monitorFindings(burst, { at: now, usd: 1, venue: "aave-v4", recipient: "0x" + "a3".repeat(20) }, { ...policy, txPerMinute: 10 }).some((f) => f.rule === "monitor.new-recipient-burst"));
  const fails = [1, 2, 3].map((m) => ({ ...ev(m, null), kind: "failed" }));
  assert.ok(monitorFindings(fails, { at: now, usd: 1, venue: "aave-v4", recipient: null }, policy).some((f) => f.rule === "monitor.repeated-failures"));
  assert.ok(monitorFindings([], { at: now, usd: 1, venue: "aave-v4", recipient: null }, { ...policy, activeHoursUtc: [9, 10] }).some((f) => f.rule === "monitor.outside-schedule"));
  assert.equal(whistleAction(spike, { ...policy, onAnomaly: "pause" }, true), "pause");
  assert.equal(whistleAction(spike, { ...policy, onAnomaly: "pause" }, false), "flag");
  assert.equal(whistleAction([], policy, true), "none");
});

test("circuit breakers: halt, switches and health facts", () => {
  assert.equal(venueBreaker({ venue: "a" }).state, "healthy");
  assert.equal(venueBreaker({ venue: "a", halted: true }).state, "blocked");
  assert.equal(venueBreaker({ venue: "a", disabled: { reason: "exploit at the venue" } }).state, "blocked");
  assert.equal(venueBreaker({ venue: "a", paused: true }).state, "blocked");
  assert.equal(venueBreaker({ venue: "a", oracleAgeSeconds: 90_000 }).state, "degraded");
  assert.equal(venueBreaker({ venue: "a", oracleAgeSeconds: 200_000 }).state, "blocked");
  assert.equal(venueBreaker({ venue: "a", deviationBps: 150 }).state, "degraded");
  assert.equal(venueBreaker({ venue: "a", deviationBps: 400 }).state, "blocked");
  assert.equal(venueBreaker({ venue: "a", tvlChange24h: -0.7 }).state, "blocked");
  assert.equal(venueBreaker({ venue: "a", utilization: 0.96 }).state, "degraded");
  assert.equal(venueBreaker({ venue: "a", recentAdminEvent: true }).reasons.length, 1);
});
