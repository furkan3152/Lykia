/**
 * Scores one compiled result (the POST /v1/ai/compile shape, offline or
 * live) against a case's rubric: every rubric line is one check; a case
 * passes when all its checks pass.
 */
import type { EvalCase, Rubric } from "./intents.js";

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface CaseScore {
  readonly id: string;
  readonly category: string;
  readonly passed: boolean;
  readonly checks: readonly Check[];
  readonly score: number;
  readonly error?: string;
}

type Json = Record<string, unknown>;

/** Subset match: every key in `want` matches in `have` (recursively; numbers and strings compare by value). */
function matches(have: unknown, want: unknown): boolean {
  if (want === null || typeof want !== "object") return String(have) === String(want) || have === want;
  if (Array.isArray(want)) return Array.isArray(have) && want.every((w, i) => matches(have[i], w));
  if (have === null || typeof have !== "object") return false;
  return Object.entries(want as Json).every(([k, v]) => matches((have as Json)[k], v));
}

function subsequence(have: readonly string[], want: readonly string[]): boolean {
  let i = 0;
  for (const h of have) if (h === want[i]) i++;
  return i === want.length;
}

export function scoreResult(c: EvalCase, result: unknown): CaseScore {
  const r = (result ?? {}) as Json;
  const e: Rubric = c.expect;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(ok || !detail ? {} : { detail }) });
  const program = (r.program ?? {}) as Json;
  const elements = (Array.isArray(program.elements) ? program.elements : []) as Json[];
  const prefs = (program.preferences ?? {}) as Json;
  const resolution = (r.resolution ?? {}) as Json;
  const now = r.now as Json | null;
  const actions = (now && Array.isArray(now.actions) ? now.actions : []) as Json[];
  const verbs = actions.map((a) => String(a.verb));
  const scheduled = (Array.isArray(r.scheduled) ? r.scheduled : []) as Json[];
  const questions = (Array.isArray(r.questions) ? r.questions : []) as Json[];
  const refusals = (Array.isArray(resolution.refusals) ? resolution.refusals : []) as Json[];
  const assumptions = (Array.isArray(resolution.assumptions) ? resolution.assumptions : []) as Json[];
  const blockers = (Array.isArray(resolution.blockers) ? resolution.blockers : []) as Json[];
  const kept = (Array.isArray(resolution.kept) ? resolution.kept : []) as Json[];
  const acting = elements.filter((x) => x.kind !== "refuse");

  if (e.status) add(`status in ${e.status.join("|")}`, e.status.includes(r.status as never), `got ${String(r.status)}`);
  for (const want of e.elements ?? []) {
    const hit = acting.some((x) => x.kind === want.kind && (!want.match || matches(x, want.match)) && (!want.when || matches(x.when, { type: want.when })));
    add(`element ${want.kind}${want.match ? ` ${JSON.stringify(want.match)}` : ""}${want.when ? ` when ${want.when}` : ""}`, hit, `elements: ${JSON.stringify(acting.map((x) => ({ kind: x.kind, quantity: x.quantity, when: x.when })))}`.slice(0, 300));
  }
  for (const kind of e.noElements ?? []) add(`no ${kind} element`, !acting.some((x) => x.kind === kind));
  if (e.prefs) add(`preferences ${JSON.stringify(e.prefs)}`, matches(prefs, e.prefs), `got ${JSON.stringify(prefs)}`);
  if (e.nowVerbs) add(`plan verbs ${e.nowVerbs.join(" > ")}`, subsequence(verbs, e.nowVerbs), `got ${verbs.join(" > ") || "none"}`);
  for (const verb of e.noNowVerbs ?? []) add(`no ${verb} in the plan`, !verbs.includes(verb), `got ${verbs.join(" > ")}`);
  for (const want of e.nowAmounts ?? []) {
    const hit = actions.some((a) => a.verb === want.verb && (!want.token || a.token === want.token || a.from === want.token) && matches(a.amount, { exact: want.exact }));
    add(`amount ${want.verb} ${want.exact}`, hit, `got ${JSON.stringify(actions.map((a) => [a.verb, a.amount]))}`);
  }
  if (e.noNow) add("no plan for now", !now, `got ${verbs.join(" > ")}`);
  for (const want of e.scheduled ?? []) {
    const hit = scheduled.some((s) => s.kind === want.kind && (!want.orderKind || (s.order as Json | undefined)?.kind === want.orderKind));
    add(`draft ${want.kind}${want.orderKind ? `:${want.orderKind}` : ""}`, hit, `got ${scheduled.map((s) => `${String(s.kind)}${s.order ? `:${String((s.order as Json).kind)}` : ""}`).join(", ") || "none"}`);
  }
  if (e.kept) add(`kept ${e.kept.amount} ${e.kept.token}`, kept.some((k) => k.token === e.kept!.token && k.amount === e.kept!.amount), `got ${JSON.stringify(kept.map((k) => [k.token, k.amount]))}`);
  if (e.question) {
    const texts = questions.map((q) => String(q.text ?? q));
    add(`question${e.question === true ? "" : ` ${e.question}`}`, e.question === true ? texts.length > 0 : texts.some((t) => (e.question as RegExp).test(t)), `got ${JSON.stringify(texts).slice(0, 200)}`);
  }
  if (e.noQuestion) add("no question", questions.length === 0, `got ${JSON.stringify(questions.map((q) => q.text)).slice(0, 200)}`);
  for (const code of e.refusals ?? []) add(`refusal ${code}`, refusals.some((x) => x.code === code), `got ${refusals.map((x) => String(x.code)).join(", ") || "none"}`);
  for (const prefix of e.assumptions ?? []) add(`assumption ${prefix}`, assumptions.some((a) => String(a.id).startsWith(prefix)), `got ${assumptions.map((a) => String(a.id)).join(", ")}`);
  if (e.conflict) add("conflict recorded", Array.isArray(program.conflicts) && program.conflicts.length > 0);
  if (e.blocker) add(`blocker ${e.blocker}`, blockers.some((b) => e.blocker!.test(String(b.text))), `got ${JSON.stringify(blockers.map((b) => b.text)).slice(0, 200)}`);
  if (e.untrusted) add("marked untrusted", program.untrusted === true);
  if (e.roundTrip) {
    const autos = scheduled.filter((s) => s.kind === "automation" && s.roundTrip !== undefined);
    add("automation sentences round-trip", autos.length > 0 && autos.every((s) => s.roundTrip === "ok"), `got ${autos.map((s) => String(s.roundTrip)).join(", ") || "none"}`);
  }
  if (e.watch !== undefined) {
    const watch = (r.watch ?? null) as Json | null;
    if (e.watch === false) add("no watch", watch === null, `got ${JSON.stringify(watch)}`);
    else add(`watch ${JSON.stringify(e.watch)}`, watch !== null && matches(watch.condition, e.watch), `got ${JSON.stringify(watch)}`);
  }
  const passed = checks.every((x) => x.ok);
  return { id: c.id, category: c.category, passed, checks, score: checks.length === 0 ? 1 : checks.filter((x) => x.ok).length / checks.length };
}
