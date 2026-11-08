/**
 * Gateway leashes: a leash that spends from the owner's Circle Gateway
 * balance through the owner's LykiaStile, behind the same endpoints as any
 * leash (create, plan, submit, trail, revoke, renew).
 *
 *   create   the Stile (created from the owner's wallet when there is none),
 *            addDelegate(USDC, stile) on Gateway Wallet, and createSession
 *   plan     the Fence with the leash's own spend, the Stile's spendable(),
 *            the destination and payee lists, the Arc part of the Gateway
 *            balance; then the burn intents [payment, Lykia fee], Gateway's
 *            fee estimate, and the reserve transaction for the agent's key,
 *            simulated on Arc
 *   submit   the reserve transaction checked against the prepared one and
 *            proven from its receipt (Reserved with the digest, StileMemo with
 *            the intent, step and verdict), then the intents posted to
 *            Gateway's /v1/transfer with contractSigner: true
 *   trail    Reserved and StileMemo on Arc, Gateway's transfer record
 *            (polled), and AttestationUsed on the destination's mint receipt
 *
 * Gateway validates a contract signer against a block up to about 5 minutes
 * old: a reservation just mined may not be visible yet (submit says so and
 * can be retried), and a revocation may take as long to apply there.
 */
import { contractAddress, evaluateFence, feeBpsFor, feeOf, formatUsdMicros, leashWindow, memoData, STILE_BETA, usdMicros, verdictTag, type Address, type ArcEnvironment, type Leash, type LeashDenyReason, type LeashStile, type LeashUsage, type PlanAction, type UnsignedTransaction } from "@lykia/core";
import type { CreateLeashResponse, LeashGatewayTrail, LeashPlanResponse, LeashSubmitResponse, LeashTrailItem, LeashTrailResponse } from "@lykia/core/api/leash";
import { decodeEventLog, encodeFunctionData, type Hex, type Log } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { randomHex } from "../platform/crypto.js";
import { GATEWAY_MINTER, gatewayChain } from "../circle/chains.js";
import { GATEWAY_MINTER_ABI, gatewayTransferStatus } from "../circle/gateway.js";
import { readSentence } from "../language/reader.js";
import { fenceBytes32, memoMatches } from "./chain.js";
import { LEASH_RECORD_TTL_MS, leashSpend, leashSteps, typedStiles, type LeashAction, type LeashStep } from "./store.js";
import {
  ARC_DOMAIN,
  addDelegateTx,
  attestationUsedIn,
  checkStile,
  createSessionTx,
  destinationRpc,
  estimateIntents,
  expectedImmutables,
  findStileSession,
  fromUnits,
  GATEWAY_WALLET_ABI,
  gatewayBalances,
  intentsDigest,
  readStileSession,
  remoteReceiptLogs,
  removeDelegateTx,
  reserveCalldata,
  signatureFor,
  specFor,
  STILE_ABI,
  stileAvailability,
  stileCallTx,
  stileCreation,
  stileDestinations,
  stileError,
  stileEvents,
  submitToGateway,
  transferSpecHashOf,
  usdcUnits,
  type StileSessionState,
  type UnsignedCreation,
} from "./stile.js";

/** What the Gateway half needs from the leash service. */
export interface LeashHost {
  now(): number;
  put(leash: Leash): Promise<Leash>;
  action(leash: Leash, action: Omit<LeashAction, "at">): Promise<void>;
  actions(leash: Leash, limit?: number): Promise<LeashAction[]>;
  fire(type: string, leash: Leash, data: Record<string, unknown>): void;
  storeSpent(leash: Leash): Promise<{ day: bigint; total: bigint }>;
  remaining(leash: Leash, usage: Pick<LeashUsage, "day" | "total">): { stepUsd: string; dayUsd: string; totalUsd: string };
  liveReasons(leash: Leash, agent: unknown): LeashDenyReason[];
  denied(leash: Leash, reasons: readonly LeashDenyReason[], remaining: { stepUsd: string; dayUsd: string; totalUsd: string }, extra?: { verdictDigest?: string | null; intentId?: string | null }): LykiaHttpError;
  packAgent(leash: Leash): Promise<{ status: string; name: string } | null>;
  recordSpend(leash: Leash, usd: string): Promise<void>;
}

const iso = (ms: number) => new Date(ms).toISOString();
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const chainIdOf = (environment: ArcEnvironment) => (environment === "mainnet" ? 5042 : 5042002);
/** Gateway's per-intent fee a session allows by default (Arc's source gas fee is 0.0035 USDC; the transfer fee is 0.005% of the value). */
export const DEFAULT_MAX_GATEWAY_FEE_USD = "0.10";
export const MAX_GATEWAY_FEE_USD = "5";

/* ------------------------------------------------------------ create */

export interface GatewayCreatePlan {
  readonly stile: LeashStile;
  readonly creation: UnsignedCreation | null;
  readonly transactions: readonly UnsignedTransaction[];
  readonly destinations: readonly { readonly key: string; readonly name: string; readonly domain: number }[];
  readonly limits: Record<string, string | boolean>;
}

/** Checks a Gateway leash request before anything is made; throws INVALID_LEASH / NOT_AVAILABLE. */
export function gatewayPreflight(ctx: AppContext, input: { readonly environment: ArcEnvironment; readonly parentAgentId?: string; readonly destinations?: readonly string[]; readonly maxGatewayFeeUsd?: string }): { readonly destinations: readonly { key: string; name: string; domain: number }[] } {
  const available = stileAvailability(ctx, input.environment);
  if (!available.available) throw new LykiaHttpError("NOT_AVAILABLE", 409, `${available.reason} Spend from your Arc wallet instead, or ask again once it is switched on.`, { spendFrom: "gateway", environment: input.environment });
  const issues: { path: string; message: string }[] = [];
  if (input.parentAgentId) issues.push({ path: "parentAgentId", message: "A Gateway leash is a root leash: its limits live on your own LykiaStile, not under another agent's session." });
  const all = stileDestinations();
  const asked = [...new Set((input.destinations ?? []).map((d) => d.trim().toLowerCase()))];
  if (asked.length === 0) issues.push({ path: "destinations", message: `Name the chains the agent may pay to: ${all.map((d) => d.key).join(", ")}.` });
  const unknown = asked.filter((d) => !gatewayChain(d));
  if (unknown.length > 0) issues.push({ path: "destinations", message: `Gateway does not reach ${unknown.join(", ")} from Arc. Destinations: ${all.map((d) => d.key).join(", ")}.` });
  if (input.maxGatewayFeeUsd !== undefined && (!/^\d{1,2}(?:\.\d{1,6})?$/u.test(input.maxGatewayFeeUsd) || usdcUnits(input.maxGatewayFeeUsd) <= 0n || usdcUnits(input.maxGatewayFeeUsd) > usdcUnits(MAX_GATEWAY_FEE_USD))) issues.push({ path: "maxGatewayFeeUsd", message: `More than 0 and at most $${MAX_GATEWAY_FEE_USD} per intent.` });
  if (issues.length > 0) throw new LykiaHttpError("INVALID_LEASH", 400, "The leash is not valid.", { issues });
  return { destinations: asked.map((key) => all.find((d) => d.key === gatewayChain(key)!.key)!) };
}

/** The Lykia fee a Stile carries for this deployment (the transfer kind of the fee schedule). */
export function stileFeeBps(ctx: AppContext): number {
  return feeBpsFor("transfer", ctx.config.fee.bps, ctx.config.fee.schedule ?? null);
}

/** The owner's Stile (reused when it is there and as expected), the delegation and the session transaction. */
export async function gatewayCreate(ctx: AppContext, input: { readonly owner: Address; readonly environment: ArcEnvironment; readonly key: Address; readonly name: string; readonly fenceHash: string; readonly budget: { perStepUsd: string; perDayUsd: string; totalUsd: string }; readonly expiresAt: string; readonly recipients: readonly Address[]; readonly destinations: readonly { key: string; name: string; domain: number }[]; readonly maxGatewayFeeUsd?: string }): Promise<GatewayCreatePlan> {
  const { owner, environment } = input;
  const chainId = chainIdOf(environment);
  const bps = stileFeeBps(ctx);
  const imm = expectedImmutables(environment, owner, { bps, recipient: ctx.config.fee.recipient });
  const client = ctx.chains.client(environment);
  const registry = typedStiles(ctx);
  const regKey = `${environment}:${owner}`;
  const known = (await registry.get(regKey))?.value ?? null;
  let address: Address | null = null;
  let creation: UnsignedCreation | null = null;
  let deployed = false;
  // The owner's Stile as Lykia recorded it, else the configured reference when it is this owner's (deployed with stile:plan).
  const reference = (ctx.config.stile.reference[environment] ?? null) as Address | null;
  for (const candidate of [known?.address ?? null, reference].filter((a, i, all): a is Address => a !== null && all.indexOf(a) === i)) {
    const check = await checkStile(ctx, environment, candidate, imm).catch(() => {
      throw new LykiaHttpError("CHAIN_UNAVAILABLE", 503, "Arc could not be read; no leash was made. Try again.");
    });
    if (check.deployed && check.matches) {
      address = candidate.toLowerCase() as Address;
      deployed = true;
      if (candidate !== known?.address) await registry.put(regKey, { address, predicted: false, at: iso(ctx.clock.now()) }, { ttlMs: LEASH_RECORD_TTL_MS });
      break;
    }
  }
  if (!address) {
    const nonce = await (client as unknown as { getTransactionCount(a: { address: Address; blockTag: "pending" }): Promise<number> }).getTransactionCount({ address: owner, blockTag: "pending" }).catch(() => {
      throw new LykiaHttpError("CHAIN_UNAVAILABLE", 503, "Your wallet's nonce could not be read on Arc, so your LykiaStile's address cannot be predicted. Nothing was made; try again.");
    });
    creation = stileCreation(chainId, imm, Number(nonce));
    address = creation.predictedAddress;
    await registry.put(regKey, { address, predicted: true, at: iso(ctx.clock.now()) }, { ttlMs: LEASH_RECORD_TTL_MS });
  }
  let sessionNonce = 0n;
  let delegated = false;
  if (deployed) {
    const [nonce, auth] = (await client.multicall({
      contracts: [
        { address, abi: STILE_ABI, functionName: "sessionNonce" },
        { address: imm.gatewayWallet, abi: GATEWAY_WALLET_ABI, functionName: "isAuthorizedForBalance", args: [imm.token, owner, address] },
      ] as never,
      allowFailure: true,
    })) as readonly { status: string; result?: unknown }[];
    if (nonce?.status !== "success") throw new LykiaHttpError("CHAIN_UNAVAILABLE", 503, "Your LykiaStile could not be read on Arc; no leash was made. Try again.");
    sessionNonce = BigInt(nonce.result as bigint);
    delegated = auth?.status === "success" && Boolean(auth.result);
  }
  const maxGatewayFee = usdcUnits(input.maxGatewayFeeUsd ?? DEFAULT_MAX_GATEWAY_FEE_USD);
  const limits = { validUntil: BigInt(Math.floor(Date.parse(input.expiresAt) / 1000)), perTransfer: usdcUnits(input.budget.perStepUsd), daily: usdcUnits(input.budget.perDayUsd), lifetime: usdcUnits(input.budget.totalUsd), maxGatewayFee, anyRecipient: false };
  const transactions: UnsignedTransaction[] = [];
  if (!delegated) transactions.push(addDelegateTx(chainId, environment, owner, address));
  transactions.push(createSessionTx({ chainId, owner, stile: address, key: input.key, limits, domains: input.destinations.map((d) => d.domain), recipients: input.recipients, policyHash: fenceBytes32(input.fenceHash), label: `Create ${input.name}'s leash on your LykiaStile` }));
  const stile: LeashStile = {
    address,
    sessionId: null,
    key: input.key,
    chainId,
    validUntil: Number(limits.validUntil),
    nonceAtCreation: sessionNonce.toString(),
    destinations: input.destinations.map((d) => d.key),
    maxGatewayFee: maxGatewayFee.toString(),
    feeBps: bps,
    feeRecipient: imm.feeRecipient,
    deploys: creation !== null,
  };
  return { stile, creation, transactions, destinations: input.destinations, limits: { perTransferUsdc: fromUnits(limits.perTransfer), dailyUsdc: fromUnits(limits.daily), lifetimeUsdc: fromUnits(limits.lifetime), maxGatewayFeeUsdc: fromUnits(maxGatewayFee), validUntil: new Date(Number(limits.validUntil) * 1000).toISOString(), anyRecipient: false } };
}

export function gatewayCreateNotes(plan: GatewayCreatePlan): string[] {
  return [
    plan.creation ? `Your wallet first creates your LykiaStile (${plan.creation.predictedAddress}); send the transactions in order with nothing in between, because the address follows from your wallet's nonce.` : "Your LykiaStile is already there; this leash adds a session to it.",
    plan.transactions.length > 1 ? "Then addDelegate lets the Stile sign Gateway transfers for your USDC deposit on Arc, and createSession sets this leash's limits." : "createSession sets this leash's limits on it.",
    "The Stile spends the part of your Gateway balance deposited on Arc; deposits on other chains are not reachable from it.",
    `While LykiaStile is unaudited a Gateway leash allows at most $${STILE_BETA.perStepUsd} per transfer and $${STILE_BETA.perDayUsd} a day.`,
    "Lykia's fee is a second burn intent in the same attestation, minted to Lykia on the same destination; caps count it.",
  ];
}

/* ------------------------------------------------------------ bind */

/** Binds the Stile session once its transaction landed: from the receipt, or by checking the ids issued since the leash was made. */
export async function gatewayBind(ctx: AppContext, host: LeashHost, leash: Leash, txHash?: `0x${string}`): Promise<Leash> {
  const s = leash.stile;
  if (!s || s.sessionId || (leash.status !== "pending" && leash.status !== "active")) return leash;
  const imm = expectedImmutables(leash.environment, leash.owner, { bps: s.feeBps, recipient: s.feeRecipient });
  const check = await checkStile(ctx, leash.environment, s.address, imm);
  if (!check.deployed) {
    if (txHash) throw new LykiaHttpError("NOT_FOUND", 404, `There is no contract at ${s.address} yet. If you sent other transactions from your wallet before creating the Stile, its address moved: revoke this leash and make a new one.`);
    return leash;
  }
  if (!check.matches) throw new LykiaHttpError("BINDING_MISMATCH", 409, `The contract at ${s.address} is not the LykiaStile this leash expects: ${check.problems.join(" ")}`);
  await typedStiles(ctx).put(`${leash.environment}:${leash.owner}`, { address: s.address, predicted: false, at: iso(host.now()) }, { ttlMs: LEASH_RECORD_TTL_MS });
  const policyHash = fenceBytes32(leash.fenceHash);
  let sessionId: Hex | null = null;
  let block: string | undefined;
  if (txHash) {
    const receipt = await ctx.chains.getTxReceipt(leash.environment, txHash);
    if (!receipt) throw new LykiaHttpError("NOT_FOUND", 404, "Arc does not know that transaction yet. Try again once it is mined.");
    if (receipt.status !== "success") throw new LykiaHttpError("RECEIPT_REVERTED", 409, "The session transaction reverted on Arc.");
    for (const log of receipt.logs as readonly Log[]) {
      if (log.address.toLowerCase() !== s.address.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: STILE_ABI, data: log.data, topics: log.topics as never }) as { eventName: string; args: { id?: Hex; key?: Address; policyHash?: Hex } };
        if (ev.eventName === "SessionCreated" && ev.args.key?.toLowerCase() === s.key.toLowerCase() && ev.args.policyHash?.toLowerCase() === policyHash.toLowerCase()) sessionId = ev.args.id ?? null;
      } catch {
        /* another event */
      }
    }
    if (!sessionId) throw new LykiaHttpError("BINDING_MISMATCH", 409, "That transaction did not create this leash's session on your LykiaStile (key or Fence hash differ).");
    block = receipt.blockNumber.toString();
  } else {
    sessionId = await findStileSession(ctx, leash.environment, { stile: s.address, key: s.key, policyHash, fromNonce: BigInt(s.nonceAtCreation) }).catch(() => null);
  }
  if (!sessionId) return leash;
  const next: Leash = { ...leash, status: "active", stile: { ...s, sessionId, ...(txHash ? { txHash } : {}), ...(block ? { block } : {}) } };
  return host.put(next);
}

/* ------------------------------------------------------------ usage */

export async function gatewayUsage(ctx: AppContext, host: LeashHost, leash: Leash): Promise<LeashUsage & { readonly unreadable?: boolean; readonly stileState?: StileSessionState }> {
  const stored = await host.storeSpent(leash);
  const secondsLeft = Math.max(0, Math.floor((Date.parse(leash.expiresAt) - host.now()) / 1000));
  const base = { asOf: iso(host.now()), perStepUsd: leash.budget.perStepUsd, secondsLeft, tokens: [], calls: null };
  const storeOnly = (unreadable: boolean) => ({ ...base, source: "store" as const, block: null, sessionValid: null, day: leashWindow(formatUsdMicros(stored.day), leash.budget.perDayUsd), total: leashWindow(formatUsdMicros(stored.total), leash.budget.totalUsd), ...(unreadable ? { unreadable: true } : {}) });
  const s = leash.stile;
  if (!s?.sessionId) return storeOnly(false);
  let state: StileSessionState;
  try {
    state = await readStileSession(ctx, leash.environment, s.address, s.sessionId as Hex, leash.owner);
  } catch {
    return storeOnly(true);
  }
  // USDC base units are micro-dollars at par.
  const day = stored.day > state.dayUsed ? stored.day : state.dayUsed;
  const total = stored.total > state.consumed ? stored.total : state.consumed;
  const balances = await gatewayBalances(ctx.fetch, leash.environment, leash.owner);
  const arc = balances?.find((b) => b.domain === ARC_DOMAIN)?.balance ?? (balances ? "0" : null);
  return {
    ...base,
    source: "chain",
    block: state.block?.toString() ?? null,
    sessionValid: state.valid,
    day: leashWindow(formatUsdMicros(day), leash.budget.perDayUsd),
    total: leashWindow(formatUsdMicros(total), leash.budget.totalUsd),
    stile: { spendable: state.spendable.toString(), paused: state.paused, delegated: state.delegated, arcBalanceUsdc: arc },
    stileState: state,
  };
}

/* ------------------------------------------------------------ plan */

const CHAIN_WORD = /\b(?:on|to|via|into)\s+([a-z]+(?:\s+[a-z]+){0,2})/giu;

/** What the agent asks for: one USDC transfer to a payee on a Gateway destination. */
export function gatewayRequest(input: { readonly text?: string; readonly actions?: readonly PlanAction[] }, leash: Pick<Leash, "stile">): { readonly to: Address; readonly amount: string; readonly destination: string | null } | { readonly error: string } {
  let actions: readonly PlanAction[];
  let text = "";
  if (input.text !== undefined) {
    const parsed = readSentence(input.text);
    if (parsed.clarify.length > 0 || parsed.actions.length === 0) return { error: parsed.clarify.length > 0 ? parsed.clarify.join(" ") : parsed.reply };
    actions = parsed.actions;
    text = input.text;
  } else actions = input.actions ?? [];
  if (actions.length !== 1) return { error: "A Gateway leash makes one transfer per plan: name one payee, one amount and one chain." };
  const a = actions[0]!;
  let to: string | undefined;
  let destination: string | null = null;
  let amount: unknown;
  let token: string;
  if (a.verb === "send") {
    to = a.to;
    amount = a.amount;
    token = a.token;
  } else if (a.verb === "bridge") {
    to = a.recipient;
    amount = a.amount;
    token = a.token;
    destination = gatewayChain(a.destination)?.key ?? a.destination;
  } else return { error: "A Gateway leash only pays: send USDC to a payee on a chain Gateway reaches." };
  if (token.toUpperCase() !== "USDC") return { error: "A Gateway balance holds USDC; name an amount in USDC." };
  if (!to || !/^0x[0-9a-fA-F]{40}$/u.test(to)) return { error: "Name the payee's address." };
  const exact = (amount as { exact?: string }).exact;
  if (!exact || !/^\d{1,12}(?:\.\d{1,6})?$/u.test(exact)) return { error: "Name an exact USDC amount (not a share or everything)." };
  if (!destination && text) {
    for (const m of text.matchAll(CHAIN_WORD)) {
      const words = m[1]!.trim().split(/\s+/u);
      for (let n = Math.min(3, words.length); n >= 1 && !destination; n--) destination = gatewayChain(words.slice(0, n).join(" "))?.key ?? null;
      if (destination) break;
    }
  }
  if (!destination && leash.stile?.destinations.length === 1) destination = leash.stile.destinations[0]!;
  return { to: to.toLowerCase() as Address, amount: exact, destination };
}

export async function gatewayPlan(ctx: AppContext, host: LeashHost, leash: Leash, input: { readonly text?: string; readonly actions?: readonly PlanAction[]; readonly dryRun?: boolean; readonly forward?: boolean }): Promise<LeashPlanResponse> {
  const s = leash.stile!;
  const agent = await host.packAgent(leash);
  const source = input.text ?? JSON.stringify(input.actions ?? []).slice(0, 500);
  const refuse = async (reasons: readonly LeashDenyReason[], usage: Pick<LeashUsage, "day" | "total">, extra: { verdictDigest?: string | null; summary?: string } = {}) => {
    const remaining = host.remaining(leash, usage);
    await host.action(leash, { kind: "denied", summary: (extra.summary ?? source).slice(0, 160), ...(extra.verdictDigest ? { verdictDigest: extra.verdictDigest } : {}), decision: "deny", reasons });
    host.fire("leash.denied", leash, { reasons: reasons as never, remaining, intentId: null, verdictDigest: extra.verdictDigest ?? null });
    return host.denied(leash, reasons, remaining, { verdictDigest: extra.verdictDigest ?? null });
  };
  const stored = await host.storeSpent(leash);
  const storeUsage = { day: leashWindow(formatUsdMicros(stored.day), leash.budget.perDayUsd), total: leashWindow(formatUsdMicros(stored.total), leash.budget.totalUsd) };
  const live = host.liveReasons(leash, agent);
  if (live.length > 0) throw await refuse(live, storeUsage);
  if (!s.sessionId && !input.dryRun) throw await refuse([{ code: "leash.session.pending", message: "The Stile session has not landed on chain yet: the owner signs it once, then the leash is live." }], storeUsage);
  const available = stileAvailability(ctx, leash.environment);
  if (!available.available) throw await refuse([{ code: "leash.gateway.unavailable", message: available.reason ?? "Gateway leashes are switched off." }], storeUsage);

  const asked = gatewayRequest(input, leash);
  if ("error" in asked) throw await refuse([{ code: "leash.not-understood", message: asked.error }], storeUsage);
  const dest = asked.destination ? gatewayChain(asked.destination) : null;
  const summary = `Pay ${asked.amount} USDC to ${asked.to} on ${dest?.name ?? "?"} from the Gateway balance`;
  const reasons: LeashDenyReason[] = [];
  if (!dest) reasons.push({ code: "leash.gateway.destination", message: `Name the chain to pay on: ${s.destinations.join(", ")}.` });
  else if (!s.destinations.includes(dest.key)) reasons.push({ code: "leash.gateway.destination", message: `${dest.name} is not one of this leash's destinations (${s.destinations.join(", ")}).` });
  if (!leash.recipients.includes(asked.to)) reasons.push({ code: "leash.gateway.recipient", message: `${asked.to} is not a payee of this leash.` });
  if (reasons.length > 0) throw await refuse(reasons, storeUsage, { summary });

  const units = usdcUnits(asked.amount);
  const fee = feeOf(units, s.feeBps);
  const charge = units + fee;
  const usage = await gatewayUsage(ctx, host, leash);
  if (usage.unreadable && !input.dryRun) throw await refuse([{ code: "leash.chain.unreadable", message: "The LykiaStile could not be read on Arc, so nothing is prepared. Try again." }], usage, { summary });
  if (usage.stile?.paused) throw await refuse([{ code: "leash.stile.paused", message: "The owner paused the LykiaStile: no transfer validates until it is lifted." }], usage, { summary });
  if (usage.sessionValid === false) throw await refuse([{ code: "leash.session.invalid", message: "The Stile session is no longer valid on chain (revoked or expired)." }], usage, { summary });
  if (usage.stile?.delegated === false) throw await refuse([{ code: "leash.stile.delegate", message: "The LykiaStile is not a Gateway delegate of the owner's deposit, so Gateway would refuse its signature. The owner signs addDelegate first." }], usage, { summary });

  // The Fence, with the leash's own spend and the beta cap.
  const usdc = (contractAddress("usdc", leash.environment) as Address).toLowerCase() as Address;
  const verdict = evaluateFence(
    leash.fence,
    { environment: leash.environment, signer: "agent", owner: leash.owner, proposedByAgent: true, steps: [{ id: "s1", kind: "transfer", venue: "gateway", usd: fromUnits(charge), tokens: [{ symbol: "USDC", address: usdc, listed: true, acquired: false }], recipient: asked.to, ...(fee > 0n ? { fee: { line: `Lykia fee ${s.feeBps / 100}% · ${fromUnits(fee)} USDC`, usd: fromUnits(fee) } } : {}) }], spent: { dayUsd: usage.day.spentUsd, weekUsd: null }, now: host.now() },
    ctx.config.beta ? { beta: ctx.config.beta } : {},
  );
  reasons.push(...verdict.reasons.filter((r) => r.decision === "deny").map((r) => ({ code: `fence.${r.rule}`, message: r.message, stepId: "s1" })));
  if (verdict.decision === "confirm") reasons.push(...verdict.reasons.filter((r) => r.decision === "confirm").map((r) => ({ code: "leash.needs-owner", message: `The owner must confirm this: ${r.message}`, stepId: "s1" })));
  const chargeUsd = formatUsdMicros(charge);
  if (charge > usdMicros(usage.total.remainingUsd)) reasons.push({ code: "leash.budget.total", message: `$${chargeUsd} is more than the $${usage.total.remainingUsd} left of this leash's total budget.` });
  if (charge > usdMicros(usage.day.remainingUsd) && !reasons.some((r) => r.code === "fence.caps.daily")) reasons.push({ code: "leash.budget.day", message: `$${chargeUsd} is more than the $${usage.day.remainingUsd} left today.` });
  if (usage.stile && charge > BigInt(usage.stile.spendable)) reasons.push({ code: "leash.chain.spendable", message: `The Stile lets this session reserve ${fromUnits(BigInt(usage.stile.spendable))} USDC right now (payment plus fee); this transfer needs ${fromUnits(charge)}.` });
  if (usage.stile?.arcBalanceUsdc !== null && usage.stile?.arcBalanceUsdc !== undefined && usdcUnits(usage.stile.arcBalanceUsdc) < charge) reasons.push({ code: "leash.gateway.balance", message: `The owner's Gateway balance on Arc is ${usage.stile.arcBalanceUsdc} USDC; this transfer needs ${fromUnits(charge)} plus Gateway's fee.` });
  if (reasons.length > 0) throw await refuse(reasons, usage, { verdictDigest: verdict.digest, summary });

  const notes: string[] = [];
  if (usage.stile?.arcBalanceUsdc === null) notes.push("Gateway's balance could not be read; Gateway checks it when the transfer is submitted.");
  if (input.dryRun) return { leashId: leash.id, decision: "allow", intent: null, prepared: null, remaining: host.remaining(leash, usage), notes: [...notes, "Dry run: nothing was prepared."] };

  // The burn intents: the payment, then Lykia's fee leg on the same destination.
  const forward = input.forward === true;
  const specs = [specFor({ environment: leash.environment, owner: leash.owner, stile: s.address, destination: dest!, recipient: asked.to, units })];
  if (s.feeBps > 0) specs.push(specFor({ environment: leash.environment, owner: leash.owner, stile: s.address, destination: dest!, recipient: s.feeRecipient, units: fee > 0n ? fee : 1n }));
  const estimated = await estimateIntents(ctx.fetch, leash.environment, specs, forward).catch(async (error: unknown) => {
    throw await refuse([{ code: "leash.gateway.unavailable", message: error instanceof Error ? error.message : "Gateway's estimate could not be read." }], usage, { verdictDigest: verdict.digest, summary });
  });
  if (estimated.source === "formula") notes.push("Gateway's fee estimate could not be read; maxFee follows Circle's published formula and the intents do not expire on chain.");
  const maxAllowed = BigInt(s.maxGatewayFee);
  const tooDear = estimated.intents.find((b) => BigInt(b.maxFee) > maxAllowed);
  if (tooDear) throw await refuse([{ code: "leash.gateway.fee", message: `Gateway asks up to ${fromUnits(BigInt(tooDear.maxFee))} USDC per intent here; this leash allows ${fromUnits(maxAllowed)}.` }], usage, { verdictDigest: verdict.digest, summary });

  const intentId = `out_gw${randomHex(6)}`;
  const stepId = "s1";
  const memo = memoData({ intentId, stepId, verdict: verdictTag(verdict.digest) });
  const digest = intentsDigest(estimated.intents);
  const signature = signatureFor(s.sessionId as Hex);
  const transferSpecHash = transferSpecHashOf(estimated.intents[0]!.spec);
  const transaction: UnsignedTransaction = { chainId: s.chainId, from: s.key, to: s.address, data: reserveCalldata(s.sessionId as Hex, estimated.intents, memo), value: "0", label: `${leash.agentName}: reserve ${asked.amount} USDC to ${asked.to.slice(0, 8)}… on ${dest!.name} (Gateway)` };
  try {
    await ctx.chains.client(leash.environment).call({ account: s.key, to: transaction.to, data: transaction.data });
  } catch (error) {
    const decoded = stileError(error);
    throw await refuse([{ code: "leash.chain.revert", message: decoded ? `The Stile refused it in simulation: ${decoded}.` : `The simulation on Arc failed: ${error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : "unknown error"}.`, stepId }], usage, { verdictDigest: verdict.digest, summary });
  }
  const maxGatewayFee = estimated.intents.reduce((n, b) => n + BigInt(b.maxFee), 0n);
  const record: LeashStep = { leashId: leash.id, intentId, stepId, transaction, verdictDigest: verdict.digest, usd: chargeUsd, summary, preparedAt: iso(host.now()), status: "prepared", gateway: { intents: estimated.intents, digest, signature, transferSpecHash, destination: dest!.key, forward } };
  await leashSteps(ctx).put(`${leash.id}:${intentId}:${stepId}`, record, { ttlMs: LEASH_RECORD_TTL_MS });
  await host.action(leash, { kind: "planned", summary, intentId, stepId, verdictDigest: verdict.digest, decision: verdict.decision, usd: chargeUsd });
  return {
    leashId: leash.id,
    decision: "allow",
    intent: null,
    prepared: {
      intentId,
      stepId,
      transaction,
      calls: [],
      memo: `lykia:1:${intentId}:${stepId}:${verdictTag(verdict.digest)}`,
      simulated: true,
      gateway: { destination: dest!.key, recipient: asked.to, amountUsdc: asked.amount, lykiaFeeUsdc: fromUnits(fee), maxGatewayFeeUsdc: fromUnits(maxGatewayFee), burnIntents: estimated.intents, digest, signature, transferSpecHash, forward },
    },
    remaining: host.remaining(leash, usage),
    notes: [...notes, "Send the reserve transaction from the session key, then submit its hash: Lykia posts the intents to Gateway with the Stile as the contract signer."],
  };
}

/* ------------------------------------------------------------ submit */

export async function gatewaySubmit(ctx: AppContext, host: LeashHost, leash: Leash, input: { readonly intentId: string; readonly stepId: string; readonly hash: `0x${string}` }): Promise<LeashSubmitResponse> {
  const s = leash.stile!;
  const live = host.liveReasons(leash, await host.packAgent(leash));
  if (live.length > 0) throw new LykiaHttpError(live[0]!.code === "leash.expired" ? "LEASH_EXPIRED" : "LEASH_REVOKED", 403, live[0]!.message, { leashId: leash.id });
  const key = `${leash.id}:${input.intentId}:${input.stepId}`;
  const doc = await leashSteps(ctx).get(key);
  if (!doc || !doc.value.gateway) throw new LykiaHttpError("NOT_FOUND", 404, "No prepared Gateway step of this leash with that intent and step id.");
  let step = doc.value;
  const g = step.gateway!;
  if (step.status === "settled" || step.status === "failed") throw new LykiaHttpError("CONFLICT", 409, `That step is already ${step.status}.`);
  if (step.txHash && step.txHash.toLowerCase() !== input.hash.toLowerCase()) throw new LykiaHttpError("BINDING_MISMATCH", 409, "This step was already submitted with another transaction.");
  const publicUsage = async () => {
    const { stileState: _s, unreadable: _u, ...u } = await gatewayUsage(ctx, host, leash);
    return u;
  };

  if (step.status === "prepared" || step.status === "submitted") {
    const tx = await ctx.chains.getTransaction(leash.environment, input.hash);
    if (!tx) throw new LykiaHttpError("NOT_FOUND", 404, `Arc does not know ${input.hash} yet. Submit again once it is broadcast.`);
    const p = step.transaction;
    if (tx.from.toLowerCase() !== p.from.toLowerCase() || (tx.to ?? "").toLowerCase() !== p.to.toLowerCase() || tx.input.toLowerCase() !== p.data.toLowerCase() || BigInt(tx.value) !== BigInt(p.value)) throw new LykiaHttpError("BINDING_MISMATCH", 409, "That transaction is not the prepared reservation (sender, target, data or value differ).", { hash: input.hash });
    const claims = ctx.store.collection<{ leashId: string; key: string }>("leash_claims");
    const claim = await claims.compareAndSet(input.hash.toLowerCase(), null, { leashId: leash.id, key }, { ttlMs: LEASH_RECORD_TTL_MS });
    if (!claim && (await claims.get(input.hash.toLowerCase()))?.value.key !== key) throw new LykiaHttpError("REFERENCE_CLAIMED", 409, "That hash is attached to another step.", { hash: input.hash });
    const receipt = await ctx.chains.getTxReceipt(leash.environment, input.hash);
    if (!receipt) {
      step = { ...step, status: "submitted", txHash: input.hash };
      await leashSteps(ctx).put(key, step, { ttlMs: LEASH_RECORD_TTL_MS });
      return { leashId: leash.id, status: "pending", chainProven: false, next: null, usage: await publicUsage() };
    }
    const events = stileEvents(receipt.logs as readonly Log[], s.address, s.sessionId as Hex);
    const reserved = receipt.status === "success" && events.some((e) => e.name === "Reserved" && e.digest.toLowerCase() === g.digest.toLowerCase());
    if (!reserved) {
      await leashSteps(ctx).put(key, { ...step, status: "failed", txHash: input.hash }, { ttlMs: LEASH_RECORD_TTL_MS });
      await host.action(leash, { kind: "failed", summary: step.summary, intentId: input.intentId, stepId: input.stepId, verdictDigest: step.verdictDigest, usd: step.usd, txHash: input.hash });
      return { leashId: leash.id, status: "failed", chainProven: false, next: null, usage: await publicUsage() };
    }
    // Reserved on chain: the Stile charged its caps, so Lykia counts it too.
    if (step.usd) {
      const micros = Number(usdMicros(step.usd));
      await leashSpend(ctx).increment(`${leash.id}:d:${dayKey(host.now())}`, micros, { ttlMs: 2 * 86_400_000 });
      await leashSpend(ctx).increment(`${leash.id}:t`, micros, { ttlMs: LEASH_RECORD_TTL_MS });
      await host.recordSpend(leash, step.usd);
    }
    step = { ...step, status: "reserved", txHash: input.hash };
    await leashSteps(ctx).put(key, step, { ttlMs: LEASH_RECORD_TTL_MS });
    await host.action(leash, { kind: "submitted", summary: step.summary, intentId: input.intentId, stepId: input.stepId, verdictDigest: step.verdictDigest, usd: step.usd, txHash: input.hash });
  }

  // Reserved: ask Gateway for the attestation with the Stile as the contract signer.
  const dest = gatewayChain(g.destination)!;
  try {
    const r = await submitToGateway(ctx.fetch, leash.environment, { intents: g.intents, signature: g.signature, forward: g.forward });
    const mint = !g.forward && r.attestation && r.signature ? { chainId: dest.chainId[leash.environment], from: s.key, to: GATEWAY_MINTER[leash.environment], data: encodeFunctionData({ abi: GATEWAY_MINTER_ABI, functionName: "gatewayMint", args: [r.attestation, r.signature] }), value: "0", label: `Mint ${step.summary.replace(/^Pay /u, "")} on ${dest.name}` } : null;
    step = { ...step, status: "settled", gateway: { ...g, transferId: r.transferId, attestation: r.attestation } };
    await leashSteps(ctx).put(key, step, { ttlMs: LEASH_RECORD_TTL_MS });
    await host.action(leash, { kind: "settled", summary: step.summary, intentId: input.intentId, stepId: input.stepId, verdictDigest: step.verdictDigest, usd: step.usd, txHash: input.hash });
    return {
      leashId: leash.id,
      status: "settled",
      chainProven: true,
      next: null,
      usage: await publicUsage(),
      gateway: { transferId: r.transferId, attestation: r.attestation, mint, forwarded: g.forward, note: g.forward ? "Circle's Forwarding Service submits the mint on the destination; the trail follows it." : `Anyone may send gatewayMint on ${dest.name} (destinationCaller is open); the payee needs no signature.` },
    };
  } catch (error) {
    if (!(error instanceof LykiaHttpError)) throw error;
    const why = (error.details as { gateway?: { message?: string } } | undefined)?.gateway?.message ?? error.message;
    return {
      leashId: leash.id,
      status: "pending",
      chainProven: true,
      next: null,
      usage: await publicUsage(),
      gateway: { transferId: null, attestation: null, mint: null, forwarded: g.forward, note: `Reserved on Arc, but Gateway did not attest it yet: ${why}. Gateway validates against a block up to about 5 minutes old, so a fresh reservation can take that long to count there; submit the same hash again in a minute. The reservation stays usable for an hour.` },
    };
  }
}

/* ------------------------------------------------------------ trail */

export async function gatewayTrail(ctx: AppContext, host: LeashHost, leash: Leash): Promise<LeashTrailResponse> {
  const s = leash.stile;
  const sessionId = s?.sessionId as Hex | null | undefined;
  const items: LeashTrailItem[] = [];
  const known = new Set<string>();
  for (const a of await host.actions(leash, 200)) {
    const base: LeashTrailItem = { at: a.at, kind: a.kind, summary: a.summary, ...(a.intentId ? { intentId: a.intentId } : {}), ...(a.stepId ? { stepId: a.stepId } : {}), ...(a.verdictDigest ? { verdictDigest: a.verdictDigest } : {}), ...(a.decision ? { decision: a.decision } : {}), ...(a.reasons ? { reasons: a.reasons } : {}), ...(a.usd !== undefined ? { usd: a.usd } : {}), ...(a.txHash ? { txHash: a.txHash } : {}), chainProven: false, source: "lykia" };
    if (!a.txHash || !s || !sessionId || !a.intentId || !a.stepId) {
      items.push(base);
      continue;
    }
    known.add(a.txHash.toLowerCase());
    const step = (await leashSteps(ctx).get(`${leash.id}:${a.intentId}:${a.stepId}`))?.value;
    const receipt = await ctx.chains.getTxReceipt(leash.environment, a.txHash).catch(() => null);
    const events = receipt ? stileEvents(receipt.logs as readonly Log[], s.address, sessionId) : [];
    const memo = events.find((e) => e.name === "StileMemo");
    const proven = Boolean(receipt && receipt.status === "success" && step?.gateway && events.some((e) => e.name === "Reserved" && e.digest.toLowerCase() === step.gateway!.digest.toLowerCase()) && a.verdictDigest && memoMatches(memo?.memo, { intentId: a.intentId, stepId: a.stepId, verdictDigest: a.verdictDigest }));
    const gateway = step?.gateway ? await gatewayRecord(ctx, leash.environment, step.gateway) : undefined;
    items.push({ ...base, chainProven: proven, ...(receipt ? { chain: { block: receipt.blockNumber.toString(), events: events.map((e) => ({ name: e.name, detail: e.detail })), ...(memo?.memo ? { memoVerdict: decodeTag(memo.memo) } : {}) } } : {}), ...(gateway ? { gateway } : {}) });
  }
  let scanned: LeashTrailResponse["scanned"] = { fromBlock: null, toBlock: null, note: "No Stile session on chain yet." };
  if (s && sessionId) {
    try {
      const client = ctx.chains.client(leash.environment);
      const to = await client.getBlockNumber();
      const from = s.block ? BigInt(s.block) : to > 29_997n ? to - 29_997n : 0n;
      const logs = (await client.getLogs({ address: s.address, events: STILE_ABI.filter((x) => x.type === "event" && (x.name === "Reserved" || x.name === "StileMemo")) as never, fromBlock: from, toBlock: to })) as unknown as Log[];
      const byTx = new Map<string, ReturnType<typeof stileEvents>>();
      for (const e of stileEvents(logs, s.address, sessionId)) byTx.set(e.txHash.toLowerCase(), [...(byTx.get(e.txHash.toLowerCase()) ?? []), e]);
      for (const [hash, list] of byTx) {
        if (known.has(hash) || !list.some((e) => e.name === "Reserved")) continue;
        items.push({ at: iso(host.now()), kind: "onchain", summary: "The session key reserved a transfer on the Stile without a Lykia plan.", txHash: hash as `0x${string}`, chainProven: true, chain: { block: list[0]!.block.toString(), events: list.map((e) => ({ name: e.name, detail: e.detail })) }, source: "chain" });
      }
      scanned = { fromBlock: from.toString(), toBlock: to.toString(), note: "Stile events in these blocks were compared with Lykia's records; Gateway's transfer records were polled." };
    } catch {
      scanned = { fromBlock: null, toBlock: null, note: "Arc's logs could not be read; items with a transaction are still checked against their receipts." };
    }
  }
  return { leashId: leash.id, items, scanned };
}

function decodeTag(memoHex: Hex): string {
  try {
    const text = new TextDecoder().decode(Uint8Array.from(Buffer.from(memoHex.slice(2), "hex")));
    return text.split("|")[0]!.split(":")[4] ?? "";
  } catch {
    return "";
  }
}

/** Gateway's record (polled) and the destination mint, checked for AttestationUsed with the payment's transferSpecHash. */
async function gatewayRecord(ctx: AppContext, environment: ArcEnvironment, g: NonNullable<LeashStep["gateway"]>): Promise<LeashGatewayTrail> {
  let status: string | null = null;
  let mintTxHash: Hex | null = null;
  if (g.transferId) {
    const record = await gatewayTransferStatus(ctx.fetch, environment, g.transferId).catch(() => null);
    if (record) {
      status = typeof record.status === "string" ? record.status : null;
      const hash = record.transactionHash;
      if (typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/u.test(hash)) mintTxHash = hash as Hex;
    }
  }
  let attestationUsed: boolean | null = null;
  if (mintTxHash) {
    const minter = GATEWAY_MINTER[environment];
    if (g.destination === "arc") {
      const receipt = await ctx.chains.getTxReceipt(environment, mintTxHash).catch(() => null);
      attestationUsed = receipt ? attestationUsedIn(receipt.logs as readonly Log[], minter, g.transferSpecHash) : null;
    } else {
      const rpc = destinationRpc(g.destination);
      const logs = rpc ? await remoteReceiptLogs(ctx.fetch, rpc, mintTxHash) : null;
      attestationUsed = logs ? attestationUsedIn(logs, minter, g.transferSpecHash) : null;
    }
  }
  return { destination: g.destination, digest: g.digest, transferSpecHash: g.transferSpecHash, transferId: g.transferId ?? null, status, mintTxHash, attestationUsed };
}

/* ------------------------------------------------------------ revoke */

export function gatewayRevokeTransactions(leash: Leash): { readonly transaction: UnsignedTransaction | null; readonly more: UnsignedTransaction[]; readonly note: string } {
  const s = leash.stile;
  if (!s) return { transaction: null, more: [], note: "The key stopped working at the API." };
  const transaction = s.sessionId ? stileCallTx(s.chainId, leash.owner, s.address, { functionName: "revokeSession", args: [s.sessionId as Hex] }, `Revoke ${leash.agentName}'s leash on your LykiaStile`) : null;
  const more = [stileCallTx(s.chainId, leash.owner, s.address, { functionName: "setPaused", args: [true] }, "Pause your LykiaStile (every session, at once)"), removeDelegateTx(s.chainId, leash.environment, leash.owner, s.address)];
  const note = transaction
    ? "The key stopped working at the API just now. Sign revokeSession to end the session on the Stile too. Gateway validates against a block up to about 5 minutes old, so for up to about 5 minutes a reservation made before the revocation may still be attested; a transfer Gateway already attested cannot be called back. To cut the Stile off entirely, pause it or remove it as a Gateway delegate."
    : "The key stopped working at the API. No Stile session was found on chain yet: if you already sent createSession, revoke it on your LykiaStile once it lands, or remove the Stile as a Gateway delegate.";
  return { transaction, more, note };
}

/* ------------------------------------------------------------ the response */

export function gatewayCreateResponse(plan: GatewayCreatePlan): NonNullable<CreateLeashResponse["stile"]> {
  return {
    address: plan.stile.address,
    deploys: plan.creation !== null,
    deployment: plan.creation,
    session: { key: plan.stile.key, validUntil: plan.stile.validUntil, destinations: plan.destinations, limits: plan.limits },
    note: gatewayCreateNotes(plan).join(" "),
  };
}
