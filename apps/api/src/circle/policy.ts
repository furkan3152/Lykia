/**
 * Fence -> Circle Agent Wallet spending policy.
 *
 * Circle's Agent Wallets (Agent Stack) enforce a spending policy natively:
 * per-transaction, daily, weekly and monthly USDC caps, and recipient /
 * contract allow and block lists. They are set with the Circle CLI
 * (`circle wallet limit set ...`), confirmed by an email OTP that only the
 * wallet's human owner receives, and they apply to mainnet agent wallets only.
 * Every transfer is also sanctions-screened by Circle.
 * https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies
 *
 * The Fence says more than that (venues, step kinds, slippage, health
 * factor, FX band, Scent, hours, signers). This compiler takes the subset
 * Circle enforces, emits it as a policy plus the verbatim CLI commands, and
 * reports for every Fence rule who enforces it: Circle natively, Lykia's
 * preflight, or both. The default agent setup is a Circle wallet plus Lykia
 * Fence preflight; a LykiaAccount ("Lykia smart account") is an optional
 * mode for on-chain enforcement of the rest.
 *
 * Pure: no I/O. Lykia never applies the policy itself: Circle documents no
 * server API for Agent Wallet policies (CLI with a human OTP only) and no
 * policy API for developer-controlled wallets, so `applyCirclePolicy` hands
 * the owner the commands and says so.
 */
import { contractAddress, fenceHash, findToken, getProtocol, normalizeFence, tokenAddress, usdMicros, type Address, type ArcEnvironment, type Fence } from "@lykia/core";

export const CIRCLE_POLICY_SCHEMA = "lykia.circle-policy/v1" as const;

export type CircleRuleType = "recipient-allowlist" | "recipient-blocklist" | "contract-allowlist" | "contract-blocklist";

export interface CircleSpendingPolicy {
  /** As the CLI names it (`--policy-type stablecoin`): caps count USDC outbound transfers and x402 payments. */
  readonly policyType: "stablecoin";
  readonly chain: "ARC";
  /** USDC amounts as decimal strings; null = tier left unset. Circle requires perTx <= daily <= weekly <= monthly. */
  readonly limits: { readonly perTx: string | null; readonly daily: string | null; readonly weekly: string | null; readonly monthly: string | null };
  readonly rules: readonly { readonly ruleType: CircleRuleType; readonly targets: readonly Address[] }[];
}

export type Enforcer = "circle" | "lykia" | "both";

export interface CoverageRow {
  /** Fence path ("caps.dailyUsd") or a Circle-only control. */
  readonly rule: string;
  readonly enforcedBy: Enforcer;
  readonly how: string;
}

export interface CirclePolicyCompilation {
  readonly schema: typeof CIRCLE_POLICY_SCHEMA;
  readonly fenceHash: string;
  readonly target: "circle-agent-wallet";
  readonly policy: CircleSpendingPolicy;
  /** Verbatim commands for the wallet owner to run in their own terminal (each asks for an email OTP). */
  readonly commands: readonly string[];
  readonly coverage: readonly CoverageRow[];
  readonly summary: { readonly circle: number; readonly lykia: number; readonly both: number };
  readonly warnings: readonly string[];
  readonly poweredBy: "Circle";
  readonly docs: string;
}

export interface CompileOptions {
  /** The agent wallet the commands address; a placeholder is used when absent. */
  readonly wallet?: Address;
  /** The Fence owner's address: "own" recipient mode becomes an allowlist of this address. */
  readonly owner?: Address;
  /** Lykia's mainnet beta cap (per step / per day, USD): the compiled caps never exceed it. */
  readonly betaCap?: { readonly perStepUsd: string; readonly perDayUsd: string } | null;
  readonly environment?: ArcEnvironment;
}

const DOCS = "https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies";
const MAX_TARGETS = 100;

function minUsd(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return usdMicros(a) <= usdMicros(b) ? a : b;
}

/** Contract addresses of a registry venue on an environment. */
function venueContracts(id: string, environment: ArcEnvironment): Address[] {
  const deployment = getProtocol(id)?.deployments[environment];
  return deployment ? (Object.values(deployment.contracts) as Address[]) : [];
}

function uniq(list: readonly Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of list) {
    const k = a.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(a);
    }
  }
  return out;
}

/** Shell-safe rendering of a command; every value is an address, a number or a fixed word. */
function command(wallet: string, parts: readonly string[]): string {
  return ["circle wallet limit set", `--address ${wallet}`, "--chain ARC", "--policy-type stablecoin", ...parts].join(" \\\n  ");
}

export function compileFenceToCirclePolicy(input: Fence, options: CompileOptions = {}): CirclePolicyCompilation {
  const fence = normalizeFence(input);
  const environment = options.environment ?? "mainnet";
  const warnings: string[] = [];
  const coverage: CoverageRow[] = [];
  const cover = (rule: string, enforcedBy: Enforcer, how: string) => coverage.push({ rule, enforcedBy, how });

  // ---- caps
  const beta = options.betaCap ?? null;
  let perTx = minUsd(fence.caps?.perStepUsd ?? null, beta?.perStepUsd ?? null);
  let daily = minUsd(fence.caps?.dailyUsd ?? null, beta?.perDayUsd ?? null);
  const weekly = fence.caps?.weeklyUsd ?? null;
  const monthly: string | null = null;
  if (beta && (perTx !== fence.caps?.perStepUsd || daily !== fence.caps?.dailyUsd)) warnings.push(`Lykia's mainnet beta cap ($${beta.perStepUsd} per step, $${beta.perDayUsd} per day) is tighter than the Fence, so the Circle caps use it.`);
  // Circle requires perTx <= daily <= weekly <= monthly: tighten the lower tier rather than loosen the higher one.
  if (daily !== null && weekly !== null && usdMicros(daily) > usdMicros(weekly)) {
    warnings.push(`The Fence's daily cap ($${daily}) is above its weekly cap ($${weekly}); the Circle daily cap is lowered to $${weekly}.`);
    daily = weekly;
  }
  const ceiling = daily ?? weekly;
  if (perTx !== null && ceiling !== null && usdMicros(perTx) > usdMicros(ceiling)) {
    warnings.push(`The per-step cap ($${perTx}) is above the daily/weekly cap; the Circle per-transaction cap is lowered to $${ceiling}.`);
    perTx = ceiling;
  }
  cover("caps.perStepUsd", perTx !== null ? "both" : "lykia", perTx !== null ? `Circle per-tx cap ${perTx} USDC on USDC transfers and x402 payments; Lykia checks every step in USD across all tokens.` : "No per-step cap in the Fence.");
  cover("caps.dailyUsd", daily !== null ? "both" : "lykia", daily !== null ? `Circle daily cap ${daily} USDC; Lykia checks the rolling day in USD across all tokens.` : "No daily cap in the Fence.");
  cover("caps.weeklyUsd", weekly !== null ? "both" : "lykia", weekly !== null ? `Circle weekly cap ${weekly} USDC; Lykia checks the rolling week in USD.` : "No weekly cap in the Fence.");
  cover("caps.perIntentUsd", "lykia", "A plan's total across steps: Circle sees transactions, not plans.");
  if (fence.caps === undefined && !beta) warnings.push("The Fence sets no caps, so the Circle policy has no spending limits. Add caps before giving an agent funds.");

  // ---- recipients
  const rules: { ruleType: CircleRuleType; targets: Address[] }[] = [];
  const mode = fence.recipients?.mode ?? "own";
  if (mode === "own") {
    if (options.owner) {
      rules.push({ ruleType: "recipient-allowlist", targets: [options.owner] });
      cover("recipients.mode", "both", "Own-only: Circle allows USDC transfers to the owner's address only; Lykia also denies strangers in every step.");
    } else {
      cover("recipients.mode", "lykia", "Own-only needs the owner's address to compile into a Circle recipient allowlist; pass `owner`.");
      warnings.push("Pass the owner's address to turn the own-only recipient rule into a Circle recipient allowlist.");
    }
  } else if (mode === "allowlist") {
    const allow = uniq([...(fence.recipients?.allow ?? []), ...(options.owner ? [options.owner] : [])]);
    if (allow.length > 0) {
      rules.push({ ruleType: "recipient-allowlist", targets: allow.slice(0, MAX_TARGETS) });
      cover("recipients.allow", "both", `Circle recipient allowlist (${allow.length}); Lykia checks the same list on every step.`);
    } else {
      cover("recipients.allow", "lykia", "The allowlist is empty: Lykia denies every external recipient. Circle has no 'deny all' rule, so nothing is sent to Circle.");
    }
  } else {
    cover("recipients.mode", "lykia", "Any recipient: no Circle allowlist; Lykia still applies confirmations for external recipients.");
  }
  const deny = uniq(fence.recipients?.deny ?? []);
  if (deny.length > 0) {
    rules.push({ ruleType: "recipient-blocklist", targets: deny.slice(0, MAX_TARGETS) });
    cover("recipients.deny", "both", `Circle recipient blocklist (${deny.length}); Lykia also denies them.`);
  }

  // ---- venues -> contract lists
  const allowVenues = fence.venues?.allow ?? [];
  const denyVenues = fence.venues?.deny ?? [];
  if (allowVenues.length > 0) {
    const tokens = (fence.tokens?.allow ?? []).map((s) => findToken(environment, s)).filter((t) => t !== null).map((t) => tokenAddress(t!, environment)).filter((a): a is Address => a !== null);
    const contracts = uniq([...allowVenues.flatMap((v) => venueContracts(v, environment)), ...tokens, contractAddress("usdc", environment) as Address]);
    if (contracts.length > 0) {
      rules.push({ ruleType: "contract-allowlist", targets: contracts.slice(0, MAX_TARGETS) });
      cover("venues.allow", "both", `Circle contract allowlist of the venues' registry contracts plus the allowed token contracts (${contracts.length}); Lykia matches venues by id and verb.`);
      warnings.push("A contract allowlist blocks every other contract the wallet calls. Check it with `circle wallet limit --address <wallet> --chain ARC` before funding the wallet.");
    } else {
      cover("venues.allow", "lykia", "The allowed venues have no registry contracts on this environment.");
    }
  } else {
    cover("venues.allow", "lykia", "No venue allowlist: Lykia compares every executable venue.");
  }
  if (denyVenues.length > 0) {
    const contracts = uniq(denyVenues.flatMap((v) => venueContracts(v, environment)));
    if (contracts.length > 0) {
      rules.push({ ruleType: "contract-blocklist", targets: contracts.slice(0, MAX_TARGETS) });
      cover("venues.deny", "both", `Circle contract blocklist (${contracts.length}); Lykia also refuses the venues.`);
    } else cover("venues.deny", "lykia", "The denied venues have no registry contracts on this environment.");
  }

  // ---- Lykia-only rules
  const lykiaOnly: readonly [string, boolean, string][] = [
    ["mode", true, fence.mode === "whistle" ? "The Whistle is blown: Lykia refuses every new risk and lets value come home. Circle has no pause policy; a LykiaAccount also enforces it on chain." : fence.mode === "dry-run" ? "Dry-run: Lykia plans and never returns signable steps." : "Live."],
    ["kinds.allow", fence.kinds?.allow !== undefined, "Step kinds (swap, borrow, bridge, ...): Circle policies do not know what a call does."],
    ["tokens", true, `Token allowlist and unlisted=${fence.tokens?.unlisted ?? "deny"}: Circle's stablecoin policy counts USDC only.`],
    ["limits.maxSlippageBps", fence.limits?.maxSlippageBps !== undefined, "Slippage is a property of a quote; only Lykia's preflight sees it."],
    ["limits.maxSteps", fence.limits?.maxSteps !== undefined, "Steps per plan."],
    ["lending.minHealthFactor", fence.lending?.minHealthFactor !== undefined, "Health factor after a borrow or withdraw, read from the lending market."],
    ["fx.maxDeviationBps", fence.fx?.maxDeviationBps !== undefined, "FX band against the Chainlink EURC/USD reference."],
    ["scent.require", true, `Scent requirement (${fence.scent?.require ?? "no-red-flags"}) for tokens a step acquires.`],
    ["schedule", fence.schedule !== undefined, "Hours and weekdays in the owner's time zone."],
    ["confirm", fence.confirm !== undefined, "Human confirmation above an amount or for external recipients, cross-chain moves and agent proposals."],
    ["bridges.destinations", fence.bridges?.destinations !== undefined, "CCTP and Gateway destinations."],
    ["signers", true, "Which signers (wallet, agent) the Fence admits."],
    ["environments", fence.environments !== undefined, "Mainnet / testnet."],
  ];
  for (const [rule, present, how] of lykiaOnly) if (present) cover(rule, "lykia", how);
  cover("circle.sanctions-screening", "circle", "Circle screens every Agent Wallet transfer against sanctions controls before it is submitted.");
  cover("circle.otp-confirmation", "circle", "Changing the policy needs an email OTP that only the wallet owner receives, so an agent cannot loosen its own limits.");

  if (environment !== "mainnet" || (fence.environments && !fence.environments.includes("mainnet"))) warnings.push("Circle spending policies apply to mainnet agent wallets only; on testnet only Lykia's preflight enforces the Fence.");

  const policy: CircleSpendingPolicy = { policyType: "stablecoin", chain: "ARC", limits: { perTx, daily, weekly, monthly }, rules };
  const wallet = options.wallet ?? "<agent-wallet-address>";
  const commands: string[] = [];
  const limitParts = [perTx !== null ? `--per-tx ${perTx}` : null, daily !== null ? `--daily ${daily}` : null, weekly !== null ? `--weekly ${weekly}` : null].filter((p): p is string => p !== null);
  if (limitParts.length > 0) commands.push(command(wallet, limitParts));
  for (const r of rules) commands.push(command(wallet, [`--rule-type ${r.ruleType}`, `--targets "[${r.targets.join(",")}]"`]));
  commands.push(`circle wallet limit --address ${wallet} --chain ARC --output json`);

  const summary = { circle: coverage.filter((c) => c.enforcedBy === "circle").length, lykia: coverage.filter((c) => c.enforcedBy === "lykia").length, both: coverage.filter((c) => c.enforcedBy === "both").length };
  return { schema: CIRCLE_POLICY_SCHEMA, fenceHash: fenceHash(input), target: "circle-agent-wallet", policy, commands, coverage, summary, warnings, poweredBy: "Circle", docs: DOCS };
}

/* ------------------------------------------------------------- applying */

export type ApplyStatus = "requires-owner-otp" | "not-yet-available";

export interface ApplyResult {
  readonly status: ApplyStatus;
  readonly walletKind: "agent-wallet" | "developer-controlled";
  readonly applied: false;
  readonly commands: readonly string[];
  readonly note: string;
}

/**
 * Applying a compiled policy. Agent Wallet policies are set by the owner
 * with the Circle CLI and an email OTP (the OTP must never pass through
 * Lykia). Developer-controlled wallets have no documented policy API yet:
 * those agents rely on Lykia's preflight (and optionally a LykiaAccount).
 */
export interface CirclePolicyApplier {
  readonly walletKind: ApplyResult["walletKind"];
  apply(compiled: CirclePolicyCompilation): ApplyResult;
}

export const agentWalletApplier: CirclePolicyApplier = {
  walletKind: "agent-wallet",
  apply: (compiled) => ({ status: "requires-owner-otp", walletKind: "agent-wallet", applied: false, commands: compiled.commands, note: "Run these in your own terminal with the Circle CLI (npm install -g @circle-fin/cli). Each asks for a 6-digit code sent to your Circle agent email: never share it with Lykia or an agent." }),
};

export const developerWalletApplier: CirclePolicyApplier = {
  walletKind: "developer-controlled",
  apply: () => ({ status: "not-yet-available", walletKind: "developer-controlled", applied: false, commands: [], note: "Circle does not document a spending-policy API for developer-controlled wallets yet. Lykia's Fence preflight enforces every rule before a step reaches the wallet; add a Lykia smart account for on-chain enforcement." }),
};

export function applyCirclePolicy(compiled: CirclePolicyCompilation, walletKind: ApplyResult["walletKind"]): ApplyResult {
  return (walletKind === "agent-wallet" ? agentWalletApplier : developerWalletApplier).apply(compiled);
}
