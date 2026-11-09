import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMessage } from "../model";
import { ASK_STARTERS, DO_STARTERS, blanks, composerHint, followUps, nextBlank, nextStep, sendWord } from "../starters";

const answer = (over: Partial<ChatMessage>): ChatMessage => ({ id: "a", role: "assistant", text: "ok", trail: [], proposals: [], clarify: null, streaming: false, ...over });

describe("Ask Lyko starting points", () => {
  it("offers four to six starters, each a fill with blanks or a question", () => {
    const all = [...DO_STARTERS, ...ASK_STARTERS];
    assert.ok(all.length >= 4 && all.length <= 6);
    for (const s of DO_STARTERS) assert.ok(blanks(s.text).length > 0, `${s.id} has a blank to fill`);
    for (const s of ASK_STARTERS) assert.equal(blanks(s.text).length, 0);
  });

  it("walks the blanks in order and wraps", () => {
    const text = "Send [amount] USDC to [who]";
    assert.deepEqual(nextBlank(text), { start: 5, end: 13, name: "amount" });
    assert.equal(nextBlank(text, 14)?.name, "who");
    assert.equal(nextBlank(text, 99)?.name, "amount");
    assert.equal(nextBlank("Send 5 USDC to @ana"), null);
  });
});

describe("the composer's guidance", () => {
  it("says nothing for an empty box", () => assert.equal(composerHint("  "), null));

  it("names open blanks first", () => {
    assert.equal(composerHint("Send [amount] USDC to [who]")?.text, "Fill in amount and who. Tab jumps to the next blank.");
  });

  it("names what a sentence lacks, in plain words", () => {
    assert.match(composerHint("Send USDC to @ana")!.text, /an amount/);
    assert.match(composerHint("Pay 50 to 0x4100000000000000000000000000000000000009")!.text, /a token/);
    assert.match(composerHint("Send 50 USDC")!.text, /who gets it/);
    assert.match(composerHint("Bridge 100 USDC")!.text, /the chain/);
    assert.match(composerHint("Convert 200 USDC")!.text, /the token you want/);
    assert.equal(composerHint("Send 50 USDC to @ana")!.tone, "ready");
    assert.equal(composerHint("Bridge 100 USDC to Base")!.tone, "ready");
  });

  it("treats questions as questions: they ask, nothing moves", () => {
    assert.equal(composerHint("Where can I earn on EURC?")!.tone, "question");
    assert.equal(sendWord("What do I have"), "ASK");
    assert.equal(sendWord("Send 5 USDC to @ana"), "PLAN IT");
  });
});

describe("the step after an answer", () => {
  it("leads a signable plan to review and sign", () => {
    const m = answer({ proposals: [{ intentId: "int_1" } as never] });
    assert.deepEqual(nextStep(m), { kind: "review", index: 0 });
  });

  it("lets a clarify question's chips be the step, with no extra buttons", () => {
    const m = answer({ clarify: { question: "How much?", options: ["Half", "All"] } });
    assert.equal(nextStep(m).kind, "choose");
  });

  it("sends saved watches to the Fold", () => {
    const m = answer({ blocks: [{ kind: "herded", items: [] }] });
    assert.deepEqual(nextStep(m), { kind: "fold", href: "/app/fold/herding", label: "See it in the Fold" });
  });

  it("waits while Lyko is still answering", () => {
    assert.equal(nextStep(answer({ streaming: true })).kind, "none");
    assert.equal(followUps(answer({ streaming: true })).length, 0);
  });

  it("offers two or three follow-ups that fit the answer", () => {
    const yields = answer({ blocks: [{ kind: "yields", token: "EURC", rows: [], best: null, from: { source: "Morpho API", readAt: "2026-11-09T00:00:00Z", block: null } } as never] });
    const f = followUps(yields);
    assert.ok(f.length >= 2 && f.length <= 3);
    assert.equal(f[0]!.text, "Put [amount] EURC to work at low risk");
    for (const m of [answer({}), answer({ blocks: [{ kind: "capabilities", title: "x", sections: [] }] })]) {
      const n = followUps(m).length;
      assert.ok(n >= 2 && n <= 3);
    }
  });
});
