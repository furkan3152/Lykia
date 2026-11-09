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
import { useQueryClient } from "@tanstack/react-query";
import { LykoOnWatch } from "../../features/fold/LykoOnWatch";
import { HerdingTab } from "../../features/fold/tabs/HerdingTab";
import { RouteArtifact } from "../../features/route/RouteArtifact";
import { acrossGraph, FOLD_INSIGHTS, FOLD_INSTRUCTIONS, HANDOFF_IDS, HANDOFF_PROPOSAL, intentResponse, KIT_OWNER, proposalFor, repayGraph, stagedGraph } from "./stagedFixtures";

const ADDR = "0x7a3f9c21b4e8d05f6a1c3e9b2d4f6a8c0e1b3d5f";
const TX = "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const T0 = 1_762_300_000_000;

const step = (id: string, kind: ChatStep["kind"], label: string, state: ChatStep["state"], result?: string, ms?: number, extra: Partial<ChatStep> = {}): ChatStep => ({ id, kind, label, state, ...(result ? { result } : {}), ...(ms !== undefined ? { ms } : {}), ...extra });

const base = (id: string, over: Partial<ChatMessage>): ChatMessage => ({ id, role: "assistant", text: "", trail: [], proposals: [], clarify: null, streaming: false, steps: [], blocks: [], notes: [], startedAt: T0, endedAt: T0 + 1800, ...over });

const fxProposal: AgentProposal = { intentId: "out_sample01", title: "fx", steps: ["Convert 198 USDC -> 176.22 EURC on Aerodrome Slipstream USDC/EURC (min 175.69)"], decision: "allow", reasons: [], warnings: ["Routed on-chain and checked against Chainlink EURC/USD."], attribution: [{ agent: "FX hedger", role: "fx-hedger", part: "fx" }], rationale: "" };
const denyProposal: AgentProposal = { intentId: null, title: "send", steps: ["Send 5,000 USDC to 0x7a3f…3d5f"], decision: "deny", reasons: ["5,000 USD is above the per-step cap of 1,000 USD."], warnings: [], attribution: [{ agent: "Payroll", role: "payroll", part: "send" }], rationale: "" };

const STAGED_TEXT = "Ready to sign: 2 steps, one after the other.\n\n- Swap 500 USDC → EURC on Uniswap v4 (min 440.4 EURC)\n- Deposit it into Morpho Galaxy EURC, rebuilt from what the swap delivers\n\n**Next:** review and sign step 1.";
const SAMPLES: readonly { readonly id: string; readonly kick: string; readonly title: string; readonly user: string; readonly m: ChatMessage }[] = [
  { id: "create-leash", kick: "ASK STARTS · A LEASH", title: "A leash drafted in Ask: the review sheet is one tap away", user: "Give my bot $20 a day for a week to pay invoices", m: base("create-leash", { text: "Your plan is drafted for later.\n\n- **Later:** Leash for Invoice bot: $20 a day for 7 days, to pay invoices\n\n**Next:** review the leash on its card; you sign once there.", blocks: [{"kind": "leash-draft", "title": "A leash for Invoice bot", "note": "It pays only payees you name: add them in the review.", "draft": {"name": "Invoice bot", "template": "pay-invoices", "perDayUsd": "20", "days": 7}}] }) },
  { id: "create-agent", kick: "ASK STARTS · AN AGENT", title: "An agent drafted in Ask: it holds a leash", user: "Create a payroll agent with a 500 USDC daily budget", m: base("create-agent", { text: "Payroll: a payroll agent with $500 a day.\n\nReview it on the card: it holds a leash with its own Fence inside yours, and you can pause or revoke it in the Fold.\n\n**Next:** open the card to review.", blocks: [{ kind: "agent-draft", name: "Payroll", role: "payroll", dailyUsd: "500", mission: null, environment: "mainnet" }] }) },
  { id: "create-autopilot", kick: "ASK STARTS · AUTOPILOT", title: "Autopilot drafted in Ask, with the limits the owner picked", user: "Turn on Autopilot with $50 a step and $150 a day for 30 days", m: base("create-autopilot", { text: "Autopilot: up to $50 a step and $150 a day for 30 days.\n\nReview it on the card: you read what Autopilot holds, tick, and sign its session once. Stop ends it at once.\n\n**Next:** open the card to review.", blocks: [{ kind: "autopilot-draft", perStepUsd: "50", perDayUsd: "150", days: 30, payees: [], environment: "mainnet" }, { kind: "autopilot-task", label: "Repay 50 USDC on Aave when health drops below 1.5", task: { kind: "repay", amountUsd: "50", floor: "1.5" }, environment: "mainnet", autopilot: "on" }] }) },
  { id: "earn-eurc", kick: "AN ANSWER · YIELDS", title: "Where can I earn on EURC? A card, not a page", user: "Where can I earn on EURC?", m: base("earn-eurc", { text: "Here is where EURC earns on Arc mainnet right now, best first. The card names each rate's source and risk.\n\n**Next:** say how much should go to work; I plan it under your Fence and you sign once.", blocks: [{"kind": "yields", "token": "EURC", "rows": [{"venue": "Gauntlet EURC Prime \u00b7 0x0586\u202650B9", "apyPercent": "2.01", "risk": "high", "source": "Morpho API"}, {"venue": "SteakEURC", "apyPercent": "2.01", "risk": "high", "source": "Morpho API"}, {"venue": "Steakhouse Prime EURC \u00b7 0xbeef\u202641D1", "apyPercent": "2.01", "risk": "high", "source": "Morpho API"}, {"venue": "Steakhouse Prime EURC \u00b7 0x3933\u2026835e", "apyPercent": "1.71", "risk": "high", "source": "Morpho API"}, {"venue": "Gauntlet EURC Prime \u00b7 0x8589\u2026831E", "apyPercent": "1.71", "risk": "high", "source": "Morpho API"}, {"venue": "Galaxy EURC", "apyPercent": "1.20", "risk": "high", "source": "Morpho API"}], "best": "Gauntlet EURC Prime \u00b7 0x0586\u202650B9", "from": {"source": "Morpho and Aave APIs", "readAt": "2026-11-09T09:52:21.000Z", "block": null}}] }) },
  { id: "staged-start", kick: "PLAN · STEP BY STEP", title: "A staged plan: step 1 active, step 2 next", user: "Swap 500 USDC to EURC, then deposit it into Morpho", m: base("staged-start", { text: STAGED_TEXT, proposals: [proposalFor(stagedGraph("start"))] }) },
  { id: "staged-after", kick: "PLAN · STEP BY STEP", title: "After step 1 settled: step 2 rebuilt from what arrived", user: "Swap 500 USDC to EURC, then deposit it into Morpho", m: base("staged-after", { text: STAGED_TEXT, proposals: [proposalFor(stagedGraph("after"))] }) },
  { id: "staged-paused", kick: "PLAN · PAUSED", title: "A paused step, with the reason and the way on", user: "Swap 500 USDC to EURC, then deposit it into Morpho", m: base("staged-paused", { text: STAGED_TEXT, proposals: [proposalFor(stagedGraph("paused"))] }) },
  { id: "handoff", kick: "FROM LYKO ON WATCH", title: "An insight sent to Ask Lyko, planned", user: "", m: base("handoff", { text: "From Lyko on watch: repay a quarter. Planned step by step; review and sign it here.", proposals: [HANDOFF_PROPOSAL], instruction: { id: HANDOFF_IDS.handoff, from: "watch", to: "ask", kind: "plan", label: "Repay a quarter" } }) },
  { id: "watch", kick: "TO LYKO ON WATCH", title: "A watch task handed to Lyko on watch", user: "Watch my Aave position and tell me if health drops below 1.5", m: base("watch", { text: "Lyko on watch has it: health factor below 1.5 on Aave V4.\n\n- **Where:** the Fold, under Herding, marked From Ask Lyko\n- **When it is met:** an insight in the Fold, with a move ready if there is one\n\n**Next:** nothing to sign; pause or remove it in the Fold any time.", blocks: [{ kind: "herded", items: [{ kind: "watch", label: "Health factor below 1.5 on Aave V4", saved: true, href: "/app/fold/herding?show=watches", next: "Lyko on watch checks it each time it reads your Fold" }] }] }) },
  { id: "bridge", kick: "PLAN · BRIDGE", title: "The bridge choice: Across beat CCTP and Relay", user: "Bridge 100 USDC to Base", m: base("bridge", { text: "Ready to sign: 1 step, inside your Fence.\n\n- Bridge 99 USDC to Base over Across (cross-chain: delivered on Base, min 98.491333 USDC)\n- **Why Across:** it delivers 98.986265 USDC on Base, more than CCTP's 98.945337 USDC and Relay's 98.929596 USDC.\n\n**Next:** review the route and sign it in your wallet.", proposals: [proposalFor(acrossGraph(), { title: "bridge" })] }) },
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
    user: "Every Friday at 17:00 sweep idle USDC above 1 into the best vault, and tell me if EURC drops below 1.05",
    m: base("herded", {
      text: "Herded: one automation saved, one watch waiting for you.\n\n- **Automation:** every Friday at 17:00 Europe/Istanbul\n- **Watch:** EURC below 1.05 USD\n\n**Next:** sign in and ask again to save the watch.",
      steps: [step("s1", "compile", "Compiling your goal", "ok", "Nothing now · 2 for later", 420), step("s2", "draft", "Drafting the automation", "ok", "Automation saved (active)", 160), step("s3", "draft", "Setting the watch", "ok", "Watch drafted (not saved)", 90)],
      drafts: [
        { kind: "automation", saved: true, label: "Friday sweep into the best vault", href: "/app/fold/herding?show=automations", next: "every Friday at 17:00 Europe/Istanbul" },
        { kind: "alert", saved: false, label: "EURC below 1.05 USD", href: "/app/fold/herding?show=watches" },
      ],
      blocks: [{ kind: "herded", items: [{ kind: "automation", label: "Friday sweep into the best vault", saved: true, href: "/app/fold/herding?show=automations", next: "every Friday at 17:00 Europe/Istanbul" }, { kind: "alert", label: "EURC below 1.05 USD", saved: false, href: "/app/fold/herding?show=watches", next: null }, { kind: "order", label: "DCA 50 USDC into EURC, 10 times, daily", saved: true, href: "/app/fold/herding?show=orders", next: "Armed; keepers run each slice" }] }],
      endedAt: T0 + 690,
    }),
  },
  {
    id: "order",
    kick: "SITUATION · AN ORDER",
    title: "Order card",
    user: "Set a stop-loss: sell 0.01 cirBTC if BTC drops to 60000",
    m: base("order", {
      text: "Ready to sign, with one confirmation: a stop-loss on LykiaOrders.\n\n- **Each execution:** 0.01 cirBTC for at least the minimum on the card\n- **Your Fence:** asks you to confirm above $500\n\n**Next:** review and sign the order in your wallet.",
      steps: [step("s1", "draft", "Drafting the order", "ok", "Order drafted (confirm)", 240), step("s2", "fence", "Checking your Fence", "warn", "Needs your confirmation", 30)],
      blocks: [{ kind: "order", summary: "Stop-loss: sell 0.01 cirBTC for USDC when BTC/USD falls to 60000", environment: "mainnet", decision: "confirm", reasons: ["Above $500: your Fence asks you to confirm."], perExecution: { fee: "0.0001", swapped: "0.00989", minOut: "587.4", symbolIn: "cirBTC", symbolOut: "USDC" }, approval: "Approve 0.01 cirBTC for LykiaOrders", executions: 1, input: { kind: "stop-loss", sell: "cirBTC", buy: "USDC", amount: "0.01", triggerPrice: "60000" } }],
      endedAt: T0 + 280,
    }),
  },
  {
    id: "watch-sourced",
    kick: "SITUATION · LYKO ON WATCH",
    title: "A sourced answer",
    user: "What does my Fold earn?",
    m: base("watch-sourced", {
      text: "Your Fold is worth $15,470.41 · Arc chain and venue APIs · block 29857405.\n\n- **Blended APY:** 4.05% · Morpho API · block 29857405\n- **Yearly estimate:** $330.61 · Morpho API · block 29857405\n- **Lowest health:** 1.38 · Aave V4 on Arc · block 29857401\n\n**Next:** the loan under your health floor comes first; its insight has a move ready.",
      steps: [step("s1", "wallet", "Reading every venue", "ok", "16 positions", 820, { detail: "Arc chain and venue APIs · block 29857405" })],
      blocks: [{ kind: "facts", title: "Your Fold, read now", note: null, rows: [
        { label: "Net worth", value: "$15,470.41", note: null, from: { source: "Arc chain and venue APIs", readAt: "2026-11-09T10:00:00.000Z", block: "29857405" } },
        { label: "Blended APY on what earns", value: "4.05%", note: null, from: { source: "Morpho API", readAt: "2026-11-09T10:00:00.000Z", block: "29857405", venue: "4 venues" } },
        { label: "Yearly estimate, net of borrowing", value: "$330.61", note: "at today's rates", from: { source: "Morpho API", readAt: "2026-11-09T10:00:00.000Z", block: "29857405", venue: "4 venues" } },
        { label: "Lowest health factor", value: "1.38", note: "Aave V4 Main Spoke · cirBTC supplied; your floor is 1.5", from: { source: "Aave V4 on Arc", readAt: "2026-11-09T09:59:58.000Z", block: "29857401", venue: "Aave V4" } },
        { label: "EURC/USD", value: "unavailable", note: "the reference price is stale", from: { source: "Chainlink EURC/USD", readAt: "2026-11-08T04:00:00.000Z", block: null, stale: "EURC/USD price is 30 h old, past its 26 h heartbeat" } },
      ] }],
      endedAt: T0 + 840,
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
      steps: [step("s1", "wallet", "Reading the wallet", "ok", "4 holdings · $12,480.20", 540), step("s2", "read", "Reading the outrun", "ok", "Settled", 230), step("s3", "fence", "Reading your Fence", "ok", "Fence Balanced (live)", 4)],
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

/** Plans the kit cards read, put in the query cache before they mount (no API call is needed to draw them). */
function useKitPlans(): void {
  const qc = useQueryClient();
  useState(() => {
    for (const g of [stagedGraph("start"), stagedGraph("after"), stagedGraph("paused"), acrossGraph(), repayGraph()]) qc.setQueryData(["intent", g.id], intentResponse(g));
    return true;
  });
}

export default function ChatKitPage() {
  useKitPlans();
  const actions: ChatActions = {
    environment: "mainnet",
    prefill: (text) => toast.info("Would fill the composer", { description: text, from: "KIT" }),
    ask: (text) => toast.info("Would ask", { description: text, from: "KIT" }),
    retry: () => toast.info("Would ask again", { from: "KIT" }),
    openRoute: (p) => toast.info("Would open the route", { description: p.title, from: "KIT" }),
    openReview: (p) => toast.info("Would open the review for the current step", { description: p.title, from: "KIT" }),
    stopPlan: async () => void toast.info("Would stop every step not started", { from: "KIT" }),
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
              {s.user ? <UserMessage text={s.user} /> : null}
              <AssistantMessage m={s.m} onChoose={(o) => toast.info("Would ask", { description: o, from: "KIT" })} />
            </div>
          </section>
        ))}
        <section className="m-chatkit__sec" id="bridge-route" data-testid="kit-bridge-route">
          <span className="m-kick">ROUTE · WHY ACROSS</span>
          <h2 className="m-chatkit__h">The route panel for the bridge</h2>
          <div className="m-frame" style={{ maxWidth: 480 }}>
            <RouteArtifact intentId={acrossGraph().id} onReview={() => undefined} />
          </div>
        </section>
        <section className="m-chatkit__sec" id="fold-watch" data-testid="kit-fold-watch">
          <span className="m-kick">THE FOLD · LYKO ON WATCH</span>
          <h2 className="m-chatkit__h">Sent to Ask Lyko, and a watch task from Ask Lyko</h2>
          <div style={{ maxWidth: 420 }}>
            <LykoOnWatch variant="tab" owner={{ address: KIT_OWNER, signedIn: true, own: true, sample: false, environment: "mainnet" }} insights={{ owner: KIT_OWNER, environment: "mainnet", at: "2026-11-08T09:12:00Z", insights: FOLD_INSIGHTS, brief: { since: null, lines: [] }, personal: true }} loading={false} instructions={FOLD_INSTRUCTIONS} snapshot={undefined} minHealth={1.5} busy={false} onDraft={() => undefined} onOpenInAsk={() => undefined} />
          </div>
        </section>
        <section className="m-chatkit__sec" id="fold-herding" data-testid="kit-fold-herding">
          <span className="m-kick">THE FOLD · HERDING</span>
          <h2 className="m-chatkit__h">Watches from Ask Lyko in Herding</h2>
          <HerdingTab instructions={FOLD_INSTRUCTIONS} waiting={[]} sample={false} signedIn initialFilter="watch" onSignIn={() => undefined} onOpen={() => undefined} onStop={() => undefined} onControl={() => undefined} onChange={() => undefined} onAsk={() => undefined} busyId={null} />
        </section>
      </div>
    </ChatActionsContext.Provider>
  );
}
