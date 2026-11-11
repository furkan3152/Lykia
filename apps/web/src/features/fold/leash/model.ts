/**
 * Leashes in the Fold: pure helpers for the Leashes section and the New
 * leash sheet. Meters, time left, the sheet's form and its checks, the
 * request it sends, and the sample leashes the sample flock shows.
 *
 * "Spend from" picks where the money is: the owner's LykiaAccount on Arc,
 * or the owner's Circle Gateway balance through their own LykiaStile (only
 * where the API offers it; otherwise the option reads "coming soon").
 */
import { LEASH_LIMITS, LEASH_TEMPLATES, STILE_BETA, budgetIssues, draftBudget, isAddress, leashDraftOf, stileBudgetIssues, usdMicros, type Address, type ArcEnvironment, type LeashDraft, type LeashSpendFrom, type LeashTemplateKey, type LeashWindow } from "@lykia/core";
import type { CreateLeashRequest, LeashTrailItem, LeashView } from "@lykia/core/api/leash";
import { formatUsd, t as msg } from "../../../i18n";

export type LeashStep = "who" | "from" | "limits" | "review";
export const LEASH_STEPS: readonly { readonly id: LeashStep; readonly label: string }[] = [
  { id: "who", label: msg("fold.leash.model.who") },
  { id: "from", label: msg("fold.leash.model.spendFrom") },
  { id: "limits", label: msg("fold.leash.model.limits") },
  { id: "review", label: msg("fold.leash.model.review") },
];

/** What GET /v1/leashes/templates says about spending from a Gateway balance. */
export interface GatewayOffer {
  readonly available: Readonly<Partial<Record<ArcEnvironment, boolean>>>;
  readonly reasons?: Readonly<Partial<Record<ArcEnvironment, string>>>;
  readonly destinations: readonly { readonly key: string; readonly name: string; readonly domain: number }[];
  readonly ceilings: { readonly perStepUsd: string; readonly perDayUsd: string };
}

export interface GatewayOption {
  readonly available: boolean;
  readonly reason: string | null;
  readonly destinations: readonly { readonly key: string; readonly name: string }[];
}

/** The Gateway option for one environment; "coming soon" when the API does not offer it or did not answer. */
export function gatewayOptionOf(offer: GatewayOffer | undefined, environment: ArcEnvironment): GatewayOption {
  if (!offer) return { available: false, reason: msg("fold.leash.model.comingSoon"), destinations: [] };
  const available = offer.available[environment] === true;
  return { available, reason: available ? null : msg("fold.leash.model.comingSoon"), destinations: offer.destinations.map((d) => ({ key: d.key, name: d.name })) };
}

/** A chain's name from the offer, or the key with a capital. */
export function chainName(key: string, offer?: Pick<GatewayOffer, "destinations">): string {
  return offer?.destinations.find((d) => d.key === key)?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
}

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
  /** Where the money is. */
  readonly spendFrom: LeashSpendFrom;
  /** Gateway only: chain keys the agent may pay on. */
  readonly destinations: readonly string[];
}

export function emptyForm(template: Exclude<LeashTemplateKey, "custom"> = "pay-invoices"): LeashForm {
  const t = LEASH_TEMPLATES[template];
  return { name: "", mission: "", template, keyMode: "generate", signer: "", perDayUsd: t.suggested.perDayUsd, perStepUsd: t.suggested.perStepUsd, days: "7", recipients: "", venues: [...(t.venues ?? [])], spendFrom: "arc", destinations: [] };
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
  // Only Pay invoices spends from a Gateway balance; another template goes back to the Arc wallet.
  const source = template !== "pay-invoices" && form.spendFrom === "gateway" ? { spendFrom: "arc" as const, destinations: [] } : {};
  return { ...form, template, venues: [...(t.venues ?? [])], ...source, ...(form.perDayUsd ? {} : { perDayUsd: t.suggested.perDayUsd, perStepUsd: t.suggested.perStepUsd }) };
}

/** Switches the money source. A Gateway leash pays named payees, so it takes the Pay invoices template. */
export function withSpendFrom(form: LeashForm, spendFrom: LeashSpendFrom): LeashForm {
  if (spendFrom === "arc") return { ...form, spendFrom };
  const paying = form.template === "pay-invoices" ? form : withTemplate(form, "pay-invoices");
  return { ...paying, spendFrom, venues: [], destinations: form.destinations.length > 0 ? form.destinations : ["arc"] };
}

export function toggleDestination(form: LeashForm, key: string): LeashForm {
  return { ...form, destinations: form.destinations.includes(key) ? form.destinations.filter((d) => d !== key) : [...form.destinations, key] };
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

/** One-tap limits for the sheet: each fills per day, per step and days. */
export const LIMIT_PRESETS: readonly { readonly label: string; readonly line: string; readonly perDayUsd: string; readonly perStepUsd: string; readonly days: string }[] = [
  { label: msg("fold.leash.model.tryItOut"), line: msg("fold.leash.model.n5ADayFor3Days"), perDayUsd: "5", perStepUsd: "5", days: "3" },
  { label: msg("fold.leash.model.smallBot"), line: msg("fold.leash.model.n20ADayFor7Days"), perDayUsd: "20", perStepUsd: "10", days: "7" },
  { label: msg("fold.leash.model.workingBot"), line: msg("fold.leash.model.n100ADayFor30Days"), perDayUsd: "100", perStepUsd: "50", days: "30" },
];

const usdWord = (v: string | number) => formatUsd(Number(v), { min: 0 });

/** The review in one sentence: "This bot can spend up to $20 a day for 7 days, only to these 2 payees. You can stop it anytime." */
export function leashSentence(form: LeashForm, payees: number): string {
  const days = Number(form.days);
  const when = msg("fold.leash.model.forDays", { n: days });
  const step = form.perStepUsd.trim() && form.perStepUsd.trim() !== form.perDayUsd.trim() ? msg("fold.leash.model.atMostAtATime", { usdWord: usdWord(form.perStepUsd) }) : "";
  const t = LEASH_TEMPLATES[form.template];
  const where = t.recipients === "allowlist" ? msg("fold.leash.model.onlyTo", { value: payees === 1 ? msg("fold.leash.model.thisPayee") : msg("fold.leash.model.thesePayees", { payees }) }) : msg("fold.leash.model.onlyOn", { value: form.venues.join(" and ") || msg("fold.leash.model.theVenuesYouPicked") });
  const name = form.name.trim() || msg("fold.leash.model.thisBot");
  return msg("fold.leash.model.leashSentence", { name, day: usdWord(form.perDayUsd || "0"), when, step, where });
}

export interface FormIssue {
  readonly field: keyof LeashForm | "budget";
  readonly message: string;
}

/** What stops the sheet moving on from a step. */
export function formIssues(form: LeashForm, step: LeashStep, owner: string | null): FormIssue[] {
  const out: FormIssue[] = [];
  if (step === "who" || step === "review") {
    if (!form.name.trim()) out.push({ field: "name", message: msg("fold.leash.model.giveTheAgentAName") });
    else if (form.name.trim().length > LEASH_LIMITS.nameLength) out.push({ field: "name", message: msg("fold.leash.model.atMostCharacters", { nameLength: LEASH_LIMITS.nameLength }) });
    if (form.keyMode === "own") {
      if (!isAddress(form.signer.trim())) out.push({ field: "signer", message: msg("fold.leash.model.theAgentSOwnAddress0x") });
      else if (owner && form.signer.trim().toLowerCase() === owner.toLowerCase()) out.push({ field: "signer", message: msg("fold.leash.model.notYourOwnWalletTheAgent") });
    }
  }
  if ((step === "from" || step === "review") && form.spendFrom === "gateway") {
    if (form.destinations.length === 0) out.push({ field: "destinations", message: msg("fold.leash.model.pickAtLeastOneChainThe") });
    if (form.template !== "pay-invoices") out.push({ field: "template", message: msg("fold.leash.model.aGatewayLeashPaysNamedPayees") });
  }
  if (step === "limits" || step === "review") {
    const days = daysOf(form);
    if (!Number.isInteger(days) || days < 1 || days > LEASH_LIMITS.maxDays) out.push({ field: "days", message: msg("fold.leash.model.n1ToDays", { maxDays: LEASH_LIMITS.maxDays }) });
    else {
      for (const i of budgetIssues(budgetOf(form))) out.push({ field: i.path === "budget.perStepUsd" ? "perStepUsd" : "perDayUsd", message: i.message });
      if (form.spendFrom === "gateway") for (const i of stileBudgetIssues(budgetOf(form))) out.push({ field: i.path === "budget.perStepUsd" ? "perStepUsd" : "perDayUsd", message: i.message });
    }
    const payees = recipientsOf(form);
    if (LEASH_TEMPLATES[form.template].recipients === "allowlist") {
      if (payees.length === 0) out.push({ field: "recipients", message: msg("fold.leash.model.nameAtLeastOnePayeeThis") });
    }
    if (payees.some((p) => !isAddress(p))) out.push({ field: "recipients", message: msg("fold.leash.model.eachPayeeIsAnAddress0x") });
    if (payees.length > LEASH_LIMITS.recipients) out.push({ field: "recipients", message: msg("fold.leash.model.atMostPayees", { recipients: LEASH_LIMITS.recipients }) });
    if (form.spendFrom === "arc" && LEASH_TEMPLATES[form.template].venues && form.venues.length === 0) out.push({ field: "venues", message: msg("fold.leash.model.keepAtLeastOneVenue") });
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
    ...(form.spendFrom === "gateway" ? { spendFrom: "gateway" as const, destinations: [...form.destinations] } : t.venues && form.venues.length !== t.venues.length ? { venues: form.venues } : {}),
  };
}

/** What the sheet shows on the sample flock instead of a real Gateway balance. */
export const SAMPLE_GATEWAY_BALANCE = { total: "1645", perChain: [{ chain: "Arc", balance: "1250" }, { chain: "Base", balance: "320" }, { chain: "Arbitrum", balance: "75" }] } as const;

/** The Gateway ceilings while LykiaStile is unaudited, for the sheet's copy. */
export const GATEWAY_CEILINGS = STILE_BETA;

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
  if (h >= 48) return msg("fold.leash.model.dHLeft", { Math: Math.floor(h / 24), value: h % 24 });
  if (h >= 1) return msg("fold.leash.model.hLeft", { h });
  return msg("fold.leash.model.minLeft", { Math: Math.max(1, Math.floor(ms / 60_000)) });
}

export function statusLabel(l: Pick<LeashView, "status" | "session">): string {
  if (l.status === "pending") return l.session?.sessionId ? "live" : msg("fold.leash.model.waitingForYourSignature");
  if (l.status === "active") return "live";
  return l.status;
}

export function spendFromLabel(l: Pick<LeashView, "spendFrom">): string {
  return l.spendFrom === "gateway" ? msg("fold.leash.model.gatewayBalance") : msg("fold.leash.model.arcWallet");
}

/** Where a Gateway leash may pay; null for an Arc leash. */
export function destinationsLabel(l: Pick<LeashView, "spendFrom" | "stile">, offer?: Pick<GatewayOffer, "destinations">): string | null {
  if (l.spendFrom !== "gateway") return null;
  const keys = l.stile?.destinations ?? [];
  return keys.length > 0 ? keys.map((k) => chainName(k, offer)).join(", ") : msg("fold.leash.model.noChain");
}

export function venueLabel(l: Pick<LeashView, "venues" | "recipients" | "template">): string {
  if (l.template === "pay-invoices") return l.recipients.length > 0 ? `${l.recipients.length} payee${l.recipients.length === 1 ? "" : "s"}` : msg("fold.leash.model.noPayees");
  return (l.venues ?? []).join(", ") || msg("fold.leash.model.anyVenueTheFenceAllows");
}

export function actionLine(i: Pick<LeashTrailItem, "kind" | "summary" | "usd" | "chainProven">): string {
  const what = i.kind === "denied" ? msg("fold.leash.model.refused") : i.kind === "settled" ? msg("fold.leash.model.done") : i.kind === "failed" ? msg("fold.leash.model.failed") : i.kind === "planned" ? msg("fold.leash.model.planned") : i.kind === "onchain" ? msg("fold.leash.model.onChain") : msg("fold.leash.model.sent");
  return `${what}: ${i.summary}${i.usd ? ` ($${i.usd})` : ""}`;
}

/** "$50", "$10.10": whole dollars without cents, anything else with two decimals. */
export const usdText = (v: string | number) => {
  const n = Number(v);
  return formatUsd(n, Number.isInteger(n) ? { min: 0, max: 0 } : { min: 2, max: 2 });
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

/** What the sample flock shows: an invoice bot near its daily cap, a small trader with room left, and a payout runner that spends from a Gateway balance. */
export function sampleLeashes(now: number): LeashView[] {
  const day = 86_400_000;
  const at = (ms: number) => new Date(now - ms).toISOString();
  return [
    sample(
      "lsh_sample000001",
      { agentName: msg("fold.leash.model.invoiceBot"), template: "pay-invoices", budget: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" }, expiresAt: new Date(now + 4 * day + 6 * 3_600_000).toISOString(), recipients: ["0x2222222222222222222222222222222222222222", "0x4444444444444444444444444444444444444444"] },
      { day: "17.17", total: "58.58" },
      [
        { at: at(40 * 60_000), kind: "denied", summary: msg("fold.leash.model.pay9UsdcToKiteHosting"), usd: "9.09", chainProven: false, source: "lykia", reasons: [{ code: "leash.budget.day", message: msg("fold.leash.model.n909IsMoreThanThe") }] },
        { at: at(3 * 3_600_000), kind: "settled", summary: msg("fold.leash.model.send12UsdcToKiteHosting"), usd: "12.12", chainProven: true, source: "lykia" },
        { at: at(9 * 3_600_000), kind: "settled", summary: msg("fold.leash.model.send5UsdcToAtlasData"), usd: "5.05", chainProven: true, source: "lykia" },
      ],
    ),
    sample(
      "lsh_sample000002",
      { agentName: msg("fold.leash.model.fxScout"), template: "trade-small", budget: { perStepUsd: "25", perDayUsd: "50", totalUsd: "350" }, expiresAt: new Date(now + 6 * day + 2 * 3_600_000).toISOString() },
      { day: "10.10", total: "30.30" },
      [{ at: at(2 * 3_600_000), kind: "settled", summary: msg("fold.leash.model.swap10UsdcToEurcOn"), usd: "10.10", chainProven: true, source: "lykia" }],
    ),
    sample(
      "lsh_sample000003",
      {
        agentName: msg("fold.leash.model.payoutRunner"),
        template: "pay-invoices",
        budget: { perStepUsd: "50", perDayUsd: "150", totalUsd: "1050" },
        expiresAt: new Date(now + 5 * day + 3 * 3_600_000).toISOString(),
        recipients: ["0x6666666666666666666666666666666666666666", "0x8888888888888888888888888888888888888888"],
        venues: ["gateway"],
        spendFrom: "gateway",
        stile: { address: "0x0000000000000000000000000000000000005711", sessionId: `0x${"5".repeat(64)}`, key: "0x0000000000000000000000000000000000000a11", chainId: 5042, validUntil: 0, nonceAtCreation: "0", destinations: ["base", "arbitrum", "arc"], maxGatewayFee: "100000", feeBps: 100, feeRecipient: "0x8c5281055b197443ff01dbbdfbf29fd63946ca1e", deploys: false },
      },
      { day: "40.40", total: "121.20" },
      [
        { at: at(70 * 60_000), kind: "settled", summary: msg("fold.leash.model.pay25UsdcTo0x66666666"), usd: "25.25", chainProven: true, source: "lykia" },
        { at: at(5 * 3_600_000), kind: "settled", summary: msg("fold.leash.model.pay15UsdcTo0x88888888"), usd: "15.15", chainProven: true, source: "lykia" },
      ],
    ),
  ];
}
