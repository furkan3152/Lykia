/**
 * Payouts: a batch of up to 100 recipients, each with its own token, amount
 * and reference, paid in as few transactions as the Fence allows.
 *
 *  1. Rows are checked (registry token, precision, address), every payee
 *     goes through the security layer's address checks (look-alikes,
 *     blocklists, Circle Compliance when configured) and the payer must
 *     hold every amount plus fees.
 *  2. Rows are planned in chunks of at most the Fence's maxSteps as one
 *     intent each: Lykia's 1% fee, the project's fee, the Fence and the
 *     mainnet beta cap all apply. A row the Fence denies is refused and the
 *     rest of its chunk is planned again without it.
 *  3. Each chunk becomes one Multicall3From batch (fee transfers + memo-
 *     wrapped transfers), checked with eth_call.
 *  4. The payer signs each batch, or (opt-in servers only) a Circle
 *     developer-controlled wallet the developer created through this API
 *     executes it; that wallet's address is the payer. Settlement is read from the
 *     receipt's Memo events, row by row.
 */
import {
  DEFAULT_FENCE,
  feeOf,
  findToken,
  fromBaseUnits,
  payoutNote,
  payoutStatusOf,
  projectFence,
  tightenFence,
  tokenAddress,
  toBaseUnitsBig,
  validatePayoutRows,
  type Address,
  type ArcEnvironment,
  type Fence,
  type Payout,
  type PayoutBatch,
  type PayoutRow,
  type PayoutRowInput,
  type PlanAction,
} from "@lykia/core";
import { decisionOf } from "@lykia/core/security/index";
import { erc20Abi } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { randomHex } from "../platform/crypto.js";
import { integratorFeeOf } from "../platform/projects.js";
import { checkRecipient, pauseOf, rememberRecipient } from "../security/index.js";
import { services } from "../services.js";
import type { JsonValue } from "../store/types.js";
import type { FlowCaller } from "./access.js";
import { buildBatch, checkBatch, memoEvents, memoIdFor, verifySubmitted, type ReceiptLog } from "./batch.js";
import { circleContractExecution, circleTransaction } from "./circleExec.js";
import { assertServerWallets, ownedWallet } from "../circle/walletRegistry.js";
import { businessEvent } from "./events.js";
import { listOwned, payouts, RECORD_TTL_MS } from "./stores.js";
import { lockedOr } from "../platform/requestState.js";
import { listAll } from "../store/types.js";

const MAX_BATCH_ROWS = 12;

export interface CreatePayoutInput {
  /** Required for wallet execution; with circleWalletId the payer is the wallet's own address. */
  readonly payer?: Address;
  readonly environment?: ArcEnvironment;
  readonly rows: readonly PayoutRowInput[];
  readonly fence?: Fence;
  /** A Circle developer-controlled wallet the caller created (its address is the payer) that executes the batches. Opt-in servers only. */
  readonly circleWalletId?: string;
  readonly dryRun?: boolean;
  /** Accept a Fence "confirm" verdict (the caller has shown the owner what it asks). */
  readonly confirm?: boolean;
}

/** The public shape. */
export function payoutView(payout: Payout): Payout {
  return payout;
}

export async function getPayout(ctx: AppContext, caller: FlowCaller, id: string): Promise<Payout> {
  const doc = /^po_[a-z0-9]{12}$/u.test(id) ? (await payouts(ctx).get(id))?.value : null;
  if (!doc || doc.developer !== caller.developer) throw new LykiaHttpError("NOT_FOUND", 404, "No such payout.");
  return doc;
}

export async function listPayouts(ctx: AppContext, caller: FlowCaller, filter: { readonly projectId?: string; readonly status?: string } = {}): Promise<Payout[]> {
  return listOwned(payouts(ctx), caller.developer, (p) => (!filter.projectId || p.projectId === filter.projectId) && (!filter.status || p.status === filter.status));
}

async function balances(ctx: AppContext, environment: ArcEnvironment, payer: Address, tokens: readonly string[]): Promise<Map<string, bigint | null>> {
  const client = ctx.chains.client(environment) as unknown as { readContract(a: unknown): Promise<unknown> };
  const out = new Map<string, bigint | null>();
  for (const symbol of tokens) {
    const token = findToken(environment, symbol);
    const address = token ? tokenAddress(token, environment) : null;
    if (!token || !address) {
      out.set(symbol, null);
      continue;
    }
    out.set(symbol, await client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [payer] }).then((v) => v as bigint).catch(() => null));
  }
  return out;
}

function totalsOf(rows: readonly PayoutRow[], environment: ArcEnvironment): Payout["totals"] {
  const by = new Map<string, { amount: bigint; fees: bigint; decimals: number }>();
  for (const r of rows) {
    if (r.status === "refused") continue;
    const token = findToken(environment, r.token);
    if (!token) continue;
    const t = by.get(token.symbol) ?? { amount: 0n, fees: 0n, decimals: token.decimals };
    t.amount += toBaseUnitsBig(r.amount, token.decimals);
    t.fees += r.fee ? BigInt(r.fee) : 0n;
    by.set(token.symbol, t);
  }
  return [...by.entries()].map(([token, t]) => ({ token, amount: fromBaseUnits(t.amount, t.decimals), fees: fromBaseUnits(t.fees, t.decimals) }));
}

function fenceFor(caller: FlowCaller, input: CreatePayoutInput): Fence {
  const fence = input.fence ?? (caller.project ? projectFence(caller.project) : DEFAULT_FENCE);
  return caller.project ? tightenFence(fence, caller.project) : fence;
}

export async function createPayout(ctx: AppContext, caller: FlowCaller, input: CreatePayoutInput): Promise<Payout> {
  const environment = input.environment ?? lockedOr(caller.project?.network ?? ctx.config.mode);
  const issues = validatePayoutRows(input.rows, environment);
  if (issues.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Invalid payout: ${issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join("; ")}`, { issues: issues.slice(0, 50) });
  const execution: Payout["execution"] = input.circleWalletId ? "circle" : "wallet";
  // A Circle wallet signs with the operator's entity secret: only its creator may pay from it, and the payer is the
  // wallet's own address, so the Fence, the beta cap, balances and the security layer all judge the real payer.
  let payer: Address;
  if (input.circleWalletId) {
    assertServerWallets(ctx);
    const wallet = await ownedWallet(ctx, input.circleWalletId, caller.developer);
    if (input.payer && input.payer.toLowerCase() !== wallet.address) throw new LykiaHttpError("PAYER_MISMATCH", 409, `A Circle wallet pays from its own address (${wallet.address}); leave payer out or send that address.`, { walletAddress: wallet.address });
    if (wallet.environment !== environment) throw new LykiaHttpError("INVALID_REQUEST", 400, `That Circle wallet is on Arc ${wallet.environment}, not ${environment}.`);
    payer = wallet.address as Address;
  } else {
    if (!input.payer) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send payer (the wallet that signs the batches), or circleWalletId.");
    payer = input.payer.toLowerCase() as Address;
  }
  const paused = await pauseOf(ctx, payer);
  if (paused) throw new LykiaHttpError("SECURITY_BLOCKED", 409, `${payer} is paused (${paused.by}): ${paused.reason}`);
  const fence = fenceFor(caller, input);
  const id = `po_${randomHex(6)}`;
  const now = new Date(ctx.clock.now()).toISOString();
  const rows: PayoutRow[] = input.rows.map((r, index) => ({
    index,
    to: r.to.toLowerCase() as Address,
    token: findToken(environment, r.token)?.symbol ?? r.token,
    amount: r.amount,
    reference: r.reference ?? null,
    memo: r.memo ?? null,
    status: "planned",
    batch: null,
    stepId: null,
    memoId: null,
    fee: null,
    reasons: [],
    txHash: null,
  }));
  const warnings: string[] = [];

  // Security layer, address protection: every payee once.
  const tokensOf = (to: string) => [...new Set(rows.filter((r) => r.to === to).map((r) => (findToken(environment, r.token) ? tokenAddress(findToken(environment, r.token)!, environment) : null)).filter((a): a is Address => Boolean(a)))];
  for (const to of [...new Set(rows.map((r) => r.to))]) {
    const check = await checkRecipient(ctx, { environment, owner: payer, recipient: to, tokens: tokensOf(to) });
    const decision = decisionOf(check.findings);
    const lines = check.findings.filter((f) => f.severity !== "info").map((f) => f.message);
    for (const row of rows.filter((r) => r.to === to)) {
      if (decision === "block") {
        row.status = "refused";
        row.reasons.push(...check.findings.filter((f) => f.severity === "block").map((f) => `Security: ${f.message}`));
      } else if (lines.length > 0) row.reasons.push(...lines.map((l) => `Note: ${l}`));
    }
  }

  // Balances: every live row plus Lykia's fee and the project's fee.
  const integrator = integratorFeeOf(caller.project);
  const feeBps = ctx.config.fee.bps + (integrator?.bps ?? 0);
  if (!input.dryRun) {
    const live = rows.filter((r) => r.status !== "refused");
    const need = new Map<string, bigint>();
    for (const r of live) {
      const token = findToken(environment, r.token);
      if (!token) continue;
      const units = toBaseUnitsBig(r.amount, token.decimals);
      need.set(token.symbol, (need.get(token.symbol) ?? 0n) + units + feeOf(units, feeBps));
    }
    const have = await balances(ctx, environment, payer, [...need.keys()]);
    const short = [...need.entries()].filter(([s, n]) => (have.get(s) ?? null) !== null && (have.get(s) as bigint) < n);
    const unknown = [...need.keys()].filter((s) => (have.get(s) ?? null) === null);
    if (unknown.length > 0) throw new LykiaHttpError("FACTS_UNAVAILABLE", 503, `The payer's ${unknown.join(", ")} balance could not be read; nothing was planned.`);
    if (short.length > 0) {
      const detail = short.map(([s, n]) => ({ token: s, need: fromBaseUnits(n, findToken(environment, s)?.decimals ?? 6), have: fromBaseUnits(have.get(s) as bigint, findToken(environment, s)?.decimals ?? 6) }));
      throw new LykiaHttpError("INSUFFICIENT_BALANCE", 409, `The payer holds too little: ${detail.map((d) => `${d.token} needs ${d.need}, holds ${d.have}`).join("; ")} (amounts include fees).`, { balances: detail });
    }
  }

  // Plan in chunks; a row the Fence denies is refused and its chunk planned again.
  const chunkSize = Math.max(1, Math.min(fence.limits?.maxSteps ?? 8, MAX_BATCH_ROWS));
  const live = rows.filter((r) => r.status !== "refused");
  const chunks: PayoutRow[][] = [];
  for (let i = 0; i < live.length; i += chunkSize) chunks.push(live.slice(i, i + chunkSize));
  const batches: PayoutBatch[] = [];
  const intents = services(ctx).intents;
  const confirmReasons: string[] = [];
  for (const chunk of chunks) {
    let members = chunk;
    for (let attempt = 0; attempt < 2 && members.length > 0; attempt++) {
      const actions: PlanAction[] = members.map((r) => ({ verb: "send", token: r.token, amount: { exact: r.amount }, to: r.to, memo: payoutNote(id, { ...(r.reference ? { reference: r.reference } : {}), ...(r.memo ? { memo: r.memo } : {}) }) }));
      let planned;
      try {
        planned = await intents.create({ environment, owner: payer, actions, source: `payout ${id}`, fence, account: execution === "circle" ? "smart" : "eoa", ...(input.dryRun ? { dryRun: true } : {}), ...(integrator ? { integrator } : {}) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const r of members) {
          r.status = "refused";
          r.reasons.push(`Planner: ${message}`);
        }
        members = [];
        break;
      }
      const graph = planned.intent;
      const transfers = graph.steps.filter((s) => s.kind === "transfer");
      if (graph.verdict.decision === "deny") {
        const denials = graph.verdict.reasons.filter((r) => r.decision === "deny");
        const global = denials.filter((r) => !r.step || !transfers.some((s) => s.id === r.step));
        if (global.length > 0 || attempt === 1) {
          for (const r of members) {
            r.status = "refused";
            r.reasons.push(...denials.map((d) => `Fence: ${d.message}`));
          }
          members = [];
          break;
        }
        const denied = new Set(denials.map((d) => d.step));
        const next: PayoutRow[] = [];
        transfers.forEach((s, i) => {
          const row = members[i];
          if (!row) return;
          if (denied.has(s.id)) {
            row.status = "refused";
            row.reasons.push(...denials.filter((d) => d.step === s.id).map((d) => `Fence: ${d.message}`));
          } else next.push(row);
        });
        members = next;
        continue;
      }
      // Planned: bind the rows to their steps.
      const batchIndex = batches.length;
      transfers.forEach((s, i) => {
        const row = members[i];
        if (!row) return;
        row.batch = batchIndex;
        row.stepId = s.id;
        row.fee = s.fee ? (BigInt(s.fee.amount) + BigInt(s.fee.integrator?.amount ?? "0")).toString() : null;
        row.status = input.dryRun ? "planned" : "ready";
      });
      if (graph.verdict.decision === "confirm") confirmReasons.push(...graph.verdict.reasons.filter((r) => r.decision === "confirm").map((r) => r.message));
      if (input.dryRun || !planned.stored) {
        batches.push({ index: batchIndex, intentId: graph.id, verdict: { decision: graph.verdict.decision, digest: graph.verdict.digest }, rows: members.map((r) => r.index), transaction: null, binding: "", status: "planned", simulation: { ok: null, reason: "Dry run: nothing was built." }, txHash: null, circleTransactionId: null });
        break;
      }
      const { doc } = await intents.load(graph.id);
      const steps = transfers.map((s) => ({ id: s.id, plan: doc.plans[s.id]! }));
      const built = await buildBatch(ctx.chains, environment, payer, graph.id, graph.verdict.digest, steps);
      const simulation = await checkBatch(ctx.chains, environment, payer, graph.id, graph.verdict.digest, steps);
      if (simulation.ok === null) warnings.push(`Batch ${batchIndex}: ${simulation.reason ?? "simulation unavailable"}.`);
      const failed = simulation.ok === false;
      if (failed)
        for (const r of members) {
          r.status = "refused";
          r.reasons.push(`Simulation: ${simulation.reason ?? "the batch reverts"}`);
        }
      batches.push({ index: batchIndex, intentId: graph.id, verdict: { decision: graph.verdict.decision, digest: graph.verdict.digest }, rows: members.map((r) => r.index), transaction: failed ? null : built.transaction, binding: built.binding, status: failed ? "failed" : "ready", simulation, txHash: null, circleTransactionId: null });
      break;
    }
  }
  if (confirmReasons.length > 0 && !input.confirm && !input.dryRun) throw new LykiaHttpError("CONFIRMATION_REQUIRED", 409, "The Fence asks the owner to confirm this payout. Send confirm: true once they have.", { reasons: [...new Set(confirmReasons)] });

  for (const r of rows) if (r.batch !== null) r.memoId = memoIdFor(batches[r.batch]!.intentId, r.stepId as string);

  const payout: Payout = {
    schema: "lykia.payout/v1",
    id,
    developer: caller.developer,
    projectId: caller.project?.id ?? null,
    environment,
    payer,
    execution,
    circleWalletId: input.circleWalletId ?? null,
    status: payoutStatusOf(rows),
    rows,
    batches,
    totals: totalsOf(rows, environment),
    warnings,
    createdAt: now,
    updatedAt: now,
  };
  if (input.dryRun) payout.status = payout.status === "refused" ? "refused" : "dry-run";
  else {
    await payouts(ctx).put(id, payout, { ttlMs: RECORD_TTL_MS });
    await businessEvent(ctx, "payout.created", { id, status: payout.status, rows: rows.length, refused: rows.filter((r) => r.status === "refused").length, totals: payout.totals as unknown as JsonValue }, { developer: caller.developer, projectId: payout.projectId, owner: payer });
  }
  return payout;
}

async function settleBatch(ctx: AppContext, payout: Payout, batch: PayoutBatch, hash: string, receipt: { status: string; logs?: readonly ReceiptLog[]; blockNumber?: bigint }): Promise<void> {
  const ok = receipt.status === "success";
  const seen = new Set(memoEvents(receipt.logs).map((m) => m.memoId));
  batch.status = ok ? "settled" : "failed";
  batch.txHash = hash;
  for (const index of batch.rows) {
    const row = payout.rows[index];
    if (!row) continue;
    row.txHash = hash;
    row.status = ok ? "settled" : "failed";
    if (ok && receipt.logs && receipt.logs.length > 0 && row.memoId && !seen.has(row.memoId.toLowerCase())) row.reasons.push("The receipt has no Memo event for this row; check the transaction.");
    if (ok) await rememberRecipient(ctx, payout.payer, row.to).catch(() => undefined);
  }
  await services(ctx).intents.settleExternal(batch.intentId, batch.rows.map((i) => payout.rows[i]?.stepId).filter((s): s is string => Boolean(s)), hash, ok).catch((error: unknown) => ctx.log.warn("payout settle on intent failed", { payout: payout.id, error: error instanceof Error ? error.message : String(error) }));
}

async function finish(ctx: AppContext, payout: Payout, before: Payout["status"]): Promise<Payout> {
  payout.status = payoutStatusOf(payout.rows);
  payout.updatedAt = new Date(ctx.clock.now()).toISOString();
  await payouts(ctx).put(payout.id, payout, { ttlMs: RECORD_TTL_MS });
  const scope = { developer: payout.developer, projectId: payout.projectId, owner: payout.payer };
  const summary = { id: payout.id, status: payout.status, rows: payout.rows.map((r) => ({ index: r.index, status: r.status, txHash: r.txHash, memoId: r.memoId, reference: r.reference })) } as unknown as JsonValue;
  if (before !== payout.status && (payout.status === "settled" || payout.status === "partially-settled")) await businessEvent(ctx, "payout.settled", summary, scope);
  if (before !== payout.status && payout.status === "failed") await businessEvent(ctx, "payout.failed", summary, scope);
  if (before !== payout.status && payout.status === "partially-settled" && payout.batches.some((b) => b.status === "failed")) await businessEvent(ctx, "payout.failed", summary, scope);
  return payout;
}

/** The payer broadcast a batch: verify it is exactly the prepared one and read its receipt. */
export async function submitBatch(ctx: AppContext, caller: FlowCaller, id: string, index: number, hash: string): Promise<Payout> {
  const payout = await getPayout(ctx, caller, id);
  const before = payout.status;
  const batch = payout.batches[index];
  if (!batch) throw new LykiaHttpError("NOT_FOUND", 404, "No such batch.");
  if (batch.status !== "ready" && batch.status !== "submitted") throw new LykiaHttpError("STEP_NOT_READY", 409, `Batch ${index} is ${batch.status}.`);
  if (!batch.transaction) throw new LykiaHttpError("STEP_NOT_READY", 409, "This batch has no transaction.");
  const match = await verifySubmitted(ctx.chains, payout.environment, batch.transaction, hash);
  if (match === "unknown") throw new LykiaHttpError("NOT_FOUND", 404, `Arc does not know ${hash} yet. Submit again once it is broadcast.`);
  if (match === "mismatch") throw new LykiaHttpError("BINDING_MISMATCH", 409, "That transaction is not the prepared batch.", { hash });
  const claims = ctx.store.collection<JsonValue>("claims");
  const claimed = await claims.compareAndSet(hash.toLowerCase(), null, { payout: id, batch: index } as JsonValue, { ttlMs: RECORD_TTL_MS });
  if (!claimed) {
    const owner = (await claims.get(hash.toLowerCase()))?.value as { payout?: string; batch?: number } | undefined;
    if (owner?.payout !== id || owner.batch !== index) throw new LykiaHttpError("REFERENCE_CLAIMED", 409, "That hash is attached to something else.", { hash });
  }
  batch.status = "submitted";
  batch.txHash = hash;
  for (const i of batch.rows) {
    const row = payout.rows[i];
    if (row && row.status === "ready") {
      row.status = "submitted";
      row.txHash = hash;
    }
  }
  const receipt = (await ctx.chains.getTxReceipt(payout.environment, hash)) as { status: string; logs?: readonly ReceiptLog[] } | null;
  if (receipt) await settleBatch(ctx, payout, batch, hash, receipt);
  return finish(ctx, payout, before);
}

/** Executes ready batches from the payout's Circle developer-controlled wallet. */
export async function executeWithCircle(ctx: AppContext, caller: FlowCaller, id: string): Promise<Payout> {
  const payout = await getPayout(ctx, caller, id);
  if (payout.execution !== "circle" || !payout.circleWalletId) throw new LykiaHttpError("INVALID_REQUEST", 400, "This payout is signed by the payer's wallet, not a Circle wallet.");
  const walletId = payout.circleWalletId;
  assertServerWallets(ctx);
  // Checked again at execution: the wallet still belongs to the payout's developer and still is the payer.
  const wallet = await ownedWallet(ctx, walletId, payout.developer);
  if (wallet.address !== payout.payer.toLowerCase()) throw new LykiaHttpError("PAYER_MISMATCH", 409, "This payout's payer is not the Circle wallet's address.");
  const before = payout.status;
  let sent = 0;
  for (const batch of payout.batches) {
    if (batch.status !== "ready" || !batch.transaction || batch.circleTransactionId) continue;
    const tx = await circleContractExecution(ctx, { walletId, contract: batch.transaction.to, callData: batch.transaction.data, refId: `${payout.id}:${batch.index}` });
    batch.circleTransactionId = tx.id;
    batch.status = "submitted";
    for (const i of batch.rows) if (payout.rows[i]?.status === "ready") payout.rows[i]!.status = "submitted";
    sent += 1;
  }
  if (sent === 0) throw new LykiaHttpError("STEP_NOT_READY", 409, "No batch is ready to execute.");
  return finish(ctx, payout, before);
}

/** One reconciliation pass: late receipts and Circle transactions. */
export async function tickPayouts(ctx: AppContext): Promise<number> {
  let changed = 0;
  for (const doc of await listAll(payouts(ctx))) {
    const payout = doc.value;
    const pending = payout.batches.filter((b) => b.status === "submitted");
    if (pending.length === 0) continue;
    const before = payout.status;
    let dirty = false;
    for (const batch of pending) {
      try {
        let hash = batch.txHash;
        if (!hash && batch.circleTransactionId) {
          const tx = await circleTransaction(ctx, batch.circleTransactionId);
          if (tx.state === "FAILED" || tx.state === "CANCELLED" || tx.state === "DENIED") {
            batch.status = "failed";
            for (const i of batch.rows) if (payout.rows[i]) payout.rows[i]!.status = "failed";
            dirty = true;
            continue;
          }
          hash = tx.txHash;
          if (hash) {
            batch.txHash = hash;
            dirty = true;
          }
        }
        if (!hash) continue;
        const receipt = (await ctx.chains.getTxReceipt(payout.environment, hash)) as { status: string; logs?: readonly ReceiptLog[] } | null;
        if (!receipt) continue;
        // Circle wallets are smart accounts: the proof is every row's memo in the receipt.
        if (batch.circleTransactionId && receipt.status === "success") {
          const seen = new Set(memoEvents(receipt.logs).map((m) => m.memoId));
          const missing = batch.rows.some((i) => payout.rows[i]?.memoId && !seen.has(payout.rows[i]!.memoId!.toLowerCase()));
          if (missing) continue;
        }
        await settleBatch(ctx, payout, batch, hash, receipt);
        dirty = true;
      } catch (error) {
        ctx.log.debug("payout tick failed", { payout: payout.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (dirty) {
      await finish(ctx, payout, before);
      changed += 1;
    }
  }
  return changed;
}
