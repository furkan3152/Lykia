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
import { ALERT_LIMITS } from "./alerts.js";
import { AUTOPILOT_BETA, AUTOPILOT_LIMITS } from "./autopilot.js";
import { DEFAULT_FEE_BPS, FEE_EXEMPT_KINDS, FEE_SCHEDULE_KINDS } from "./fee.js";
import { FENCE_LIMITS } from "./fence.js";
import type { StepKind } from "./intent.js";
import { LEASH_LIMITS, STILE_BETA } from "./leash.js";
import { ARC_CCTP_SOURCE, type ArcEnvironment } from "./networks.js";
import { ORDER_KINDS, ORDERS_MAX_EXECUTIONS } from "./orders.js";
import { betaCapExplain, DEFAULT_BETA_CAP, FENCE_PRESET_IDS, FENCE_PRESETS, LYKIA_TERMS, MEANINGS, type BetaCap } from "./plain.js";

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

const dollars = (v: string | number) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/** 100 bps -> "1%", 30 bps -> "0.3%". */
export const bpsPercent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

const KIND_WORDS: Readonly<Partial<Record<StepKind, string>>> = { transfer: "sends", swap: "swaps", fx: "conversions", deposit: "vault deposits", supply: "lending supplies", borrow: "borrows", bridge: "bridges", "gateway-deposit": "Gateway deposits", repay: "repaying", withdraw: "withdrawing", approve: "approvals", "register-agent": "registering an agent", attest: "attestations" };

/** What each feature flag means when it is off, in the owner's words. Every flag in FEATURE_FLAGS has a line here (tested). */
export const FLAG_PLAIN: Readonly<Record<string, { readonly name: string; readonly off: string; readonly on?: string; readonly words: readonly string[] }>> = {
  "agents.llm": { name: "Language model", off: "The language model is off here: Lyko answers with its built-in reader, which understands plain requests in English and common Turkish.", words: ["model", "ai\\b", "llm"] },
  "agents.keeper": { name: "Session-mode agent automations", off: "Agent automations that execute through a session are off here: each run arrives as a proposal you sign, or Autopilot signs it inside its leash.", words: ["keeper", "session.mode"] },
  "pack.onchain": { name: "On-chain agent sessions", off: "On-chain sessions for Pack agents are off here: agents can still propose, and you sign.", words: ["on.?chain sessions?", "session keys?"] },
  x402: { name: "Paid API routes (x402)", off: "The paid API routes for other agents are off here. They are a way to pay Lykia's API, never a route for your money.", words: ["x402", "paid (?:api|routes?)"] },
  "developer.signup": { name: "Developer sign-up", off: "New developer accounts in The Forge are closed right now.", words: ["developer sign.?up", "forge sign.?up", "api key"] },
  "routing.halt": { name: "Global halt", off: "", on: "Every new route is halted on this deployment right now. Money coming home (repaying, withdrawing) still passes.", words: ["halt", "kill switch"] },
};

function entry(e: Omit<KnowledgeEntry, "value" | "say"> & { readonly value?: string | null; readonly say?: string | null }): KnowledgeEntry {
  return { value: null, say: null, ...e };
}

/** Builds the self-knowledge for a network from the constants the code enforces. */
export function buildSelfKnowledge(input: KnowledgeInputs): SelfKnowledge {
  const feeBps = input.feeBps ?? DEFAULT_FEE_BPS;
  const beta = input.beta === undefined ? (input.environment === "mainnet" ? DEFAULT_BETA_CAP : null) : input.environment === "mainnet" ? input.beta : null;
  const fee = bpsPercent(feeBps);
  const free = [...FEE_EXEMPT_KINDS].filter((k) => k === "repay" || k === "withdraw" || k === "approve").map((k) => KIND_WORDS[k] ?? k);
  const charged = FEE_SCHEDULE_KINDS.map((k) => KIND_WORDS[k] ?? k);

  const limits: KnowledgeEntry[] = [
    ...FENCE_PRESET_IDS.map((id) => {
      const p = FENCE_PRESETS[id];
      const patch = p.patch as { caps: { perStepUsd: string; perIntentUsd: string; dailyUsd: string }; confirm: { aboveUsd: string }; limits: { maxSlippageBps: number }; lending: { minHealthFactor: string } };
      return entry({ id: `fence-${id}`, topic: "limit", name: `${p.label} Fence`, value: `${dollars(patch.caps.perStepUsd)} a step · ${dollars(patch.caps.perIntentUsd)} a plan · ${dollars(patch.caps.dailyUsd)} a day`, plain: `${p.line} Lyko asks above ${dollars(patch.confirm.aboveUsd)}, slippage at most ${bpsPercent(patch.limits.maxSlippageBps)}, loans never under health ${patch.lending.minHealthFactor}.`, source: "Fence presets (core FENCE_PRESETS)", say: `Make my Fence ${p.label.toLowerCase()}`, words: [`${id}(?: fence| preset)?`] });
    }),
    entry({ id: "fence-edges", topic: "limit", name: "Any Fence", value: `${FENCE_LIMITS.maxSteps} steps a plan · slippage up to ${bpsPercent(FENCE_LIMITS.maxSlippageBps)}`, plain: "The widest a Fence can be set: a plan has at most this many steps, and no Fence allows more slippage than this.", source: "core FENCE_LIMITS", say: "Show my Fence", words: ["max(?:imum)? steps", "steps (?:in|per) (?:a |one )?plan", "max(?:imum)? slippage"] }),
    ...(beta
      ? [entry({ id: "beta-cap", topic: "limit", name: betaCapExplain(beta).name, value: betaCapExplain(beta).figures, plain: `${betaCapExplain(beta).sentence} ${betaCapExplain(beta).why} ${betaCapExplain(beta).scope} ${betaCapExplain(beta).home}`, source: "deployment beta cap (LYKIA_BETA_CAP_USD)", say: "Show my Fence", words: ["beta (?:cap|limit)", "mainnet (?:cap|limit)", "most (?:i|you|lyko) can (?:move|send|swap)", "max(?:imum)? (?:amount|i can)", "how much can (?:i|you) (?:move|send|swap|bridge|deposit)"] })]
      : []),
    entry({ id: "autopilot-ceiling", topic: "limit", name: "Autopilot ceiling", value: `${dollars(AUTOPILOT_BETA.perStepUsd)} a step · ${dollars(AUTOPILOT_BETA.perDayUsd)} a day`, plain: `The most Autopilot may sign while in beta; you can choose lower. It runs ${AUTOPILOT_LIMITS.minDays} to ${AUTOPILOT_LIMITS.maxDays} days, pays at most ${AUTOPILOT_LIMITS.payees} payees you name and holds at most ${AUTOPILOT_LIMITS.tasks} tasks.`, source: "core AUTOPILOT_BETA and AUTOPILOT_LIMITS", say: "Turn on Autopilot", words: ["autopilot"] }),
    entry({ id: "stile-ceiling", topic: "limit", name: "Stile ceiling (a leash on a Gateway balance)", value: `${dollars(STILE_BETA.perStepUsd)} a transfer · ${dollars(STILE_BETA.perDayUsd)} a day`, plain: "The most a bot may spend from your Gateway balance through LykiaStile while it is unaudited. The contract enforces it; a leash can be lower.", source: "core STILE_BETA", say: "Give my bot $20 a day for a week from my Gateway balance", words: ["stile", "gateway leash", "leash.*gateway", "gateway.*leash"] }),
    entry({ id: "leash-limits", topic: "limit", name: "Leash", value: `up to ${LEASH_LIMITS.maxDays} days · ${LEASH_LIMITS.recipients} payees · ${LEASH_LIMITS.perOwner} leashes`, plain: "A leash lasts at most this long, names at most this many payees, and you can hold this many at once. Its budget (per step, per day, in total) is yours to set, inside your Fence.", source: "core LEASH_LIMITS", say: "Give my bot $20 a day for a week", words: ["leash(?:es)?", "bot budget"] }),
    entry({ id: "order-limits", topic: "limit", name: "Orders", value: `${ORDER_KINDS.length} kinds · up to ${ORDERS_MAX_EXECUTIONS.toLocaleString("en-US")} executions`, plain: `${ORDER_KINDS.join(", ")}. A DCA or TWAP order runs at most this many slices; each slice is checked against your Fence.`, source: "core ORDER_KINDS and ORDERS_MAX_EXECUTIONS", say: "Buy EURC when EUR/USD is below 1.09", words: ["orders?", "dca", "twap", "limit orders?", "stop.?loss", "take.?profit"] }),
    entry({ id: "watch-limits", topic: "limit", name: "Watches", value: `${ALERT_LIMITS.perOwner} watches · at least ${ALERT_LIMITS.minCooldownSeconds} s between firings`, plain: `You can keep this many watches; one fires again after ${Math.round(ALERT_LIMITS.defaultCooldownSeconds / 60)} minutes by default.`, source: "core ALERT_LIMITS", say: "Tell me if my health factor drops below 1.5", words: ["watch(?:es)?", "alerts?"] }),
  ];

  const fees: KnowledgeEntry[] = [
    entry({ id: "lykia-fee", topic: "fee", name: "Lykia's fee", value: fee, plain: `${fee} of what moves on ${charged.join(", ")}, paid in the same transaction: taken from the amount, or paid on top of an exact send.`, source: "deployment fee (LYKIA_FEE_BPS) and core FEE_SCHEDULE_KINDS", say: "What did I pay in fees?", words: ["fees?", "commission", "cost", "charge", "price of"] }),
    entry({ id: "free-moves", topic: "fee", name: "Free of Lykia's fee", value: free.join(", "), plain: "Money coming home is never charged: paying back a loan and taking money out of a vault or a market cost only the network fee. Approvals are free of it too.", source: "core FEE_EXEMPT_KINDS", say: "Repay 150 USDC on Aave", words: ["free", "repay", "withdraw", "no fee"] }),
    entry({ id: "gas", topic: "fee", name: "Network fee (gas)", value: "paid in USDC", plain: MEANINGS.gas, source: "Arc network (USDC is the gas token)", say: "How is my gas?", words: ["gas", "network fee"] }),
    entry({ id: "cctp-fee", topic: "fee", name: "Bridging with CCTP", value: `Circle's fee ${bpsPercent(ARC_CCTP_SOURCE.standardFeeBps)} · attested in about ${ARC_CCTP_SOURCE.attestationSeconds} s`, plain: "Circle burns USDC on Arc and mints native USDC on the other chain. Circle's standard transfer from Arc carries no Circle fee; Lykia's fee and a forwarding fee Circle quotes for the mint apply, and the plan shows both before you sign. Across and Relay are quoted next to it with their own fee.", source: "core ARC_CCTP_SOURCE and the live bridge quotes", say: "Bridge 100 USDC to Base", words: ["bridge", "bridging", "cctp", "cross.?chain"] }),
  ];

  const term = (id: string, name: string, plain: string, words: readonly string[], say: string | null = null, source = "core plain words (LYKIA_TERMS, MEANINGS)") => entry({ id, topic: "term", name, plain, source, say, words });
  const glossary: KnowledgeEntry[] = [
    ...(Object.keys(LYKIA_TERMS) as (keyof typeof LYKIA_TERMS)[]).map((k) => term(k, `${LYKIA_TERMS[k].word} · ${LYKIA_TERMS[k].plain}`, LYKIA_TERMS[k].line, [k === "trails" ? "trails?" : k === "leash" ? "leash(?:es)?" : k])),
    term("health-factor", "Health factor", MEANINGS.healthFactor, ["health factor", "health", "liquidat\\w+"], "Tell me if my health factor drops below 1.5"),
    term("slippage", "Slippage", MEANINGS.slippage, ["slippage"]),
    term("apy", "APY", MEANINGS.apy, ["apy", "apr", "yield rate"], "Where can I earn on USDC?"),
    term("ltv", "Loan to value", MEANINGS.ltv, ["ltv", "loan to value"]),
    term("min-received", "Minimum received", MEANINGS.minReceived, ["min(?:imum)? received"]),
    term("unpriced", "Unpriced", MEANINGS.unpriced, ["unpriced"]),
    term("finality", "Finality", "When a transaction can no longer be undone. On Arc that is deterministic and takes under a second, so a settled step stays settled.", ["finality", "final"], null, "Arc network"),
    term("gas", "Gas", MEANINGS.gas, ["gas"], "How is my gas?"),
    term("autopilot", "Autopilot", "Lyko signs your own automations (repaying, sweeping idle USDC, recurring payments) inside a leash on your own LykiaAccount. Off until you turn it on; Stop ends it at once.", ["autopilot"], "Turn on Autopilot", "core autopilot"),
    term("stile", "Stile", "A gate on your Circle Gateway balance: a leash that spends from it goes through LykiaStile, which enforces a per-transfer and a daily ceiling on chain.", ["stile"], null, "core leash (LykiaStile)"),
    term("gateway", "Circle Gateway", "One USDC balance you deposit once on Arc and can spend on several chains.", ["gateway", "unified balance"], "Deposit 300 USDC into Gateway", "Circle Gateway"),
    term("cctp", "CCTP", "Circle's bridge: USDC is burned on Arc and minted as native USDC on the other chain.", ["cctp"], "Bridge 100 USDC to Base", "Circle CCTP"),
    term("preflight", "Checks before you sign", "Before anything is signed, code checks the plan: gas left, balance, what is due this week, price impact, the FX rate, loan health and more. A problem comes first, with fixes to pick.", ["preflight", "checks? before"], null, "core PREFLIGHT_CHECKS"),
    term("dry-run", "Dry run", "A plan that is built and checked but cannot be signed. Without a connected wallet every plan is a dry run for a sample address.", ["dry.?run", "sample (?:address|mode|wallet)"], null, "Fence mode dry-run"),
    term("beta", "Beta limit", betaCapExplain(beta ?? DEFAULT_BETA_CAP).why, ["beta"], null, "deployment beta cap"),
    term("lykia-fee", "Lykia's fee", MEANINGS.lykiaFee.replace("1%", fee), ["lykia(?:'s)? fee"], null, "deployment fee"),
    term("verdict", "Verdict", MEANINGS.verdict, ["verdict"]),
    term("the-fold", "The Fold", "Where you see and manage everything you own and everything in motion. Anything started in Ask shows there as one row, with one control.", ["the fold", "fold"], null, "Lykia"),
    term("the-forge", "The Forge", "The developer area: API keys, projects, the SDK and the docs.", ["the forge", "forge"], null, "Lykia"),
  ];

  const about: KnowledgeEntry[] = [
    entry({ id: "what-lykia-is", topic: "about", name: "What Lykia is", plain: "An agent and stablecoin desk on Arc Network. You say what your money should do; Lyko plans it across Arc's venues, checks every step against your Fence, and hands you something to sign.", source: "Lykia", say: "What can you do?", words: ["what (?:is|are) (?:lykia|lyko|you)", "who are you", "what do you do"] }),
    entry({ id: "non-custodial", topic: "about", name: "Who holds the money", plain: "You do. Lykia is non-custodial: it never holds your funds or your keys. Lyko proposes and your wallet signs; nothing moves without a signature.", source: "Lykia (plans are unsigned transactions)", say: null, words: ["custod\\w+", "hold my (?:money|funds|keys?)", "keep my (?:money|funds|keys?)", "my keys?", "private keys?", "seed phrase", "trust you with"] }),
    entry({ id: "who-signs", topic: "about", name: "Who signs", plain: "Your wallet signs every plan. The one exception is Autopilot, and only after you turn it on: Lyko then signs your own automations inside a leash on your LykiaAccount, within the limits you set, until you press Stop.", source: "core autopilot (leash on the owner's LykiaAccount)", say: "Turn on Autopilot", words: ["sign (?:for|on behalf of) me", "who signs", "do you sign", "can you sign", "move (?:money|funds) (?:on your own|without me|by yourself)", "without (?:my|me) sign\\w*"] }),
    entry({ id: "rails", topic: "about", name: "What it is built on", plain: "Arc is Circle's network, where USDC pays the gas. Lykia routes through Circle's CCTP and Gateway and through Arc's own venues; the routing, the Fence, the Leash and the checks are Lykia's own code.", source: "Lykia", say: "Where can I bridge to?", words: ["built on", "arc network", "what is arc", "circle"] }),
    entry({ id: "numbers", topic: "about", name: "Where the numbers come from", plain: "Every figure comes from the chain or an official API, with its source and the block or time it was read. When something cannot be read Lyko says unavailable; it never estimates.", source: "Lykia (number discipline)", say: null, words: ["where do (?:the |your )?(?:numbers|figures|prices) come", "source of", "how do you know", "can i trust (?:the|your) numbers"] }),
  ];

  const risks: KnowledgeEntry[] = [
    entry({ id: "risk-beta", topic: "risk", name: "Unaudited beta", plain: `Lykia's contracts have not been audited yet. That is why ${beta ? `mainnet moves are capped at ${betaCapExplain(beta).figures}` : "amounts are capped while in beta"}, and why you should only use money you can afford to have at risk.`, source: "deployment beta cap", words: ["lykia", "lyko", "you\\b", "this app", "beta", "audit\\w*"] }),
    entry({ id: "risk-vault", topic: "risk", name: "Vault and lending risk", plain: "A vault or a lending market can lose money: a borrower can default, a contract can have a bug, and a rate can fall. Lyko compares rates and risk tiers and says what it compared; it never calls one safe.", source: "core knowledge rows (venue risk)", say: "Where can I earn on USDC?", words: ["vaults?", "lending", "morpho", "aave", "earn\\w*", "deposit\\w*", "yield"] }),
    entry({ id: "risk-bridge", topic: "risk", name: "Bridge risk", plain: "A bridge depends on its operator: CCTP on Circle, Across and Relay on their solvers. A transfer can take longer than quoted; an unfilled Across or Relay deposit is refunded on Arc. Lyko shows the route and its settlement before you sign.", source: "core bridge routes", say: "Bridge 100 USDC to Base", words: ["bridg\\w+", "cctp", "across", "relay", "cross.?chain"] }),
    entry({ id: "risk-loan", topic: "risk", name: "Loan risk", plain: "A loan can be liquidated: when its health factor reaches 1.00, part of the collateral is sold to repay it. Your Fence keeps new borrowing above a floor, and a watch can tell you when health drops.", source: "core MEANINGS.healthFactor and the Fence health floor", say: "Tell me if my health factor drops below 1.5", words: ["borrow\\w*", "loans?", "leverage", "liquidat\\w+"] }),
    entry({ id: "risk-token", topic: "risk", name: "Token risk", plain: "A token can be a copy, a trap or simply worthless. Scent reports what can be proven about one (registry, look-alikes, privileged functions, a simulated transfer) and never promises that it is safe.", source: "Scent", say: "Check a token for me", words: ["tokens?", "coins?", "scam", "rug", "eurc", "usdc", "cirbtc", "stablecoins?"] }),
    entry({ id: "risk-autopilot", topic: "risk", name: "Autopilot and Leash risk", plain: `A leash is a signing key with limits. Inside those limits it can spend without asking you, so set them to what you can afford: Autopilot is capped at ${dollars(AUTOPILOT_BETA.perStepUsd)} a step and ${dollars(AUTOPILOT_BETA.perDayUsd)} a day in beta, and Stop or Revoke ends a key at once.`, source: "core AUTOPILOT_BETA", say: "Show me what is running", words: ["autopilot", "leash(?:es)?", "agents?", "bots?"] }),
  ];

  const unknowable: KnowledgeEntry[] = [
    entry({ id: "future-prices", topic: "unknowable", name: "Future prices and rates", plain: "Nobody knows where a price or a rate goes next, and Lyko does not guess. It can show today's rate with its source, run a what-if on your holdings, or watch a level for you.", source: "Lykia (number discipline)", say: "What if EURC drops 5%?", words: ["will .* (?:go up|go down|rise|fall|drop|crash|moon|pump|dump|increase|decrease)", "price prediction", "predict\\w*", "forecast\\w*", "going to (?:go up|go down|rise|fall|drop|crash)", "should i (?:buy|sell)", "is it a good time", "best time to (?:buy|sell)", "which (?:coin|token) (?:will|should)"] }),
    entry({ id: "advice", topic: "unknowable", name: "Tax, legal and investment advice", plain: "Lyko is not a tax, legal or investment adviser and will not act as one. It can give you the record: every settled step, fee and transaction is in Trails, with its memo, for you or your accountant.", source: "Lykia", say: "What did I pay in fees?", words: ["tax\\w*", "legal\\w*", "lawyer", "law\\b", "regulat\\w+", "investment advice", "financial advice", "accountant"] }),
    entry({ id: "others", topic: "unknowable", name: "Other people's wallets", plain: "Lyko reads public chain data only. It cannot see who owns an address, what an exchange holds for you, or anything off chain.", source: "Lykia", say: null, words: ["who owns", "(?:on|at|in) my (?:binance|coinbase|exchange) account", "what does (?:binance|coinbase) hold", "off.?chain data"] }),
  ];

  const nb = (id: string, name: string, plain: string, words: readonly string[], say: string | null) => entry({ id, topic: "not-built", name, plain, source: "capability map (no executable adapter)", say, words });
  const notBuilt: KnowledgeEntry[] = [
    nb("perps", "Perps and leverage trading", "Lykia does not trade perps, margin or leverage. It shows perps markets read-only; on Arc itself the nearest thing is a stop-loss, a take-profit or a limit order.", ["perps?", "perpetuals?", "leverage\\w*", "margin", "futures", "short\\w*", "long position", "\\d+x"], "Sell my cirBTC if it drops 10%"),
    nb("launchpad", "Launching or sniping tokens", "Lykia does not launch tokens or buy into launches. It lists new pools on Arc and checks each token's Scent before you touch it.", ["launch\\w*", "create a (?:token|coin)", "mint a (?:token|coin)", "deploy a (?:token|coin)", "snip\\w+", "presale", "memecoin"], "What are the new pools on Arc?"),
    nb("stablefx", "Circle StableFX", "StableFX is not a route in Lykia: it settles a quote off chain that Lykia cannot check from your wallet. USDC and EURC convert on chain instead, checked against Chainlink's EURC/USD.", ["stablefx", "stable fx", "rfq"], "Convert 200 USDC to EURC"),
    nb("usyc", "Minting or redeeming USYC", "USYC is not a route in Lykia: its Teller serves allowlisted holders only and its source is not verified. Lykia shows a USYC balance you already hold; to earn on USDC it compares Arc's vaults and markets.", ["usyc", "treasur(?:y|ies) (?:bills?|fund)", "t.?bills?"], "Where can I earn on USDC?"),
    nb("x402", "Paying through x402", "x402 is how other agents pay for Lykia's API. It is not a route for your money.", ["x402"], "What can you do?"),
    nb("solana", "Bridging to Solana", "Not yet: a Solana transfer needs a token account Lykia does not create. USDC bridges to the EVM chains CCTP serves.", ["solana", "\\bsol\\b"], "Where can I bridge to?"),
    nb("fiat", "Bank transfers and cards", "Lykia moves stablecoins on chain; it has no bank, card or cash rail. To cash out, send USDC to an exchange or a provider you use.", ["bank\\w*", "iban", "wire", "fiat", "credit card", "debit card", "cash out", "off.?ramp", "on.?ramp", "withdraw to my bank", "paypal", "\\btl\\b", "lira"], "Pay 250 USDC to 0x… for invoice 42"),
    nb("nft", "NFTs", "Lykia does not buy, sell or hold NFTs for you. It moves stablecoins and the registry tokens on Arc.", ["nfts?"], "What can you do?"),
    nb("lp", "Opening liquidity positions", "Lykia does not open or rebalance LP positions in a plan. It reads the ones you hold (range and fees) and Lyko on watch tells you when one leaves its range.", ["liquidity position", "provide liquidity", "add liquidity", "\\blp\\b", "become an? lp"], "Tell me if my liquidity goes out of range"),
    nb("other-chains", "Acting on other chains", "Lyko plans on Arc only. It can bridge USDC to another chain, and a Gateway balance can be spent there, but it does not swap, lend or borrow on other chains.", ["on (?:base|ethereum|arbitrum|optimism|polygon|avalanche|bsc|tron)", "from (?:base|ethereum|arbitrum|optimism|polygon|avalanche) to"], "Where can I bridge to?"),
    nb("undo", "Undoing a settled transaction", "A settled transaction is final on Arc and cannot be reversed. Lyko can plan the opposite move at today's price, which costs a second fee and the spread.", ["undo", "reverse", "revert", "cancel (?:a |the |my )?(?:transaction|transfer|payment|send)", "take back", "refund"], "Undo my last swap"),
    nb("custody", "Holding your funds or keys", "Lykia never holds your money or your keys, and cannot recover a lost key or a seed phrase.", ["recover my (?:key|wallet|seed)", "lost my (?:key|wallet|seed)", "reset my (?:password|wallet)", "store my (?:key|seed)"], null),
    nb("guarantee", "Guaranteed returns", "No return is guaranteed and Lyko never says so. A rate is today's rate; it moves every day.", ["guarantee\\w*", "risk.?free", "no risk", "sure profit"], "Where can I earn on USDC?"),
  ];

  const flags = input.flags ?? {};
  const off: KnowledgeEntry[] = Object.entries(FLAG_PLAIN).flatMap(([flag, f]) => {
    const on = flags[flag];
    if (on === undefined) return [];
    if (flag === "routing.halt") return on ? [entry({ id: `flag-${flag}`, topic: "off", name: f.name, plain: f.on ?? "", source: `feature flag ${flag}`, words: f.words })] : [];
    return on ? [] : [entry({ id: `flag-${flag}`, topic: "off", name: f.name, plain: f.off, source: `feature flag ${flag}`, words: f.words })];
  });

  const needs: KnowledgeEntry[] = [
    entry({ id: "needs-wallet", topic: "needs", name: "A connected wallet", plain: "Planning for real, signing, and anything about your own money need a connected wallet. Without one Lyko answers general questions and plans dry runs for a sample address, and says so.", source: "Lykia (sample mode)", say: null, words: ["need a wallet", "without a wallet", "connect(?:ing)? (?:a |my )?wallet", "no wallet", "do i (?:need|have) to connect"] }),
    entry({ id: "needs-sign-in", topic: "needs", name: "Signing in (one message, no transaction)", plain: "Saving something for you (a watch, an automation, a leash), your history, your memory and your private rows in the Fold need a sign-in: one signed message that proves the wallet is yours. It costs nothing and moves nothing.", source: "Sign-In with Ethereum session", say: null, words: ["sign.?in", "log.?in", "why (?:do i|must i) sign a message", "prove"] }),
    entry({ id: "needs-signature", topic: "needs", name: "A transaction you sign", plain: "Every money move (send, convert, swap, deposit, withdraw, borrow, repay, bridge), every order, cancelling an order, turning on Autopilot, creating or revoking a leash and loosening your Fence need your wallet's signature. Pausing, resuming and stopping things, making your Fence stricter and setting a watch do not.", source: "Lykia (plans are unsigned transactions; RunningControl.sign)", say: null, words: ["need(?:s)? (?:a |my )?signature", "what (?:do i|must i) sign", "have to sign", "which .* sign", "do i sign"] }),
    entry({ id: "where-it-shows", topic: "needs", name: "Where things show", plain: "Anything started in Ask is one row in the Fold: plans, orders, automations, watches, leashes and Autopilot under Herding, each with one control; holdings and positions under Flock; what happened, with fees, under Trails; your rules under Fence.", source: "the Fold (Herding, Flock, Trails, Fence)", say: "Show me what is running", words: ["where (?:do|can|will) i (?:see|find|manage|stop)", "where does it show", "where is it"] }),
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
  { words: ["liquidat\\w+", "health (?:factor )?(?:drops|falls|hits|reaches|goes)"], entry: entry({ id: "if-liquidated", topic: "risk", name: "If a loan is liquidated", plain: "When a loan's health factor reaches 1.00, the venue sells part of your collateral to repay the debt, usually with a penalty. Repaying part of the loan or adding collateral before that raises the health factor.", source: "core MEANINGS.healthFactor", say: "Fix my loan health", words: [] }) },
  { words: ["step fails?", "transaction fails?", "plan fails?", "it fails", "something fails", "fails? (?:halfway|midway)", "goes wrong"], entry: entry({ id: "if-fails", topic: "about", name: "If a step fails", plain: "A failed step moves nothing: the transaction reverts and only its network fee is spent. Steps that already settled stay settled, and the next step is rebuilt from what actually arrived, so you can stop there or carry on.", source: "Lykia (step-by-step plans)", say: "Why did my last plan fail?", words: [] }) },
  { words: ["whistle"], entry: entry({ id: "if-whistle", topic: "about", name: "If you blow the Whistle", plain: LYKIA_TERMS.whistle.line, source: "core LYKIA_TERMS.whistle", say: "Blow the whistle", words: [] }) },
  { words: ["bridge (?:fails?|gets? stuck|is stuck)", "stuck", "never arrives?", "does ?n.t arrive"], entry: entry({ id: "if-bridge-stuck", topic: "risk", name: "If a bridge transfer is slow", plain: "A CCTP transfer is burned on Arc first and minted on the other chain once Circle attests it; it shows as in flight in the Fold until then. An Across or Relay deposit nobody fills is refunded on Arc.", source: "core bridge routes", say: "Where is my money?", words: [] }) },
  { words: ["price moves?", "price changes?", "slippage"], entry: entry({ id: "if-price-moves", topic: "about", name: "If the price moves before you sign", plain: `${MEANINGS.slippage} ${MEANINGS.minReceived}`, source: "core MEANINGS", say: null, words: [] }) },
  { words: ["los[et] my (?:key|wallet|phone|seed)", "wallet is (?:hacked|stolen)", "get hacked"], entry: entry({ id: "if-key-lost", topic: "about", name: "If you lose your wallet", plain: "Lykia never holds your keys and cannot restore them. A stolen leash key is bounded by its limits and dies when you press Revoke; the Whistle stops every agent at once.", source: "Lykia (non-custodial)", say: "Blow the whistle", words: [] }) },
  { words: ["lykia (?:goes down|is down|disappears|shuts down|dies)", "you (?:go down|are down|disappear|shut down)"], entry: entry({ id: "if-lykia-down", topic: "about", name: "If Lykia goes away", plain: "Your money stays where it is: in your wallet and in the venues' own contracts, which you can reach without Lykia. Only what Lykia runs for you (automations, watches, Autopilot) would stop.", source: "Lykia (non-custodial)", say: null, words: [] }) },
  { words: ["run out of gas", "no gas", "gas runs out"], entry: entry({ id: "if-no-gas", topic: "about", name: "If gas runs out", plain: "Arc pays gas in USDC, so a wallet with no USDC cannot send anything. Lyko checks the gas a plan leaves before you sign and warns under your reserve.", source: "core PREFLIGHT_CHECKS gas-reserve", say: "How is my gas?", words: [] }) },
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
