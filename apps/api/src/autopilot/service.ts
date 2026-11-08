/**
 * Lyko Autopilot: Lyko signs the owner's own automations inside a leash on
 * the owner's own LykiaAccount, with a Circle developer-controlled wallet as
 * the session key.
 *
 * Turning it on needs three things: the operator's LYKIA_CIRCLE_SERVER_WALLETS
 * (with Circle credentials), the owner's acceptance of the acknowledgement
 * (its digest), and the owner's wallet signing the session once. Until the
 * session lands nothing can be signed.
 *
 * Every step goes through, in order: Autopilot is on (read again right before
 * Circle is asked), the leash and its Pack agent are live, the Whistle is not
 * blown on the account, the leash's own plan (the Fence with the leash's
 * spend, its total, spendable() and the call rules read from the account, a
 * simulation from the Autopilot key), the Autopilot ceilings, and the anomaly
 * guard. Only then is the prepared transaction handed to Circle. Its memo
 * carries the Fence verdict digest; once it lands it is settled through the
 * leash and chain-proven in the leash trail.
 *
 * Stop Autopilot (the Fold, Ask Lyko, the Whistle) sets the record to stopped
 * before anything else, revokes the leash (its Pack agent and key) and returns
 * revokeSession for the owner's wallet.
 */
import {
  AUTOPILOT_ACK_LINES,
  AUTOPILOT_LABEL,
  AUTOPILOT_LIMITS,
  AUTOPILOT_SCHEMA,
  AUTOPILOT_TRUST,
  autopilotAckDigest,
  autopilotBudget,
  autopilotCeiling,
  autopilotFence,
  autopilotLimitIssues,
  autopilotTask,
  checkWatch,
  contractAddress,
  formatUsdMicros,
  getToken,
  guardVerdict,
  isAddress,
  scheduleDue,
  taskSentence,
  tokenAddress,
  usdMicros,
  type Address,
  type ArcEnvironment,
  type AutopilotLimits,
  type AutopilotTask,
  type AutopilotTaskInput,
  type GuardEvent,
  type Leash,
  type LeashDenyReason,
  type WatchFacts,
  type WatchPayload,
} from "@lykia/core";
import type { Autopilot, AutopilotOffer, AutopilotRun, AutopilotView, EnableAutopilotResponse, StopAutopilotResponse } from "@lykia/core/api/autopilot";
import type { LeashPreparedStep } from "@lykia/core/api/leash";
import { decodeFunctionData, erc20Abi, type Hex } from "viem";
import { MULTICALL3_FROM_ABI } from "../engine/abis.js";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { agentServices } from "../agents/index.js";
import { appendMessages, openThread, threadSummaries } from "../agents/memory.js";
import { getInstruction } from "../agents/instructions.js";
import { healthFromPositions } from "../fold/insights.js";
import { ACCOUNT_ABI } from "../leash/chain.js";
import { leashService } from "../leash/service.js";
import { randomHex } from "../platform/crypto.js";
import { revokeKey } from "../platform/keys.js";
import { readPositions } from "../positions/service.js";
import { services } from "../services.js";
import { listAll } from "../store/types.js";
import { CIRCLE_DEAD, circleState, signerFor, signWithCircle } from "./signer.js";
import { AUTOPILOT_TTL_MS, autopilotRuns, autopilots, autopilotSpend, keyOf } from "./store.js";

const iso = (ms: number) => new Date(ms).toISOString();
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const inverted = (ms: number) => String(9_999_999_999_999 - ms).padStart(13, "0");

/** What the tick reads to judge conditions on the LykiaAccount. Tests replace it. */
export type FactsReader = (ctx: AppContext, environment: ArcEnvironment, account: Address, needs: { readonly positions: boolean }) => Promise<WatchFacts>;
const READERS = new WeakMap<AppContext, FactsReader>();
export function setAutopilotFacts(ctx: AppContext, reader: FactsReader | null): void {
  if (reader) READERS.set(ctx, reader);
  else READERS.delete(ctx);
}

/** The account's own facts: its USDC and EURC from balanceOf, and (when a task needs them) health factors and rates from the position map. */
const readFacts: FactsReader = async (ctx, environment, account, needs) => {
  const client = ctx.chains.client(environment) as unknown as { readContract(x: unknown): Promise<unknown> };
  const wallet: Record<string, number> = {};
  for (const symbol of ["USDC", "EURC"]) {
    const token = getToken(symbol);
    const address = token ? tokenAddress(token, environment) : null;
    if (!token || !address) continue;
    const raw = (await client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [account] })) as bigint;
    wallet[symbol] = Number(raw) / 10 ** token.decimals;
  }
  if (!needs.positions) return { health: [], ranges: [], wallet, rates: [] };
  const positions = await readPositions(ctx, environment, account, { personal: false });
  const all = positions.venues.flatMap((v) => v.positions);
  return {
    health: healthFromPositions(positions).map((h) => ({ venue: h.venue, label: h.label, factor: h.healthFactor })),
    ranges: all.filter((p) => p.range).map((p) => ({ venue: p.venue, label: p.label, inRange: p.range!.inRange })),
    wallet,
    rates: all.filter((p) => p.apy && Number(p.valueUsd ?? 0) > 0).map((p) => ({ venue: p.venue, label: p.label, percent: Number(p.apy!.percent) })),
  };
};

/** The account itself, or Arc's Multicall3From batching calls that all go to the account (the key stays msg.sender of each). */
export function onlyAccountCalls(tx: { readonly to: string; readonly data: string }, account: string, environment: ArcEnvironment): boolean {
  if (tx.to.toLowerCase() === account.toLowerCase()) return true;
  if (tx.to.toLowerCase() !== (contractAddress("multicall3From", environment) ?? "").toLowerCase()) return false;
  try {
    const { functionName, args } = decodeFunctionData({ abi: MULTICALL3_FROM_ABI, data: tx.data as Hex });
    const calls = (args?.[0] ?? []) as readonly { target: string }[];
    return functionName === "aggregate3" && calls.length > 0 && calls.every((c) => c.target.toLowerCase() === account.toLowerCase());
  } catch {
    return false;
  }
}

function refusal(code: string, message: string): LeashDenyReason[] {
  return [{ code, message }];
}

export class AutopilotService {
  constructor(private readonly ctx: AppContext) {}

  private now(): number {
    return this.ctx.clock.now();
  }

  private beta(environment: ArcEnvironment) {
    return environment === "mainnet" ? this.ctx.config.beta : null;
  }

  /* ------------------------------------------------------------ records */

  offer(environment: ArcEnvironment): AutopilotOffer {
    const c = this.ctx.config.circle;
    const reason = c.serverWallets !== true ? "This server does not sign with Circle wallets (the operator has not set LYKIA_CIRCLE_SERVER_WALLETS=true)." : !c.apiKey || !c.entitySecret ? "Circle credentials are missing on this server (CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET)." : null;
    return { available: reason === null, reason, ceilings: autopilotCeiling(this.beta(environment)), ack: { lines: AUTOPILOT_ACK_LINES, digest: autopilotAckDigest() }, trust: AUTOPILOT_TRUST };
  }

  async get(owner: string, environment: ArcEnvironment): Promise<Autopilot | null> {
    return (await autopilots(this.ctx).get(keyOf(environment, owner)))?.value ?? null;
  }

  private async put(ap: Autopilot): Promise<Autopilot> {
    const next = { ...ap, updatedAt: iso(this.now()) };
    await autopilots(this.ctx).put(keyOf(ap.environment, ap.owner), next, { ttlMs: AUTOPILOT_TTL_MS });
    return next;
  }

  async runs(owner: string, environment: ArcEnvironment, limit = 30): Promise<AutopilotRun[]> {
    return (await autopilotRuns(this.ctx).list({ prefix: `${keyOf(environment, owner)}:`, limit })).map((d) => d.value);
  }

  private async putRun(ap: Autopilot, run: AutopilotRun, key?: string): Promise<string> {
    const k = key ?? `${keyOf(ap.environment, ap.owner)}:${inverted(Date.parse(run.at))}:${randomHex(3)}`;
    await autopilotRuns(this.ctx).put(k, run, { ttlMs: AUTOPILOT_TTL_MS });
    return k;
  }

  private async spentToday(ap: Autopilot): Promise<bigint> {
    return BigInt(await autopilotSpend(this.ctx).get(`${keyOf(ap.environment, ap.owner)}:${dayKey(this.now())}`));
  }

  async view(owner: string, environment: ArcEnvironment): Promise<AutopilotView> {
    let ap = await this.get(owner, environment);
    if (ap && ap.status === "pending") ap = await this.refresh(ap);
    const leash = ap ? await leashService(this.ctx).get(ap.leashId).then((l) => leashService(this.ctx).view(l)).catch(() => null) : null;
    const spent = ap ? await this.spentToday(ap) : 0n;
    const cap = ap ? usdMicros(ap.limits.perDayUsd) : 0n;
    return { offer: this.offer(environment), autopilot: ap, leash, today: ap ? { spentUsd: formatUsdMicros(spent), leftUsd: formatUsdMicros(cap > spent ? cap - spent : 0n) } : null, runs: await this.runs(owner, environment) };
  }

  private fire(type: "autopilot.signed" | "autopilot.paused" | "autopilot.stopped", ap: Autopilot, data: Record<string, unknown>): void {
    void agentServices(this.ctx)
      .webhooks.emit(type, ap.owner, { environment: ap.environment, leashId: ap.leashId, signer: ap.signer.address, ...data } as never)
      .catch((error: unknown) => this.ctx.log.warn("autopilot webhook failed", { type, error: error instanceof Error ? error.message : String(error) }));
  }

  /** A line in the owner's latest Ask Lyko thread, so a pause or a stop is seen where they talk to Lyko. */
  private async tell(ap: Autopilot, text: string): Promise<void> {
    try {
      const latest = (await threadSummaries(this.ctx, ap.owner, 1))[0]?.id;
      const thread = await openThread(this.ctx, ap.owner, ap.environment, latest ?? undefined, "Autopilot");
      await appendMessages(this.ctx, thread, [{ role: "assistant", text, origin: "fold" }]);
    } catch (error) {
      this.ctx.log.debug("autopilot note failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /* ------------------------------------------------------------ on and off */

  async enable(input: { readonly owner: Address; readonly environment: ArcEnvironment; readonly ack: string; readonly limits: AutopilotLimits; readonly payees?: readonly Address[]; readonly publicBaseUrl: string }): Promise<EnableAutopilotResponse> {
    const ctx = this.ctx;
    const owner = input.owner.toLowerCase() as Address;
    const environment = input.environment;
    // 1. The operator opted in and Circle is configured.
    const c = ctx.config.circle;
    if (c.serverWallets !== true) throw new LykiaHttpError("CIRCLE_SERVER_WALLETS_OFF", 403, "Autopilot is off on this server: the operator has not opted in to Circle server wallets (LYKIA_CIRCLE_SERVER_WALLETS=true).");
    if (!c.apiKey || !c.entitySecret) throw new LykiaHttpError("CIRCLE_NOT_CONFIGURED", 503, "Autopilot needs CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET on this server.");
    // 2. The owner read and accepted the acknowledgement.
    if (input.ack !== autopilotAckDigest()) throw new LykiaHttpError("AUTOPILOT_ACK_REQUIRED", 400, "Read and accept the Autopilot acknowledgement first: send its digest as ack.", { ack: { lines: AUTOPILOT_ACK_LINES, digest: autopilotAckDigest() } });
    const issues = autopilotLimitIssues(input.limits, this.beta(environment));
    const payees = [...new Set((input.payees ?? []).map((p) => p.toLowerCase()))] as Address[];
    if (payees.length > AUTOPILOT_LIMITS.payees) issues.push({ path: "payees", message: `At most ${AUTOPILOT_LIMITS.payees} payees.` });
    if (!payees.every((p) => isAddress(p) && p !== owner)) issues.push({ path: "payees", message: "Payee addresses, not your own (money to you is always allowed)." });
    if (issues.length > 0) throw new LykiaHttpError("INVALID_AUTOPILOT", 400, "These Autopilot limits are not valid.", { issues });
    const existing = await this.get(owner, environment);
    if (existing && existing.status !== "stopped") throw new LykiaHttpError("CONFLICT", 409, `Autopilot is already ${existing.status === "on" ? "on" : existing.status}. Stop it first to change its limits.`);

    // The signer: the owner's own Circle wallet (made once, then reused).
    const signer = await signerFor(ctx, owner, environment);
    // 3. The leash the owner signs once: a session on their LykiaAccount with the Autopilot key.
    const fence = autopilotFence({ environment, limits: input.limits, payees });
    const created = await leashService(ctx).create(
      { via: "session", developer: owner },
      {
        owner,
        environment,
        agent: { name: "Lyko Autopilot", mission: "Signs the owner's own automations inside this leash.", signer: signer.address },
        template: "custom",
        fence,
        budget: autopilotBudget(input.limits),
        expiresAt: iso(this.now() + input.limits.days * 86_400_000),
        ...(payees.length > 0 ? { recipients: payees } : {}),
        maxSlippageBps: 50,
        maxCalls: AUTOPILOT_LIMITS.maxCalls,
        tools: ["plan", "submit", "status"],
        publicBaseUrl: input.publicBaseUrl,
      },
    );
    // Autopilot plans through the service, never through a key: the leash key is switched off at once.
    await revokeKey(ctx, owner, created.leash.key.id).catch(() => undefined);
    const at = iso(this.now());
    const ap: Autopilot = {
      schema: AUTOPILOT_SCHEMA,
      owner,
      environment,
      status: "pending",
      leashId: created.leash.id,
      signer,
      limits: { perStepUsd: input.limits.perStepUsd, perDayUsd: input.limits.perDayUsd, days: input.limits.days },
      payees,
      tasks: (existing?.tasks ?? []).map((t) => ({ ...t, enabled: t.kind !== "pay" || payees.includes(t.sentence.match(/0x[0-9a-f]{40}/u)?.[0] as Address) ? t.enabled : false, met: false })),
      ack: { digest: input.ack, at },
      sign: created.transactions,
      createdAt: at,
      updatedAt: at,
    };
    await this.put(ap);
    return {
      autopilot: ap,
      transactions: created.transactions,
      notes: [
        "Sign the session transaction once from your wallet. Until it lands, Autopilot signs nothing.",
        `The Autopilot key is ${signer.address}, a Circle wallet made for you. It holds no funds; send it about 1 USDC for gas on Arc (Circle's Gas Station sponsors smart-contract wallets only).`,
        "Your money stays in your LykiaAccount. Fund it with what Autopilot may use.",
        `Caps on chain: $${input.limits.perStepUsd} a step, $${input.limits.perDayUsd} a day, $${autopilotBudget(input.limits).totalUsd} in total, for ${input.limits.days} days.`,
      ],
    };
  }

  /** pending -> on once the session is on chain; anything -> stopped once the leash ended. */
  private async refresh(ap: Autopilot): Promise<Autopilot> {
    if (ap.status === "stopped") return ap;
    const leash = await leashService(this.ctx).get(ap.leashId).catch(() => null);
    const bound = leash && leash.status === "pending" ? await leashService(this.ctx).bind(leash).catch(() => leash) : leash;
    if (!bound || bound.status === "revoked" || bound.status === "expired") {
      const next = await this.put({ ...ap, status: "stopped", stopped: { by: "leash", reason: bound?.status === "expired" ? "Its leash expired." : "Its leash was revoked.", at: iso(this.now()) } });
      this.fire("autopilot.stopped", next, { by: "leash", reason: next.stopped!.reason, revokeTransaction: null });
      return next;
    }
    if (ap.status === "pending" && bound.status === "active") {
      const { sign: _signed, ...rest } = ap;
      return this.put({ ...rest, status: "on" });
    }
    return ap;
  }

  /** The kill switch. Server signing stops before anything else happens. */
  async stop(owner: string, environment: ArcEnvironment, by: "owner" | "whistle" | "ask", reason?: string): Promise<StopAutopilotResponse> {
    const ap = await this.get(owner, environment);
    if (!ap) return { autopilot: null, signingStopped: true, transaction: null, note: "Autopilot was not on for this owner." };
    const why = reason ?? (by === "whistle" ? "The Whistle was blown." : "Stopped by the owner.");
    const wasLive = ap.status !== "stopped";
    const { sign: _unsigned, ...rest } = ap;
    const stopped = wasLive ? await this.put({ ...rest, status: "stopped", stopped: { by, reason: why, at: iso(this.now()) } }) : ap;
    const leash = await leashService(this.ctx).get(ap.leashId).catch(() => null);
    const revoked = leash ? await leashService(this.ctx).revoke(leash, `Autopilot stopped: ${why}`).catch(() => null) : null;
    const transaction = revoked?.transaction ?? null;
    if (wasLive) {
      this.fire("autopilot.stopped", stopped, { by, reason: why, revokeTransaction: transaction as never });
      await this.tell(stopped, `Autopilot stopped (${why}) Lyko will not sign anything more.${transaction ? " Sign revokeSession in the Fold to end its session on chain too." : ""}`);
    }
    return {
      autopilot: stopped,
      signingStopped: true,
      transaction,
      note: transaction
        ? "Server signing is off now. Sign revokeSession from your wallet to end the session on chain; a step already handed to Circle before this moment can still land, inside the caps."
        : "Server signing is off now. No session was found on chain, so there is nothing to revoke there yet.",
    };
  }

  async resume(owner: string, environment: ArcEnvironment): Promise<Autopilot> {
    const ap = await this.get(owner, environment);
    if (!ap) throw new LykiaHttpError("NOT_FOUND", 404, "Autopilot is not set up for this owner.");
    if (ap.status !== "paused") throw new LykiaHttpError("CONFLICT", 409, ap.status === "stopped" ? "Autopilot was stopped; turn it on again for a new leash." : `Autopilot is ${ap.status}.`);
    const { paused: _p, ...rest } = ap;
    return this.put({ ...rest, status: "on" });
  }

  async pause(ap: Autopilot, code: "anomaly.denies" | "anomaly.velocity" | "owner", reason: string): Promise<Autopilot> {
    const next = await this.put({ ...ap, status: "paused", paused: { code, reason, at: iso(this.now()) } });
    this.fire("autopilot.paused", next, { code, reason });
    if (code !== "owner") await this.tell(next, `Autopilot paused itself: ${reason} Nothing is signed until you resume it in the Fold.`);
    return next;
  }

  /* ------------------------------------------------------------ tasks */

  async addTask(owner: string, environment: ArcEnvironment, input: AutopilotTaskInput): Promise<Autopilot> {
    const ap = await this.get(owner, environment);
    if (!ap || ap.status === "stopped") throw new LykiaHttpError("CONFLICT", 409, "Turn Autopilot on first.");
    if (ap.tasks.length >= AUTOPILOT_LIMITS.tasks) throw new LykiaHttpError("LIMIT_REACHED", 409, `At most ${AUTOPILOT_LIMITS.tasks} Autopilot tasks.`);
    let request = input;
    if (input.kind === "watch") {
      const watch = await getInstruction(this.ctx, owner as Address, input.watchId);
      if (watch.kind !== "watch" || watch.status === "removed") throw new LykiaHttpError("NOT_FOUND", 404, "No such watch.");
      // The watch's own condition, read from the watch: Autopilot checks it on the LykiaAccount.
      request = { ...input, condition: (watch.payload as WatchPayload).condition };
    }
    const built = autopilotTask(request, { id: `apt_${randomHex(4)}`, now: iso(this.now()), limits: ap.limits, payees: ap.payees });
    if (!built.task) throw new LykiaHttpError("INVALID_AUTOPILOT", 400, "That task is not valid.", { issues: built.issues });
    return this.put({ ...ap, tasks: [...ap.tasks, built.task] });
  }

  async setTask(owner: string, environment: ArcEnvironment, id: string, action: "pause" | "resume" | "remove"): Promise<Autopilot> {
    const ap = await this.get(owner, environment);
    if (!ap || !ap.tasks.some((t) => t.id === id)) throw new LykiaHttpError("NOT_FOUND", 404, "No such Autopilot task.");
    const tasks = action === "remove" ? ap.tasks.filter((t) => t.id !== id) : ap.tasks.map((t) => (t.id === id ? { ...t, enabled: action === "resume" } : t));
    return this.put({ ...ap, tasks });
  }

  private async saveTask(ap: Autopilot, task: AutopilotTask): Promise<Autopilot> {
    const latest = (await this.get(ap.owner, ap.environment)) ?? ap;
    return this.put({ ...latest, tasks: latest.tasks.map((t) => (t.id === task.id ? task : t)) });
  }

  /** "Run now" from the Fold: the same checks as a scheduled run. */
  async runTask(owner: string, environment: ArcEnvironment, id: string): Promise<AutopilotRun> {
    const ap = await this.get(owner, environment);
    const task = ap?.tasks.find((t) => t.id === id);
    if (!ap || !task) throw new LykiaHttpError("NOT_FOUND", 404, "No such Autopilot task.");
    const facts = task.kind === "sweep" ? await this.facts(ap, false).catch(() => null) : null;
    const sentence = taskSentence(task, { idleUsdc: facts?.wallet.USDC ?? 0 });
    const run = sentence ? await this.run(ap, { taskId: task.id, sentence, origin: "owner" }) : await this.refuse(ap, { taskId: task.id, origin: "owner", summary: task.label }, refusal("autopilot.nothing-to-do", "Nothing to move right now."));
    await this.saveTask(ap, { ...task, lastRunAt: run.at, lastResult: run.status === "refused" ? `refused: ${run.reasons?.[0]?.message ?? "outside the leash"}` : run.summary, runs: task.runs + 1 });
    return run;
  }

  /* ------------------------------------------------------------ signing */

  private async guardEvents(ap: Autopilot): Promise<GuardEvent[]> {
    // Refusals that never reached the leash ("Autopilot is off", "nothing to move") are not anomalies.
    const counted = (r: AutopilotRun) => r.status !== "refused" || !(r.reasons ?? []).every((x) => x.code.startsWith("autopilot.off") || x.code === "autopilot.nothing-to-do");
    return (await this.runs(ap.owner, ap.environment, 60)).filter(counted).map((r) => ({ at: Date.parse(r.at), kind: r.status === "refused" ? "refused" : "signed", usd: r.usd ?? null }));
  }

  private async refuse(ap: Autopilot, at: { readonly taskId: string | null; readonly origin: AutopilotRun["origin"]; readonly summary: string; readonly intentId?: string; readonly verdictDigest?: string }, reasons: readonly LeashDenyReason[]): Promise<AutopilotRun> {
    const run: AutopilotRun = { id: `apr_${randomHex(6)}`, at: iso(this.now()), taskId: at.taskId, origin: at.origin, summary: at.summary.slice(0, 200), status: "refused", reasons, ...(at.intentId ? { intentId: at.intentId } : {}), ...(at.verdictDigest ? { verdictDigest: at.verdictDigest } : {}) };
    await this.putRun(ap, run);
    // Repeated refusals pause Autopilot (only refusals that reached the leash count; "not on" does not).
    if (ap.status === "on" && !reasons.every((r) => r.code.startsWith("autopilot.off") || r.code === "autopilot.nothing-to-do")) {
      const verdict = guardVerdict(await this.guardEvents(ap), { now: this.now(), perDayUsd: ap.limits.perDayUsd });
      if (verdict.pause) await this.pause((await this.get(ap.owner, ap.environment)) ?? ap, verdict.code, verdict.reason);
    }
    return run;
  }

  /** Plans `sentence` under the Autopilot leash and, when every check passes, has Circle sign its first step. */
  async run(apIn: Autopilot, input: { readonly taskId: string | null; readonly sentence: string; readonly origin: AutopilotRun["origin"] }): Promise<AutopilotRun> {
    const ctx = this.ctx;
    const ap = await this.refresh(apIn);
    const base = { taskId: input.taskId, origin: input.origin, summary: input.sentence };
    if (ap.status !== "on") return this.refuse(ap, base, refusal("autopilot.off", ap.status === "paused" ? `Autopilot is paused: ${ap.paused?.reason ?? "by the owner"}` : ap.status === "pending" ? "The Autopilot session is not on chain yet: sign it once from your wallet." : "Autopilot is stopped."));
    const leash = await leashService(ctx).get(ap.leashId);
    // The Whistle on the account stops Autopilot for good.
    const account = leash.session?.account;
    const whistle = account ? await ctx.chains.client(ap.environment).readContract({ address: account, abi: ACCOUNT_ABI, functionName: "whistle" }).catch(() => null) : null;
    if (whistle === null) return this.refuse(ap, base, refusal("leash.chain.unreadable", "The LykiaAccount could not be read on Arc, so nothing is signed."));
    if (whistle === true) {
      await this.stop(ap.owner, ap.environment, "whistle", "The Whistle is blown on your LykiaAccount.");
      return this.refuse(ap, base, refusal("autopilot.off.whistle", "The Whistle is blown on your LykiaAccount; Autopilot stopped."));
    }
    const spent = await this.spentToday(ap);
    if (spent >= usdMicros(ap.limits.perDayUsd)) return this.refuse(ap, base, refusal("autopilot.budget.day", `Autopilot already signed $${formatUsdMicros(spent)} of its $${ap.limits.perDayUsd} today.`));
    let plan;
    try {
      plan = await leashService(ctx).plan(leash, { text: input.sentence });
    } catch (error) {
      if (error instanceof LykiaHttpError && error.code === "LEASH_DENIED") {
        const d = error.details as { reasons?: LeashDenyReason[]; verdictDigest?: string | null; intentId?: string | null } | undefined;
        return this.refuse(ap, { ...base, ...(d?.intentId ? { intentId: d.intentId } : {}), ...(d?.verdictDigest ? { verdictDigest: d.verdictDigest } : {}) }, d?.reasons ?? refusal("leash.denied", error.message));
      }
      return this.refuse(ap, base, refusal("autopilot.plan.failed", error instanceof Error ? error.message.slice(0, 200) : "Planning failed."));
    }
    if (!plan.prepared || !plan.intent) return this.refuse(ap, base, refusal("autopilot.nothing-to-do", "The plan has no step ready to sign."));
    const intent = plan.intent;
    const summary = intent.steps.map((s) => s.summary).join("; ").slice(0, 200) || input.sentence;
    const step = intent.steps.find((s) => s.id === plan.prepared!.stepId);
    const usd = step ? step.inputs.reduce<bigint | null>((acc, a) => (acc === null || a.usd === null ? null : acc + usdMicros(a.usd)), 0n) : null;
    return this.signPrepared(ap, leash, plan.prepared, { ...base, summary, usd: usd === null ? null : formatUsdMicros(usd), verdictDigest: intent.verdict.digest });
  }

  /** The last checks on a prepared step, then Circle. */
  private async signPrepared(ap: Autopilot, leash: Leash, prepared: LeashPreparedStep, at: { readonly taskId: string | null; readonly origin: AutopilotRun["origin"]; readonly summary: string; readonly usd: string | null; readonly verdictDigest: string }): Promise<AutopilotRun> {
    const ctx = this.ctx;
    const tx = prepared.transaction;
    const meta = { taskId: at.taskId, origin: at.origin, summary: at.summary, intentId: prepared.intentId, verdictDigest: at.verdictDigest };
    // Only the Autopilot key's own call on the owner's account, with no value attached.
    const session = leash.session;
    if (!session || tx.from.toLowerCase() !== ap.signer.address.toLowerCase() || !onlyAccountCalls(tx, session.account, ap.environment) || BigInt(tx.value) !== 0n || tx.chainId !== session.chainId) return this.refuse(ap, meta, refusal("autopilot.shape", "The prepared step is not a call from the Autopilot key on your LykiaAccount; nothing was signed."));
    if (at.usd === null) return this.refuse(ap, meta, refusal("leash.unpriced", "This step has no USD price, so Autopilot cannot count it."));
    const ceiling = autopilotCeiling(this.beta(ap.environment));
    const stepCap = usdMicros(ap.limits.perStepUsd) < usdMicros(ceiling.perStepUsd) ? ap.limits.perStepUsd : ceiling.perStepUsd;
    if (usdMicros(at.usd) > usdMicros(stepCap)) return this.refuse(ap, meta, refusal("autopilot.budget.step", `$${at.usd} is more than Autopilot's $${stepCap} per step.`));
    const spent = await this.spentToday(ap);
    if (spent + usdMicros(at.usd) > usdMicros(ap.limits.perDayUsd)) return this.refuse(ap, meta, refusal("autopilot.budget.day", `$${at.usd} more would pass Autopilot's $${ap.limits.perDayUsd} today ($${formatUsdMicros(spent)} signed).`));
    const verdict = guardVerdict(await this.guardEvents(ap), { now: this.now(), perDayUsd: ap.limits.perDayUsd, next: { usd: at.usd } });
    if (verdict.pause) {
      await this.pause(ap, verdict.code, verdict.reason);
      const run: AutopilotRun = { id: `apr_${randomHex(6)}`, at: iso(this.now()), ...meta, status: "refused", reasons: refusal(verdict.code, verdict.reason) };
      await this.putRun(ap, run);
      return run;
    }
    // The kill switch wins any race: the record is read again right before Circle is asked.
    const latest = await this.get(ap.owner, ap.environment);
    if (latest?.status !== "on" || latest.leashId !== ap.leashId) return this.refuse(latest ?? ap, meta, refusal("autopilot.off", "Autopilot was stopped or paused a moment ago; nothing was signed."));
    const runId = `apr_${randomHex(6)}`;
    let sent;
    try {
      sent = await signWithCircle(ctx, ap.signer, { to: tx.to, data: tx.data as Hex }, `${runId}:${prepared.stepId}`);
    } catch (error) {
      return this.refuse(ap, meta, refusal("autopilot.circle", error instanceof Error ? `Circle did not sign: ${error.message.slice(0, 160)}` : "Circle did not sign."));
    }
    await autopilotSpend(ctx).increment(`${keyOf(ap.environment, ap.owner)}:${dayKey(this.now())}`, Number(usdMicros(at.usd)), { ttlMs: 2 * 86_400_000 });
    const run: AutopilotRun = { id: runId, at: iso(this.now()), ...meta, stepId: prepared.stepId, status: CIRCLE_DEAD.has(sent.state) ? "failed" : "signing", usd: at.usd, circleTxId: sent.id, label: AUTOPILOT_LABEL };
    await this.putRun(ap, run);
    this.fire("autopilot.signed", ap, { runId, intentId: prepared.intentId, stepId: prepared.stepId, verdictDigest: at.verdictDigest, usd: at.usd, circleTransactionId: sent.id, memo: prepared.memo, label: AUTOPILOT_LABEL });
    return run;
  }

  /** Follows what Circle sent: the hash goes to the leash's submit, which settles it from the receipt and proves it from the memo. */
  async poll(ap: Autopilot): Promise<number> {
    const ctx = this.ctx;
    let settled = 0;
    const open = (await autopilotRuns(ctx).list({ prefix: `${keyOf(ap.environment, ap.owner)}:`, limit: 60 })).filter((d) => (d.value.status === "signing" || d.value.status === "sent") && d.value.circleTxId);
    if (open.length === 0) return 0;
    const leash = await leashService(ctx).get(ap.leashId).catch(() => null);
    for (const doc of open) {
      const run = doc.value;
      const state = await circleState(ctx, run.circleTxId!).catch(() => ({ state: "UNKNOWN", txHash: null }));
      if (CIRCLE_DEAD.has(state.state)) {
        await autopilotRuns(ctx).put(doc.id, { ...run, status: "failed", summary: `${run.summary} (Circle: ${state.state.toLowerCase()})`.slice(0, 200) }, { ttlMs: AUTOPILOT_TTL_MS });
        continue;
      }
      if (!state.txHash || !/^0x[0-9a-f]{64}$/iu.test(state.txHash) || !leash || !run.intentId || !run.stepId) continue;
      const hash = state.txHash.toLowerCase() as `0x${string}`;
      try {
        const r = await leashService(ctx).submit(leash, { intentId: run.intentId, stepId: run.stepId, hash });
        const status: AutopilotRun["status"] = r.status === "settled" ? "settled" : r.status === "failed" ? "failed" : "sent";
        await autopilotRuns(ctx).put(doc.id, { ...run, status, txHash: hash, chainProven: r.chainProven }, { ttlMs: AUTOPILOT_TTL_MS });
        if (status === "settled") settled += 1;
        // A plan with more steps: the next one comes back prepared and goes through the same last checks.
        if (r.next) {
          const intent = await services(ctx).intents.get(r.next.intentId).then((x) => x.intent).catch(() => null);
          const step = intent?.steps.find((s) => s.id === r.next!.stepId);
          const usd = step ? step.inputs.reduce<bigint | null>((acc, a) => (acc === null || a.usd === null ? null : acc + usdMicros(a.usd)), 0n) : null;
          const current = (await this.get(ap.owner, ap.environment)) ?? ap;
          await this.signPrepared(current, leash, r.next, { taskId: run.taskId, origin: run.origin, summary: step?.summary ?? run.summary, usd: usd === null ? null : formatUsdMicros(usd), verdictDigest: intent?.verdict.digest ?? run.verdictDigest ?? "" });
        }
      } catch (error) {
        // The leash ended after Circle sent it: keep the hash; the leash trail still shows it.
        await autopilotRuns(ctx).put(doc.id, { ...run, status: "sent", txHash: hash }, { ttlMs: AUTOPILOT_TTL_MS });
        ctx.log.debug("autopilot submit failed", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return settled;
  }

  private async facts(ap: Autopilot, positions: boolean): Promise<WatchFacts> {
    const leash = await leashService(this.ctx).get(ap.leashId);
    if (!leash.session) throw new Error("no session");
    return (READERS.get(this.ctx) ?? readFacts)(this.ctx, ap.environment, leash.session.account, { positions });
  }

  /** One owner's due tasks. Conditions are read on the LykiaAccount, where Autopilot's money and positions are. */
  async runDue(apIn: Autopilot): Promise<number> {
    let ap = apIn;
    const now = this.now();
    let facts: WatchFacts | null = null;
    let ran = 0;
    for (const task of ap.tasks) {
      if (!task.enabled) continue;
      ap = (await this.get(ap.owner, ap.environment)) ?? ap;
      if (ap.status !== "on") break;
      let due: boolean;
      let next: AutopilotTask = task;
      if (task.when.kind === "schedule") due = scheduleDue(task, now);
      else {
        if (task.when.watchId) {
          const watch = await getInstruction(this.ctx, ap.owner, task.when.watchId).catch(() => null);
          if (!watch || watch.status !== "active") continue;
        }
        const needs = task.when.condition.kind !== "idle-above";
        try {
          facts ??= await this.facts(ap, needs);
          if (needs && facts.health.length === 0 && facts.rates.length === 0 && facts.ranges.length === 0) facts = await this.facts(ap, true);
        } catch {
          continue;
        }
        const check = checkWatch(task.when.condition, facts);
        due = check.met && task.met !== true;
        next = { ...task, met: check.met };
        if (!due && next.met !== task.met) await this.saveTask(ap, next);
      }
      if (!due) continue;
      const sentence = taskSentence(task, { idleUsdc: facts?.wallet.USDC ?? 0 });
      const run = sentence ? await this.run(ap, { taskId: task.id, sentence, origin: task.kind === "watch" ? "watch" : "task" }) : null;
      await this.saveTask(ap, { ...next, lastRunAt: iso(now), lastResult: run ? (run.status === "refused" ? `refused: ${run.reasons?.[0]?.message ?? "outside the leash"}` : run.summary) : "nothing to move", runs: task.runs + (run ? 1 : 0) });
      if (run && run.status !== "refused") ran += 1;
    }
    return ran;
  }

  /** The background pass (the scheduler's flow tick): bind, follow Circle, run what is due. */
  async tick(): Promise<{ checked: number; ran: number; settled: number }> {
    let checked = 0;
    let ran = 0;
    let settled = 0;
    for (const doc of await listAll(autopilots(this.ctx))) {
      let ap = doc.value;
      if (ap.status === "stopped") continue;
      checked += 1;
      try {
        ap = await this.refresh(ap);
        settled += await this.poll(ap);
        if (ap.status === "on") ran += await this.runDue(ap);
      } catch (error) {
        this.ctx.log.debug("autopilot tick failed", { owner: ap.owner, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { checked, ran, settled };
  }
}

const SERVICES = new WeakMap<AppContext, AutopilotService>();
export function autopilotService(ctx: AppContext): AutopilotService {
  let s = SERVICES.get(ctx);
  if (!s) {
    s = new AutopilotService(ctx);
    SERVICES.set(ctx, s);
  }
  return s;
}
