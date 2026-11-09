/**
 * Leashes: one call that gives an outside agent a budget it cannot exceed.
 *
 * Creating one makes a Pack agent whose Fence sits inside its parent's (a
 * Pack agent, or for a root leash the template's ceiling and the mainnet
 * beta cap), carves its daily budget out of the parent's (a Pack agent's
 * caps, or for a root leash the owner's own Fence), builds the unsigned
 * LykiaAccount session the owner (or the parent agent's session key) signs
 * once, and issues a key that works for this leash only.
 *
 * Every leashed plan goes through the Fence with the leash's own spend, is
 * checked against the leash's total and against `spendable()` on chain
 * (authoritative), and its first step is wrapped into the session calls the
 * agent signs (agentTransfer / agentExecute) and simulated on Arc. A plan
 * outside the leash is refused with machine-readable reasons and what is
 * left. Fail closed: when the chain cannot be read, nothing is prepared.
 *
 * A Gateway leash (`spendFrom: "gateway"`) keeps these endpoints and this
 * record but spends from the owner's Circle Gateway balance through the
 * owner's LykiaStile; its half lives in ./gateway.ts.
 */
import { ownerFence as ownerFenceStored } from "../personal/fence.js";
import { LEASH_ENFORCEMENT, LEASH_GATEWAY_ENFORCEMENT, LEASH_LIMITS, LEASH_SCHEMA, LEASH_REQUIRED_TOOLS, LEASH_TOOLS, PROTOCOLS, budgetOf, carveBudget, crossedThresholds, expiryIssues, fenceHash, formatUsdMicros, getToken, intersectFence, leashCarve, leashCeiling, leashFence, leashWindow, memoData, networkFor, projectFence, subFenceViolations, tightenFence, tokenAddress, usdMicros, verdictTag, type Address, type ArcEnvironment, type Fence, type IntentGraph, type Leash, type LeashBudget, type LeashDenyReason, type LeashSession, type LeashSpendFrom, type LeashTemplateKey, type LeashTool, type LeashUsage, type PackAgent, type PackBudget, type PlanAction, type Project, type UnsignedTransaction } from "@lykia/core";
import type { CreateLeashResponse, LeashDenied, LeashPlanResponse, LeashPreparedStep, LeashSubmitResponse, LeashTrailItem, LeashTrailResponse, LeashView, RenewLeashResponse, RevokeLeashResponse } from "@lykia/core/api/leash";
import type { Hex } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { agentServices } from "../agents/index.js";
import { buildSessionTx, callRulesFor, lykiaAccountFor, sessionCalldata, usdToUnits, type SessionSpec } from "../agents/onchain.js";
import { readSentence } from "../language/reader.js";
import { randomHex } from "../platform/crypto.js";
import { createKey, revokeKey } from "../platform/keys.js";
import { services } from "../services.js";
import { listAll } from "../store/types.js";
import { ACCOUNT_ABI, agentEvents, accountError, fenceBytes32, findSession, memoMatches, readSession, readSessionNonce, recentAgentLogs, revokeTransaction, sessionFromLogs, sessionTransaction, WrapError, wrapForSession, type SessionState } from "./chain.js";
import { LEASH_RECORD_TTL_MS, leashActions, leashes, leashMarks, leashOwners, leashSpend, leashSteps, type LeashAction, type LeashStep } from "./store.js";
import { gatewayBind, gatewayCreate, gatewayCreateNotes, gatewayCreateResponse, gatewayPlan, gatewayPreflight, gatewayRevokeTransactions, gatewaySubmit, gatewayTrail, gatewayUsage, type GatewayCreatePlan, type LeashHost } from "./gateway.js";

export interface LeashCaller {
  readonly via: "session" | "secret";
  readonly developer: string;
  readonly projectId?: string;
  readonly project?: Project | null;
}

export interface CreateLeashInput {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly agent?: { readonly name: string; readonly mission?: string; readonly signer: Address };
  readonly parentAgentId?: string;
  readonly name?: string;
  readonly signer?: Address;
  readonly template: LeashTemplateKey;
  readonly fence?: Fence;
  readonly budget: LeashBudget;
  readonly expiresAt: string;
  readonly venues?: readonly string[];
  readonly recipients?: readonly Address[];
  readonly maxSlippageBps?: number;
  readonly tools?: readonly LeashTool[];
  readonly maxCalls?: number;
  readonly tag?: boolean;
  readonly publicBaseUrl: string;
  /** Renewal: the leash whose allocation the new carve replaces. */
  readonly releasing?: Leash;
  /** Absent = "arc". */
  readonly spendFrom?: LeashSpendFrom;
  /** Gateway leashes: destination chain keys. */
  readonly destinations?: readonly string[];
  /** Gateway leashes: Gateway's per-intent fee the session allows (USD). */
  readonly maxGatewayFeeUsd?: string;
}

const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString();
const inverted = (ms: number) => String(9_999_999_999_999 - ms).padStart(13, "0");

function denied(leash: Leash, reasons: readonly LeashDenyReason[], remaining: LeashDenied["remaining"], extra: { verdictDigest?: string | null; intentId?: string | null } = {}): LykiaHttpError {
  const details: LeashDenied = { leashId: leash.id, reasons, remaining, verdictDigest: extra.verdictDigest ?? null, intentId: extra.intentId ?? null };
  return new LykiaHttpError("LEASH_DENIED", 422, reasons.map((r) => r.message).join(" ") || "Outside this leash.", details as never);
}

export class LeashService implements LeashHost {
  constructor(private readonly ctx: AppContext) {}

  now(): number {
    return this.ctx.clock.now();
  }

  private chainId(environment: ArcEnvironment): number {
    return networkFor(environment).chainId;
  }

  /* ------------------------------------------------------------ records */

  async get(id: string): Promise<Leash> {
    const doc = /^lsh_[a-f0-9]{12}$/u.test(id) ? await leashes(this.ctx).get(id) : null;
    if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No such leash.");
    return this.expireIfDue(doc.value);
  }

  async put(leash: Leash): Promise<Leash> {
    await leashes(this.ctx).put(leash.id, leash, { ttlMs: LEASH_RECORD_TTL_MS });
    await leashOwners(this.ctx).put(`${leash.owner}:${leash.id}`, { id: leash.id }, { ttlMs: LEASH_RECORD_TTL_MS });
    return leash;
  }

  async ownedBy(owner: string, environment?: ArcEnvironment): Promise<Leash[]> {
    const index = await leashOwners(this.ctx).list({ prefix: `${owner.toLowerCase()}:`, limit: 1000 });
    const out: Leash[] = [];
    for (const entry of index) {
      const doc = await leashes(this.ctx).get(entry.value.id);
      if (doc && (!environment || doc.value.environment === environment)) out.push(await this.expireIfDue(doc.value));
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async action(leash: Leash, action: Omit<LeashAction, "at">): Promise<void> {
    const at = this.now();
    await leashActions(this.ctx).put(`${leash.id}:${inverted(at)}:${randomHex(3)}`, { at: iso(at), ...action }, { ttlMs: LEASH_RECORD_TTL_MS });
  }

  async actions(leash: Leash, limit = 100): Promise<LeashAction[]> {
    return (await leashActions(this.ctx).list({ prefix: `${leash.id}:`, limit })).map((d) => d.value);
  }

  fire(type: string, leash: Leash, data: Record<string, unknown>): void {
    void agentServices(this.ctx)
      .webhooks.emit(type, leash.owner, { leashId: leash.id, agentId: leash.agentId, environment: leash.environment, ...data } as never)
      .catch((error: unknown) => this.ctx.log.warn("leash webhook failed", { type, error: error instanceof Error ? error.message : String(error) }));
  }

  /** Once per key: true the first time. */
  private async markOnce(key: string, ttlMs: number): Promise<boolean> {
    return (await leashMarks(this.ctx).compareAndSet(key, null, { at: this.now() }, { ttlMs })) !== null;
  }

  /* ------------------------------------------------------------ lifecycle */

  /** Past its expiry: the key stops, the Pack agent is revoked and its carve returns to the parent. */
  private async expireIfDue(leash: Leash): Promise<Leash> {
    if ((leash.status !== "pending" && leash.status !== "active") || Date.parse(leash.expiresAt) > this.now()) return leash;
    const next: Leash = { ...leash, status: "expired", revokedAt: iso(this.now()), revokedReason: "Expired." };
    await this.put(next);
    await this.release(next);
    return next;
  }

  /** Frees what a leash holds: its Pack agent (and the carve), and its key. */
  private async release(leash: Leash): Promise<void> {
    const pack = agentServices(this.ctx).pack;
    await pack.revoke(leash.agentId, leash.owner).catch(() => []);
    await revokeKey(this.ctx, leash.owner, leash.key.id).catch(() => undefined);
  }

  /** Expiry sweep and the 24-hour warning (the scheduler runs it). */
  async tick(): Promise<{ expired: number; warned: number }> {
    let expired = 0;
    let warned = 0;
    const now = this.now();
    for (const doc of await listAll(leashes(this.ctx))) {
      const leash = doc.value;
      if (leash.status !== "pending" && leash.status !== "active") continue;
      const at = Date.parse(leash.expiresAt);
      if (at <= now) {
        await this.expireIfDue(leash);
        expired += 1;
      } else if (at - now <= 86_400_000 && (await this.markOnce(`${leash.id}:expiring`, 2 * 86_400_000))) {
        this.fire("leash.expiring", leash, { expiresAt: leash.expiresAt, hoursLeft: Math.max(0, Math.round((at - now) / 3_600_000)) });
        warned += 1;
      }
    }
    return { expired, warned };
  }

  /* ------------------------------------------------------------ create */

  async create(caller: LeashCaller, input: CreateLeashInput): Promise<CreateLeashResponse> {
    const ctx = this.ctx;
    const owner = input.owner.toLowerCase() as Address;
    const environment = input.environment;
    const issues = [...expiryIssues(input.expiresAt, this.now())];
    const active = (await this.ownedBy(owner)).filter((l) => (l.status === "pending" || l.status === "active") && l.id !== input.releasing?.id);
    if (active.length >= LEASH_LIMITS.perOwner) throw new LykiaHttpError("LIMIT_REACHED", 409, `At most ${LEASH_LIMITS.perOwner} live leashes per owner; revoke one first.`);
    const pack = agentServices(ctx).pack;
    const gateway = input.spendFrom === "gateway";
    const preflight = gateway ? gatewayPreflight(ctx, { environment, ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}), ...(input.destinations ? { destinations: input.destinations } : {}), ...(input.maxGatewayFeeUsd !== undefined ? { maxGatewayFeeUsd: input.maxGatewayFeeUsd } : {}) }) : null;

    // Who the leash is for: a new root agent, or a sub-agent of a Pack agent.
    const parent: PackAgent | null = input.parentAgentId ? await pack.get(input.parentAgentId) : null;
    if (parent && parent.owner !== owner) throw new LykiaHttpError("FORBIDDEN", 403, "That Pack agent belongs to another owner.");
    if (parent && parent.status !== "active") throw new LykiaHttpError("CONFLICT", 409, `${parent.name} is ${parent.status}; it cannot carve a leash.`);
    if (parent && parent.environment !== environment) throw new LykiaHttpError("INVALID_REQUEST", 400, `${parent.name} lives on ${parent.environment}.`);
    const name = (input.agent?.name ?? input.name ?? "").trim();
    const signer = (input.agent?.signer ?? input.signer)?.toLowerCase() as Address | undefined;
    if (!name || name.length > LEASH_LIMITS.nameLength) issues.push({ path: "agent.name", message: `A name of 1 to ${LEASH_LIMITS.nameLength} characters.` });
    if (!signer) issues.push({ path: "agent.signer", message: "The address of the agent's own key: it becomes the LykiaAccount session key. Lykia never sees the private key." });
    else if (signer === owner || /^0x0{40}$/u.test(signer)) issues.push({ path: "agent.signer", message: "The session key must be the agent's own address, not the owner's and not zero." });

    // Limits: the template narrowed by the caller, then kept inside the parent.
    const requested = leashFence({ template: input.template, name: name || "agent", environment, budget: input.budget, ...(input.venues ? { venues: input.venues } : {}), ...(input.recipients ? { recipients: input.recipients } : {}), ...(input.maxSlippageBps !== undefined ? { maxSlippageBps: input.maxSlippageBps } : {}), ...(input.fence ? { fence: input.fence } : {}), ...(gateway ? { spendFrom: "gateway" as const } : {}) });
    issues.push(...requested.issues);
    if (issues.length > 0 || !requested.fence) throw new LykiaHttpError("INVALID_LEASH", 400, "The leash is not valid.", { issues: issues.slice(0, 20) });
    let ceiling: Fence = parent ? parent.fence : leashCeiling({ template: input.template, environment, ...(input.recipients ? { recipients: input.recipients } : {}), beta: ctx.config.beta, ...(input.fence ? { fence: input.fence } : {}), ...(gateway ? { spendFrom: "gateway" as const } : {}) });
    if (!parent && caller.project) ceiling = tightenFence(ceiling, caller.project);
    const fence: Fence = { ...intersectFence(ceiling, requested.fence, requested.fence.label), signers: ["agent"] };
    const violations = subFenceViolations(ceiling, fence);
    // The intersection never lowers the asked budget silently: a parent's tighter cap is an error to fix.
    for (const [key, asked] of [["perStepUsd", input.budget.perStepUsd], ["dailyUsd", input.budget.perDayUsd]] as const) {
      const got = fence.caps?.[key];
      if (got !== undefined && usdMicros(got) < usdMicros(asked)) violations.push({ path: `caps.${key}`, message: `${parent ? `${parent.name}'s Fence` : environment === "mainnet" && ctx.config.beta ? "The mainnet beta cap" : "The ceiling"} allows at most $${got}; ask for that or less.` });
    }
    if (fence.venues?.allow && fence.venues.allow.length === 0) violations.push({ path: "venues.allow", message: "No venue is left after the parent's Fence: this leash could do nothing." });
    if (requested.fence.recipients?.mode === "allowlist" && (fence.recipients?.allow ?? []).length === 0) violations.push({ path: "recipients.allow", message: "None of these payees is allowed by the parent's Fence: this leash could pay no one." });
    if (fence.kinds?.allow && fence.kinds.allow.length === 0) violations.push({ path: "kinds.allow", message: "No step kind is left after the parent's Fence: this leash could do nothing." });
    if (violations.length > 0) throw new LykiaHttpError("SUB_FENCE_VIOLATION", 422, "A leash's Fence must sit inside its parent's.", { violations: violations.slice(0, 20) });
    const hash = fenceHash(fence);

    // The budget is carved from the parent: a Pack agent's caps, or for a root leash the owner's own Fence.
    if (!parent) {
      const ownerFence = caller.project ? projectFence(caller.project) : await ownerFenceStored(ctx, owner as Address);
      const own = budgetOf(ownerFence);
      const caps: PackBudget = { ...(own.perIntentUsd ? { perIntentUsd: own.perIntentUsd } : {}), ...(own.dailyUsd ? { dailyUsd: own.dailyUsd } : {}) };
      const allocated = active.filter((l) => l.parentAgentId === null && l.environment === environment).reduce<PackBudget>((sum, l) => ({ dailyUsd: formatUsdMicros(usdMicros(sum.dailyUsd ?? "0") + usdMicros(l.budget.perDayUsd)) }), {});
      const carve = carveBudget({ caps, allocated }, leashCarve(input.budget));
      if (!carve.ok) throw new LykiaHttpError("BUDGET_EXCEEDED", 422, "Your Fence does not have that much daily budget free for leashes.", { violations: carve.violations, free: carve.remaining });
    }
    if (gateway && preflight) return this.createGateway(caller, input, { owner, name, signer: signer as Address, fence, hash, active, destinations: preflight.destinations });

    // The on-chain half: the owner's LykiaAccount (or the parent's), the session spec and its transaction.
    let account: Address;
    let accountTx: UnsignedTransaction | null = null;
    if (parent?.session) account = parent.session.account;
    else {
      const info = await lykiaAccountFor(ctx, owner, environment);
      if (!info) throw new LykiaHttpError("NOT_AVAILABLE", 409, `LykiaAccountFactory is not deployed on Arc ${environment}; a leash needs it.`);
      account = info.address;
      accountTx = info.transaction;
    }
    if (parent?.session && !parent.signer) throw new LykiaHttpError("CONFLICT", 409, `${parent.name} has a session but no signer address; its key would sign the sub-session.`);
    const nonce = await readSessionNonce(ctx, environment, account).catch(() => {
      throw new LykiaHttpError("CHAIN_UNAVAILABLE", 503, "Arc could not be read; no leash was made. Try again.");
    });

    // The Pack agent: carved and checked by the Pack service.
    const capabilities = ["read", "propose"] as const;
    const agent = parent
      ? await pack.spawn(parent.id, { name, role: "custom", fence, ...(input.agent?.mission ? { mission: input.agent.mission } : {}), signer: signer as Address, capabilities, ...(input.releasing?.parentAgentId === parent.id ? { releasing: input.releasing.agentId } : {}) })
      : await pack.create({ owner, environment, name, role: "custom", fence, ...(input.agent?.mission ? { mission: input.agent.mission } : {}), signer: signer as Address, capabilities });

    const days = Math.max(1, Math.ceil((Date.parse(input.expiresAt) - this.now()) / 86_400_000));
    const built = await buildSessionTx(ctx, { agent, parent, account, key: signer as Address, validDays: days, maxCalls: input.maxCalls ?? LEASH_LIMITS.defaultMaxCalls, calls: callRulesFor({ fence }, environment) }, environment).catch(async (error: unknown) => {
      await pack.revoke(agent.id, owner).catch(() => []);
      throw error;
    });
    const spec = await this.leashSpec(built.spec, input.budget, input.expiresAt, environment);
    if (spec.tokens.length === 0) {
      await pack.revoke(agent.id, owner).catch(() => []);
      throw new LykiaHttpError("UNPRICED", 503, "No reference price for the leash's tokens, so the on-chain caps cannot be set. Nothing was made; try again shortly.");
    }
    const sub = Boolean(parent?.session);
    if (sub) {
      // The account refuses a sub-session outside its parent; say so before the parent key signs a transaction that would revert.
      const parentSession = await ctx.chains
        .client(environment)
        .readContract({ address: account, abi: ACCOUNT_ABI, functionName: "getSession", args: [parent!.session!.sessionId as Hex] })
        .catch(() => null) as { key: Address; validUntil: bigint; maxCalls: number; callsUsed: number; revoked: boolean } | null;
      const problems: string[] = [];
      if (!parentSession) problems.push("Its session could not be read on Arc.");
      else {
        if (parentSession.revoked || parentSession.key.toLowerCase() !== parent!.signer!.toLowerCase()) problems.push("Its session is revoked or held by another key.");
        if (spec.validUntil > BigInt(parentSession.validUntil)) problems.push(`Its session ends ${new Date(Number(parentSession.validUntil) * 1000).toISOString()}; the leash cannot outlive it.`);
        if (spec.maxCalls > Number(parentSession.maxCalls) - Number(parentSession.callsUsed)) problems.push(`Its session has ${Number(parentSession.maxCalls) - Number(parentSession.callsUsed)} calls left; ask for at most that many (maxCalls).`);
      }
      if (problems.length > 0) {
        await pack.revoke(agent.id, owner).catch(() => []);
        throw new LykiaHttpError("SUB_FENCE_VIOLATION", 422, `${parent!.name}'s on-chain session cannot hold this leash. ${problems.join(" ")}`, { violations: problems.map((message) => ({ path: "session", message })) });
      }
    }
    const sessionTx: UnsignedTransaction = { ...built.transaction, data: sessionCalldata(spec, sub ? (parent!.session!.sessionId as Hex) : undefined), label: sub ? `Create ${name}'s leash under ${parent!.name}'s session` : `Create ${name}'s leash on your LykiaAccount` };

    const id = `lsh_${randomHex(6)}`;
    let key;
    try {
      key = await createKey(ctx, { owner, label: `Leash · ${name}`.slice(0, 64), kind: "secret", mode: environment === "testnet" ? "test" : "live", leashId: id, scopes: ["read", "build", "execute"], perMinute: 60, perDay: 5_000 });
    } catch (error) {
      await pack.revoke(agent.id, owner).catch(() => []);
      throw error;
    }
    const tools = [...new Set([...LEASH_REQUIRED_TOOLS, ...(input.tools ?? LEASH_TOOLS)])].filter((t) => LEASH_TOOLS.includes(t));
    const session: LeashSession = {
      account,
      sessionId: null,
      key: signer as Address,
      parentSessionId: sub ? (parent!.session!.sessionId as Hex) : null,
      signer: sub ? "parent-session" : "owner",
      from: sessionTx.from,
      chainId: this.chainId(environment),
      validUntil: Number(spec.validUntil),
      maxCalls: spec.maxCalls,
      nonceAtCreation: nonce.toString(),
      tokens: spec.tokens.map((t) => t.token.toLowerCase() as Address),
    };
    let tag: CreateLeashResponse["tag"] = null;
    if (input.tag) {
      const drafted = await services(ctx).tags.draft({ environment, owner, agentWallet: signer as Address, name, description: `${name}: an agent on a Lykia leash (${input.template}), $${input.budget.perDayUsd} a day until ${input.expiresAt.slice(0, 10)}.`, fence, publicBaseUrl: input.publicBaseUrl });
      tag = { transaction: drafted.transaction, cardDigest: drafted.cardDigest, agentURI: drafted.agentURI };
    }
    const leash: Leash = {
      schema: LEASH_SCHEMA,
      id,
      owner,
      environment,
      agentId: agent.id,
      agentName: name,
      ...(input.agent?.mission ? { mission: input.agent.mission } : {}),
      parentAgentId: parent?.id ?? null,
      template: input.template,
      fence,
      fenceHash: hash,
      budget: input.budget,
      expiresAt: new Date(Date.parse(input.expiresAt)).toISOString(),
      tools,
      venues: fence.venues?.allow ?? null,
      recipients: (fence.recipients?.allow ?? []).map((r) => r.toLowerCase() as Address),
      status: "pending",
      session,
      tag: tag ? { cardDigest: tag.cardDigest } : null,
      key: { id: key.id, prefix: key.prefix },
      createdBy: { via: caller.via, developer: caller.developer, ...(caller.projectId ? { projectId: caller.projectId } : {}) },
      ...(input.releasing ? { renewedFrom: input.releasing.id } : {}),
      createdAt: iso(this.now()),
    };
    await this.put(leash);
    const transactions = [...(accountTx ? [accountTx] : []), sessionTx];
    const notes = [
      sub ? `${parent!.name}'s session key signs the session transaction (createSubSession); the account refuses a sub-session outside its parent.` : "Your wallet signs the session transaction once (createSession on your LykiaAccount).",
      accountTx ? "Your LykiaAccount does not exist yet: the first transaction creates it." : "",
      "Fund the LykiaAccount with what the agent may spend; the agent's own key needs a little USDC for gas on Arc.",
      "Caps on chain are token units (USDC 1:1, EURC at today's reference rate). Dollar caps, venues and slippage are checked by the API.",
      fence.confirm?.when && fence.confirm.when.length > 0 ? `The parent's Fence asks the owner to confirm ${fence.confirm.when.join(", ")}: plans that hit those wait for you.` : "",
    ].filter(Boolean);
    const view = await this.view(leash);
    return {
      leash: view,
      transactions,
      session: { signer: session.signer, from: session.from, account, spec: JSON.parse(JSON.stringify(spec, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))), note: built.note },
      apiKey: { id: key.id, secret: key.secret, prefix: key.prefix },
      mcp: { mcpServers: { [`lykia-leash-${name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "agent"}`]: { url: `${input.publicBaseUrl.replace(/\/$/u, "")}/v1/mcp`, headers: { "Lykia-Key": key.secret } } } },
      stile: null,
      tag,
      enforcement: LEASH_ENFORCEMENT,
      notes,
    };
  }

  /** The Gateway half of create: the owner's LykiaStile, the delegation and the session; the same Pack agent, key and record. */
  private async createGateway(caller: LeashCaller, input: CreateLeashInput, at: { readonly owner: Address; readonly name: string; readonly signer: Address; readonly fence: Fence; readonly hash: ReturnType<typeof fenceHash>; readonly active: readonly Leash[]; readonly destinations: readonly { key: string; name: string; domain: number }[] }): Promise<CreateLeashResponse> {
    const ctx = this.ctx;
    const { owner, name, signer, fence, hash } = at;
    const environment = input.environment;
    const recipients = (fence.recipients?.allow ?? []).map((r) => r.toLowerCase() as Address);
    const plan: GatewayCreatePlan = await gatewayCreate(ctx, { owner, environment, key: signer, name, fenceHash: hash, budget: input.budget, expiresAt: input.expiresAt, recipients, destinations: at.destinations, ...(input.maxGatewayFeeUsd !== undefined ? { maxGatewayFeeUsd: input.maxGatewayFeeUsd } : {}) });
    const pack = agentServices(ctx).pack;
    const agent = await pack.create({ owner, environment, name, role: "custom", fence, ...(input.agent?.mission ? { mission: input.agent.mission } : {}), signer, capabilities: ["read", "propose"] });
    const id = `lsh_${randomHex(6)}`;
    let key;
    try {
      key = await createKey(ctx, { owner, label: `Leash · ${name}`.slice(0, 64), kind: "secret", mode: environment === "testnet" ? "test" : "live", leashId: id, scopes: ["read", "build", "execute"], perMinute: 60, perDay: 5_000 });
    } catch (error) {
      await pack.revoke(agent.id, owner).catch(() => []);
      throw error;
    }
    const tools = [...new Set([...LEASH_REQUIRED_TOOLS, ...(input.tools ?? LEASH_TOOLS)])].filter((t) => LEASH_TOOLS.includes(t) && t !== "venues" && t !== "scent");
    const leash: Leash = {
      schema: LEASH_SCHEMA,
      id,
      owner,
      environment,
      agentId: agent.id,
      agentName: name,
      ...(input.agent?.mission ? { mission: input.agent.mission } : {}),
      parentAgentId: null,
      template: input.template,
      fence,
      fenceHash: hash,
      budget: input.budget,
      expiresAt: new Date(Date.parse(input.expiresAt)).toISOString(),
      tools,
      venues: fence.venues?.allow ?? null,
      recipients,
      status: "pending",
      session: null,
      spendFrom: "gateway",
      stile: plan.stile,
      tag: null,
      key: { id: key.id, prefix: key.prefix },
      createdBy: { via: caller.via, developer: caller.developer, ...(caller.projectId ? { projectId: caller.projectId } : {}) },
      ...(input.releasing ? { renewedFrom: input.releasing.id } : {}),
      createdAt: iso(this.now()),
    };
    await this.put(leash);
    return {
      leash: await this.view(leash),
      transactions: plan.transactions,
      session: null,
      stile: gatewayCreateResponse(plan),
      apiKey: { id: key.id, secret: key.secret, prefix: key.prefix },
      mcp: { mcpServers: { [`lykia-leash-${name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "agent"}`]: { url: `${input.publicBaseUrl.replace(/\/$/u, "")}/v1/mcp`, headers: { "Lykia-Key": key.secret } } } },
      tag: null,
      enforcement: LEASH_GATEWAY_ENFORCEMENT,
      notes: gatewayCreateNotes(plan),
    };
  }

  /** The session spec with the leash's own budget: per call = per step, daily, lifetime = total, in token units. */
  private async leashSpec(base: SessionSpec, budget: LeashBudget, expiresAt: string, environment: ArcEnvironment): Promise<SessionSpec> {
    const prices = await services(this.ctx).prices.prices(["USDC", "EURC"]);
    const tokens = base.tokens.flatMap((t) => {
      const token = ["USDC", "EURC"].map((s) => getToken(s)!).find((x) => tokenAddress(x, environment)?.toLowerCase() === t.token.toLowerCase());
      const price = token ? Number(prices[token.symbol]?.usd ?? (token.symbol === "USDC" ? "1" : "NaN")) : NaN;
      if (!token || !Number.isFinite(price) || price <= 0) return [];
      return [{ token: t.token, perCall: usdToUnits(budget.perStepUsd, token.decimals, price), daily: usdToUnits(budget.perDayUsd, token.decimals, price), budget: usdToUnits(budget.totalUsd, token.decimals, price) }];
    });
    return { ...base, validUntil: BigInt(Math.floor(Date.parse(expiresAt) / 1000)), tokens };
  }

  /* ------------------------------------------------------------ session binding */

  /** Binds the session once its transaction landed: from the receipt, or by checking the ids issued since the leash was made. */
  async bind(leash: Leash, txHash?: `0x${string}`): Promise<Leash> {
    if (leash.spendFrom === "gateway") {
      // The Pack agent is not bound to the Stile session: it is not a LykiaAccount session and cannot carve sub-sessions.
      return gatewayBind(this.ctx, this, leash, txHash);
    }
    if (!leash.session || leash.session.sessionId || (leash.status !== "pending" && leash.status !== "active")) return leash;
    const s = leash.session;
    let sessionId: Hex | null;
    let block: string | undefined;
    if (txHash) {
      const receipt = await this.ctx.chains.getTxReceipt(leash.environment, txHash);
      if (!receipt) throw new LykiaHttpError("NOT_FOUND", 404, "Arc does not know that transaction yet. Try again once it is mined.");
      if (receipt.status !== "success") throw new LykiaHttpError("RECEIPT_REVERTED", 409, "The session transaction reverted on Arc.");
      const found = sessionFromLogs(receipt.logs, { account: s.account, key: s.key, fenceHash: fenceBytes32(leash.fenceHash) });
      if (!found || found.parent.toLowerCase() !== (s.parentSessionId ?? ZERO32).toLowerCase()) throw new LykiaHttpError("BINDING_MISMATCH", 409, "That transaction did not create this leash's session (key, Fence hash or parent differ).");
      sessionId = found.id;
      block = receipt.blockNumber.toString();
    } else {
      sessionId = await findSession(this.ctx, leash.environment, { account: s.account, key: s.key, fenceHash: fenceBytes32(leash.fenceHash), parent: s.parentSessionId, fromNonce: BigInt(s.nonceAtCreation) }).catch(() => null);
    }
    if (!sessionId) return leash;
    const next: Leash = { ...leash, status: "active", session: { ...s, sessionId, ...(txHash ? { txHash } : {}), ...(block ? { block } : {}) } };
    await this.put(next);
    const pack = agentServices(this.ctx).pack;
    await pack.bindSession(leash.agentId, { account: s.account, sessionId, ...(txHash ? { txHash } : {}) }).catch(() => undefined);
    return next;
  }

  /* ------------------------------------------------------------ usage */

  private tokensOf(leash: Leash): Address[] {
    return [...(leash.session?.tokens ?? [])];
  }

  async storeSpent(leash: Leash): Promise<{ day: bigint; total: bigint }> {
    const counters = leashSpend(this.ctx);
    const [day, total] = await Promise.all([counters.get(`${leash.id}:d:${dayKey(this.now())}`), counters.get(`${leash.id}:t`)]);
    return { day: BigInt(day), total: BigInt(total) };
  }

  /** Spent and left, per window and per token. On chain values win when they are larger: spendable() is the authority. */
  async usage(leash: Leash): Promise<LeashUsage & { readonly unreadable?: boolean; readonly state?: SessionState }> {
    if (leash.spendFrom === "gateway") {
      const { stileState: _st, ...u } = await gatewayUsage(this.ctx, this, leash);
      if (u.source === "chain") await this.thresholds(leash, u);
      return u;
    }
    const stored = await this.storeSpent(leash);
    const secondsLeft = Math.max(0, Math.floor((Date.parse(leash.expiresAt) - this.now()) / 1000));
    const base = { asOf: iso(this.now()), perStepUsd: leash.budget.perStepUsd, secondsLeft };
    const sessionId = leash.session?.sessionId as Hex | null | undefined;
    if (!leash.session || !sessionId) {
      return { ...base, source: "store", block: null, sessionValid: null, day: leashWindow(formatUsdMicros(stored.day), leash.budget.perDayUsd), total: leashWindow(formatUsdMicros(stored.total), leash.budget.totalUsd), tokens: [], calls: null };
    }
    let state: SessionState;
    try {
      state = await readSession(this.ctx, leash.environment, leash.session.account, sessionId, this.tokensOf(leash));
    } catch {
      return { ...base, source: "store", block: null, sessionValid: null, day: leashWindow(formatUsdMicros(stored.day), leash.budget.perDayUsd), total: leashWindow(formatUsdMicros(stored.total), leash.budget.totalUsd), tokens: [], calls: null, unreadable: true };
    }
    const prices = await services(this.ctx).prices.prices(["USDC", "EURC"]).catch(() => ({}) as Record<string, { usd: string | null }>);
    let chainDay = 0n;
    let chainTotal = 0n;
    const tokens = state.tokens.map((t) => {
      const token = ["USDC", "EURC"].map((s) => getToken(s)!).find((x) => tokenAddress(x, leash.environment)?.toLowerCase() === t.token.toLowerCase());
      const decimals = token?.decimals ?? 6;
      const usd = Number((prices as Record<string, { usd: string | null } | undefined>)[token?.symbol ?? ""]?.usd ?? (token?.symbol === "USDC" ? "1" : "0"));
      const toMicros = (units: bigint) => (BigInt(Math.round(usd * 1_000_000)) * units) / 10n ** BigInt(decimals);
      chainDay += toMicros(t.dayUsed);
      chainTotal += toMicros(t.consumed);
      return { symbol: token?.symbol ?? "?", token: t.token, decimals, perCall: t.perCall.toString(), daily: t.daily.toString(), budget: t.budget.toString(), dayUsed: t.dayUsed.toString(), consumed: t.consumed.toString(), spendable: t.spendable.toString() };
    });
    const day = stored.day > chainDay ? stored.day : chainDay;
    const total = stored.total > chainTotal ? stored.total : chainTotal;
    const usage = { ...base, source: "chain" as const, block: state.block?.toString() ?? null, sessionValid: state.valid, day: leashWindow(formatUsdMicros(day), leash.budget.perDayUsd), total: leashWindow(formatUsdMicros(total), leash.budget.totalUsd), tokens, calls: { used: state.callsUsed, max: state.maxCalls }, state };
    await this.thresholds(leash, usage);
    return usage;
  }

  /** leash.budget.threshold at 50, 80 and 100%: once per window. */
  private async thresholds(leash: Leash, usage: Pick<LeashUsage, "day" | "total">): Promise<void> {
    for (const [window, w, key] of [["day", usage.day, dayKey(this.now())], ["total", usage.total, "life"]] as const) {
      for (const t of crossedThresholds(0, w.share)) {
        if (await this.markOnce(`${leash.id}:${window}:${key}:${t}`, 3 * 86_400_000)) this.fire("leash.budget.threshold", leash, { window, threshold: t, spentUsd: w.spentUsd, capUsd: w.capUsd, remainingUsd: w.remainingUsd });
      }
    }
  }

  remaining(leash: Leash, usage: Pick<LeashUsage, "day" | "total">): LeashDenied["remaining"] {
    const min = (...v: string[]) => v.reduce((a, b) => (usdMicros(a) <= usdMicros(b) ? a : b));
    return { stepUsd: formatUsdMicros(usdMicros(min(leash.budget.perStepUsd, usage.day.remainingUsd, usage.total.remainingUsd))), dayUsd: usage.day.remainingUsd, totalUsd: usage.total.remainingUsd };
  }

  async view(leash: Leash): Promise<LeashView> {
    const bound = leash.status === "pending" ? await this.bind(leash).catch(() => leash) : leash;
    const { state: _s, unreadable: _u, ...usage } = await this.usage(bound);
    const recent = (await this.actions(bound, 5)).map((a) => this.trailItem(a, null));
    return { ...bound, usage, recent };
  }

  async list(owner: string, environment?: ArcEnvironment): Promise<LeashView[]> {
    return Promise.all((await this.ownedBy(owner, environment)).map((l) => this.view(l)));
  }

  /* ------------------------------------------------------------ revoke and renew */

  async revoke(leash: Leash, reason = "Revoked by the owner."): Promise<RevokeLeashResponse> {
    let current = leash;
    if (current.status === "pending") current = await this.bind(current).catch(() => current);
    const wasLive = current.status === "pending" || current.status === "active";
    if (wasLive) {
      current = { ...current, status: "revoked", revokedAt: iso(this.now()), revokedReason: reason };
      await this.put(current);
      await this.release(current);
      // Leashes carved from this leash's agent go with it (the Pack revoked their agents already).
      for (const child of (await this.ownedBy(current.owner)).filter((l) => l.parentAgentId === current.agentId && (l.status === "pending" || l.status === "active"))) await this.revoke(child, `Its parent leash ${current.id} was revoked.`);
    }
    if (current.spendFrom === "gateway") {
      const g = gatewayRevokeTransactions(current);
      if (wasLive) this.fire("leash.revoked", current, { reason, keyDisabled: true, revokeTransaction: g.transaction as never });
      return { leash: await this.view(current), keyDisabled: true, transaction: g.transaction, more: g.more, note: g.note };
    }
    const sessionId = current.session?.sessionId as Hex | null | undefined;
    const transaction = current.session && sessionId ? revokeTransaction({ chainId: current.session.chainId, owner: current.owner, account: current.session.account, sessionId, label: `Revoke ${current.agentName}'s leash on chain` }) : null;
    if (wasLive) this.fire("leash.revoked", current, { reason, keyDisabled: true, revokeTransaction: transaction as never });
    const note = transaction
      ? "The key stopped working at the API just now. Sign revokeSession to end the session on chain too; it also ends every sub-session under it."
      : current.session
        ? "The key stopped working at the API. No session was found on chain yet: if you already sent the session transaction, call revokeSession on your LykiaAccount once it lands (or POST /v1/leashes/:id/session with its hash, then revoke again for the transaction)."
        : "The key stopped working at the API.";
    return { leash: await this.view(current), keyDisabled: true, transaction, note };
  }

  /** Revokes the leashes of Pack agents that were revoked elsewhere (POST /v1/pack/:id/revoke). */
  async revokeForAgents(owner: string, agentIds: readonly string[]): Promise<void> {
    const ids = new Set(agentIds);
    for (const l of await this.ownedBy(owner)) if (ids.has(l.agentId) && (l.status === "pending" || l.status === "active")) await this.revoke(l, "Its Pack agent was revoked.");
  }

  /** A new carve with new limits and a new key; the old leash is revoked. Never an increase in place. */
  async renew(caller: LeashCaller, leash: Leash, input: { readonly budget?: LeashBudget; readonly expiresAt: string; readonly recipients?: readonly Address[]; readonly venues?: readonly string[]; readonly signer?: Address; readonly publicBaseUrl: string }): Promise<RenewLeashResponse> {
    const created = await this.create(caller, {
      owner: leash.owner,
      environment: leash.environment,
      ...(leash.parentAgentId ? { parentAgentId: leash.parentAgentId, name: leash.agentName, signer: input.signer ?? leash.session?.key } : { agent: { name: leash.agentName, ...(leash.mission ? { mission: leash.mission } : {}), signer: (input.signer ?? leash.session?.key) as Address } }),
      template: leash.template,
      ...(leash.template === "custom" ? { fence: leash.fence } : {}),
      budget: input.budget ?? leash.budget,
      expiresAt: input.expiresAt,
      ...(input.venues ?? leash.venues ? { venues: input.venues ?? (leash.venues as string[]) } : {}),
      ...(input.recipients ?? (leash.recipients.length > 0 ? leash.recipients : undefined) ? { recipients: input.recipients ?? leash.recipients } : {}),
      ...(leash.spendFrom === "gateway" ? {} : { maxSlippageBps: leash.fence.limits?.maxSlippageBps ?? 0 }),
      tools: leash.tools,
      publicBaseUrl: input.publicBaseUrl,
      releasing: leash,
      ...(leash.spendFrom === "gateway" && leash.stile ? { spendFrom: "gateway" as const, destinations: leash.stile.destinations, maxGatewayFeeUsd: (Number(leash.stile.maxGatewayFee) / 1_000_000).toString() } : {}),
    });
    const revoked = await this.revoke(leash, `Renewed as ${created.leash.id}.`);
    return { ...created, previous: { id: leash.id, revokeTransaction: revoked.transaction } };
  }

  /* ------------------------------------------------------------ plan */

  denied(leash: Leash, reasons: readonly LeashDenyReason[], remaining: LeashDenied["remaining"], extra: { verdictDigest?: string | null; intentId?: string | null } = {}): LykiaHttpError {
    return denied(leash, reasons, remaining, extra);
  }

  async packAgent(leash: Leash): Promise<PackAgent | null> {
    return agentServices(this.ctx).pack.get(leash.agentId).catch(() => null);
  }

  async recordSpend(leash: Leash, usd: string): Promise<void> {
    await agentServices(this.ctx).pack.recordSpend(leash.agentId, usd).catch(() => undefined);
  }

  liveReasons(leash: Leash, agentIn: unknown): LeashDenyReason[] {
    const agent = agentIn as PackAgent | null;
    if (leash.status === "revoked") return [{ code: "leash.revoked", message: "This leash was revoked." }];
    if (leash.status === "expired" || Date.parse(leash.expiresAt) <= this.now()) return [{ code: "leash.expired", message: `This leash expired at ${leash.expiresAt}.` }];
    if (leash.paused) return [{ code: "leash.paused", message: leash.paused.by === "whistle" ? "The Whistle is blown: this leash's key is disabled until the owner resumes it in the Fold." : "This leash is paused by the owner." }];
    if (!agent || agent.status === "revoked") return [{ code: "leash.revoked", message: "This leash's Pack agent was revoked." }];
    if (agent.status === "paused") return [{ code: "leash.revoked", message: `${agent.name} is paused by the owner.` }];
    return [];
  }

  async plan(leashIn: Leash, input: { readonly text?: string; readonly actions?: readonly PlanAction[]; readonly dryRun?: boolean; readonly forward?: boolean }): Promise<LeashPlanResponse> {
    const ctx = this.ctx;
    const leash = leashIn.status === "pending" ? await this.bind(leashIn).catch(() => leashIn) : leashIn;
    if (leash.spendFrom === "gateway") return gatewayPlan(ctx, this, leash, input);
    const agent = await agentServices(ctx).pack.get(leash.agentId).catch(() => null);
    const refuse = async (reasons: readonly LeashDenyReason[], usage: Pick<LeashUsage, "day" | "total">, extra: { verdictDigest?: string | null; intentId?: string | null; summary?: string } = {}) => {
      const remaining = this.remaining(leash, usage);
      await this.action(leash, { kind: "denied", summary: extra.summary ?? (input.text ?? "actions").slice(0, 160), ...(extra.intentId ? { intentId: extra.intentId } : {}), ...(extra.verdictDigest ? { verdictDigest: extra.verdictDigest } : {}), decision: "deny", reasons });
      this.fire("leash.denied", leash, { reasons: reasons as never, remaining, intentId: extra.intentId ?? null, verdictDigest: extra.verdictDigest ?? null });
      return denied(leash, reasons, remaining, extra);
    };
    const stored = await this.storeSpent(leash);
    const storeUsage = { day: leashWindow(formatUsdMicros(stored.day), leash.budget.perDayUsd), total: leashWindow(formatUsdMicros(stored.total), leash.budget.totalUsd) };
    const live = this.liveReasons(leash, agent);
    if (live.length > 0) throw await refuse(live, storeUsage);
    if (!leash.session?.sessionId && !input.dryRun) throw await refuse([{ code: "leash.session.pending", message: "The session transaction has not landed on chain yet: the owner signs it once, then the leash is live." }], storeUsage);

    // What the agent asks for.
    let actions: readonly PlanAction[];
    let source: string;
    if (input.text !== undefined) {
      const parsed = readSentence(input.text);
      if (parsed.clarify.length > 0 || parsed.actions.length === 0) throw await refuse([{ code: "leash.not-understood", message: parsed.clarify.length > 0 ? parsed.clarify.join(" ") : parsed.reply }], storeUsage);
      actions = parsed.actions;
      source = input.text;
    } else {
      actions = input.actions ?? [];
      source = JSON.stringify(actions).slice(0, 500);
    }

    // The chain is the authority on what is left; unreadable means nothing is prepared.
    const usage = await this.usage(leash);
    if (usage.unreadable && !input.dryRun) throw await refuse([{ code: "leash.chain.unreadable", message: "The LykiaAccount could not be read on Arc, so nothing is prepared. Try again." }], usage);
    if (usage.sessionValid === false) throw await refuse([{ code: "leash.session.invalid", message: "The session is no longer valid on chain (revoked, expired, or the account revoked every session)." }], usage);
    const allowed = new Set(leash.venues ?? []);
    const blocked = leash.venues ? PROTOCOLS.map((p) => p.id).filter((id) => !allowed.has(id)) : [];
    const account = leash.session!.account;
    const planWith = (prefs: { blocked: string[]; noSplit: boolean }, dryRun: boolean) =>
      services(ctx).intents.create({
        environment: leash.environment,
        owner: leash.owner,
        agent: { address: account },
        signer: "agent",
        actions,
        source,
        fence: leash.fence,
        account: "smart",
        proposedByAgent: true,
        preferences: prefs,
        spent: { dayUsd: usage.day.spentUsd, weekUsd: null },
        ...(dryRun ? { dryRun: true } : {}),
      });
    let result;
    try {
      result = await planWith({ blocked, noSplit: true }, input.dryRun === true);
    } catch (error) {
      if (!(error instanceof LykiaHttpError) || error.code !== "NO_ROUTE" || blocked.length === 0) throw error;
      // Nothing inside the leash's venues can do it. Plan once more without that limit, as a dry run, to say why in Fence terms.
      const open = await planWith({ blocked: [], noSplit: true }, true).catch(() => null);
      const why = open?.intent.verdict.reasons.filter((r) => r.decision === "deny").map((r) => ({ code: `fence.${r.rule}`, message: r.message, ...(r.step ? { stepId: r.step } : {}) })) ?? [];
      throw await refuse(why.length > 0 ? why : [{ code: "leash.venue.none", message: `None of this leash's venues (${(leash.venues ?? []).join(", ")}) can do that.` }], usage, { summary: source.slice(0, 160) });
    }
    const intent = result.intent;
    const verdict = intent.verdict;
    const reasons: LeashDenyReason[] = verdict.reasons.filter((r) => r.decision === "deny").map((r) => ({ code: `fence.${r.rule}`, message: r.message, ...(r.step ? { stepId: r.step } : {}) }));
    if (verdict.decision === "confirm") reasons.push(...verdict.reasons.filter((r) => r.decision === "confirm").map((r) => ({ code: "leash.needs-owner", message: `The owner must confirm this: ${r.message}`, ...(r.step ? { stepId: r.step } : {}) })));
    const planUsd = intent.steps.reduce<bigint | null>((sum, s) => s.inputs.reduce<bigint | null>((acc, a) => (acc === null || a.usd === null ? null : acc + usdMicros(a.usd)), sum), 0n);
    if (planUsd === null) reasons.push({ code: "leash.unpriced", message: "Part of this plan has no USD price, so it cannot be counted against the leash." });
    else {
      if (planUsd > usdMicros(usage.total.remainingUsd)) reasons.push({ code: "leash.budget.total", message: `$${formatUsdMicros(planUsd)} is more than the $${usage.total.remainingUsd} left of this leash's total budget.` });
      if (planUsd > usdMicros(usage.day.remainingUsd) && !reasons.some((r) => r.code === "fence.caps.daily")) reasons.push({ code: "leash.budget.day", message: `$${formatUsdMicros(planUsd)} is more than the $${usage.day.remainingUsd} left today.` });
    }
    // Per token, the account's own answer.
    if (usage.source === "chain") {
      const byToken = new Map<string, bigint>();
      for (const s of intent.steps) for (const a of s.inputs) byToken.set(a.token.toLowerCase(), (byToken.get(a.token.toLowerCase()) ?? 0n) + BigInt(a.amount));
      for (const [token, units] of byToken) {
        const t = usage.tokens.find((x) => x.token.toLowerCase() === token);
        const symbol = intent.steps.flatMap((s) => s.inputs).find((a) => a.token.toLowerCase() === token)?.symbol ?? token;
        if (!t) reasons.push({ code: "leash.token.not-in-session", message: `The session has no cap for ${symbol}, so the account would refuse to spend it.` });
        else if (units > BigInt(t.spendable)) reasons.push({ code: "leash.chain.spendable", message: `The account lets this session spend ${fmtUnits(BigInt(t.spendable), t.decimals)} ${symbol} right now; this plan needs ${fmtUnits(units, t.decimals)}.` });
      }
    }
    if (reasons.length > 0) throw await refuse(reasons, usage, { verdictDigest: verdict.digest, intentId: result.stored ? intent.id : null, summary: intent.steps.map((s) => s.summary).join("; ").slice(0, 200) || source.slice(0, 160) });

    const notes: string[] = [...intent.warnings];
    let prepared: LeashPreparedStep | null = null;
    if (!input.dryRun && result.stored) {
      const first = intent.steps.find((s) => s.status === "ready");
      if (first) prepared = await this.prepareStep(leash, intent, first.id, usage, refuse);
      await this.action(leash, { kind: "planned", summary: intent.steps.map((s) => s.summary).join("; ").slice(0, 200), intentId: intent.id, verdictDigest: verdict.digest, decision: verdict.decision, usd: planUsd === null ? null : formatUsdMicros(planUsd) });
    } else notes.push("Dry run: nothing was prepared.");
    return { leashId: leash.id, decision: "allow", intent, prepared, remaining: this.remaining(leash, usage), notes };
  }

  /** Prepares one step and wraps it into the session calls; checks the call rules and payees on chain and simulates it. */
  private async prepareStep(leash: Leash, intent: IntentGraph, stepId: string, usage: Pick<LeashUsage, "day" | "total">, refuse: (reasons: readonly LeashDenyReason[], usage: Pick<LeashUsage, "day" | "total">, extra?: { verdictDigest?: string | null; intentId?: string | null; summary?: string }) => Promise<LykiaHttpError>): Promise<LeashPreparedStep> {
    const ctx = this.ctx;
    const s = leash.session!;
    const sessionId = s.sessionId as Hex;
    const step = intent.steps.find((x) => x.id === stepId)!;
    const prepared = await services(ctx).intents.prepare(intent.id, stepId);
    const memo = memoData({ intentId: intent.id, stepId, verdict: verdictTag(intent.verdict.digest) });
    let wrapped;
    try {
      wrapped = wrapForSession(prepared.transactions, { account: s.account, sessionId, memo });
    } catch (error) {
      if (error instanceof WrapError) throw await refuse([{ code: "leash.call.not-in-session", message: error.message, stepId }], usage, { verdictDigest: intent.verdict.digest, intentId: intent.id });
      throw error;
    }
    // What the account will check, read from the account itself.
    const client = ctx.chains.client(leash.environment);
    const reasons: LeashDenyReason[] = [];
    try {
      const checks = await client.multicall({
        contracts: wrapped.map((w) => (w.kind === "agentExecute" ? { address: s.account, abi: ACCOUNT_ABI, functionName: "getRule", args: [sessionId, w.target, w.selector] } : { address: s.account, abi: ACCOUNT_ABI, functionName: "isRecipient", args: [sessionId, w.to] })) as never,
        allowFailure: true,
      }) as readonly { status: string; result?: unknown }[];
      checks.forEach((c, i) => {
        const w = wrapped[i]!;
        if (c.status !== "success") throw new Error("unreadable");
        if (w.kind === "agentExecute" && !(c.result as { allowed: boolean }).allowed) reasons.push({ code: "leash.call.not-in-session", message: `The session has no call rule for ${w.selector} on ${w.target}; the account would refuse it.`, stepId });
        if (w.kind === "agentTransfer" && !(c.result as boolean) && w.to?.toLowerCase() !== leash.owner.toLowerCase()) reasons.push({ code: "leash.recipient.not-in-session", message: `${w.to} is not a payee of the session; the account would refuse it.`, stepId });
      });
    } catch {
      throw await refuse([{ code: "leash.chain.unreadable", message: "The session's call rules could not be read on Arc, so nothing is prepared." }], usage, { verdictDigest: intent.verdict.digest, intentId: intent.id });
    }
    if (reasons.length > 0) throw await refuse(reasons, usage, { verdictDigest: intent.verdict.digest, intentId: intent.id });
    const transaction = sessionTransaction(wrapped, { environment: leash.environment, chainId: s.chainId, key: s.key, account: s.account, label: `${leash.agentName}: ${step.summary}` });
    // Simulated from the session key against Arc as it is now. A revert is a refusal with the account's own error.
    try {
      await client.call({ account: s.key, to: transaction.to, data: transaction.data });
    } catch (error) {
      const decoded = accountError(error);
      throw await refuse([{ code: "leash.chain.revert", message: decoded ? `The account refused it in simulation: ${decoded}.` : `The simulation on Arc failed: ${error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : "unknown error"}.`, stepId }], usage, { verdictDigest: intent.verdict.digest, intentId: intent.id });
    }
    const usd = step.inputs.reduce<bigint | null>((acc, a) => (acc === null || a.usd === null ? null : acc + usdMicros(a.usd)), 0n);
    const record: LeashStep = { leashId: leash.id, intentId: intent.id, stepId, transaction, verdictDigest: intent.verdict.digest, usd: usd === null ? null : formatUsdMicros(usd), summary: step.summary, preparedAt: iso(this.now()), status: "prepared" };
    await leashSteps(ctx).put(`${leash.id}:${intent.id}:${stepId}`, record, { ttlMs: LEASH_RECORD_TTL_MS });
    return {
      intentId: intent.id,
      stepId,
      transaction,
      calls: wrapped.map(({ data: _d, ...rest }) => rest),
      memo: `lykia:1:${intent.id}:${stepId}:${verdictTag(intent.verdict.digest)}`,
      simulated: true,
    };
  }

  /* ------------------------------------------------------------ submit */

  async submit(leashIn: Leash, input: { readonly intentId: string; readonly stepId: string; readonly hash: `0x${string}` }): Promise<LeashSubmitResponse> {
    const ctx = this.ctx;
    const leash = leashIn;
    if (leash.spendFrom === "gateway") return gatewaySubmit(ctx, this, leash, input);
    const agent = await agentServices(ctx).pack.get(leash.agentId).catch(() => null);
    const live = this.liveReasons(leash, agent);
    if (live.length > 0) throw new LykiaHttpError(live[0]!.code === "leash.expired" ? "LEASH_EXPIRED" : "LEASH_REVOKED", 403, live[0]!.message, { leashId: leash.id });
    const key = `${leash.id}:${input.intentId}:${input.stepId}`;
    const doc = await leashSteps(ctx).get(key);
    if (!doc) throw new LykiaHttpError("NOT_FOUND", 404, "No prepared step of this leash with that intent and step id.");
    const step = doc.value;
    if (step.status === "settled" || step.status === "failed") throw new LykiaHttpError("CONFLICT", 409, `That step is already ${step.status}.`);
    const tx = await ctx.chains.getTransaction(leash.environment, input.hash);
    if (!tx) throw new LykiaHttpError("NOT_FOUND", 404, `Arc does not know ${input.hash} yet. Submit again once it is broadcast.`);
    const p = step.transaction;
    if (tx.from.toLowerCase() !== p.from.toLowerCase() || (tx.to ?? "").toLowerCase() !== p.to.toLowerCase() || tx.input.toLowerCase() !== p.data.toLowerCase() || BigInt(tx.value) !== BigInt(p.value)) throw new LykiaHttpError("BINDING_MISMATCH", 409, "That transaction is not the prepared one (sender, target, data or value differ).", { hash: input.hash });
    const claims = ctx.store.collection<{ leashId: string; key: string }>("leash_claims");
    const claim = await claims.compareAndSet(input.hash.toLowerCase(), null, { leashId: leash.id, key }, { ttlMs: LEASH_RECORD_TTL_MS });
    if (!claim && (await claims.get(input.hash.toLowerCase()))?.value.key !== key) throw new LykiaHttpError("REFERENCE_CLAIMED", 409, "That hash is attached to another step.", { hash: input.hash });
    const receipt = await ctx.chains.getTxReceipt(leash.environment, input.hash);
    if (!receipt) {
      await leashSteps(ctx).put(key, { ...step, status: "submitted", txHash: input.hash }, { ttlMs: LEASH_RECORD_TTL_MS });
      return { leashId: leash.id, status: "pending", chainProven: false, next: null, usage: await this.publicUsage(leash) };
    }
    const ok = receipt.status === "success";
    const sessionId = leash.session!.sessionId as Hex;
    const events = agentEvents(receipt.logs, leash.session!.account, sessionId);
    const proven = ok && events.some((e) => e.name === "AgentCall" || e.name === "AgentTransfer") && events.some((e) => e.name === "AgentMemo" && memoMatches(e.memo, { intentId: input.intentId, stepId: input.stepId, verdictDigest: step.verdictDigest }));
    await services(ctx).intents.settleExternal(input.intentId, [input.stepId], input.hash, ok).catch((error: unknown) => ctx.log.warn("leash settle failed", { error: error instanceof Error ? error.message : String(error) }));
    await leashSteps(ctx).put(key, { ...step, status: ok ? "settled" : "failed", txHash: input.hash }, { ttlMs: LEASH_RECORD_TTL_MS });
    if (ok && step.usd) {
      const micros = Number(usdMicros(step.usd));
      await leashSpend(ctx).increment(`${leash.id}:d:${dayKey(this.now())}`, micros, { ttlMs: 2 * 86_400_000 });
      await leashSpend(ctx).increment(`${leash.id}:t`, micros, { ttlMs: LEASH_RECORD_TTL_MS });
      await agentServices(ctx).pack.recordSpend(leash.agentId, step.usd).catch(() => undefined);
    }
    await this.action(leash, { kind: ok ? "settled" : "failed", summary: step.summary, intentId: input.intentId, stepId: input.stepId, verdictDigest: step.verdictDigest, usd: step.usd, txHash: input.hash });
    const usage = await this.usage(leash);
    // The next step of the same plan, prepared the same way.
    let next: LeashPreparedStep | null = null;
    if (ok) {
      const { intent } = await services(ctx).intents.get(input.intentId);
      const ready = intent.steps.find((s) => s.status === "ready");
      if (ready) next = await this.prepareStep(leash, intent, ready.id, usage, async (reasons, u, extra) => {
        await this.action(leash, { kind: "denied", summary: ready.summary, intentId: intent.id, decision: "deny", reasons, ...(extra?.verdictDigest ? { verdictDigest: extra.verdictDigest } : {}) });
        this.fire("leash.denied", leash, { reasons: reasons as never, remaining: this.remaining(leash, u) });
        return denied(leash, reasons, this.remaining(leash, u), extra ?? {});
      });
    }
    const { state: _s, unreadable: _u, ...publicUsage } = usage;
    return { leashId: leash.id, status: ok ? "settled" : "failed", chainProven: proven, next, usage: publicUsage };
  }

  private async publicUsage(leash: Leash): Promise<LeashUsage> {
    const { state: _s, unreadable: _u, ...usage } = await this.usage(leash);
    return usage;
  }

  /* ------------------------------------------------------------ trail */

  private trailItem(a: LeashAction, chain: { proven: boolean; block?: bigint; events?: { name: "AgentCall" | "AgentTransfer" | "AgentMemo"; detail: string }[]; memoVerdict?: string } | null): LeashTrailItem {
    return {
      at: a.at,
      kind: a.kind,
      summary: a.summary,
      ...(a.intentId ? { intentId: a.intentId } : {}),
      ...(a.stepId ? { stepId: a.stepId } : {}),
      ...(a.verdictDigest ? { verdictDigest: a.verdictDigest } : {}),
      ...(a.decision ? { decision: a.decision } : {}),
      ...(a.reasons ? { reasons: a.reasons } : {}),
      ...(a.usd !== undefined ? { usd: a.usd } : {}),
      ...(a.txHash ? { txHash: a.txHash } : {}),
      chainProven: chain?.proven ?? false,
      ...(chain?.block !== undefined && chain.events ? { chain: { block: chain.block.toString(), events: chain.events, ...(chain.memoVerdict ? { memoVerdict: chain.memoVerdict } : {}) } } : {}),
      source: "lykia",
    };
  }

  /**
   * Every action under the leash. Lykia's records are cross-checked with the
   * chain: an item with a transaction is chain-proven when its receipt
   * succeeded, carries AgentCall or AgentTransfer for this session, and its
   * AgentMemo names the same intent, step and verdict. Session events Lykia
   * has no record of (the key acted directly) are listed as source "chain".
   */
  async trail(leash: Leash): Promise<LeashTrailResponse> {
    const ctx = this.ctx;
    if (leash.spendFrom === "gateway") return gatewayTrail(ctx, this, leash);
    const actions = await this.actions(leash, 200);
    const s = leash.session;
    const sessionId = s?.sessionId as Hex | null | undefined;
    const items: LeashTrailItem[] = [];
    const known = new Set<string>();
    for (const a of actions) {
      if (!a.txHash || !s || !sessionId) {
        items.push(this.trailItem(a, null));
        continue;
      }
      known.add(a.txHash.toLowerCase());
      const receipt = await ctx.chains.getTxReceipt(leash.environment, a.txHash).catch(() => null);
      if (!receipt) {
        items.push(this.trailItem(a, null));
        continue;
      }
      const events = agentEvents(receipt.logs, s.account, sessionId);
      const memo = events.find((e) => e.name === "AgentMemo");
      const proven = receipt.status === "success" && events.some((e) => e.name !== "AgentMemo") && Boolean(a.intentId && a.stepId && a.verdictDigest && memoMatches(memo?.memo, { intentId: a.intentId, stepId: a.stepId, verdictDigest: a.verdictDigest }));
      items.push(this.trailItem(a, { proven, block: receipt.blockNumber, events: events.map((e) => ({ name: e.name, detail: e.detail })), ...(memo?.memo ? { memoVerdict: memo.detail.split(":")[4] ?? "" } : {}) }));
    }
    let scanned: LeashTrailResponse["scanned"] = { fromBlock: null, toBlock: null, note: "No session on chain yet." };
    if (s && sessionId) {
      try {
        const recent = await recentAgentLogs(ctx, leash.environment, s.account, s.block ? BigInt(s.block) : null);
        const events = agentEvents(recent.logs, s.account, sessionId);
        const byTx = new Map<string, typeof events>();
        for (const e of events) byTx.set(e.txHash.toLowerCase(), [...(byTx.get(e.txHash.toLowerCase()) ?? []), e]);
        for (const [hash, list] of byTx) {
          if (known.has(hash) || !list.some((e) => e.name !== "AgentMemo")) continue;
          items.push({ at: iso(this.now()), kind: "onchain", summary: "The session key acted on chain without a Lykia plan.", txHash: hash as `0x${string}`, chainProven: true, chain: { block: list[0]!.block.toString(), events: list.map((e) => ({ name: e.name, detail: e.detail })) }, source: "chain" });
        }
        scanned = { fromBlock: recent.from.toString(), toBlock: recent.to.toString(), note: "Session events in these blocks were compared with Lykia's records." };
      } catch {
        scanned = { fromBlock: null, toBlock: null, note: "Arc's logs could not be read; items with a transaction are still checked against their receipts." };
      }
    }
    return { leashId: leash.id, items, scanned };
  }
}

function fmtUnits(units: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/u, "").slice(0, 6);
  return frac ? `${whole}.${frac}` : whole.toString();
}

const SERVICES = new WeakMap<AppContext, LeashService>();
export function leashService(ctx: AppContext): LeashService {
  let s = SERVICES.get(ctx);
  if (!s) {
    s = new LeashService(ctx);
    SERVICES.set(ctx, s);
  }
  return s;
}
