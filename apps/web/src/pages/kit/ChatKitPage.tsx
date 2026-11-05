/**
 * The chat kit (development only, /app/kit/chat): every Ask Lyko card and
 * every state of "Lyko at work" with sample data, so each can be checked
 * and screenshotted without a wallet or live money. Nothing here calls the
 * API; the replay folds a recorded sample stream through the real reducer.
 */
import type { AgentProposal, ChatEvent, ChatStep } from "@lykia/core/api/agents";
import { useEffect, useRef, useState } from "react";

import { AssistantMessage, UserMessage } from "../../features/ask/Answer";
import { ChatActionsContext, type ChatActions } from "../../features/ask/actions";
import { assistantDraft, EMPTY, reduce, userMessage, type ChatMessage, type Conversation } from "../../features/ask/model";
import { Tag, toast } from "../../mosaic";

const ADDR = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f";
const TX = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const T0 = 1_762_300_000_000;

const step = (id: string, kind: ChatStep["kind"], label: string, state: ChatStep["state"], result?: string, ms?: number, extra: Partial<ChatStep> = {}): ChatStep => ({ id, kind, label, state, ...(result ? { result } : {}), ...(ms !== undefined ? { ms } : {}), ...extra });

const base = (id: string, over: Partial<ChatMessage>): ChatMessage => ({ id, role: "assistant", text: "", trail: [], proposals: [], clarify: null, streaming: false, steps: [], blocks: [], notes: [], startedAt: T0, endedAt: T0 + 1800, ...over });

const fxProposal: AgentProposal = { intentId: "out_sample01", title: "fx", steps: ["Convert 198 USDC -> 176.22 EURC on Aerodrome Slipstream USDC/EURC (min 175.69)"], decision: "allow", reasons: [], warnings: ["Routed on-chain and checked against Chainlink EURC/USD."], attribution: [{ agent: "FX hedger", role: "fx-hedger", part: "fx" }], rationale: "" };
const denyProposal: AgentProposal = { intentId: null, title: "send", steps: ["Send 5,000 USDC to 0x7a3f…3d5f"], decision: "deny", reasons: ["5,000 USD is above the per-step cap of 1,000 USD."], warnings: [], attribution: [{ agent: "Payroll", role: "payroll", part: "send" }], rationale: "" };

const SAMPLES: readonly { readonly id: string; readonly kick: string; readonly title: string; readonly user: string; readonly m: ChatMessage }[] = [
  {
    id: "working",
    kick: "THINKING · LIVE",
    title: "Lyko at work, mid-turn",
    user: "Keep 2,000 USDC for payroll and put the rest to work",
    m: base("working", { streaming: true, endedAt: undefined, steps: [step("s1", "intent", "Reading your request", "ok", "2 actions: reserve + earn", 38), step("s2", "wallet", "Reading the wallet", "ok", "4 holdings · $12,480.20", 612), step("s3", "route", "Searching routes", "running", undefined, undefined, { agent: "Yield keeper" })] }),
  },
  {
    id: "gas",
    kick: "SITUATION · GAS LOW",
    title: "Fuel gauge",
    user: "Is my gas ok?",
    m: base("gas", {
      text: "Gas is low: 0.0412 USDC, under your 0.5 USDC floor.\n\n- **Short by:** 0.4588 USDC\n- **Why it matters:** Arc pays gas in USDC, and below the floor a plan can stop halfway.\n\n**Next:** send at least 0.4588 USDC to this wallet.",
      steps: [step("s1", "intent", "Reading your question", "ok", "A question about gas", 2), step("s2", "wallet", "Reading the wallet", "warn", "0.0412 USDC for gas", 640, { detail: "Your floor is 0.5 USDC." })],
      blocks: [{ kind: "gas", balance: "0.0412", floor: "0.5", address: ADDR, gasPriceGwei: "20" }],
      endedAt: T0 + 660,
    }),
  },
  {
    id: "route",
    kick: "SITUATION · PLAN",
    title: "Route proposal with its rate",
    user: "Convert 200 USDC to EURC",
    m: base("route", {
      text: "Ready to sign: 1 step, every one inside your Fence.\n\n- Convert 198 USDC -> 176.22 EURC on Aerodrome Slipstream USDC/EURC (min 175.69)\n\n**Next:** review the route and sign it in your wallet.",
      steps: [step("s1", "intent", "Reading your request", "ok", "1 action: fx", 41), step("s2", "route", "Searching routes", "ok", "Aerodrome Slipstream USDC/EURC · 1 step", 2140, { agent: "FX hedger", detail: "Best net output after gas. Beat 2 other options." }), step("s3", "fence", "Checking your Fence", "ok", "Allowed", 3, { agent: "FX hedger" })],
      blocks: [{ kind: "rate", base: "USDC", quote: "EURC", rate: "0.890009", reference: "0.888916", bandBps: 50, source: "Chainlink EURC/USD" }],
      proposals: [fxProposal],
      endedAt: T0 + 2210,
    }),
  },
  {
    id: "fence",
    kick: "SITUATION · REFUSED",
    title: "The Fence gate",
    user: "Send 5000 USDC to 0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f",
    m: base("fence", {
      text: "The Fence said no.\n\n- 5,000 USD is above the per-step cap of 1,000 USD.\n\n**Next:** ask for less, or change the rule in your Fence.",
      steps: [step("s1", "intent", "Reading your request", "ok", "1 action: send", 35), step("s2", "route", "Searching routes", "ok", "Direct · 1 step", 820, { agent: "Payroll" }), step("s3", "fence", "Checking your Fence", "fail", "Refused by caps.step", 2, { agent: "Payroll", detail: "5,000 USD is above the per-step cap of 1,000 USD." })],
      blocks: [{ kind: "fence", decision: "deny", rules: [{ rule: "caps.step", message: "5,000 USD is above the per-step cap of 1,000 USD." }], headroom: [{ label: "Per step", value: "$1,000" }, { label: "Per day", value: "$5,000" }, { label: "Max slippage", value: "0.50%" }] }],
      proposals: [denyProposal],
      endedAt: T0 + 870,
    }),
  },
  {
    id: "balance",
    kick: "SITUATION · BALANCES",
    title: "The pasture",
    user: "What do I hold?",
    m: base("balance", {
      text: "You hold $12,480.20 on Arc mainnet.\n\n- **USDC:** 8,210.5 ($8,210.50) in wallet\n- **Morpho Galaxy USDC:** 3,000 ($3,012.40) in morpho-vaults\n- **EURC:** 1,120 ($1,257.30) in wallet\n\n**Next:** say “put my idle USDC to work” to earn on what sits still.",
      steps: [step("s1", "intent", "Reading your question", "ok", "A question about your holdings", 1), step("s2", "wallet", "Reading the wallet", "ok", "4 holdings · $12,480.20", 702)],
      blocks: [{ kind: "balance", totalUsd: "12480.2", holdings: [{ symbol: "USDC", amount: "8210.5", usd: "8210.5", where: "wallet" }, { symbol: "USDC", amount: "3000", usd: "3012.4", where: "morpho-vaults" }, { symbol: "EURC", amount: "1120", usd: "1257.3", where: "wallet" }, { symbol: "USYC", amount: "12.5", usd: null, where: "wallet" }] }],
      endedAt: T0 + 720,
    }),
  },
  {
    id: "rate",
    kick: "SITUATION · FX QUOTE",
    title: "Rate tile",
    user: "What's the EURC rate?",
    m: base("rate", {
      text: "1 USDC buys 0.8889 EURC at the reference rate.\n\n- **Source:** Chainlink EURC/USD\n- **Your band:** a quote may sit at most 0.50% from it\n\n**Next:** say “convert 200 USDC to EURC” for a routed quote.",
      steps: [step("s1", "intent", "Reading your question", "ok", "The USDC/EURC rate", 1), step("s2", "price", "Checking the reference rate", "ok", "1 USDC = 0.8889 EURC", 180)],
      blocks: [{ kind: "rate", base: "USDC", quote: "EURC", rate: "0.888916", reference: null, bandBps: 50, source: "Chainlink EURC/USD" }],
      endedAt: T0 + 190,
    }),
  },
  {
    id: "herded",
    kick: "SITUATION · AUTOMATION",
    title: "Herded into the Fold",
    user: "Every Friday at 17:00 sweep idle USDC above 1 into the best vault, and bark if EURC drops below 1.05",
    m: base("herded", {
      text: "Herded: one round saved, one bark waiting for you.\n\n- **Round:** every Friday at 17:00 Europe/Istanbul\n- **Bark:** EURC below 1.05 USD\n\n**Next:** open the bark and save it while signed in.",
      steps: [step("s1", "compile", "Compiling your goal", "ok", "Nothing now · 2 for later", 420), step("s2", "draft", "Drafting the automation", "ok", "Automation saved (active)", 160), step("s3", "draft", "Setting the alert", "ok", "Alert drafted (not saved)", 90)],
      drafts: [
        { kind: "automation", saved: true, label: "Friday sweep into the best vault", href: "/app/automations", next: "every Friday at 17:00 Europe/Istanbul" },
        { kind: "alert", saved: false, label: "EURC below 1.05 USD", href: "/app/alerts?draft=abc123" },
      ],
      blocks: [{ kind: "herded", items: [{ kind: "automation", label: "Friday sweep into the best vault", saved: true, href: "/app/fold/herding?show=rounds", next: "every Friday at 17:00 Europe/Istanbul" }, { kind: "alert", label: "EURC below 1.05 USD", saved: false, href: "/app/alerts?draft=abc123", next: null }, { kind: "order", label: "DCA 50 USDC into EURC, 10 times, daily", saved: false, href: "/app/orders", next: "Sign it on the Orders page" }] }],
      endedAt: T0 + 690,
    }),
  },
  {
    id: "clarify",
    kick: "SITUATION · ONE QUESTION",
    title: "Clarifying chips",
    user: "Pay Ayla",
    m: base("clarify", { text: "One detail before I plan it.", steps: [step("s1", "intent", "Reading your request", "warn", "Needs one detail", 30, { detail: "How much should Ayla get?" })], clarify: { question: "How much should Ayla get?", options: ["50 USDC", "250 USDC", "The same as last time"] }, endedAt: T0 + 40 }),
  },
  {
    id: "error",
    kick: "SITUATION · NETWORK TROUBLE",
    title: "Calm trouble state",
    user: "Bridge 100 USDC to Base",
    m: base("error", { error: "Lyko could not be reached. The connection dropped before the answer came back.", steps: [step("s1", "intent", "Reading your request", "ok", "1 action: bridge", 30)], endedAt: T0 + 5000 }),
  },
  {
    id: "settled",
    kick: "SITUATION · SETTLED",
    title: "Stamped seal",
    user: "Did my payment to Ayla land?",
    m: base("settled", { text: "It landed: 250 USDC reached Ayla in one block.\n\n- **Memo:** invoice 12\n- **Fee:** 0 USDC on top\n\n**Next:** nothing to do.", steps: [step("s1", "read", "Reading the outrun", "ok", "Settled", 210)], blocks: [{ kind: "settled", summary: "250 USDC to Ayla · invoice 12", tx: TX }], endedAt: T0 + 230 }),
  },
  {
    id: "markdown",
    kick: "TYPE · MODEL ANSWER",
    title: "Markdown, rendered safely",
    user: "Why did my last plan cost more than I said?",
    m: base("markdown", {
      text: "**Your send cost 0.25 USDC more, by design.**\n\n- **Why it matters:** an exact send pays Lykia's fee *on top*, so the recipient still gets exactly 250 USDC.\n- **Where:** the fee went to `0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f` in the same transaction ([see the fees page](/app/fold/trails)).\n- **Proof:** " + TX + "\n\n**Next:** nothing to do. <b>Raw HTML</b> stays text.",
      steps: [step("s1", "wallet", "Reading the wallet", "ok", "4 holdings · $12,480.20", 540), step("s2", "read", "Reading the outrun", "ok", "Settled", 230), step("s3", "fence", "Reading your Fence", "ok", "Fence Shepherd (live)", 4)],
      notes: ["The fee line on the outrun explains it; I will point to the transaction."],
      endedAt: T0 + 2900,
    }),
  },
];

/** A recorded sample stream (the shapes the server sends), replayed through the real reducer. */
const REPLAY: readonly (readonly [number, ChatEvent])[] = [
  [200, { event: "thread", data: { threadId: "sample", mode: "reader" } }],
  [300, { event: "step", data: step("r1", "intent", "Reading your request", "running") }],
  [500, { event: "step", data: step("r1", "intent", "Reading your request", "ok", "1 action: fx", 41) }],
  [300, { event: "step", data: step("r2", "route", "Searching routes", "running", undefined, undefined, { agent: "FX hedger" }) }],
  [1900, { event: "step", data: step("r2", "route", "Searching routes", "ok", "Aerodrome Slipstream USDC/EURC · 1 step", 2140, { agent: "FX hedger", detail: "Best net output after gas. Beat 2 other options." }) }],
  [250, { event: "step", data: step("r3", "fence", "Checking your Fence", "ok", "Allowed", 3, { agent: "FX hedger" }) }],
  [250, { event: "block", data: { kind: "rate", base: "USDC", quote: "EURC", rate: "0.890009", reference: "0.888916", bandBps: 50, source: "Chainlink EURC/USD" } }],
  [200, { event: "proposal", data: fxProposal }],
  [200, { event: "text", data: { text: "Ready to sign: 1 step, every one inside your Fence.\n\n- Convert 198 USDC -> 176.22 EURC on Aerodrome Slipstream USDC/EURC (min 175.69)\n\n**Next:** review the route and sign it in your wallet." } }],
  [300, { event: "done", data: { threadId: "sample", stopReason: "end_turn" } }],
];

function Replay() {
  const [convo, setConvo] = useState<Conversation>(EMPTY);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const play = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    let c: Conversation = { ...EMPTY, messages: [userMessage("Convert 200 USDC to EURC"), assistantDraft()] };
    setConvo(c);
    let at = 0;
    for (const [delay, e] of REPLAY) {
      at += delay;
      timers.current.push(
        setTimeout(() => {
          c = reduce(c, e);
          setConvo(c);
        }, at),
      );
    }
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return (
    <div className="m-convo__col" style={{ width: "100%" }}>
      <button type="button" className="m-mini m-mini--solid" style={{ justifySelf: "start" }} onClick={play} data-testid="replay">
        Replay a sample stream
      </button>
      {convo.messages.map((m) => (m.role === "user" ? <UserMessage key={m.id} text={m.text} /> : <AssistantMessage key={m.id} m={m} />))}
    </div>
  );
}

export default function ChatKitPage() {
  const actions: ChatActions = {
    environment: "mainnet",
    prefill: (text) => toast.info("Would fill the composer", { description: text, from: "KIT" }),
    ask: (text) => toast.info("Would ask", { description: text, from: "KIT" }),
    retry: () => toast.info("Would ask again", { from: "KIT" }),
    openRoute: (p) => toast.info("Would open the route", { description: p.title, from: "KIT" }),
  };
  return (
    <ChatActionsContext.Provider value={actions}>
      <div className="m-wrap m-chatkit" style={{ maxWidth: 820, padding: "24px 0 64px" }}>
        <header style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          <span className="m-kick">ASK LYKO · CHAT KIT</span>
          <h1 className="m-title" style={{ fontSize: 34 }}>Every card, every state</h1>
          <div className="flex gap-2 flex-wrap items-center">
            <Tag tone="ochre">SAMPLE · FIXTURE DATA</Tag>
            <Tag tone="ghost">DEVELOPMENT ONLY · NOTHING MOVES</Tag>
          </div>
        </header>
        <section className="m-chatkit__sec" id="replay">
          <span className="m-kick">THINKING · REPLAY</span>
          <Replay />
        </section>
        {SAMPLES.map((s) => (
          <section key={s.id} className="m-chatkit__sec" id={s.id} data-testid={`kit-${s.id}`}>
            <span className="m-kick">{s.kick}</span>
            <h2 className="m-chatkit__h">{s.title}</h2>
            <div className="m-convo__col" style={{ width: "100%" }}>
              <UserMessage text={s.user} />
              <AssistantMessage m={s.m} onChoose={(o) => toast.info("Would ask", { description: o, from: "KIT" })} />
            </div>
          </section>
        ))}
      </div>
    </ChatActionsContext.Provider>
  );
}
