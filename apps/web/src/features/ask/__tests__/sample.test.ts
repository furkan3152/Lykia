import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAnswerBlock } from "@lykia/core/api/answer";
import type { AnswerBlock } from "@lykia/core/api/agents";

import { askMessages, assistantDraft, EMPTY, reduce, userMessage, type Conversation } from "../model";

const SAMPLE = "0x000000000000000000000000000000000000dEaD";

function turn(c: Conversation, text: string): Conversation {
  return { ...c, messages: [...c.messages, userMessage(text), assistantDraft()] };
}

describe("the sample and the Ask thread", () => {
  it("a turn about the Fold's sample flock is marked and never joins the Ask thread", () => {
    let c = turn(EMPTY, "Where is my money?");
    c = reduce(c, { event: "thread", data: { threadId: "anon:thr_ask", mode: "reader", sample: true } });
    c = reduce(c, { event: "text", data: { text: "**Sample address, not your wallet.** Nothing here." } });
    c = reduce(c, { event: "done", data: { threadId: "anon:thr_ask", stopReason: "end_turn" } });
    assert.equal(c.threadId, "anon:thr_ask");

    c = turn(c, "What is my Fold worth?");
    c = reduce(c, { event: "thread", data: { threadId: "anon:thr_fold", mode: "reader", sample: true, origin: "fold", fixture: true } });
    c = reduce(c, { event: "text", data: { text: "**Sample flock, not your wallet.** The sample flock is worth $15,470.41." } });
    c = reduce(c, { event: "done", data: { threadId: "anon:thr_fold", stopReason: "end_turn" } });

    assert.equal(c.threadId, "anon:thr_ask", "the Ask thread keeps its id");
    assert.equal(c.messages.length, 4, "the Fold still shows all of it");
    assert.deepEqual(c.messages.map((m) => Boolean(m.fixture)), [false, false, true, true]);
    const ask = askMessages(c);
    assert.equal(ask.length, 2);
    assert.ok(!ask.some((m) => /15,470/u.test(m.text)), "the fixture figure never shows in Ask");
  });

  it("without a fixture turn the conversation is shown as it is", () => {
    const c = reduce(turn(EMPTY, "hi"), { event: "thread", data: { threadId: "t1", mode: "llm" } });
    assert.equal(askMessages(c), c.messages);
  });
});

describe("the sample card and the running card", () => {
  it("a sample card needs the address, a line and its Connect action", () => {
    const card: AnswerBlock = { kind: "sample", address: SAMPLE, line: "No wallet is connected.", cta: "Connect a wallet" };
    assert.deepEqual(parseAnswerBlock(card), card);
    assert.equal(parseAnswerBlock({ ...card, address: "0x1" }), null);
    assert.equal(parseAnswerBlock({ ...card, cta: "" }), null);
  });

  it("a running card carries Herding's own control and nothing that points outside the API", () => {
    const control = { action: "pause", label: "Pause", method: "post", path: "/v1/automations/so_1/pause", query: { owner: SAMPLE.toLowerCase() } } as const;
    const card: AnswerBlock = { kind: "running", title: "Pause: Pay rent", note: null, items: [{ id: "so_1", source: "recurring", name: "Pay 5 USDC rent every Friday", sourceLabel: "Recurring payment", status: "active", nextLine: "Runs in 3 d; you sign what it plans.", control }] };
    assert.deepEqual(parseAnswerBlock(card), card);
    const withPath = (path: string) => parseAnswerBlock({ ...card, items: [{ ...card.items[0], control: { ...control, path } }] });
    for (const path of ["https://evil.example/v1/x", "//evil.example/v1", "/v2/automations/x", "/v1/../admin", "javascript:alert(1)"]) assert.equal(withPath(path), null, path);
    assert.equal(parseAnswerBlock({ ...card, items: [] }), null);
    assert.equal(parseAnswerBlock({ ...card, items: [{ ...card.items[0], control: { ...control, action: "drain" } }] }), null);
    // A row without a control is still a row.
    assert.ok(parseAnswerBlock({ ...card, items: [{ ...card.items[0], control: null }] }));
  });

  it("a positions card folds dust into one count and can show the priced net", () => {
    const card = parseAnswerBlock({ kind: "positions", netUsd: null, pricedNetUsd: "212.88", weightedApyPercent: null, lowestHealth: null, rows: [], unavailable: [], hidden: 55 });
    assert.ok(card && card.kind === "positions" && card.hidden === 55 && card.pricedNetUsd === "212.88");
  });
});
