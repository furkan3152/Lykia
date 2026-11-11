/**
 * What Lykia knows about itself, as data: limits, fees, plain meanings, what
 * needs a signature or a wallet, what is switched off on a deployment, what
 * is not built, and the honest answers to questions it cannot know.
 *
 * Concrete figures are read from the constants the code enforces (the Fence
 * presets, the beta cap, the Autopilot and Stile ceilings, the fee and its
 * exempt step kinds, the order, alert and leash limits, the CCTP source
 * facts), never typed twice. `readKnowledge` reads a question against it:
 * "what is X", "can you X", "why can't you X", "how much does X cost",
 * "is X safe", "what happens if". Pure: no I/O.
 */
import { coreIntlTag, txKnown, localized } from "./i18n/index.js";
import { ALERT_LIMITS } from "./alerts.js";
import { AUTOPILOT_BETA, AUTOPILOT_LIMITS } from "./autopilot.js";
import { DEFAULT_FEE_BPS, FEE_EXEMPT_KINDS, FEE_SCHEDULE_KINDS } from "./fee.js";
import { FENCE_LIMITS } from "./fence.js";
import type { StepKind } from "./intent.js";
import { LEASH_LIMITS, STILE_BETA } from "./leash.js";
import { ARC_CCTP_SOURCE, type ArcEnvironment } from "./networks.js";
import { ORDER_KINDS, ORDERS_MAX_EXECUTIONS } from "./orders.js";
import { betaCapExplain, DEFAULT_BETA_CAP, FENCE_PRESET_IDS, FENCE_PRESETS, LYKIA_TERMS, MEANINGS, type BetaCap } from "./plain.js";

import { tx, phrase } from "./i18n/index.js";
export type KnowledgeTopic = "limit" | "fee" | "term" | "about" | "risk" | "unknowable" | "not-built" | "off" | "needs";

/** One thing Lykia knows about itself. `source` names the constant or module the line comes from. */
export interface KnowledgeEntry {
  readonly id: string;
  readonly topic: KnowledgeTopic;
  readonly name: string;
  /** The figure, when the entry has one ("$100 a step · $300 a day"). */
  readonly value: string | null;
  readonly plain: string;
  readonly source: string;
  /** A sentence that starts the nearest thing Lyko can do. */
  readonly say: string | null;
  /** Lower-case patterns that name it in a question (regular expression sources). */
  readonly words: readonly string[];
}

export interface SelfKnowledge {
  readonly limits: readonly KnowledgeEntry[];
  readonly fees: readonly KnowledgeEntry[];
  readonly glossary: readonly KnowledgeEntry[];
  readonly about: readonly KnowledgeEntry[];
  readonly risks: readonly KnowledgeEntry[];
  readonly unknowable: readonly KnowledgeEntry[];
  readonly notBuilt: readonly KnowledgeEntry[];
  /** Switched off on this deployment (feature flags). */
  readonly off: readonly KnowledgeEntry[];
  readonly needs: readonly KnowledgeEntry[];
}

export interface KnowledgeInputs {
  readonly environment: ArcEnvironment;
  /** Lykia's fee in basis points (the API's config.fee.bps). */
  readonly feeBps?: number;
  /** The mainnet beta cap, or null when the deployment switched it off. */
  readonly beta?: BetaCap | null;
  /** Feature flags of the deployment (flag -> on). */
  readonly flags?: Readonly<Record<string, boolean>>;
}

const dollars = (v: string | number) => `$${Number(v).toLocaleString(coreIntlTag(), { maximumFractionDigits: 2 })}`;
/** 100 bps -> "1%", 30 bps -> "0.3%". */
export const bpsPercent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

const KIND_WORDS: Readonly<Partial<Record<StepKind, string>>> = { transfer: phrase("sends"), swap: phrase("swaps"), fx: phrase("conversions"), deposit: phrase("vault deposits"), supply: phrase("lending supplies"), borrow: phrase("borrows"), bridge: phrase("bridges"), "gateway-deposit": phrase("Gateway deposits"), repay: phrase("repaying"), withdraw: phrase("withdrawing"), approve: phrase("approvals"), "register-agent": phrase("registering an agent"), attest: phrase("attestations") };

/** What each feature flag means when it is off, in the owner's words. Every flag in FEATURE_FLAGS has a line here (tested). */
export const FLAG_PLAIN: Readonly<Record<string, { readonly name: string; readonly off: string; readonly on?: string; readonly words: readonly string[] }>> = localized({
  "agents.llm": { name: phrase("Language model"), off: phrase("The language model is off here: Lyko answers with its built-in reader, which understands plain requests in every supported language."), words: ["model", "ai\\b", "llm"] },
  "agents.keeper": { name: phrase("Session-mode agent automations"), off: phrase("Agent automations that execute through a session are off here: each run arrives as a proposal you sign, or Autopilot signs it inside its leash."), words: ["keeper", "session.mode"] },
  "pack.onchain": { name: phrase("On-chain agent sessions"), off: phrase("On-chain sessions for Pack agents are off here: agents can still propose, and you sign."), words: ["on.?chain sessions?", "session keys?"] },
  x402: { name: phrase("Paid API routes (x402)"), off: phrase("The paid API routes for other agents are off here. They are a way to pay Lykia's API, never a route for your money."), words: ["x402", "paid (?:api|routes?)"] },
  "developer.signup": { name: phrase("Developer sign-up"), off: phrase("New developer accounts in The Forge are closed right now."), words: ["developer sign.?up", "forge sign.?up", "api key"] },
  "routing.halt": { name: phrase("Global halt"), off: "", on: phrase("Every new route is halted on this deployment right now. Money coming home (repaying, withdrawing) still passes."), words: ["halt", "kill switch"] },
});

function entry(e: Omit<KnowledgeEntry, "value" | "say"> & { readonly value?: string | null; readonly say?: string | null }): KnowledgeEntry {
  return { value: null, say: null, ...e };
}

/** Builds the self-knowledge for a network from the constants the code enforces. */
export function buildSelfKnowledge(input: KnowledgeInputs): SelfKnowledge {
  const feeBps = input.feeBps ?? DEFAULT_FEE_BPS;
  const beta = input.beta === undefined ? (input.environment === "mainnet" ? DEFAULT_BETA_CAP : null) : input.environment === "mainnet" ? input.beta : null;
  const fee = bpsPercent(feeBps);
  const free = [...FEE_EXEMPT_KINDS].filter((k) => k === "repay" || k === "withdraw" || k === "approve").map((k) => txKnown(KIND_WORDS[k] ?? k));
  const charged = FEE_SCHEDULE_KINDS.map((k) => txKnown(KIND_WORDS[k] ?? k));

  const limits: KnowledgeEntry[] = [
    ...FENCE_PRESET_IDS.map((id) => {
      const p = FENCE_PRESETS[id];
      const patch = p.patch as { caps: { perStepUsd: string; perIntentUsd: string; dailyUsd: string }; confirm: { aboveUsd: string }; limits: { maxSlippageBps: number }; lending: { minHealthFactor: string } };
      return entry({ id: `fence-${id}`, topic: "limit", name: `${p.label} Fence`, value: tx("{amount} a step · {amount2} a plan · {amount3} a day", { amount: dollars(patch.caps.perStepUsd), amount2: dollars(patch.caps.perIntentUsd), amount3: dollars(patch.caps.dailyUsd) }), plain: tx("{line} Lyko asks above {amount}, slippage at most {maxSlippageBps}, loans never under health {minHealthFactor}.", { line: p.line, amount: dollars(patch.confirm.aboveUsd), maxSlippageBps: bpsPercent(patch.limits.maxSlippageBps), minHealthFactor: patch.lending.minHealthFactor }), source: "Fence presets (core FENCE_PRESETS)", say: tx("Make my Fence {value}", { value: p.label.toLowerCase() }), words: [`${id}(?: fence| preset)?`] });
    }),
    entry({ id: "fence-edges", topic: "limit", name: tx("Any Fence"), value: tx("{maxSteps} steps a plan · slippage up to {maxSlippageBps}", { maxSteps: FENCE_LIMITS.maxSteps, maxSlippageBps: bpsPercent(FENCE_LIMITS.maxSlippageBps) }), plain: tx("The widest a Fence can be set: a plan has at most this many steps, and no Fence allows more slippage than this."), source: "core FENCE_LIMITS", say: tx("Show my Fence"), words: ["max(?:imum)? steps", "steps (?:in|per) (?:a |one )?plan", "max(?:imum)? slippage"] }),
    ...(beta
      ? [entry({ id: "beta-cap", topic: "limit", name: betaCapExplain(beta).name, value: betaCapExplain(beta).figures, plain: `${betaCapExplain(beta).sentence} ${betaCapExplain(beta).why} ${betaCapExplain(beta).scope} ${betaCapExplain(beta).home}`, source: "deployment beta cap (LYKIA_BETA_CAP_USD)", say: tx("Show my Fence"), words: ["beta (?:cap|limit)", "mainnet (?:cap|limit)", "most (?:i|you|lyko) can (?:move|send|swap)", "max(?:imum)? (?:amount|i can)", "how much can (?:i|you) (?:move|send|swap|bridge|deposit)"] })]
      : []),
    entry({ id: "autopilot-ceiling", topic: "limit", name: tx("Autopilot ceiling"), value: tx("{amount} a step · {amount2} a day", { amount: dollars(AUTOPILOT_BETA.perStepUsd), amount2: dollars(AUTOPILOT_BETA.perDayUsd) }), plain: tx("The most Autopilot may sign while in beta; you can choose lower. It runs {minDays} to {maxDays} days, pays at most {payees} payees you name and holds at most {tasks} tasks.", { minDays: AUTOPILOT_LIMITS.minDays, maxDays: AUTOPILOT_LIMITS.maxDays, payees: AUTOPILOT_LIMITS.payees, tasks: AUTOPILOT_LIMITS.tasks }), source: "core AUTOPILOT_BETA and AUTOPILOT_LIMITS", say: tx("Turn on Autopilot"), words: ["autopilot"] }),
    entry({ id: "stile-ceiling", topic: "limit", name: tx("Stile ceiling (a leash on a Gateway balance)"), value: tx("{amount} a transfer · {amount2} a day", { amount: dollars(STILE_BETA.perStepUsd), amount2: dollars(STILE_BETA.perDayUsd) }), plain: tx("The most a bot may spend from your Gateway balance through LykiaStile while it is unaudited. The contract enforces it; a leash can be lower."), source: "core STILE_BETA", say: tx("Give my bot $20 a day for a week from my Gateway balance"), words: ["stile", "gateway leash", "leash.*gateway", "gateway.*leash"] }),
    entry({ id: "leash-limits", topic: "limit", name: "Leash", value: tx("up to {maxDays} days · {recipients} payees · {perOwner} leashes", { maxDays: LEASH_LIMITS.maxDays, recipients: LEASH_LIMITS.recipients, perOwner: LEASH_LIMITS.perOwner }), plain: tx("A leash lasts at most this long, names at most this many payees, and you can hold this many at once. Its budget (per step, per day, in total) is yours to set, inside your Fence."), source: "core LEASH_LIMITS", say: tx("Give my bot $20 a day for a week"), words: ["leash(?:es)?", "bot budget"] }),
    entry({ id: "order-limits", topic: "limit", name: tx("Orders"), value: tx("{length} kinds · up to {value} executions", { length: ORDER_KINDS.length, value: ORDERS_MAX_EXECUTIONS.toLocaleString(coreIntlTag()) }), plain: tx("{value}. A DCA or TWAP order runs at most this many slices; each slice is checked against your Fence.", { value: new Intl.ListFormat(coreIntlTag(), { type: "conjunction" }).format(ORDER_KINDS.map((kind) => tx("{kind, select, limit {limit} stop-loss {stop-loss} take-profit {take-profit} dca {DCA} other {TWAP}}", { kind }))) }), source: "core ORDER_KINDS and ORDERS_MAX_EXECUTIONS", say: tx("Buy EURC when EUR/USD is below 1.09"), words: ["orders?", "dca", "twap", "limit orders?", "stop.?loss", "take.?profit"] }),
    entry({ id: "watch-limits", topic: "limit", name: tx("Watches"), value: tx("{perOwner} watches · at least {minCooldownSeconds} s between firings", { perOwner: ALERT_LIMITS.perOwner, minCooldownSeconds: ALERT_LIMITS.minCooldownSeconds }), plain: tx("You can keep this many watches; one fires again after {value} minutes by default.", { value: Math.round(ALERT_LIMITS.defaultCooldownSeconds / 60) }), source: "core ALERT_LIMITS", say: tx("Tell me if my health factor drops below 1.5"), words: ["watch(?:es)?", "alerts?"] }),
  ];

  const fees: KnowledgeEntry[] = [
    entry({ id: "lykia-fee", topic: "fee", name: tx("Lykia's fee"), value: fee, plain: tx("{fee} of what moves on {value}, paid in the same transaction: taken from the amount, or paid on top of an exact send.", { fee, value: charged.join(", ") }), source: "deployment fee (LYKIA_FEE_BPS) and core FEE_SCHEDULE_KINDS", say: tx("What did I pay in fees?"), words: ["fees?", "commission", "cost", "charge", "price of"] }),
    entry({ id: "free-moves", topic: "fee", name: tx("Free of Lykia's fee"), value: free.join(", "), plain: tx("Money coming home is never charged: paying back a loan and taking money out of a vault or a market cost only the network fee. Approvals are free of it too."), source: "core FEE_EXEMPT_KINDS", say: tx("Repay 150 USDC on Aave"), words: ["free", "repay", "withdraw", "no fee"] }),
    entry({ id: "gas", topic: "fee", name: tx("Network fee (gas)"), value: tx("paid in USDC"), plain: MEANINGS.gas, source: "Arc network (USDC is the gas token)", say: tx("How is my gas?"), words: ["gas", "network fee"] }),
    entry({ id: "cctp-fee", topic: "fee", name: tx("Bridging with CCTP"), value: tx("Circle's fee {standardFeeBps} · attested in about {attestationSeconds} s", { standardFeeBps: bpsPercent(ARC_CCTP_SOURCE.standardFeeBps), attestationSeconds: ARC_CCTP_SOURCE.attestationSeconds }), plain: tx("Circle burns USDC on Arc and mints native USDC on the other chain. Circle's standard transfer from Arc carries no Circle fee; Lykia's fee and a forwarding fee Circle quotes for the mint apply, and the plan shows both before you sign. Across and Relay are quoted next to it with their own fee."), source: "core ARC_CCTP_SOURCE and the live bridge quotes", say: tx("Bridge 100 USDC to Base"), words: ["bridge", "bridging", "cctp", "cross.?chain"] }),
  ];

  const term = (id: string, name: string, plain: string, words: readonly string[], say: string | null = null, source = tx("core plain words (LYKIA_TERMS, MEANINGS)")) => entry({ id, topic: "term", name, plain, source, say, words });
  const glossary: KnowledgeEntry[] = [
    ...(Object.keys(LYKIA_TERMS) as (keyof typeof LYKIA_TERMS)[]).map((k) => term(k, `${LYKIA_TERMS[k].word} · ${LYKIA_TERMS[k].plain}`, LYKIA_TERMS[k].line, [k === "trails" ? "trails?" : k === "leash" ? "leash(?:es)?" : k])),
    term("health-factor", tx("Health factor"), MEANINGS.healthFactor, ["health factor", "health", "liquidat\\w+"], tx("Tell me if my health factor drops below 1.5")),
    term("slippage", tx("Slippage"), MEANINGS.slippage, ["slippage"]),
    term("apy", "APY", MEANINGS.apy, ["apy", "apr", "yield rate"], tx("Where can I earn on USDC?")),
    term("ltv", tx("Loan to value"), MEANINGS.ltv, ["ltv", "loan to value"]),
    term("min-received", tx("Minimum received"), MEANINGS.minReceived, ["min(?:imum)? received"]),
    term("unpriced", tx("Unpriced"), MEANINGS.unpriced, ["unpriced"]),
    term("finality", tx("Finality"), tx("When a transaction can no longer be undone. On Arc that is deterministic and takes under a second, so a settled step stays settled."), ["finality", "final"], null, tx("Arc network")),
    term("gas", tx("Gas"), MEANINGS.gas, ["gas"], tx("How is my gas?")),
    term("autopilot", "Autopilot", tx("Lyko signs your own automations (repaying, sweeping idle USDC, recurring payments) inside a leash on your own LykiaAccount. Off until you turn it on; Stop ends it at once."), ["autopilot"], tx("Turn on Autopilot"), tx("core autopilot")),
    term("stile", "Stile", tx("A gate on your Circle Gateway balance: a leash that spends from it goes through LykiaStile, which enforces a per-transfer and a daily ceiling on chain."), ["stile"], null, tx("core leash (LykiaStile)")),
    term("gateway", "Circle Gateway", tx("One USDC balance you deposit once on Arc and can spend on several chains."), ["gateway", "unified balance"], tx("Deposit 300 USDC into Gateway"), "Circle Gateway"),
    term("cctp", "CCTP", tx("Circle's bridge: USDC is burned on Arc and minted as native USDC on the other chain."), ["cctp"], tx("Bridge 100 USDC to Base"), "Circle CCTP"),
    term("preflight", tx("Checks before you sign"), tx("Before anything is signed, code checks the plan: gas left, balance, what is due this week, price impact, the FX rate, loan health and more. A problem comes first, with fixes to pick."), ["preflight", "checks? before"], null, tx("core PREFLIGHT_CHECKS")),
    term("dry-run", tx("Dry run"), tx("A plan that is built and checked but cannot be signed. Without a connected wallet every plan is a dry run for a sample address."), ["dry.?run", "sample (?:address|mode|wallet)"], null, tx("Fence mode dry-run")),
    term("beta", tx("Beta limit"), betaCapExplain(beta ?? DEFAULT_BETA_CAP).why, ["beta"], null, tx("deployment beta cap")),
    term("lykia-fee", tx("Lykia's fee"), MEANINGS.lykiaFee.replace("1%", fee), ["lykia(?:'s)? fee"], null, tx("deployment fee")),
    term("verdict", tx("Verdict"), MEANINGS.verdict, ["verdict"]),
    term("the-fold", tx("The Fold"), tx("Where you see and manage everything you own and everything in motion. Anything started in Ask shows there as one row, with one control."), ["the fold", "fold"], null, "Lykia"),
    term("the-forge", tx("The Forge"), tx("The developer area: API keys, projects, the SDK and the docs."), ["the forge", "forge"], null, "Lykia"),
  ];

  const about: KnowledgeEntry[] = [
    entry({ id: "what-lykia-is", topic: "about", name: tx("What Lykia is"), plain: tx("An agent and stablecoin desk on Arc Network. You say what your money should do; Lyko plans it across Arc's venues, checks every step against your Fence, and hands you something to sign."), source: "Lykia", say: tx("What can you do?"), words: ["what (?:is|are) (?:lykia|lyko|you)", "who are you", "what do you do"] }),
    entry({ id: "non-custodial", topic: "about", name: tx("Who holds the money"), plain: tx("You do. Lykia is non-custodial: it never holds your funds or your keys. Lyko proposes and your wallet signs; nothing moves without a signature."), source: "Lykia (plans are unsigned transactions)", say: null, words: ["custod\\w+", "hold my (?:money|funds|keys?)", "keep my (?:money|funds|keys?)", "my keys?", "private keys?", "seed phrase", "trust you with"] }),
    entry({ id: "who-signs", topic: "about", name: tx("Who signs"), plain: tx("Your wallet signs every plan. The one exception is Autopilot, and only after you turn it on: Lyko then signs your own automations inside a leash on your LykiaAccount, within the limits you set, until you press Stop."), source: "core autopilot (leash on the owner's LykiaAccount)", say: tx("Turn on Autopilot"), words: ["sign (?:for|on behalf of) me", "who signs", "do you sign", "can you sign", "move (?:money|funds) (?:on your own|without me|by yourself)", "without (?:my|me) sign\\w*"] }),
    entry({ id: "rails", topic: "about", name: tx("What it is built on"), plain: tx("Arc is Circle's network, where USDC pays the gas. Lykia routes through Circle's CCTP and Gateway and through Arc's own venues; the routing, the Fence, the Leash and the checks are Lykia's own code."), source: "Lykia", say: tx("Where can I bridge to?"), words: ["built on", "arc network", "what is arc", "circle"] }),
    entry({ id: "numbers", topic: "about", name: tx("Where the numbers come from"), plain: tx("Every figure comes from the chain or an official API, with its source and the block or time it was read. When something cannot be read Lyko says unavailable; it never estimates."), source: "Lykia (number discipline)", say: null, words: ["where do (?:the |your )?(?:numbers|figures|prices) come", "source of", "how do you know", "can i trust (?:the|your) numbers"] }),
  ];

  const risks: KnowledgeEntry[] = [
    entry({ id: "risk-beta", topic: "risk", name: tx("Unaudited beta"), plain: tx("Lykia's contracts have not been audited yet. That is why {value}, and why you should only use money you can afford to have at risk.", { value: beta ? tx("mainnet moves are capped at {figures}", { figures: betaCapExplain(beta).figures }) : tx("amounts are capped while in beta") }), source: "deployment beta cap", words: ["lykia", "lyko", "you\\b", "this app", "beta", "audit\\w*"] }),
    entry({ id: "risk-vault", topic: "risk", name: tx("Vault and lending risk"), plain: tx("A vault or a lending market can lose money: a borrower can default, a contract can have a bug, and a rate can fall. Lyko compares rates and risk tiers and says what it compared; it never calls one safe."), source: "core knowledge rows (venue risk)", say: tx("Where can I earn on USDC?"), words: ["vaults?", "lending", "morpho", "aave", "earn\\w*", "deposit\\w*", "yield"] }),
    entry({ id: "risk-bridge", topic: "risk", name: tx("Bridge risk"), plain: tx("A bridge depends on its operator: CCTP on Circle, Across and Relay on their solvers. A transfer can take longer than quoted; an unfilled Across or Relay deposit is refunded on Arc. Lyko shows the route and its settlement before you sign."), source: "core bridge routes", say: tx("Bridge 100 USDC to Base"), words: ["bridg\\w+", "cctp", "across", "relay", "cross.?chain"] }),
    entry({ id: "risk-loan", topic: "risk", name: tx("Loan risk"), plain: tx("A loan can be liquidated: when its health factor reaches 1.00, part of the collateral is sold to repay it. Your Fence keeps new borrowing above a floor, and a watch can tell you when health drops."), source: "core MEANINGS.healthFactor and the Fence health floor", say: tx("Tell me if my health factor drops below 1.5"), words: ["borrow\\w*", "loans?", "leverage", "liquidat\\w+"] }),
    entry({ id: "risk-token", topic: "risk", name: tx("Token risk"), plain: tx("A token can be a copy, a trap or simply worthless. Scent reports what can be proven about one (registry, look-alikes, privileged functions, a simulated transfer) and never promises that it is safe."), source: "Scent", say: tx("Check a token for me"), words: ["tokens?", "coins?", "scam", "rug", "eurc", "usdc", "cirbtc", "stablecoins?"] }),
    entry({ id: "risk-autopilot", topic: "risk", name: tx("Autopilot and Leash risk"), plain: tx("A leash is a signing key with limits. Inside those limits it can spend without asking you, so set them to what you can afford: Autopilot is capped at {amount} a step and {amount2} a day in beta, and Stop or Revoke ends a key at once.", { amount: dollars(AUTOPILOT_BETA.perStepUsd), amount2: dollars(AUTOPILOT_BETA.perDayUsd) }), source: "core AUTOPILOT_BETA", say: tx("Show me what is running"), words: ["autopilot", "leash(?:es)?", "agents?", "bots?"] }),
  ];

  const unknowable: KnowledgeEntry[] = [
    entry({ id: "future-prices", topic: "unknowable", name: tx("Future prices and rates"), plain: tx("Nobody knows where a price or a rate goes next, and Lyko does not guess. It can show today's rate with its source, run a what-if on your holdings, or watch a level for you."), source: "Lykia (number discipline)", say: tx("What if EURC drops 5%?"), words: ["will .* (?:go up|go down|rise|fall|drop|crash|moon|pump|dump|increase|decrease)", "price prediction", "predict\\w*", "forecast\\w*", "going to (?:go up|go down|rise|fall|drop|crash)", "should i (?:buy|sell)", "is it a good time", "best time to (?:buy|sell)", "which (?:coin|token) (?:will|should)"] }),
    entry({ id: "advice", topic: "unknowable", name: tx("Tax, legal and investment advice"), plain: tx("Lyko is not a tax, legal or investment adviser and will not act as one. It can give you the record: every settled step, fee and transaction is in Trails, with its memo, for you or your accountant."), source: "Lykia", say: tx("What did I pay in fees?"), words: ["tax\\w*", "legal\\w*", "lawyer", "law\\b", "regulat\\w+", "investment advice", "financial advice", "accountant"] }),
    entry({ id: "others", topic: "unknowable", name: tx("Other people's wallets"), plain: tx("Lyko reads public chain data only. It cannot see who owns an address, what an exchange holds for you, or anything off chain."), source: "Lykia", say: null, words: ["who owns", "(?:on|at|in) my (?:binance|coinbase|exchange) account", "what does (?:binance|coinbase) hold", "off.?chain data"] }),
  ];

  const nb = (id: string, name: string, plain: string, words: readonly string[], say: string | null) => entry({ id, topic: "not-built", name, plain, source: "capability map (no executable adapter)", say, words });
  const notBuilt: KnowledgeEntry[] = [
    nb("perps", tx("Perps and leverage trading"), tx("Lykia does not trade perps, margin or leverage. It shows perps markets read-only; on Arc itself the nearest thing is a stop-loss, a take-profit or a limit order."), ["perps?", "perpetuals?", "leverage\\w*", "margin", "futures", "short\\w*", "long position", "\\d+x"], tx("Sell my cirBTC if it drops 10%")),
    nb("launchpad", tx("Launching or sniping tokens"), tx("Lykia does not launch tokens or buy into launches. It lists new pools on Arc and checks each token's Scent before you touch it."), ["launch\\w*", "create a (?:token|coin)", "mint a (?:token|coin)", "deploy a (?:token|coin)", "snip\\w+", "presale", "memecoin"], tx("What are the new pools on Arc?")),
    nb("stablefx", tx("Circle StableFX"), tx("StableFX is not a route in Lykia: it settles a quote off chain that Lykia cannot check from your wallet. USDC and EURC convert on chain instead, checked against Chainlink's EURC/USD."), ["stablefx", "stable fx", "rfq"], tx("Convert 200 USDC to EURC")),
    nb("usyc", tx("Minting or redeeming USYC"), tx("USYC is not a route in Lykia: its Teller serves allowlisted holders only and its source is not verified. Lykia shows a USYC balance you already hold; to earn on USDC it compares Arc's vaults and markets."), ["usyc", "treasur(?:y|ies) (?:bills?|fund)", "t.?bills?"], tx("Where can I earn on USDC?")),
    nb("x402", tx("Paying through x402"), tx("x402 is how other agents pay for Lykia's API. It is not a route for your money."), ["x402"], tx("What can you do?")),
    nb("solana", tx("Bridging to Solana"), tx("Not yet: a Solana transfer needs a token account Lykia does not create. USDC bridges to the EVM chains CCTP serves."), ["solana", "\\bsol\\b"], tx("Where can I bridge to?")),
    nb("fiat", tx("Bank transfers and cards"), tx("Lykia moves stablecoins on chain; it has no bank, card or cash rail. To cash out, send USDC to an exchange or a provider you use."), ["bank\\w*", "iban", "wire", "fiat", "credit card", "debit card", "cash out", "off.?ramp", "on.?ramp", "withdraw to my bank", "paypal", "\\btl\\b", "lira"], tx("Pay 250 USDC to 0x… for invoice 42")),
    nb("nft", "NFTs", tx("Lykia does not buy, sell or hold NFTs for you. It moves stablecoins and the registry tokens on Arc."), ["nfts?"], tx("What can you do?")),
    nb("lp", tx("Opening liquidity positions"), tx("Lykia does not open or rebalance LP positions in a plan. It reads the ones you hold (range and fees) and Lyko on watch tells you when one leaves its range."), ["liquidity position", "provide liquidity", "add liquidity", "\\blp\\b", "become an? lp"], tx("Tell me if my liquidity goes out of range")),
    nb("other-chains", tx("Acting on other chains"), tx("Lyko plans on Arc only. It can bridge USDC to another chain, and a Gateway balance can be spent there, but it does not swap, lend or borrow on other chains."), ["on (?:base|ethereum|arbitrum|optimism|polygon|avalanche|bsc|tron)", "from (?:base|ethereum|arbitrum|optimism|polygon|avalanche) to"], tx("Where can I bridge to?")),
    nb("undo", tx("Undoing a settled transaction"), tx("A settled transaction is final on Arc and cannot be reversed. Lyko can plan the opposite move at today's price, which costs a second fee and the spread."), ["undo", "reverse", "revert", "cancel (?:a |the |my )?(?:transaction|transfer|payment|send)", "take back", "refund"], tx("Undo my last swap")),
    nb("custody", tx("Holding your funds or keys"), tx("Lykia never holds your money or your keys, and cannot recover a lost key or a seed phrase."), ["recover my (?:key|wallet|seed)", "lost my (?:key|wallet|seed)", "reset my (?:password|wallet)", "store my (?:key|seed)"], null),
    nb("guarantee", tx("Guaranteed returns"), tx("No return is guaranteed and Lyko never says so. A rate is today's rate; it moves every day."), ["guarantee\\w*", "risk.?free", "no risk", "sure profit"], tx("Where can I earn on USDC?")),
  ];

  const flags = input.flags ?? {};
  const off: KnowledgeEntry[] = Object.entries(FLAG_PLAIN).flatMap(([flag, f]) => {
    const on = flags[flag];
    if (on === undefined) return [];
    if (flag === "routing.halt") return on ? [entry({ id: `flag-${flag}`, topic: "off", name: f.name, plain: f.on ?? "", source: `feature flag ${flag}`, words: f.words })] : [];
    return on ? [] : [entry({ id: `flag-${flag}`, topic: "off", name: f.name, plain: f.off, source: `feature flag ${flag}`, words: f.words })];
  });

  const needs: KnowledgeEntry[] = [
    entry({ id: "needs-wallet", topic: "needs", name: tx("A connected wallet"), plain: tx("Planning for real, signing, and anything about your own money need a connected wallet. Without one Lyko answers general questions and plans dry runs for a sample address, and says so."), source: "Lykia (sample mode)", say: null, words: ["need a wallet", "without a wallet", "connect(?:ing)? (?:a |my )?wallet", "no wallet", "do i (?:need|have) to connect"] }),
    entry({ id: "needs-sign-in", topic: "needs", name: tx("Signing in (one message, no transaction)"), plain: tx("Saving something for you (a watch, an automation, a leash), your history, your memory and your private rows in the Fold need a sign-in: one signed message that proves the wallet is yours. It costs nothing and moves nothing."), source: "Sign-In with Ethereum session", say: null, words: ["sign.?in", "log.?in", "why (?:do i|must i) sign a message", "prove"] }),
    entry({ id: "needs-signature", topic: "needs", name: tx("A transaction you sign"), plain: tx("Every money move (send, convert, swap, deposit, withdraw, borrow, repay, bridge), every order, cancelling an order, turning on Autopilot, creating or revoking a leash and loosening your Fence need your wallet's signature. Pausing, resuming and stopping things, making your Fence stricter and setting a watch do not."), source: "Lykia (plans are unsigned transactions; RunningControl.sign)", say: null, words: ["need(?:s)? (?:a |my )?signature", "what (?:do i|must i) sign", "have to sign", "which .* sign", "do i sign"] }),
    entry({ id: "where-it-shows", topic: "needs", name: tx("Where things show"), plain: tx("Anything started in Ask is one row in the Fold: plans, orders, automations, watches, leashes and Autopilot under Herding, each with one control; holdings and positions under Flock; what happened, with fees, under Trails; your rules under Fence."), source: "the Fold (Herding, Flock, Trails, Fence)", say: tx("Show me what is running"), words: ["where (?:do|can|will) i (?:see|find|manage|stop)", "where does it show", "where is it"] }),
  ];

  return { limits, fees, glossary, about, risks, unknowable, notBuilt, off, needs };
}

/** Every entry, for the tests and the system prompt summary. */
export function knowledgeEntries(k: SelfKnowledge): KnowledgeEntry[] {
  return [...k.limits, ...k.fees, ...k.glossary, ...k.about, ...k.risks, ...k.unknowable, ...k.notBuilt, ...k.off, ...k.needs];
}

/** A compact block for the model's system prompt: what Lykia is, the figures it must quote from here, and what it must refuse. */
export function selfKnowledgeSummary(k: SelfKnowledge): string {
  const line = (e: KnowledgeEntry) => `${e.name}${e.value ? `: ${e.value}` : ""}`;
  return [
    "Self-knowledge (from code). Quote these figures only as written here or from a tool result.",
    `- About: ${k.about.map((e) => e.plain).slice(0, 3).join(" ")}`,
    `- Limits: ${k.limits.map(line).join("; ")}`,
    `- Fees: ${k.fees.map(line).join("; ")}`,
    `- Not built (say no, why, and the nearest thing you can do): ${k.notBuilt.map((e) => e.name).join("; ")}`,
    ...(k.off.length > 0 ? [`- Off on this deployment: ${k.off.map((e) => e.name).join("; ")}`] : []),
    `- Risks to name when asked if something is safe (never say safe): ${k.risks.map((e) => e.name).join("; ")}`,
    `- Cannot know (say so plainly, then offer what you can do): ${k.unknowable.map((e) => e.name).join("; ")}`,
  ].join("\n");
}

/* --------------------------------------------------------------- reading */

export type KnowledgeIntent = "define" | "can" | "why-not" | "cost" | "limit" | "safe" | "what-if" | "about" | "needs" | "off";

export interface KnowledgeReading {
  readonly intent: KnowledgeIntent;
  /** "yes": it can; "no": it cannot (with the nearest thing); "info": an explanation. */
  readonly verdict: "yes" | "no" | "info";
  /** The entries that answer it, best first (at most four). */
  readonly entries: readonly KnowledgeEntry[];
  /** For "can you X" with a yes: the capability map action or feature that does it. */
  readonly can?: { readonly name: string; readonly plain: string; readonly say: string; readonly venues: number };
}

const hit = (t: string, e: KnowledgeEntry) => e.words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${w})(?![\\p{L}\\p{N}])`, "u").test(t));
const pick = (t: string, list: readonly KnowledgeEntry[]) => list.filter((e) => hit(t, e));

export interface CanTarget {
  readonly name: string;
  readonly plain: string;
  readonly say: string;
  readonly venues: number;
  readonly words: readonly string[];
}

const WHAT_IF: readonly { readonly words: readonly string[]; readonly entry: KnowledgeEntry }[] = [
  { words: ["liquidat\\w+", "health (?:factor )?(?:drops|falls|hits|reaches|goes)"], entry: entry({ id: "if-liquidated", topic: "risk", name: phrase("If a loan is liquidated"), plain: phrase("When a loan's health factor reaches 1.00, the venue sells part of your collateral to repay the debt, usually with a penalty. Repaying part of the loan or adding collateral before that raises the health factor."), source: "core MEANINGS.healthFactor", say: phrase("Fix my loan health"), words: [] }) },
  { words: ["step fails?", "transaction fails?", "plan fails?", "it fails", "something fails", "fails? (?:halfway|midway)", "goes wrong"], entry: entry({ id: "if-fails", topic: "about", name: phrase("If a step fails"), plain: phrase("A failed step moves nothing: the transaction reverts and only its network fee is spent. Steps that already settled stay settled, and the next step is rebuilt from what actually arrived, so you can stop there or carry on."), source: "Lykia (step-by-step plans)", say: phrase("Why did my last plan fail?"), words: [] }) },
  { words: ["whistle"], entry: entry({ id: "if-whistle", topic: "about", name: phrase("If you blow the Whistle"), plain: LYKIA_TERMS.whistle.line, source: "core LYKIA_TERMS.whistle", say: phrase("Blow the whistle"), words: [] }) },
  { words: ["bridge (?:fails?|gets? stuck|is stuck)", "stuck", "never arrives?", "does ?n.t arrive"], entry: entry({ id: "if-bridge-stuck", topic: "risk", name: phrase("If a bridge transfer is slow"), plain: phrase("A CCTP transfer is burned on Arc first and minted on the other chain once Circle attests it; it shows as in flight in the Fold until then. An Across or Relay deposit nobody fills is refunded on Arc."), source: "core bridge routes", say: phrase("Where is my money?"), words: [] }) },
  { words: ["price moves?", "price changes?", "slippage"], entry: entry({ id: "if-price-moves", topic: "about", name: phrase("If the price moves before you sign"), plain: `${MEANINGS.slippage} ${MEANINGS.minReceived}`, source: "core MEANINGS", say: null, words: [] }) },
  { words: ["los[et] my (?:key|wallet|phone|seed)", "wallet is (?:hacked|stolen)", "get hacked"], entry: entry({ id: "if-key-lost", topic: "about", name: phrase("If you lose your wallet"), plain: phrase("Lykia never holds your keys and cannot restore them. A stolen leash key is bounded by its limits and dies when you press Revoke; the Whistle stops every agent at once."), source: "Lykia (non-custodial)", say: phrase("Blow the whistle"), words: [] }) },
  { words: ["lykia (?:goes down|is down|disappears|shuts down|dies)", "you (?:go down|are down|disappear|shut down)"], entry: entry({ id: "if-lykia-down", topic: "about", name: phrase("If Lykia goes away"), plain: phrase("Your money stays where it is: in your wallet and in the venues' own contracts, which you can reach without Lykia. Only what Lykia runs for you (automations, watches, Autopilot) would stop."), source: "Lykia (non-custodial)", say: null, words: [] }) },
  { words: ["run out of gas", "no gas", "gas runs out"], entry: entry({ id: "if-no-gas", topic: "about", name: phrase("If gas runs out"), plain: phrase("Arc pays gas in USDC, so a wallet with no USDC cannot send anything. Lyko checks the gas a plan leaves before you sign and warns under your reserve."), source: "core PREFLIGHT_CHECKS gas-reserve", say: phrase("How is my gas?"), words: [] }) },
];

/**
 * Reads a self-knowledge question. `can` lists what the capability map can do (actions and features with the words
 * that name them). Null when the sentence is not a question about Lykia itself.
 */
export function readKnowledge(text: string, k: SelfKnowledge, can: readonly CanTarget[]): KnowledgeReading | null {
  const t = text.trim().toLowerCase().replace(/[’']/gu, "'").replace(/\s+/gu, " ");
  if (t.length === 0 || t.length > 300) return null;
  const question = /\?/u.test(t) || /^(what|which|where|can|could|do|does|how|is|are|why|who|will|should|explain|tell me (?:about|what|how|why))\b/u.test(t);
  if (!question) return null;
  const all = knowledgeEntries(k);
  const top = (list: readonly KnowledgeEntry[]) => list.slice(0, 4);

  // What Lyko cannot know comes first: a price forecast or advice is never answered as a capability.
  const cannotKnow = pick(t, k.unknowable);
  if (cannotKnow.length > 0 && !/\bwhat (?:is|does)\b.*\bmean\b/u.test(t)) return { intent: "about", verdict: "no", entries: top(cannotKnow) };

  // "What happens if ...": the abstract consequences (a priced what-if on holdings is the Stress test, read elsewhere).
  if (/\bwhat (?:happens|if|would happen|will happen)\b|\bwhat about if\b/u.test(t)) {
    const w = WHAT_IF.filter((x) => x.words.some((p) => new RegExp(p, "u").test(t))).map((x) => x.entry);
    if (w.length > 0) return { intent: "what-if", verdict: "info", entries: top(w) };
  }

  // "Is X safe?": the risks that apply, never "safe".
  if (/\b(safe|safely|secure|risky|risks?|dangerous|trust(?:ed|worthy)?|audited|scam|legit)\b/u.test(t)) {
    const r = pick(t, k.risks.filter((e) => e.id !== "risk-beta"));
    const beta = k.risks.find((e) => e.id === "risk-beta");
    return { intent: "safe", verdict: "info", entries: top([...r, ...(beta ? [beta] : [])]) };
  }

  const names = (list: readonly KnowledgeEntry[]) => pick(t, list);

  // A question about a limit is answered with the limit, also when it is phrased "how many ... can I".
  if (/\b(?:how many|how much can|how long|limits?|caps?|ceiling|max(?:imum)?|at most|the most)\b/u.test(t) && names(k.notBuilt).length === 0) {
    const early = names(k.limits);
    if (early.length > 0) return { intent: "limit", verdict: "info", entries: top(early) };
  }

  // "Why can't you X" / "can you X" / "do you support X".
  const whyNot = /\bwhy (?:can'?t|cannot|can not|don'?t|do not|won'?t|not)\b|\bwhy is(?:n'?t| not)\b/u.test(t);
  const canAsk = /\b(?:can|could|will|would) (?:you|i|lyko|lykia|we)\b|\bdo(?:es)? (?:you|lyko|lykia)\b.*\b(?:support|have|do|offer|handle|work)\b|\b(?:is|are) (?:it |there |.{1,40}) ?(?:possible|supported|available)\b|\bable to\b|\bsupport(?:s|ed)?\b/u.test(t);
  if (whyNot || canAsk) {
    const missing = names(k.notBuilt);
    const offHere = names(k.off);
    if (missing.length > 0) return { intent: whyNot ? "why-not" : "can", verdict: "no", entries: top(missing) };
    if (offHere.length > 0) return { intent: whyNot ? "why-not" : "can", verdict: "no", entries: top(offHere) };
    const whoSigns = names(k.about.filter((e) => e.id === "who-signs" || e.id === "non-custodial"));
    if (whoSigns.length > 0) return { intent: "about", verdict: "info", entries: top(whoSigns) };
    const target = can.find((c) => c.words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${w})(?![\\p{L}\\p{N}])`, "u").test(t)));
    if (target && !/\b\d/u.test(t)) return { intent: "can", verdict: "yes", entries: [], can: { name: target.name, plain: target.plain, say: target.say, venues: target.venues } };
    if (whyNot) return { intent: "why-not", verdict: "info", entries: top(k.needs.filter((e) => e.id === "needs-wallet" || e.id === "needs-signature")) };
  }

  // "What is off / not available / not supported?"
  if (/\bwhat (?:is|'s|are) (?:off|disabled|unavailable|not (?:available|supported|built|possible))\b|\bwhat can'?t you do\b|\bwhat (?:can you not|are you unable to) do\b|\byour limitations\b/u.test(t)) return { intent: "off", verdict: "info", entries: [...k.off, ...k.notBuilt].slice(0, 12) };

  // "How much does X cost?" / "what are the fees?" / "is repay free?"
  if (/\b(fees?|cost|costs|commission|charge[sd]?|free|how much (?:do|does|is|are|will) .* (?:cost|take|charge))\b/u.test(t) && !/\bwhat did i pay\b|\bi paid\b|\bhave i paid\b|\bspent on fees\b/u.test(t)) {
    const specific = pick(t, k.fees.filter((e) => e.id !== "lykia-fee"));
    const base = k.fees.find((e) => e.id === "lykia-fee")!;
    return { intent: "cost", verdict: "info", entries: top([...(specific.length > 0 ? specific : []), base, ...(specific.length === 0 ? k.fees.filter((e) => e.id === "free-moves" || e.id === "gas") : [])]) };
  }

  // "What is the limit / the most / the minimum ...?"
  if (/\b(limits?|caps?|ceiling|max(?:imum)?|most|at most|how much can|how many|how long can|minimum|least)\b/u.test(t)) {
    const l = names(k.limits);
    if (l.length > 0) return { intent: "limit", verdict: "info", entries: top(l) };
    if (/\b(limits?|caps?|ceiling)\b/u.test(t)) return { intent: "limit", verdict: "info", entries: top(k.limits.filter((e) => e.id === "beta-cap" || e.id === "fence-balanced" || e.id === "autopilot-ceiling" || e.id === "stile-ceiling")) };
  }

  // What needs a wallet or a signature, and where things show.
  const need = names(k.needs);
  if (need.length > 0) return { intent: "needs", verdict: "info", entries: top(need) };

  // What Lykia is.
  const what = names(k.about);
  if (what.length > 0) return { intent: "about", verdict: "info", entries: top(what) };

  // "What is X?" / "what does X mean?" / "explain X".
  if (/\bwhat(?:'s| is| are| does)\b|\bexplain\b|\bmean(?:s|ing)?\b|\bhow does\b|\bhow do\b|\btell me about\b/u.test(t)) {
    const terms = names(k.glossary).sort((a, b) => Math.max(...b.words.map((w) => w.length)) - Math.max(...a.words.map((w) => w.length)));
    if (terms.length > 0) return { intent: "define", verdict: "info", entries: top(terms) };
    const lim = names(k.limits);
    if (lim.length > 0) return { intent: "limit", verdict: "info", entries: top(lim) };
  }
  void all;
  return null;
}
