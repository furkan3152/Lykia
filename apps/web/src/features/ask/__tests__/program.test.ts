import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatProgramView } from "@lykia/core/api/agents";

import { assistantDraft, EMPTY, programViewOk, reduce, userMessage, type Conversation } from "../model";

const view: ChatProgramView = {
  programHash: "sha256:abc",
  resolutionHash: "sha256:def",
  status: "ready",
  source: "deterministic",
  text: "keep 1000 USDC liquid and earn the rest",
  overrides: {},
  summary: "1 move now in one plan.",
  goals: ["Keep 1000 USDC liquid", "Put the rest to work"],
  hypothetical: false,
  now: { steps: [{ summary: "Put the rest of the USDC to work", rationale: "the rest" }], decision: "allow", reasons: [], intentId: "out_abcdef" },
  scheduled: [{ kind: "automation", summary: "Pay 2 recipients every month", rationale: "monthly", href: "/app/automations?draft=eyJh", saved: false, decision: "unknown", reasons: [] }],
  assumptions: [{ id: "buffer.gas", text: "1 USDC stays for gas.", value: "1", options: ["0", "5"] }],
  questions: [],
  refusals: [],
  blockers: [],
  kept: ["1001 USDC"],
  fees: null,
  tradeoffs: [],
  rejected: [],
};

describe("compiled programs in the conversation", () => {
  it("attaches a program event to the assistant message", () => {
    const start: Conversation = { ...EMPTY, messages: [userMessage("hi"), assistantDraft()] };
    const next = reduce(start, { event: "program", data: view });
    assert.equal(next.messages[1]!.program?.programHash, "sha256:abc");
  });

  it("drops views whose links leave the app", () => {
    assert.equal(programViewOk(view), true);
    assert.equal(programViewOk({ ...view, scheduled: [{ ...view.scheduled[0]!, href: "https://evil.example/app/automations" }] }), false);
    assert.equal(programViewOk({ ...view, scheduled: [{ ...view.scheduled[0]!, href: "/app/automations?draft=<script>" }] }), false);
    const start: Conversation = { ...EMPTY, messages: [userMessage("hi"), assistantDraft()] };
    assert.equal(reduce(start, { event: "program", data: { ...view, scheduled: [{ ...view.scheduled[0]!, href: "javascript:alert(1)" }] } }).messages[1]!.program, undefined);
  });
});
