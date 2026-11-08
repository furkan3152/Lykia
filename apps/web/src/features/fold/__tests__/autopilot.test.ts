import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { autopilotAckDigest } from "@lykia/core";

import { autopilotFormIssues, emptyAutopilotForm, enableRequestOf, runLine, sampleAutopilot, statusLine, taskInputOf, emptyTaskForm } from "../autopilot/model";

const OWNER = "0x1111111111111111111111111111111111111111";
const PAYEE = "0x2222222222222222222222222222222222222222";
const BETA = { perStepUsd: "100", perDayUsd: "300" };

describe("the Autopilot card and sheet", () => {
  it("checks the limits against the ceilings and asks for the tick", () => {
    const form = emptyAutopilotForm();
    assert.deepEqual(autopilotFormIssues(form, "limits", BETA, OWNER), []);
    assert.deepEqual(autopilotFormIssues(form, "accept", BETA, OWNER).map((i) => i.field), ["accepted"]);
    const over = autopilotFormIssues({ ...form, perStepUsd: "150", perDayUsd: "400" }, "limits", BETA, OWNER).map((i) => i.field);
    assert.deepEqual(over, ["perStepUsd", "perDayUsd"]);
    assert.ok(autopilotFormIssues({ ...form, payees: OWNER }, "limits", BETA, OWNER).some((i) => i.field === "payees"));
    assert.ok(autopilotFormIssues({ ...form, days: "45" }, "limits", BETA, OWNER).some((i) => i.field === "days"));
  });

  it("sends the acknowledgement digest with the limits and payees", () => {
    const r = enableRequestOf({ ...emptyAutopilotForm(), payees: `${PAYEE}\n${PAYEE.toUpperCase().replace("0X", "0x")}`, accepted: true }, "mainnet");
    assert.equal(r.ack, autopilotAckDigest());
    assert.deepEqual(r.limits, { perStepUsd: "20", perDayUsd: "50", days: 7 });
    assert.deepEqual(r.payees, [PAYEE]);
  });

  it("says where it stands in one sentence", () => {
    const view = sampleAutopilot(Date.UTC(2026, 10, 8, 12));
    assert.match(statusLine(view.autopilot, null).line, /at most \$50 a step and \$150 a day/u);
    assert.equal(statusLine(null, "This server does not sign with Circle wallets.").tag, "NOT ON THIS SERVER");
    assert.equal(statusLine({ ...view.autopilot!, status: "paused", paused: { code: "anomaly.velocity", reason: "Too fast.", at: "" } }, null).tag, "PAUSED");
    assert.equal(runLine(view.runs[0]!), "Convert 25 USDC to EURC on Uniswap v3 · $25.25");
    assert.match(runLine(view.runs[1]!), /^Refused: /u);
    assert.ok(view.runs.filter((r) => r.status === "settled").every((r) => r.label === "Signed by Lyko under your Autopilot leash"));
  });

  it("builds task requests and says what is missing", () => {
    assert.deepEqual(taskInputOf(emptyTaskForm("repay"), []).input, { kind: "repay", amountUsd: "20", floor: "1.5" });
    assert.equal(taskInputOf({ ...emptyTaskForm("pay"), payee: "nope" }, []).input, null);
    assert.equal(taskInputOf(emptyTaskForm("watch"), []).issue, "Pick one of your watches.");
    const w = taskInputOf({ ...emptyTaskForm("watch"), watchId: "w1", sentence: "repay 30 USDC on Aave" }, [{ id: "w1" }]);
    assert.deepEqual(w.input, { kind: "watch", watchId: "w1", sentence: "repay 30 USDC on Aave", amountUsd: "20" });
  });
});
