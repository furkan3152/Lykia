import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentProposal } from "@lykia/core/api/agents";

import { assistantDraft, EMPTY, latestProposal, reduce, titleOf, userMessage, type Conversation } from "../model";
import { parseSse, payload } from "../sse";

describe("SSE framing", () => {
  it("splits complete events and keeps the remainder", () => {
    const { events, rest } = parseSse('event: thread\ndata: {"threadId":"t1","mode":"reader"}\n\n: ping\n\nevent: text\ndata: {"text":"Hi"}\n\nevent: te');
    assert.equal(events.length, 2);
    assert.equal(events[0]!.event, "thread");
    assert.deepEqual(payload(events[1]!), { text: "Hi" });
    assert.equal(rest, "event: te");
  });

  it("handles CRLF and multi-line data", () => {
    const { events } = parseSse("event: text\r\ndata: a\r\ndata: b\r\n\r\n");
    assert.equal(events[0]!.data, "a\nb");
    assert.equal(payload(events[0]!), null);
  });
});

describe("conversation reducer", () => {
  const proposal: AgentProposal = { intentId: "out_1", title: "Earn", steps: ["Deposit"], decision: "allow", reasons: [], warnings: [], attribution: [], rationale: "best yield" };
  it("folds a stream into one assistant message", () => {
    let c: Conversation = { ...EMPTY, messages: [userMessage("put half to work"), assistantDraft()] };
    c = reduce(c, { event: "thread", data: { threadId: "t1", mode: "reader" } });
    c = reduce(c, { event: "reading", data: { what: "flock", ok: true } });
    c = reduce(c, { event: "tool", data: { agent: "yield-keeper", name: "quote", ok: false, summary: "" } });
    c = reduce(c, { event: "text", data: { text: "Galaxy " } });
    c = reduce(c, { event: "text", data: { text: "wins." } });
    c = reduce(c, { event: "proposal", data: proposal });
    c = reduce(c, { event: "done", data: { threadId: "t1", stopReason: "end" } });
    const last = c.messages[1]!;
    assert.equal(c.threadId, "t1");
    assert.equal(c.mode, "reader");
    assert.equal(last.text, "Galaxy wins.");
    assert.equal(last.trail.length, 2);
    assert.equal(last.trail[1]!.ok, false);
    assert.equal(last.streaming, false);
    assert.equal(latestProposal(c)?.intentId, "out_1");
  });

  it("errors stop streaming and never touch user messages", () => {
    let c: Conversation = { ...EMPTY, messages: [userMessage("x")] };
    c = reduce(c, { event: "text", data: { text: "ignored" } });
    assert.equal(c.messages[0]!.text, "x");
    c = { ...c, messages: [...c.messages, assistantDraft()] };
    c = reduce(c, { event: "error", data: { code: "X", message: "boom" } });
    assert.equal(c.messages[1]!.error, "boom");
    assert.equal(c.messages[1]!.streaming, false);
  });

  it("titles threads from the first line", () => {
    assert.equal(titleOf("  send   5 USDC "), "send 5 USDC");
    assert.ok(titleOf("x".repeat(80)).endsWith("…"));
  });
});
