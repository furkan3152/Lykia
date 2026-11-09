/**
 * The intent compiler, end to end:
 *
 *   words --read--> lykia.program/v1 --resolve--> amounts + assumptions
 *         --compile--> plan for now + drafts for later --check--> route search,
 *         Fence verdicts, round-trip of every automation sentence
 *
 * Reading: the model (any language, one structured tool call, validated and
 * repaired once) when one is configured, reconciled with the deterministic
 * English lexicon (hybrid.ts), else the lexicon alone; injected data never
 * becomes an element either way. Resolution reads the owner's Flock, prices and contacts (or
 * what-if balances the caller passes, flagged as hypothetical). The plan for
 * now goes through the real route search under the owner's Fence, tightened
 * by the program's venue policy, with the program digest pinned in the Fence
 * facts. Drafts are previewed against the Fence as dry runs and returned
 * with links to their prefilled forms; this module never saves them and
 * never signs anything.
 */
import {
  alertDraftLink,
  leashDraftLink,
  leashDraftOf,
  alertDraftOf,
  automationDraftLink,
  automationDraftOf,
  canonicalDigest,
  canonicalJson,
  compileProgram,
  emptyProgram,
  fenceForProfile,
  fenceHash,
  KNOWLEDGE_ROWS,
  programHash,
  readWatchRequest,
  projectFence,
  tightenFence,
  venueFactsFrom,
  type Address,
  type ArcEnvironment,
  type CompiledProgram,
  type Fence,
  type PlanAction,
  type Program,
  type ProgramState,
  type ScheduledDraft,
  type WatchCondition,
} from "@lykia/core";
import type { Request } from "express";
import { readAssist, type AssistReading } from "@lykia/core";
import { capabilityMap } from "../capabilities/map.js";
import type { AppContext } from "../context.js";
import { agentServices } from "../agents/index.js";
import type { LlmClient } from "../agents/llm.js";
import { constrainedFence, type AiConstraints } from "../aggregator/ai.js";
import { readSentence } from "../language/reader.js";
import { memoryService } from "../personal/memory.js";
import { getProfile } from "../personal/profile.js";
import { projectOf } from "../platform/projects.js";
import { services } from "../services.js";
import { groundAmounts, lexiconReading, readDeterministic, reconcile } from "./hybrid.js";
import { readProgramWithModel } from "./llm.js";

const SAMPLE_OWNER = "0x000000000000000000000000000000000000dead";
const PREVIEW_TIMEOUT_MS = 15_000;
const MAX_PREVIEWS = 6;

export interface CompileInput {
  readonly text: string;
  /**
   * The owner's own words when `text` was written by a model (Ask Lyko's compile_goal): amounts are grounded against
   * these, so a figure the model added to its restatement is asked about, never planned. Defaults to `text`.
   */
  readonly ownerText?: string;
  readonly owner?: Address | null;
  readonly environment?: ArcEnvironment;
  /** Assumption id -> the owner's choice (see core programCompile.ts Assumption). */
  readonly overrides?: Readonly<Record<string, string>>;
  /** What-if balances (whole tokens); the result is flagged hypothetical and nothing is stored. */
  readonly balances?: Readonly<Record<string, string>>;
  readonly constraints?: AiConstraints;
  /** Run the route search on the plan for now (default true when an owner is known). */
  readonly search?: boolean;
  /** Store the winning plan as an intent the owner can sign (needs an owner; never for what-if balances). */
  readonly plan?: boolean;
  /** "auto" (default): the model when configured, else the lexicon. */
  readonly reader?: "auto" | "llm" | "deterministic";
  /** Preview each draft against the Fence with a dry run (default true when an owner is known). */
  readonly preview?: boolean;
  /** Use this Fence instead of the profile's (the chat passes the acting agent's Fence). */
  readonly fence?: Fence;
  readonly proposedByAgent?: boolean;
}

export interface VerdictBrief {
  readonly decision: "allow" | "confirm" | "deny" | "unknown";
  readonly reasons: readonly string[];
  readonly digest: string | null;
}

export type CheckedDraft = ScheduledDraft & {
  /** The prefilled form (automations, alerts) or the page that creates it. */
  readonly link: string;
  /** The draft passed core's draft validator (the same check the web page runs). */
  readonly valid: boolean;
  /** Automations: the plan sentence reads back into exactly the drafted actions. */
  readonly roundTrip?: "ok" | "mismatch";
  readonly verdict: VerdictBrief;
};

export interface CompileResult {
  readonly schema: "lykia.compile-result/v1";
  readonly status: CompiledProgram["status"];
  readonly source: "llm" | "deterministic";
  readonly note: string | null;
  readonly language: string | null;
  readonly environment: ArcEnvironment;
  readonly owner: Address | null;
  readonly hypothetical: boolean;
  readonly program: Program;
  readonly programHash: string;
  readonly resolution: CompiledProgram["resolution"];
  readonly resolutionHash: string;
  readonly now: (NonNullable<CompiledProgram["now"]> & {
    readonly search: { readonly best: unknown; readonly alternatives: number; readonly pruned: readonly { label: string; reason: string }[]; readonly failedChecks: readonly { label: string; reason: string }[] } | null;
    readonly verdict: VerdictBrief;
    readonly intentId: string | null;
    readonly signable: boolean;
  }) | null;
  readonly scheduled: readonly CheckedDraft[];
  readonly why: CompiledProgram["why"];
  readonly questions: CompiledProgram["questions"];
  /** Binds program, resolution, Fence and verdict: the same digest goes into the plan's Fence facts. */
  readonly pin: { readonly programHash: string; readonly resolutionHash: string; readonly fenceHash: string | null; readonly verdictDigest: string | null; readonly digest: string };
  /** Set when the words ask for a watch rather than a move: Ask Lyko hands it to Lyko on watch (core/agentInstructions). */
  readonly watch?: { readonly condition: WatchCondition; readonly label: string };
  /** Set when the capability map reads the words: a capability question, a feature to offer, or the one question to ask (core/capabilities). */
  readonly assist?: AssistReading;
}

/** What the capability map reads in the words, if anything (never for a watch, which has its own reader). */
function assistOf(text: string, environment: ArcEnvironment): { assist?: AssistReading } {
  if (readWatchRequest(text)) return {};
  const a = readAssist(text, capabilityMap(environment));
  return a ? { assist: a } : {};
}

/** The watch the words ask for, if any, in the compile result's shape. */
function watchOf(text: string): { watch?: { condition: WatchCondition; label: string } } {
  const w = readWatchRequest(text);
  return w ? { watch: { condition: w.condition, label: w.label } } : {};
}

/**
 * Words to a program: the model when configured (any language), reconciled
 * with the deterministic lexicon (hybrid.ts), else the English lexicon.
 * Every path goes through the deterministic guard.
 */
export async function readGoal(llm: LlmClient | null, text: string, contacts: readonly { name: string; address: string }[] = [], reader: CompileInput["reader"] = "auto", ownerText?: string): Promise<{ program: Program; source: "llm" | "deterministic"; note: string | null; language: string | null }> {
  const read = await readGoalUngrounded(llm, text, contacts, reader);
  if (ownerText === undefined || ownerText === text) return read;
  // The text came from a model: every exact amount, on every path (the lexicon reads it too), must be in the owner's words.
  const grounded = groundAmounts(read.program, ownerText);
  if (grounded.dropped === 0) return read;
  return { ...read, program: grounded.program, note: [read.note, "Amounts the owner did not state were turned into questions."].filter(Boolean).join(" ") };
}

async function readGoalUngrounded(llm: LlmClient | null, text: string, contacts: readonly { name: string; address: string }[], reader: CompileInput["reader"]): Promise<{ program: Program; source: "llm" | "deterministic"; note: string | null; language: string | null }> {
  if (llm && reader !== "deterministic") {
    try {
      const result = await readProgramWithModel(llm, text, contacts);
      if (result.program) {
        const merged = reconcile(result.program, result.language);
        const note = [result.repaired ? "The model's first program did not validate; it repaired it once." : null, merged.note].filter(Boolean).join(" ") || null;
        return { program: merged.program, source: "llm", note, language: result.language };
      }
      const issues = result.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join(" ");
      if (result.language === "en") {
        const lex = lexiconReading(text);
        if (lex.understood && lex.complete) return { program: readDeterministic(text), source: "deterministic", note: `The model's program did not validate after one repair (${issues}); the English lexicon read every clause instead.`, language: "en" };
      }
      const base = emptyProgram(text, result.language);
      return { program: { ...base, questions: ["I could not turn that into a plan I can verify. Could you say it again with the amounts, tokens and recipients spelled out?"] }, source: "llm", note: `The model's program did not validate after one repair (${issues}).`, language: result.language };
    } catch (error) {
      const fallback = readDeterministic(text);
      return { program: fallback, source: "deterministic", note: `The model did not answer (${error instanceof Error ? error.message.slice(0, 100) : "error"}); the English lexicon read it.`, language: "en" };
    }
  }
  return { program: readDeterministic(text), source: "deterministic", note: llm ? null : "No model is configured: the deterministic lexicon reads English goal language.", language: "en" };
}

/** The owner's state the resolver needs: wallet balances, positions, prices, venue facts, fee, beta cap, contacts. */
async function programState(ctx: AppContext, environment: ArcEnvironment, owner: Address | null, balances?: Readonly<Record<string, string>>, live = false): Promise<ProgramState> {
  const s = services(ctx);
  const base = { environment, venues: venueFactsFrom(KNOWLEDGE_ROWS), feeBps: ctx.config.fee.bps, beta: environment === "mainnet" ? ctx.config.beta : null, gasBufferUsdc: "1", now: ctx.clock.now() } as const;
  const symbols = ["USDC", "EURC", "cirBTC", "WETH", "USYC"];
  const priceRows = await s.prices.prices(symbols).catch(() => ({}) as Record<string, { usd: string | null }>);
  const prices: Record<string, string | null> = Object.fromEntries(symbols.map((sym) => [sym, (priceRows as Record<string, { usd: string | null } | undefined>)[sym]?.usd ?? (sym === "USDC" ? "1" : null)]));
  let timezone = "UTC";
  let contacts: { name: string; address: string }[] = [];
  const real = owner && owner.toLowerCase() !== SAMPLE_OWNER ? owner : null;
  if (real) {
    const profile = await getProfile(ctx, real).catch(() => null);
    timezone = profile?.quietHours?.timezone ?? "UTC";
    if (profile?.memory.enabled) {
      const snap = await memoryService(ctx).snapshot(real).catch(() => null);
      contacts = (snap?.contacts ?? []).filter((c) => c.origin === "manual" || c.confirmedSends > 0).map((c) => ({ name: c.name, address: c.address }));
    }
  }
  if (balances) return { ...base, owner: real, balances: { ...balances }, prices, timezone, contacts, hypothetical: true };
  // Signed out, Ask plans for the sample address read live from Arc, like every other read in an Ask turn
  // (the Fold's fixture is for the Fold only); the result stays a what-if, never signable.
  const reader = real ?? (live ? (SAMPLE_OWNER as Address) : null);
  if (!reader) return { ...base, owner: null, balances: null, prices, timezone, contacts };
  const snap = await s.flock.snapshot(environment, reader);
  const wallet: Record<string, string> = {};
  for (const h of snap.holdings) if (h.where === "wallet" && h.kind === "token") wallet[h.symbol] = h.amount;
  for (const sym of ["USDC", "EURC"]) wallet[sym] ??= "0";
  for (const [sym, p] of Object.entries(snap.prices)) if (p.usd !== null) prices[sym] = p.usd;
  return { ...base, owner: real, balances: wallet, positions: snap.holdings.filter((h) => h.where !== "wallet").map((h) => ({ symbol: h.symbol, where: h.where, amount: h.amount, kind: h.kind })), prices, timezone, contacts, ...(real ? {} : { hypothetical: true }) };
}

const normalize = (actions: readonly PlanAction[]) => canonicalJson(actions.map((a) => ({ ...a, ...("to" in a && typeof a.to === "string" && a.to.startsWith("0x") ? { to: a.to.toLowerCase() } : {}) })));

/** Does the automation's sentence read back into exactly its actions? (The automation re-plans the sentence at each fire.) */
export function roundTrip(sentence: string, actions: readonly PlanAction[]): "ok" | "mismatch" {
  const parsed = readSentence(sentence);
  if (parsed.clarify.length > 0) return "mismatch";
  const strip = (list: readonly PlanAction[]) => list.map((a) => (a.verb === "earn" ? { ...a, maxRisk: a.maxRisk ?? "medium" } : a));
  return normalize(strip(parsed.actions)) === normalize(strip(actions)) ? "ok" : "mismatch";
}

function linkOf(d: ScheduledDraft): { link: string; valid: boolean } {
  switch (d.kind) {
    case "automation": {
      const valid = automationDraftOf(d.draft) !== null;
      return { link: automationDraftLink(d.draft), valid };
    }
    case "alert": {
      const valid = alertDraftOf(d.draft) !== null;
      return { link: alertDraftLink(d.draft), valid };
    }
    case "order":
      // Signed from its order card in the chat; once armed it lives in Herding.
      return { link: "/app/fold/herding?show=orders", valid: true };
    case "standing":
      return { link: "/app/fold/herding?show=automations", valid: true };
    case "budget":
      return { link: "/app/fold/pack", valid: true };
    case "leash": {
      const valid = leashDraftOf(d.draft) !== null;
      return { link: leashDraftLink(d.draft), valid };
    }
  }
}

function brief(verdict: { decision: "allow" | "confirm" | "deny"; reasons: readonly { decision: string; message: string }[]; digest: string } | null | undefined): VerdictBrief {
  if (!verdict) return { decision: "unknown", reasons: [], digest: null };
  return { decision: verdict.decision, reasons: verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message).slice(0, 6), digest: verdict.digest };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The owner's Fence (or the project's, or the given one), tightened by the integrator's constraints and the program's venue policy. */
async function fenceFor(ctx: AppContext, input: CompileInput, http: Request | null, owner: Address | null, compiled: CompiledProgram): Promise<Fence> {
  const project = http ? projectOf(http) : null;
  let fence: Fence = input.fence ?? input.constraints?.fence ?? (project ? projectFence(project) : fenceForProfile(owner ? await getProfile(ctx, owner).catch(() => getProfile(ctx, SAMPLE_OWNER as Address)) : await getProfile(ctx, SAMPLE_OWNER as Address)));
  if (project) fence = tightenFence(fence, project);
  const deny = compiled.resolution.venuePolicy.excluded.map((x) => x.venue);
  return constrainedFence(fence, { ...input.constraints, venues: { ...input.constraints?.venues, deny: [...new Set([...(input.constraints?.venues?.deny ?? []), ...deny])] } });
}

/**
 * The compiler without I/O: a program (or the lexicon's reading of the text)
 * against a given state, with drafts checked (draft validators, sentence
 * round trips) but no route search and no Fence previews. The offline
 * evaluation suite and tests use it; the result has the HTTP shape.
 */
export function compileOffline(text: string, state: ProgramState, options: { readonly overrides?: Readonly<Record<string, string>>; readonly program?: Program } = {}): CompileResult {
  const program = options.program ?? readDeterministic(text);
  const compiled = compileProgram(program, state, options.overrides ? { overrides: options.overrides } : {});
  const offline: VerdictBrief = { decision: "unknown", reasons: ["Offline: the route search and the Fence run when the plan is made."], digest: null };
  const scheduled = compiled.scheduled.map((d) => ({ ...d, ...linkOf(d), ...(d.kind === "automation" && d.draft.action.type === "plan" ? { roundTrip: roundTrip(d.draft.action.sentence, d.actions) } : {}), verdict: offline }) as CheckedDraft);
  const pin = { programHash: compiled.programHash, resolutionHash: compiled.resolutionHash, fenceHash: null, verdictDigest: null };
  return {
    schema: "lykia.compile-result/v1",
    ...watchOf(text),
    ...assistOf(text, state.environment),
    status: compiled.status,
    source: options.program ? "llm" : "deterministic",
    note: null,
    language: program.language,
    environment: state.environment,
    owner: (state.owner as Address | null) ?? null,
    hypothetical: state.hypothetical === true,
    program: compiled.program,
    programHash: compiled.programHash,
    resolution: compiled.resolution,
    resolutionHash: compiled.resolutionHash,
    now: compiled.now ? { ...compiled.now, search: null, verdict: offline, intentId: null, signable: false } : null,
    scheduled,
    why: compiled.why,
    questions: compiled.questions,
    pin: { ...pin, digest: canonicalDigest(pin) },
  };
}

export async function compileIntent(ctx: AppContext, input: CompileInput, http: Request | null = null): Promise<CompileResult> {
  const environment = input.environment ?? ctx.config.mode;
  const owner = input.owner && input.owner.toLowerCase() !== SAMPLE_OWNER ? input.owner : null;
  const sample = !owner && !input.balances && input.owner?.toLowerCase() === SAMPLE_OWNER;
  const state = await programState(ctx, environment, owner, input.balances, sample);
  const llm = input.reader === "deterministic" ? null : agentServices(ctx).llm();
  const read = await readGoal(llm, input.text, state.contacts ?? [], input.reader, input.ownerText);
  if (sample) read.note = `${read.note ? `${read.note} ` : ""}No wallet is connected: amounts use the sample address ${SAMPLE_OWNER} read live from Arc (${state.balances?.USDC ?? "0"} USDC in its wallet), as a what-if.`;
  const compiled = compileProgram(read.program, state, input.overrides ? { overrides: input.overrides } : {});
  const fence = await fenceFor(ctx, input, http, owner, compiled);
  const s = services(ctx);
  const pinProgram = compiled.programHash as `sha256:${string}`;
  const hypothetical = state.hypothetical === true;

  let now: CompileResult["now"] = null;
  if (compiled.now) {
    let search: NonNullable<CompileResult["now"]>["search"] = null;
    let verdict: VerdictBrief = { decision: "unknown", reasons: owner ? [] : ["No wallet: the plan is checked against the Fence when an owner plans it."], digest: null };
    let intentId: string | null = null;
    let signable = false;
    const wantSearch = (input.search ?? true) && owner !== null && compiled.status !== "refused";
    if (wantSearch) {
      try {
        const spent = await s.intents.spent(environment, owner);
        const profile = await getProfile(ctx, owner).catch(() => null);
        const result = await s.search.search({
          environment,
          owner,
          actions: compiled.now.actions,
          fence,
          source: input.text.slice(0, 500),
          appetite: compiled.resolution.venuePolicy.maxRisk,
          spent,
          program: pinProgram,
          ...(input.proposedByAgent ? { proposedByAgent: true } : {}),
          ...(profile ? { preferences: { favorites: profile.venues.favorites, blocked: profile.venues.blocked, maxRisk: compiled.resolution.venuePolicy.maxRisk } } : {}),
          ...(input.constraints?.horizonDays ? { horizonDays: input.constraints.horizonDays } : {}),
          ...(input.constraints?.maxCandidates ? { maxCandidates: input.constraints.maxCandidates } : { maxCandidates: 6 }),
        });
        search = { best: result.best, alternatives: result.alternatives.length, pruned: result.pruned.slice(0, 8), failedChecks: result.failedChecks };
        if (result.best) {
          signable = result.best.signable && !hypothetical;
          verdict = { decision: result.best.decision, reasons: result.best.explanation.fence.filter((f) => !/^allow/iu.test(f)).slice(0, 6), digest: null };
          if (input.plan && !hypothetical && result.best.decision !== "deny") {
            const created = await s.intents.create({ environment, owner, actions: result.best.actions, source: input.text.slice(0, 500), fence, program: pinProgram, ...(input.proposedByAgent ? { proposedByAgent: true } : {}) });
            intentId = created.stored ? created.intent.id : null;
            verdict = brief(created.intent.verdict);
            signable = created.intent.verdict.signable;
          }
        } else verdict = { decision: "deny", reasons: [...result.pruned.slice(0, 3).map((p) => `${p.label}: ${p.reason}`), ...result.failedChecks.map((f) => `${f.label}: ${f.reason}`)].slice(0, 6), digest: null };
      } catch (error) {
        verdict = { decision: "unknown", reasons: [error instanceof Error ? error.message.slice(0, 200) : "The route search failed."], digest: null };
      }
    }
    now = { ...compiled.now, search, verdict, intentId, signable };
  }

  const wantPreview = (input.preview ?? true) && owner !== null;
  let previews = 0;
  const scheduled: CheckedDraft[] = [];
  for (const d of compiled.scheduled) {
    const { link, valid } = linkOf(d);
    let verdict: VerdictBrief = { decision: "unknown", reasons: d.kind === "alert" ? ["Watches move no money."] : d.kind === "budget" ? ["A Fence change: you sign it on the Pack page."] : [], digest: null };
    const previewActions: readonly PlanAction[] | null = d.kind === "automation" ? d.actions : d.kind === "standing" ? d.draft.actions : d.kind === "order" ? [{ verb: "swap", from: d.order.sell, to: d.order.buy, amount: { exact: d.order.amount } }] : null;
    if (wantPreview && previewActions && previewActions.length > 0 && previews < MAX_PREVIEWS) {
      previews++;
      try {
        const planned = await withTimeout(s.intents.create({ environment, owner, actions: previewActions, source: `preview: ${d.summary}`.slice(0, 500), fence, dryRun: true, program: pinProgram, ...(input.proposedByAgent ? { proposedByAgent: true } : {}) }), PREVIEW_TIMEOUT_MS);
        verdict = planned ? { ...brief(planned.intent.verdict), reasons: [...brief(planned.intent.verdict).reasons, "Previewed today as a dry run; each run is checked again when it fires."] } : { decision: "unknown", reasons: ["The preview timed out; each run is checked when it fires."], digest: null };
      } catch (error) {
        verdict = { decision: "unknown", reasons: [`Preview: ${error instanceof Error ? error.message.slice(0, 160) : "failed"}. Each run is checked when it fires.`], digest: null };
      }
    } else if (previewActions && !owner) verdict = { decision: "unknown", reasons: ["Checked against the Fence each time it fires."], digest: null };
    scheduled.push({ ...d, link, valid, ...(d.kind === "automation" && d.draft.action.type === "plan" ? { roundTrip: roundTrip(d.draft.action.sentence, d.actions) } : {}), verdict } as CheckedDraft);
  }

  const pin = { programHash: compiled.programHash, resolutionHash: compiled.resolutionHash, fenceHash: fenceHash(fence), verdictDigest: now?.verdict.digest ?? null };
  return {
    schema: "lykia.compile-result/v1",
    ...watchOf(input.text),
    ...assistOf(input.text, environment),
    status: compiled.status,
    source: read.source,
    note: read.note,
    language: read.language,
    environment,
    owner,
    hypothetical,
    program: compiled.program,
    programHash: programHash(compiled.program),
    resolution: compiled.resolution,
    resolutionHash: compiled.resolutionHash,
    now,
    scheduled,
    why: compiled.why,
    questions: compiled.questions,
    pin: { ...pin, digest: canonicalDigest(pin) },
  };
}
