/**
 * Leashes in the Fold: pure helpers for the Leashes section and the New
 * leash sheet. Meters, time left, the sheet's form and its checks, the
 * request it sends, and the sample leashes the sample flock shows.
 */
import { LEASH_LIMITS, LEASH_TEMPLATES, budgetIssues, draftBudget, isAddress, leashDraftOf, usdMicros, type Address, type ArcEnvironment, type LeashDraft, type LeashTemplateKey, type LeashWindow } from "@lykia/core";
import type { CreateLeashRequest, LeashTrailItem, LeashView } from "@lykia/core/api/leash";

export type LeashStep = "who" | "limits" | "review";
export const LEASH_STEPS: readonly { readonly id: LeashStep; readonly label: string }[] = [
  { id: "who", label: "Who" },
  { id: "limits", label: "Limits" },
  { id: "review", label: "Review" },
];

/** The three templates the sheet offers (custom goes through the API). */
export const SHEET_TEMPLATES: readonly Exclude<LeashTemplateKey, "custom">[] = ["pay-invoices", "trade-small", "earn"];

export interface LeashForm {
  readonly name: string;
  readonly mission: string;
  readonly template: Exclude<LeashTemplateKey, "custom">;
  /** "generate": a session key made in this browser; "own": the agent's address. */
  readonly keyMode: "generate" | "own";
  readonly signer: string;
  readonly perDayUsd: string;
  readonly perStepUsd: string;
  readonly days: string;
  /** Comma- or line-separated payee addresses. */
  readonly recipients: string;
  readonly venues: readonly string[];
}

export function emptyForm(template: Exclude<LeashTemplateKey, "custom"> = "pay-invoices"): LeashForm {
  const t = LEASH_TEMPLATES[template];
  return { name: "", mission: "", template, keyMode: "generate", signer: "", perDayUsd: t.suggested.perDayUsd, perStepUsd: t.suggested.perStepUsd, days: "7", recipients: "", venues: [...(t.venues ?? [])] };
}

/** A form prefilled from Ask Lyko's draft. */
export function formFromDraft(draft: LeashDraft): LeashForm {
  const base = emptyForm(draft.template === "custom" ? "pay-invoices" : draft.template);
  return { ...base, name: draft.name, perDayUsd: draft.perDayUsd, perStepUsd: draft.perStepUsd ?? draft.perDayUsd, days: String(draft.days), recipients: (draft.recipients ?? []).join("\n") };
}

/** A `?leash=` draft from the URL, checked (unknown fields dropped, anything malformed is null). */
export function draftFromParam(value: string | null, decode: (v: string) => unknown): LeashDraft | null {
  if (!value) return null;
  return leashDraftOf(decode(value));
}

export function withTemplate(form: LeashForm, template: Exclude<LeashTemplateKey, "custom">): LeashForm {
  const t = LEASH_TEMPLATES[template];
  return { ...form, template, venues: [...(t.venues ?? [])], ...(form.perDayUsd ? {} : { perDayUsd: t.suggested.perDayUsd, perStepUsd: t.suggested.perStepUsd }) };
}

export function recipientsOf(form: Pick<LeashForm, "recipients">): string[] {
  return [...new Set(form.recipients.split(/[\s,;]+/u).map((r) => r.trim().toLowerCase()).filter(Boolean))];
}

export function daysOf(form: Pick<LeashForm, "days">): number {
  const n = Number(form.days);
  return Number.isInteger(n) ? n : NaN;
}

/** The budget the form asks for: per step, per day, and the total over the days. */
export function budgetOf(form: Pick<LeashForm, "perDayUsd" | "perStepUsd" | "days">) {
  const days = daysOf(form);
  const day = form.perDayUsd.trim();
  const step = form.perStepUsd.trim() || day;
  if (!Number.isInteger(days) || days < 1 || !/^\d{1,12}(?:\.\d{1,2})?$/u.test(day)) return { perStepUsd: step, perDayUsd: day, totalUsd: "" };
  return { ...draftBudget({ perDayUsd: day, perStepUsd: step, days }), perStepUsd: step };
}

export interface FormIssue {
  readonly field: keyof LeashForm | "budget";
  readonly message: string;
}

/** What stops the sheet moving on from a step. */
export function formIssues(form: LeashForm, step: LeashStep, owner: string | null): FormIssue[] {
  const out: FormIssue[] = [];
  if (step === "who" || step === "review") {
    if (!form.name.trim()) out.push({ field: "name", message: "Give the agent a name." });
    else if (form.name.trim().length > LEASH_LIMITS.nameLength) out.push({ field: "name", message: `At most ${LEASH_LIMITS.nameLength} characters.` });
    if (form.keyMode === "own") {
      if (!isAddress(form.signer.trim())) out.push({ field: "signer", message: "The agent's own address, 0x followed by 40 hex characters." });
      else if (owner && form.signer.trim().toLowerCase() === owner.toLowerCase()) out.push({ field: "signer", message: "Not your own wallet: the agent needs a key of its own." });
    }
  }
  if (step === "limits" || step === "review") {
    const days = daysOf(form);
    if (!Number.isInteger(days) || days < 1 || days > LEASH_LIMITS.maxDays) out.push({ field: "days", message: `1 to ${LEASH_LIMITS.maxDays} days.` });
    else {
      for (const i of budgetIssues(budgetOf(form))) out.push({ field: i.path === "budget.perStepUsd" ? "perStepUsd" : "perDayUsd", message: i.message });
    }
    const payees = recipientsOf(form);
    if (LEASH_TEMPLATES[form.template].recipients === "allowlist") {
      if (payees.length === 0) out.push({ field: "recipients", message: "Name at least one payee: this leash pays known recipients only." });
    }
    if (payees.some((p) => !isAddress(p))) out.push({ field: "recipients", message: "Each payee is an address, 0x followed by 40 hex characters." });
    if (payees.length > LEASH_LIMITS.recipients) out.push({ field: "recipients", message: `At most ${LEASH_LIMITS.recipients} payees.` });
    if (LEASH_TEMPLATES[form.template].venues && form.venues.length === 0) out.push({ field: "venues", message: "Keep at least one venue." });
  }
  return out;
}

/** The POST /v1/leashes body. */
export function requestOf(form: LeashForm, input: { readonly owner: string; readonly environment: ArcEnvironment; readonly signer: string; readonly now: number }): CreateLeashRequest {
  const days = daysOf(form);
  const payees = recipientsOf(form);
  const t = LEASH_TEMPLATES[form.template];
  return {
    owner: input.owner as Address,
    environment: input.environment,
    agent: { name: form.name.trim(), ...(form.mission.trim() ? { mission: form.mission.trim() } : {}), signer: input.signer as Address },
    template: form.template,
    budget: budgetOf(form),
    expiresAt: new Date(input.now + days * 86_400_000).toISOString(),
    ...(t.recipients === "allowlist" ? { recipients: payees as Address[] } : {}),
    ...(t.venues && form.venues.length !== t.venues.length ? { venues: form.venues } : {}),
  };
}

/* ------------------------------------------------------------ cards */

export interface MeterView {
  readonly share: number;
  readonly used: number;
  readonly cap: number;
  readonly tone: "ok" | "warn" | "bad";
}

export function meterOf(w: LeashWindow): MeterView {
  return { share: w.share, used: Number(w.spentUsd), cap: Number(w.capUsd), tone: w.share >= 0.95 ? "bad" : w.share >= 0.8 ? "warn" : "ok" };
}

/** True when today's or the total budget is 80% used or more. */
export function nearCap(l: Pick<LeashView, "usage">): boolean {
  return l.usage.day.share >= 0.8 || l.usage.total.share >= 0.8;
}

export function timeLeft(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} d ${h % 24} h left`;
  if (h >= 1) return `${h} h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min left`;
}

export function statusLabel(l: Pick<LeashView, "status" | "session">): string {
  if (l.status === "pending") return l.session?.sessionId ? "live" : "waiting for your signature";
  if (l.status === "active") return "live";
  return l.status;
}

export function venueLabel(l: Pick<LeashView, "venues" | "recipients" | "template">): string {
  if (l.template === "pay-invoices") return l.recipients.length > 0 ? `${l.recipients.length} payee${l.recipients.length === 1 ? "" : "s"}` : "no payees";
  return (l.venues ?? []).join(", ") || "any venue the Fence allows";
}

export function actionLine(i: Pick<LeashTrailItem, "kind" | "summary" | "usd" | "chainProven">): string {
  const what = i.kind === "denied" ? "Refused" : i.kind === "settled" ? "Done" : i.kind === "failed" ? "Failed" : i.kind === "planned" ? "Planned" : i.kind === "onchain" ? "On chain" : "Sent";
  return `${what}: ${i.summary}${i.usd ? ` ($${i.usd})` : ""}`;
}

/** "$50", "$10.10": whole dollars without cents, anything else with two decimals. */
export const usdText = (v: string | number) => {
  const n = Number(v);
  return `$${n.toLocaleString("en-US", Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Money left per step right now: the smallest of the step cap and what is left today and in total. */
export function stepLeft(l: Pick<LeashView, "budget" | "usage">): string {
  const values = [l.budget.perStepUsd, l.usage.day.remainingUsd, l.usage.total.remainingUsd];
  return values.reduce((a, b) => (usdMicros(a) <= usdMicros(b) ? a : b));
}

/* ------------------------------------------------------------ samples */

const SAMPLE_OWNER = "0x000000000000000000000000000000000000dead" as Address;

function sample(id: string, partial: Partial<LeashView> & Pick<LeashView, "agentName" | "template" | "budget" | "expiresAt">, spent: { day: string; total: string }, recent: LeashTrailItem[]): LeashView {
  const w = (s: string, cap: string): LeashWindow => {
    const share = Math.min(1, Number(s) / Number(cap));
    return { spentUsd: Number(s).toFixed(2), capUsd: Number(cap).toFixed(2), remainingUsd: Math.max(0, Number(cap) - Number(s)).toFixed(2), share };
  };
  return {
    schema: "lykia.leash/v1",
    id,
    owner: SAMPLE_OWNER,
    environment: "mainnet",
    agentId: `${SAMPLE_OWNER}:agt_${id.slice(4, 16)}`,
    parentAgentId: null,
    fence: { schema: "lykia.fence/v1" },
    fenceHash: `sha256:${"0".repeat(64)}`,
    tools: ["plan", "submit", "status", "trail", "venues", "scent"],
    venues: LEASH_TEMPLATES[partial.template].venues,
    recipients: [],
    status: "active",
    session: null,
    tag: null,
    key: { id: id.slice(4), prefix: `lk_leash_live_${id.slice(4)}_` },
    createdBy: { via: "session", developer: SAMPLE_OWNER },
    createdAt: new Date(Date.parse(partial.expiresAt) - 7 * 86_400_000).toISOString(),
    ...partial,
    usage: { asOf: new Date().toISOString(), source: "chain", block: null, sessionValid: true, day: w(spent.day, partial.budget.perDayUsd), total: w(spent.total, partial.budget.totalUsd), perStepUsd: partial.budget.perStepUsd, tokens: [], calls: null, secondsLeft: 0 },
    recent,
  } as LeashView;
}

/** What the sample flock shows: an invoice bot near its daily cap and a small trader with room left. */
export function sampleLeashes(now: number): LeashView[] {
  const day = 86_400_000;
  const at = (ms: number) => new Date(now - ms).toISOString();
  return [
    sample(
      "lsh_sample000001",
      { agentName: "Invoice bot", template: "pay-invoices", budget: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" }, expiresAt: new Date(now + 4 * day + 6 * 3_600_000).toISOString(), recipients: ["0x2222222222222222222222222222222222222222", "0x4444444444444444444444444444444444444444"] },
      { day: "17.17", total: "58.58" },
      [
        { at: at(40 * 60_000), kind: "denied", summary: "Pay 9 USDC to Kite Hosting", usd: "9.09", chainProven: false, source: "lykia", reasons: [{ code: "leash.budget.day", message: "$9.09 is more than the $2.83 left today." }] },
        { at: at(3 * 3_600_000), kind: "settled", summary: "Send 12 USDC to Kite Hosting (invoice 4411)", usd: "12.12", chainProven: true, source: "lykia" },
        { at: at(9 * 3_600_000), kind: "settled", summary: "Send 5 USDC to Atlas Data (invoice 0192)", usd: "5.05", chainProven: true, source: "lykia" },
      ],
    ),
    sample(
      "lsh_sample000002",
      { agentName: "FX scout", template: "trade-small", budget: { perStepUsd: "25", perDayUsd: "50", totalUsd: "350" }, expiresAt: new Date(now + 6 * day + 2 * 3_600_000).toISOString() },
      { day: "10.10", total: "30.30" },
      [{ at: at(2 * 3_600_000), kind: "settled", summary: "Swap 10 USDC to EURC on Uniswap v3", usd: "10.10", chainProven: true, source: "lykia" }],
    ),
  ];
}
