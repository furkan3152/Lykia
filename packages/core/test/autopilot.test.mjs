import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTOPILOT_ACK_TEXT,
  AUTOPILOT_BETA,
  AUTOPILOT_TRUST,
  autopilotAckDigest,
  autopilotBudget,
  autopilotCeiling,
  autopilotFence,
  autopilotLimitIssues,
  autopilotTask,
  buildCapabilityMap,
  guardVerdict,
  readAssist,
  scheduleDue,
  taskSentence,
  validateFence,
} from "../dist/index.js";
import { parseAnswerBlock } from "../dist/api/answer.js";

const PAYEE = "0x2222222222222222222222222222222222222222";
const at = { id: "apt_00000001", now: "2026-11-08T10:00:00.000Z", limits: { perStepUsd: "50" }, payees: [PAYEE] };

describe("Autopilot", () => {
  it("binds the acknowledgement to its exact text", () => {
    assert.match(autopilotAckDigest(), /^sha256:[0-9a-f]{64}$/u);
    assert.notEqual(autopilotAckDigest(`${AUTOPILOT_ACK_TEXT} `), autopilotAckDigest());
    assert.ok(AUTOPILOT_ACK_TEXT.includes("Lykia never holds your funds"));
    assert.ok(AUTOPILOT_ACK_TEXT.includes("until you revoke"));
    assert.deepEqual(AUTOPILOT_TRUST.map((t) => t.who), ["You", "Circle", "Lykia", "Chain"]);
  });

  it("keeps limits under the beta ceilings and the mainnet beta cap", () => {
    assert.deepEqual(autopilotLimitIssues({ perStepUsd: "100", perDayUsd: "300", days: 30 }, null), []);
    const over = autopilotLimitIssues({ perStepUsd: "101", perDayUsd: "301", days: 31 }, null).map((i) => i.path);
    assert.deepEqual(over, ["limits.days"], "days are checked first");
    assert.deepEqual(autopilotLimitIssues({ perStepUsd: "101", perDayUsd: "301", days: 7 }, null).map((i) => i.path), ["limits.perStepUsd", "limits.perDayUsd"]);
    assert.deepEqual(autopilotCeiling({ perStepUsd: "40", perDayUsd: "1000" }), { perStepUsd: "40", perDayUsd: AUTOPILOT_BETA.perDayUsd });
    assert.ok(autopilotLimitIssues({ perStepUsd: "50", perDayUsd: "100", days: 7 }, { perStepUsd: "40", perDayUsd: "1000" }).some((i) => /beta cap/u.test(i.message)));
    assert.ok(autopilotLimitIssues({ perStepUsd: "60", perDayUsd: "50", days: 7 }, null).some((i) => i.path === "limits.perStepUsd"));
    assert.deepEqual(autopilotBudget({ perStepUsd: "25", perDayUsd: "60", days: 7 }), { perStepUsd: "25", perDayUsd: "60", totalUsd: "420.00" });
  });

  it("builds a Fence an agent can sign under and that pins money to the owner or named payees", () => {
    const f = autopilotFence({ environment: "mainnet", limits: { perStepUsd: "25", perDayUsd: "60", days: 7 }, payees: [PAYEE.toUpperCase().replace("0X", "0x")] });
    assert.equal(validateFence(f).ok, true);
    assert.deepEqual(f.signers, ["agent"]);
    assert.deepEqual(f.recipients, { mode: "allowlist", allow: [PAYEE] });
    assert.equal(f.caps.perStepUsd, "25");
    assert.ok(!f.kinds.allow.includes("borrow") && !f.kinds.allow.includes("bridge"), "Autopilot never borrows or bridges");
    assert.deepEqual(autopilotFence({ environment: "mainnet", limits: { perStepUsd: "5", perDayUsd: "5", days: 1 }, payees: [] }).recipients, { mode: "own" });
  });

  it("builds the tasks and refuses ones outside the step cap or the payees", () => {
    const repay = autopilotTask({ kind: "repay", amountUsd: "50", floor: "1.5" }, at);
    assert.equal(repay.task.sentence, "repay 50 USDC on Aave");
    assert.deepEqual(repay.task.when, { kind: "condition", condition: { kind: "health-below", threshold: "1.5", venue: "aave-v4" } });
    const dca = autopilotTask({ kind: "dca", amountUsd: "20", every: "week", to: "EURC" }, at);
    assert.equal(dca.task.sentence, "convert 20 USDC to EURC");
    const sweep = autopilotTask({ kind: "sweep", amountUsd: "50", keepUsd: "200", vault: "Galaxy vault" }, at).task;
    assert.equal(taskSentence(sweep, { idleUsdc: 230.5 }), "deposit 30.5 USDC into Galaxy vault");
    assert.equal(taskSentence(sweep, { idleUsdc: 900 }), "deposit 50 USDC into Galaxy vault", "at most the task's amount");
    assert.equal(taskSentence(sweep, { idleUsdc: 200.4 }), null, "nothing to move");
    assert.equal(autopilotTask({ kind: "pay", amountUsd: "20", every: "month", payee: PAYEE }, at).task.sentence, `send 20 USDC to ${PAYEE}`);
    assert.ok(autopilotTask({ kind: "pay", amountUsd: "60", every: "month", payee: PAYEE }, at).issues.some((i) => i.path === "amountUsd"));
    assert.ok(autopilotTask({ kind: "pay", amountUsd: "5", every: "month", payee: "0x3333333333333333333333333333333333333333" }, at).issues.some((i) => i.path === "payee"));
    const watch = autopilotTask({ kind: "watch", watchId: `0x${"a".repeat(40)}:ins_${"b".repeat(16)}`, condition: { kind: "health-below", threshold: "1.4" }, sentence: "repay 30 USDC on Aave", amountUsd: "30" }, at);
    assert.equal(watch.task.label, "Health factor below 1.4, then repay 30 USDC on Aave");
    const t = dca.task;
    assert.equal(scheduleDue(t, Date.parse(at.now)), true);
    assert.equal(scheduleDue({ ...t, lastRunAt: at.now }, Date.parse(at.now) + 6 * 86_400_000), false);
    assert.equal(scheduleDue({ ...t, lastRunAt: at.now }, Date.parse(at.now) + 7 * 86_400_000), true);
  });

  it("pauses on repeated refusals and on unusual spend velocity", () => {
    const now = Date.parse(at.now);
    const refused = (m) => ({ at: now - m * 60_000, kind: "refused" });
    const signed = (m, usd) => ({ at: now - m * 60_000, kind: "signed", usd });
    assert.equal(guardVerdict([refused(5), refused(10)], { now, perDayUsd: "300" }).pause, false);
    assert.equal(guardVerdict([refused(5), refused(10), refused(50)], { now, perDayUsd: "300" }).code, "anomaly.denies");
    assert.equal(guardVerdict([refused(5), refused(10), refused(70)], { now, perDayUsd: "300" }).pause, false, "outside the hour");
    assert.equal(guardVerdict([signed(5, "100")], { now, perDayUsd: "300", next: { usd: "40" } }).pause, false);
    assert.equal(guardVerdict([signed(5, "100")], { now, perDayUsd: "300", next: { usd: "60" } }).code, "anomaly.velocity");
    assert.equal(guardVerdict([], { now, perDayUsd: "300", next: { usd: "100" } }).pause, false, "one step alone is not a burst");
    const six = [1, 2, 3, 4, 5, 6].map((m) => signed(m * 8, "1"));
    assert.equal(guardVerdict(six, { now, perDayUsd: "300", next: { usd: "1" } }).code, "anomaly.velocity");
  });

  it("Ask Lyko offers Autopilot and its Stop", () => {
    const map = buildCapabilityMap({ environment: "mainnet", executable: new Set(["arc-transfer"]), gatewayChains: [] });
    assert.equal(readAssist("stop autopilot", map)?.feature, "autopilot");
    assert.match(readAssist("Stop Autopilot", map)?.reason ?? "", /^Stop Autopilot/u);
    assert.equal(readAssist("turn on autopilot", map)?.options[0], "Turn on Autopilot");
    assert.equal(readAssist("stop everything", map)?.feature, "whistle");
    const feature = map.features.find((f) => f.id === "autopilot");
    // The chat drops offer blocks whose link is not an app path: both links must survive.
    for (const href of [feature.href, "/app/fold/pack?autopilot=on"]) assert.ok(parseAnswerBlock({ kind: "offer", feature: "autopilot", title: "Stop Autopilot", line: "x", href, cta: "Stop Autopilot" }), href);
  });
});
