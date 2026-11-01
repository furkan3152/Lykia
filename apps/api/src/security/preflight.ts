/**
 * The two hooks the engine calls: `securityPreflight` before prepared
 * transactions leave the API, `securityPostflight` after a submit is
 * verified. Preflight runs every signing-time layer and throws
 * SECURITY_BLOCKED (409, with the full report) when any finding blocks;
 * otherwise the report rides on the prepare response as `security`.
 */
import { ARC_CONTRACTS, canonicalDigest, isAddress, networkFor, protocolsFor, sameAddress, type Address, type IntentGraph, type IntentStep, type UnsignedTransaction } from "@lykia/core";
import type { PrepareStepResponse, SubmitStepResponse } from "@lykia/core/api/intents";
import { analyzeFlow, decisionOf, describeCall, HOMEWARD_KINDS, monitorFindings, SECURITY_SPEC_VERSION, whistleAction, type ExpectedFlow, type SecurityFinding, type SecurityReport } from "@lykia/core/security/index";
import { encodeFunctionData, erc20Abi } from "viem";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { listDeployments } from "../platform/admin.js";
import { services } from "../services.js";
import { pause, pauseOf, policyOf, raiseAlert, recentActivity, recordActivity } from "./activity.js";
import { auditSafe, ownerChain } from "./audit.js";
import { pausedTargets, venueBreakers } from "./breakers.js";
import { decodeTransactions } from "./decode.js";
import { checkRecipient, rememberRecipient } from "./recipients.js";
import { simulateStep, type SimulationResult } from "./simulate.js";
import { adapterContracts } from "../integrations/registry.js";

const RECIPIENT_KEYS = new Set(["to", "recipient", "mintRecipient", "receiver"]);

function stepUsd(step: IntentStep): number | null {
  const values = step.inputs.map((i) => (i.usd === null ? null : Number(i.usd)));
  if (values.some((v) => v === null || !Number.isFinite(v))) return null;
  return (values as number[]).reduce((s, v) => s + v, 0);
}

function planRecipient(kind: string, params: Readonly<Record<string, string>>): Address | null {
  if (kind !== "transfer" && kind !== "bridge") return null;
  const value = params.to ?? params.recipient;
  return value && isAddress(value) ? value : null;
}

async function knownContracts(ctx: AppContext, graph: IntentGraph, params: Readonly<Record<string, string>>): Promise<Address[]> {
  const env = graph.environment;
  const out = new Set<string>();
  for (const c of Object.values(ARC_CONTRACTS)) if (c.addresses[env]) out.add((c.addresses[env] as string).toLowerCase());
  for (const p of protocolsFor(env)) for (const a of Object.values(p.deployments[env]?.contracts ?? {})) out.add(a.toLowerCase());
  for (const [key, value] of Object.entries(params)) if (!RECIPIENT_KEYS.has(key) && isAddress(value)) out.add(value.toLowerCase());
  for (const d of await listDeployments(ctx, env).catch(() => [])) if (d.verified) out.add(d.address.toLowerCase());
  for (const a of await adapterContracts(ctx, env).catch(() => [])) out.add(a.toLowerCase());
  return [...out] as Address[];
}

export interface PreflightInput {
  readonly intentId: string;
  readonly stepId: string;
  readonly prepared: PrepareStepResponse;
}

export async function securityPreflight(ctx: AppContext, input: PreflightInput): Promise<SecurityReport> {
  const { doc } = await services(ctx).intents.load(input.intentId);
  const graph = doc.graph as IntentGraph;
  const step = graph.steps.find((s) => s.id === input.stepId);
  const plan = (doc.plans as Record<string, { params: Readonly<Record<string, string>> }>)[input.stepId];
  if (!step || !plan) throw new LykiaHttpError("NOT_FOUND", 404, "No such step.");
  return securityReview(ctx, { graph, step, params: plan.params, transactions: input.prepared.transactions, binding: input.prepared.binding, mode: "prepare" });
}

export interface ReviewInput {
  readonly graph: IntentGraph;
  readonly step: IntentStep;
  readonly params: Readonly<Record<string, string>>;
  readonly transactions: readonly UnsignedTransaction[];
  readonly binding: string;
  /**
   * "prepare": the signing gate of a stored intent (records the activity and may auto-pause).
   * "build": a stateless aggregator build (reads pauses and the monitor, never records or pauses).
   */
  readonly mode: "prepare" | "build";
  /** A simulation the caller already ran (a whole route in one batch); replaces the per-step one. */
  readonly simulation?: SimulationResult;
}

/** Layers 1 to 5 over one step's prepared transactions. Throws 409 SECURITY_BLOCKED on a block. */
export async function securityReview(ctx: AppContext, input: ReviewInput): Promise<SecurityReport> {
  const { graph, step } = input;
  const plan = { params: input.params };
  const env = graph.environment;
  const now = ctx.clock.now();
  const findings: SecurityFinding[] = [];
  const homeward = HOMEWARD_KINDS.includes(step.kind);
  const soften = (f: SecurityFinding): SecurityFinding => (homeward && f.severity === "block" ? { ...f, severity: "warn", message: `${f.message} Allowed: this move brings value home.` } : f);

  // Layer 5: halt, admin switches, oracle health, paused contracts.
  const breaker = (await venueBreakers(ctx, env)).find((v) => v.venue === step.venue);
  if (breaker && breaker.state !== "healthy") findings.push(soften({ layer: "breakers", rule: `breakers.${breaker.state}`, severity: breaker.state === "blocked" ? "block" : "warn", message: `${step.venue}: ${breaker.reasons.join(" ")}`, stepId: step.id }));

  // Layer 4: pauses and the monitor.
  const subject = graph.agent?.address ?? graph.owner;
  const paused = await pauseOf(ctx, subject);
  if (paused) findings.push(soften({ layer: "monitor", rule: "monitor.paused", severity: "block", message: `${subject} is paused (${paused.by}): ${paused.reason}`, stepId: step.id }));

  // Layer 1: decode, diff, simulate.
  const calls = decodeTransactions(input.transactions);
  const recipient = planRecipient(step.kind, plan.params);
  const expect: ExpectedFlow = {
    stepId: step.id,
    account: step.account,
    owner: graph.owner,
    kind: step.kind,
    inputs: step.inputs.map((i) => ({ token: i.token, symbol: i.symbol, amount: i.amount })),
    fees: step.fee ? [{ token: step.fee.token, recipient: step.fee.recipient, amount: step.fee.amount }, ...(step.fee.integrator ? [{ token: step.fee.token, recipient: step.fee.integrator.recipient, amount: step.fee.integrator.amount }] : [])] : [],
    recipients: recipient ? [recipient] : [],
    knownContracts: await knownContracts(ctx, graph, plan.params),
    repayHeadroom: step.kind === "repay" && plan.params.mode === "all",
  };
  const flow = analyzeFlow(expect, calls);
  findings.push(...flow.findings);
  const sim = input.simulation ?? (await simulateStep(ctx.chains.client(env), step.id, input.transactions));
  findings.push(...sim.findings);
  const touched = flow.summary.contractsTouched.filter((a) => !step.inputs.some((i) => sameAddress(i.token, a)));
  for (const a of await pausedTargets(ctx, env, touched)) findings.push(soften({ layer: "breakers", rule: "breakers.paused", severity: "block", message: `${a} reports paused(): nothing moves through it right now.`, stepId: step.id, address: a }));

  // Layer 2: the recipient.
  if (recipient) findings.push(...(await checkRecipient(ctx, { environment: env, owner: graph.owner, recipient, tokens: step.inputs.map((i) => i.token), stepId: step.id })).findings);

  // Layer 4: velocity and anomalies for the subject.
  const policy = await policyOf(ctx, graph.owner);
  const monitor = monitorFindings(await recentActivity(ctx, subject, now), { at: now, usd: stepUsd(step), venue: step.venue, recipient }, policy, step.id).map(soften);
  findings.push(...monitor);
  const action = whistleAction(monitor, policy, step.signer === "agent");
  if (action !== "none" && input.mode === "prepare") {
    const first = monitor.find((f) => f.severity !== "info") as SecurityFinding;
    await raiseAlert(ctx, { owner: graph.owner, subject, severity: action === "pause" ? "block" : first.severity, rule: first.rule, title: action === "pause" ? `Auto-Whistle paused ${subject}` : "Auto-Whistle flagged unusual activity", body: monitor.map((f) => f.message).join(" ") }).catch(() => null);
    if (action === "pause" && !homeward) {
      await pause(ctx, { subject: subject.toLowerCase(), owner: graph.owner.toLowerCase(), reason: first.message, at: new Date(now).toISOString(), by: "auto-whistle" });
      await auditSafe(ctx, ownerChain(graph.owner), { kind: "pause", actor: "auto-whistle", subject, data: { rule: first.rule, intentId: graph.id, stepId: step.id } });
      findings.push({ layer: "monitor", rule: "monitor.auto-pause", severity: "block", message: `The Auto-Whistle paused ${subject}; the owner can resume it from the Security center.`, stepId: step.id });
    }
  }

  // Layer 3: resets for anything that may leave an allowance behind.
  const chainId = networkFor(env).chainId;
  const cleanup: UnsignedTransaction[] = flow.summary.approvals
    .filter((a) => !a.exact && BigInt(a.amount) > 0n)
    .map((a) => ({ chainId, from: step.account, to: a.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [a.spender, 0n] }), value: "0", label: `Reset the allowance of ${a.spender} to zero` }));

  const symbolOf = (t: string) => step.inputs.find((i) => sameAddress(i.token, t))?.symbol ?? (step.fee && sameAddress(step.fee.token, t) ? step.fee.symbol : null);
  const balanceChanges = flow.summary.balanceChanges.map((b) => {
    const traced = sim.assetChanges.find((a) => sameAddress(a.token, b.token));
    return { ...b, symbol: b.symbol ?? symbolOf(b.token), in: traced && BigInt(traced.diff) > 0n ? traced.diff : null };
  });
  const body = {
    schema: SECURITY_SPEC_VERSION,
    stepId: step.id,
    decision: decisionOf(findings),
    findings,
    summary: { ...flow.summary, balanceChanges, lines: calls.map((c) => describeCall(c, symbolOf)) },
    simulation: sim.method,
    checkedAt: new Date(now).toISOString(),
    cleanup,
  } as const;
  const report: SecurityReport = { ...body, digest: canonicalDigest(body) };
  await auditSafe(ctx, ownerChain(graph.owner), { kind: report.decision === "block" ? "blocked" : "prepare", actor: step.signer === "agent" ? (graph.agent?.address ?? "agent") : graph.owner, subject: `${graph.id}:${step.id}`, data: { decision: report.decision, digest: report.digest, verdict: graph.verdict.digest, binding: input.binding, mode: input.mode, rules: findings.filter((f) => f.severity !== "info").map((f) => f.rule) } });
  if (report.decision === "block") {
    const first = findings.find((f) => f.severity === "block") as SecurityFinding;
    throw new LykiaHttpError("SECURITY_BLOCKED", 409, first.message, { security: report });
  }
  if (input.mode === "prepare") await recordActivity(ctx, subject, { at: now, kind: "prepare", usd: stepUsd(step), venue: step.venue, recipient }).catch(() => undefined);
  return report;
}

export interface PostflightInput {
  readonly intentId: string;
  readonly stepId: string;
  readonly result: SubmitStepResponse;
  readonly references: readonly string[];
}

export async function securityPostflight(ctx: AppContext, input: PostflightInput): Promise<void> {
  try {
    const { doc } = await services(ctx).intents.load(input.intentId);
    const graph = doc.graph as IntentGraph;
    const step = input.result.step;
    const plan = (doc.plans as Record<string, { params: Readonly<Record<string, string>> }>)[input.stepId];
    const subject = graph.agent?.address ?? graph.owner;
    const now = ctx.clock.now();
    await auditSafe(ctx, ownerChain(graph.owner), { kind: "submit", actor: step.signer === "agent" ? (graph.agent?.address ?? "agent") : graph.owner, subject: `${graph.id}:${step.id}`, data: { status: step.status, references: [...input.references], binding: step.binding ?? null } });
    if (step.status === "failed") await recordActivity(ctx, subject, { at: now, kind: "failed", usd: null, venue: step.venue, recipient: null });
    const recipient = plan ? planRecipient(step.kind, plan.params) : null;
    if (recipient && step.status !== "failed") await rememberRecipient(ctx, graph.owner, recipient);
  } catch (error) {
    ctx.log.warn("security postflight failed", { intentId: input.intentId, stepId: input.stepId, error: error instanceof Error ? error.message : String(error) });
  }
}
