/**
 * Structured parts of Lyko's chat answers (pure, no I/O).
 *
 * - `ChatStep` is one step of "Lyko at work": reading the request, reading
 *   the wallet, searching routes, checking the Fence. The server emits a
 *   `step` event when a step starts (state "running") and again with the
 *   same id when it ends (ok, warn or fail, with the measured time). Steps
 *   only describe work that really ran.
 * - `AnswerBlock` is a typed card beside the answer text (a gas gauge, a
 *   Fence gate, a balance mosaic, a rate tile, a herded draft, a settled
 *   seal). The server builds every number in a block from tool results, the
 *   wallet or the Fence, never from model prose; the text stays the
 *   fallback for clients that do not draw cards.
 *
 * `parseAnswerBlock` and `parseChatStep` validate untrusted input (a model
 * tool call, a stored thread, a stream) and return null for anything off-shape.
 */

export const CHAT_STEP_KINDS = ["intent", "wallet", "memory", "delegate", "route", "fence", "price", "simulate", "compile", "draft", "scent", "insight", "read"] as const;
export type ChatStepKind = (typeof CHAT_STEP_KINDS)[number];

export const CHAT_STEP_STATES = ["running", "ok", "warn", "fail"] as const;
export type ChatStepState = (typeof CHAT_STEP_STATES)[number];

export interface ChatStep {
  /** Stable within a turn: the end event reuses the start event's id. */
  readonly id: string;
  readonly kind: ChatStepKind;
  /** What Lyko is doing, in a few words ("Searching routes"). */
  readonly label: string;
  readonly state: ChatStepState;
  /** The short outcome ("Aerodrome Slipstream, 1 step"). */
  readonly result?: string;
  /** One or two sentences more, shown when the step is opened. */
  readonly detail?: string;
  /** Who did it, when a specialist did ("FX hedger"). */
  readonly agent?: string;
  /** Measured duration of the step in milliseconds (end events only). */
  readonly ms?: number;
}

/** A decimal amount as a string: "12", "0.0450", "1250.5". */
const DECIMAL = /^-?\d{1,18}(?:\.\d{1,18})?$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/u;
const SYMBOL = /^[A-Za-z][A-Za-z0-9.]{0,11}$/u;
/** In-app links only: a path under /app (no scheme, no host, no protocol-relative). */
const APP_HREF = /^\/app(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z0-9_=&%.-]*)?$/u;

export const FENCE_BLOCK_DECISIONS = ["deny", "confirm"] as const;

/**
 * Where a block's figures came from: the source (a chain read, an oracle,
 * an official API), when it was read, the Arc block when there is one, the
 * venue, and why it is stale when it is (a Chainlink round older than its
 * heartbeat, a cached read). Shown on the card as "source · block or time".
 */
export interface BlockSource {
  readonly source: string;
  readonly readAt: string;
  readonly block: string | null;
  readonly venue?: string | null;
  /** Set when the figure is older than its source promises; the card says so. */
  readonly stale?: string | null;
}

/** One sourced figure: a label, a value the code computed or read, and where it came from. */
export interface FactRow {
  readonly label: string;
  readonly value: string;
  readonly note?: string | null;
  readonly from: BlockSource;
}

/** What an Ask-drafted leash carries into the review sheet (core LeashDraft, validated again there). */
export interface LeashDraftBlock {
  readonly name: string;
  readonly template: "pay-invoices" | "trade-small" | "earn";
  readonly perDayUsd: string;
  readonly perStepUsd?: string;
  readonly days: number;
  readonly recipients?: readonly string[];
  /** "arc" (the owner's LykiaAccount) or "gateway" (the owner's Gateway balance through LykiaStile). */
  readonly spendFrom?: "arc" | "gateway";
}

/** One venue's live rate for a token. */
export interface YieldRow {
  readonly venue: string;
  /** Percent, two decimals; null when the source did not give one ("n/a", never a guess). */
  readonly apyPercent: string | null;
  readonly risk: "low" | "medium" | "high";
  readonly source: string;
}

/** A drafted LykiaOrders order the owner reviews and signs in the chat (the draft is rebuilt and re-checked at signing). */
export interface OrderBlockInput {
  readonly kind: "limit" | "stop-loss" | "take-profit" | "dca" | "twap";
  readonly sell: string;
  readonly buy: string;
  readonly amount: string;
  readonly executions?: number;
  readonly intervalSeconds?: number;
  readonly triggerPrice?: string;
  readonly triggerAbove?: boolean;
}

export type AnswerBlock =
  /** Native USDC (gas on Arc) against the owner's gas floor. */
  | { readonly kind: "gas"; readonly balance: string; readonly floor: string; readonly address: string | null; readonly gasPriceGwei: string | null; readonly from?: BlockSource }
  /** The Fence refused (or wants a confirmation): the rules that decided, and the room left under the caps. */
  | { readonly kind: "fence"; readonly decision: (typeof FENCE_BLOCK_DECISIONS)[number]; readonly rules: readonly { readonly rule: string; readonly message: string }[]; readonly headroom: readonly { readonly label: string; readonly value: string }[] }
  /** What the owner holds: the largest holdings with their USD value (null when unpriced). */
  | { readonly kind: "balance"; readonly totalUsd: string | null; readonly holdings: readonly { readonly symbol: string; readonly amount: string; readonly usd: string | null; readonly where: string }[]; readonly unpriced?: number; readonly from?: BlockSource }
  /** A quoted conversion rate against the reference rate and the Fence's band. */
  | { readonly kind: "rate"; readonly base: string; readonly quote: string; readonly rate: string; readonly reference: string | null; readonly bandBps: number | null; readonly source: string | null; readonly from?: BlockSource }
  /** Alerts, automations and orders Lyko set up (saved) or drafted (a link to finish). */
  | { readonly kind: "herded"; readonly items: readonly { readonly kind: "alert" | "automation" | "order" | "watch"; readonly label: string; readonly saved: boolean; readonly href: string; readonly next: string | null }[] }
  /** A step that settled on chain. */
  | { readonly kind: "settled"; readonly summary: string; readonly tx: string }
  /** Where the owner's money is and what it is doing: the largest positions with their state, and the venues that could not be read. */
  | { readonly kind: "positions"; readonly netUsd: string | null; readonly weightedApyPercent: string | null; readonly lowestHealth: string | null; readonly rows: readonly PositionsCardRow[]; readonly unavailable: readonly string[]; readonly yearlyYieldUsd?: string | null; readonly unpriced?: number; /** Dust and unpriced lines folded out of the rows ("55 small or unpriced lines hidden"). */ readonly hidden?: number; /** The sum over priced positions, shown when some are unpriced. */ readonly pricedNetUsd?: string | null; readonly from?: BlockSource }
  /** What Lyko can do, from the capability map: titled sections of items with a plain note each. */
  | { readonly kind: "capabilities"; readonly title: string; readonly sections: readonly CapabilitySection[] }
  /** A feature Lyko offers for the owner's words: what it is, why it fits, where it lives. */
  | { readonly kind: "offer"; readonly feature: string; readonly title: string; readonly line: string; readonly href: string; readonly cta: string }
  /** A Stress test answer: one scenario, the value before and after, and the closest liquidation. */
  | { readonly kind: "stress"; readonly scenario: string; readonly sentence: string; readonly beforeUsd: string; readonly afterUsd: string; readonly closest: { readonly venue: string; readonly health: string; readonly roomPercent: string } | null }
  /** Sourced figures: a read-only answer from Lyko on watch, or totals the code derived (a blended APY, a yearly estimate). */
  | { readonly kind: "facts"; readonly title: string; readonly rows: readonly FactRow[]; readonly note: string | null }
  /** A LykiaOrders order drafted in the chat: its terms, the Fence and beta verdict at draft time, and the inputs to rebuild it for signing. */
  /** A leash drafted in Ask: who holds it, what it may spend and for how long. Its card opens the leash review sheet; nothing is created before that. */
  | { readonly kind: "leash-draft"; readonly title: string; readonly draft: LeashDraftBlock; readonly note: string | null }
  /** Autopilot drafted in Ask: the limits the owner stated or picked. Its card opens the Autopilot review sheet (read, accept, sign once). */
  | { readonly kind: "autopilot-draft"; readonly perStepUsd: string; readonly perDayUsd: string; readonly days: number; readonly payees: readonly string[]; readonly environment: "mainnet" | "testnet" }
  /** An automation for Autopilot to sign, drafted in Ask: the card adds it once the owner confirms. */
  | { readonly kind: "autopilot-task"; readonly label: string; readonly task: Readonly<Record<string, string>>; readonly environment: "mainnet" | "testnet"; readonly autopilot: "on" | "paused" | "pending" | "off" }
  /** An agent drafted in Ask: it holds a leash (its own Fence and daily budget, carved from yours). The card creates it once the owner confirms. */
  | { readonly kind: "agent-draft"; readonly name: string; readonly role: string; readonly dailyUsd: string; readonly mission: string | null; readonly environment: "mainnet" | "testnet" }
  /** Live yields for one token, best first, each with its risk and source (the answer to "where can I earn on EURC?"). */
  | { readonly kind: "yields"; readonly token: string; readonly rows: readonly YieldRow[]; readonly best: string | null; readonly from: BlockSource }
  /** No wallet is connected: the answer is about a sample address, not the reader's money. Drawn first, with a Connect action. */
  | { readonly kind: "sample"; readonly address: string; readonly line: string; readonly cta: string }
  /** Things in motion that match what the owner named, each with the one control Herding offers for it. Nothing changes until the owner presses it. */
  | { readonly kind: "running"; readonly title: string; readonly items: readonly RunningItem[]; readonly note: string | null }
  | { readonly kind: "order"; readonly summary: string; readonly environment: "mainnet" | "testnet"; readonly decision: "allow" | "confirm" | "deny"; readonly reasons: readonly string[]; readonly perExecution: { readonly fee: string; readonly swapped: string; readonly minOut: string; readonly symbolIn: string; readonly symbolOut: string }; readonly approval: string | null; readonly executions: number; readonly input: OrderBlockInput };

/** One running thing on a card in Ask: the same row and the same control the Fold's Herding list shows. */
export interface RunningItem {
  readonly id: string;
  readonly source: string;
  readonly name: string;
  readonly sourceLabel: string;
  readonly status: string;
  readonly nextLine: string | null;
  /** The call Herding makes for this row (pause, resume, stop or cancel); null when it has no control. */
  readonly control: { readonly action: "pause" | "resume" | "stop" | "cancel"; readonly label: string; readonly method: "get" | "post" | "delete"; readonly path: string; readonly query?: Readonly<Record<string, string>>; readonly body?: Readonly<Record<string, string>>; readonly sign?: "order-cancel" | "revoke-session" } | null;
}

export interface CapabilitySection {
  readonly label: string;
  /** One plain line under the label. */
  readonly note?: string | null;
  readonly items: readonly { readonly name: string; readonly note: string | null }[];
}

export interface PositionsCardRow {
  readonly venue: string;
  readonly label: string;
  readonly state: string;
  readonly valueUsd: string | null;
  readonly doing: string;
}

const POSITION_CARD_STATES = ["earning", "idle", "borrowing", "at-risk", "out-of-range", "pending", "escrowed", "committed", "watching"] as const;

export type AnswerBlockKind = AnswerBlock["kind"];
export const ANSWER_BLOCK_KINDS: readonly AnswerBlockKind[] = ["gas", "fence", "balance", "rate", "herded", "settled", "positions", "capabilities", "offer", "stress", "facts", "order", "sample", "running"];

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const ORDER_KINDS_ALLOWED = ["limit", "stop-loss", "take-profit", "dca", "twap"] as const;

/** A validated BlockSource, null when absent, undefined when off-shape. */
export function parseBlockSource(raw: unknown): BlockSource | null | undefined {
  if (raw === undefined || raw === null) return null;
  const o = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return undefined;
  const source = typeof o.source === "string" && o.source.length > 0 && o.source.length <= 80 ? o.source : null;
  const readAt = typeof o.readAt === "string" && ISO_TIME.test(o.readAt) ? o.readAt : null;
  const block = o.block === null || o.block === undefined ? null : typeof o.block === "string" && /^\d{1,20}$/u.test(o.block) ? o.block : undefined;
  const venue = o.venue === null || o.venue === undefined ? null : typeof o.venue === "string" && o.venue.length <= 60 ? o.venue : undefined;
  const stale = o.stale === null || o.stale === undefined ? null : typeof o.stale === "string" && o.stale.length <= 200 ? o.stale : undefined;
  if (!source || !readAt || block === undefined || venue === undefined || stale === undefined) return undefined;
  return { source, readAt, block, ...(venue ? { venue } : {}), ...(stale ? { stale } : {}) };
}

/** "Chainlink EURC/USD · block 1234" or "Morpho API · 14:02 UTC": a source line for a card. */
export function sourceLine(from: BlockSource): string {
  const when = from.block ? `block ${from.block}` : `${from.readAt.slice(11, 16)} UTC`;
  return `${from.source}${from.venue ? ` · ${from.venue}` : ""} · ${when}${from.stale ? ` · stale: ${from.stale}` : ""}`;
}

/** At most this many blocks ride on one answer. */
export const MAX_BLOCKS = 6;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

function decimal(v: unknown): string | null {
  return typeof v === "string" && DECIMAL.test(v) ? v : null;
}

function nullable<T>(v: unknown, parse: (x: unknown) => T | null): T | null | undefined {
  if (v === null || v === undefined) return null;
  const parsed = parse(v);
  return parsed === null ? undefined : parsed;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A validated block, or null when anything is off-shape. Extra fields are dropped. */
export function parseAnswerBlock(raw: unknown): AnswerBlock | null {
  const o = obj(raw);
  if (!o) return null;
  switch (o.kind) {
    case "gas": {
      const balance = decimal(o.balance);
      const floor = decimal(o.floor);
      const address = nullable(o.address, (x) => (typeof x === "string" && ADDRESS.test(x) ? x : null));
      const gasPriceGwei = nullable(o.gasPriceGwei, decimal);
      const from = parseBlockSource(o.from);
      if (balance === null || floor === null || address === undefined || gasPriceGwei === undefined || from === undefined) return null;
      return { kind: "gas", balance, floor, address, gasPriceGwei, ...(from ? { from } : {}) };
    }
    case "fence": {
      if (o.decision !== "deny" && o.decision !== "confirm") return null;
      if (!Array.isArray(o.rules) || o.rules.length === 0 || o.rules.length > 6) return null;
      const rules = o.rules.map((r) => {
        const x = obj(r);
        const rule = str(x?.rule, 40);
        const message = str(x?.message, 400);
        return rule && message ? { rule, message } : null;
      });
      const headroomRaw = o.headroom === undefined ? [] : o.headroom;
      if (!Array.isArray(headroomRaw) || headroomRaw.length > 6) return null;
      const headroom = headroomRaw.map((h) => {
        const x = obj(h);
        const label = str(x?.label, 60);
        const value = str(x?.value, 60);
        return label && value ? { label, value } : null;
      });
      if (rules.some((r) => r === null) || headroom.some((h) => h === null)) return null;
      return { kind: "fence", decision: o.decision, rules: rules as { rule: string; message: string }[], headroom: headroom as { label: string; value: string }[] };
    }
    case "balance": {
      const totalUsd = nullable(o.totalUsd, decimal);
      if (totalUsd === undefined || !Array.isArray(o.holdings) || o.holdings.length > 12) return null;
      const holdings = o.holdings.map((h) => {
        const x = obj(h);
        const symbol = typeof x?.symbol === "string" && SYMBOL.test(x.symbol) ? x.symbol : null;
        const amount = decimal(x?.amount);
        const usd = nullable(x?.usd, decimal);
        const where = str(x?.where, 60);
        return symbol && amount !== null && usd !== undefined && where ? { symbol, amount, usd, where } : null;
      });
      const from = parseBlockSource(o.from);
      const unpriced = o.unpriced === undefined ? 0 : typeof o.unpriced === "number" && Number.isInteger(o.unpriced) && o.unpriced >= 0 && o.unpriced < 1000 ? o.unpriced : null;
      if (holdings.some((h) => h === null) || from === undefined || unpriced === null) return null;
      return { kind: "balance", totalUsd, holdings: holdings as { symbol: string; amount: string; usd: string | null; where: string }[], ...(unpriced > 0 ? { unpriced } : {}), ...(from ? { from } : {}) };
    }
    case "rate": {
      const base = typeof o.base === "string" && SYMBOL.test(o.base) ? o.base : null;
      const quote = typeof o.quote === "string" && SYMBOL.test(o.quote) ? o.quote : null;
      const rate = decimal(o.rate);
      const reference = nullable(o.reference, decimal);
      const bandBps = nullable(o.bandBps, (x) => (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 10_000 ? x : null));
      const source = nullable(o.source, (x) => str(x, 80));
      const from = parseBlockSource(o.from);
      if (!base || !quote || rate === null || reference === undefined || bandBps === undefined || source === undefined || from === undefined) return null;
      return { kind: "rate", base, quote, rate, reference, bandBps, source, ...(from ? { from } : {}) };
    }
    case "herded": {
      if (!Array.isArray(o.items) || o.items.length === 0 || o.items.length > 6) return null;
      const items = o.items.map((i) => {
        const x = obj(i);
        const kind = x?.kind === "alert" || x?.kind === "automation" || x?.kind === "order" || x?.kind === "watch" ? x.kind : null;
        const label = str(x?.label, 200);
        const href = typeof x?.href === "string" && x.href.length <= 200 && APP_HREF.test(x.href) ? x.href : null;
        const next = nullable(x?.next, (n) => str(n, 80));
        return kind && label && href && typeof x?.saved === "boolean" && next !== undefined ? { kind, label, saved: x.saved, href, next } : null;
      });
      if (items.some((i) => i === null)) return null;
      return { kind: "herded", items: items as { kind: "alert" | "automation" | "order" | "watch"; label: string; saved: boolean; href: string; next: string | null }[] };
    }
    case "positions": {
      const netUsd = nullable(o.netUsd, decimal);
      const weightedApyPercent = nullable(o.weightedApyPercent, decimal);
      const lowestHealth = nullable(o.lowestHealth, decimal);
      if (netUsd === undefined || weightedApyPercent === undefined || lowestHealth === undefined) return null;
      if (!Array.isArray(o.rows) || o.rows.length > 10) return null;
      const rows = o.rows.map((r) => {
        const x = obj(r);
        const venue = str(x?.venue, 60);
        const label = str(x?.label, 120);
        const state = typeof x?.state === "string" && (POSITION_CARD_STATES as readonly string[]).includes(x.state) ? x.state : null;
        const valueUsd = nullable(x?.valueUsd, decimal);
        const doing = str(x?.doing, 200);
        return venue && label && state && valueUsd !== undefined && doing ? { venue, label, state, valueUsd, doing } : null;
      });
      const unavailableRaw = o.unavailable === undefined ? [] : o.unavailable;
      if (!Array.isArray(unavailableRaw) || unavailableRaw.length > 12) return null;
      const unavailable = unavailableRaw.map((u) => str(u, 60));
      const from = parseBlockSource(o.from);
      const yearlyYieldUsd = nullable(o.yearlyYieldUsd, decimal);
      const unpriced = o.unpriced === undefined ? 0 : typeof o.unpriced === "number" && Number.isInteger(o.unpriced) && o.unpriced >= 0 && o.unpriced < 1000 ? o.unpriced : null;
      const hidden = o.hidden === undefined ? 0 : typeof o.hidden === "number" && Number.isInteger(o.hidden) && o.hidden >= 0 && o.hidden < 10_000 ? o.hidden : null;
      const pricedNetUsd = nullable(o.pricedNetUsd, decimal);
      if (rows.some((r) => r === null) || unavailable.some((u) => u === null) || from === undefined || yearlyYieldUsd === undefined || unpriced === null || hidden === null || pricedNetUsd === undefined) return null;
      return { kind: "positions", netUsd, weightedApyPercent, lowestHealth, rows: rows as PositionsCardRow[], unavailable: unavailable as string[], ...(yearlyYieldUsd !== null ? { yearlyYieldUsd } : {}), ...(unpriced > 0 ? { unpriced } : {}), ...(hidden > 0 ? { hidden } : {}), ...(pricedNetUsd !== null ? { pricedNetUsd } : {}), ...(from ? { from } : {}) };
    }
    case "capabilities": {
      const title = str(o.title, 120);
      if (!title || !Array.isArray(o.sections) || o.sections.length === 0 || o.sections.length > 8) return null;
      const sections = o.sections.map((sec) => {
        const x = obj(sec);
        const label = str(x?.label, 80);
        const note = nullable(x?.note, (n) => str(n, 240));
        if (!label || note === undefined || !Array.isArray(x?.items) || x.items.length === 0 || x.items.length > 16) return null;
        const items = x.items.map((i) => {
          const y = obj(i);
          const name = str(y?.name, 80);
          const note = nullable(y?.note, (n) => str(n, 200));
          return name && note !== undefined ? { name, note } : null;
        });
        return items.some((i) => i === null) ? null : { label, ...(note ? { note } : {}), items: items as { name: string; note: string | null }[] };
      });
      if (sections.some((sec) => sec === null)) return null;
      return { kind: "capabilities", title, sections: sections as CapabilitySection[] };
    }
    case "offer": {
      const feature = str(o.feature, 40);
      const title = str(o.title, 120);
      const line = str(o.line, 300);
      const cta = str(o.cta, 40);
      const href = typeof o.href === "string" && o.href.length <= 200 && APP_HREF.test(o.href) ? o.href : null;
      return feature && title && line && cta && href ? { kind: "offer", feature, title, line, href, cta } : null;
    }
    case "stress": {
      const scenario = str(o.scenario, 80);
      const sentence = str(o.sentence, 400);
      const beforeUsd = decimal(o.beforeUsd);
      const afterUsd = decimal(o.afterUsd);
      const c = o.closest === null || o.closest === undefined ? null : obj(o.closest);
      const closest = c ? { venue: str(c.venue, 60), health: decimal(c.health), roomPercent: decimal(c.roomPercent) } : null;
      if (closest && (!closest.venue || !closest.health || !closest.roomPercent)) return null;
      return scenario && sentence && beforeUsd && afterUsd ? { kind: "stress", scenario, sentence, beforeUsd, afterUsd, closest: closest as { venue: string; health: string; roomPercent: string } | null } : null;
    }
    case "facts": {
      const title = str(o.title, 120);
      const note = nullable(o.note, (n) => str(n, 300));
      if (!title || note === undefined || !Array.isArray(o.rows) || o.rows.length === 0 || o.rows.length > 12) return null;
      const rows = o.rows.map((r) => {
        const x = obj(r);
        const label = str(x?.label, 80);
        const value = str(x?.value, 60);
        const rowNote = nullable(x?.note, (n) => str(n, 200));
        const from = parseBlockSource(x?.from);
        return label && value && rowNote !== undefined && from ? { label, value, ...(rowNote ? { note: rowNote } : {}), from } : null;
      });
      if (rows.some((r) => r === null)) return null;
      return { kind: "facts", title, rows: rows as FactRow[], note };
    }
    case "order": {
      const summary = str(o.summary, 240);
      const environment = o.environment === "mainnet" || o.environment === "testnet" ? o.environment : null;
      const decision = o.decision === "allow" || o.decision === "confirm" || o.decision === "deny" ? o.decision : null;
      const reasons = Array.isArray(o.reasons) && o.reasons.length <= 6 ? o.reasons.map((r) => str(r, 300)) : null;
      const pe = obj(o.perExecution);
      const perExecution = pe ? { fee: decimal(pe.fee), swapped: decimal(pe.swapped), minOut: decimal(pe.minOut), symbolIn: typeof pe.symbolIn === "string" && SYMBOL.test(pe.symbolIn) ? pe.symbolIn : null, symbolOut: typeof pe.symbolOut === "string" && SYMBOL.test(pe.symbolOut) ? pe.symbolOut : null } : null;
      const approval = nullable(o.approval, (a) => str(a, 200));
      const executions = typeof o.executions === "number" && Number.isInteger(o.executions) && o.executions >= 1 && o.executions <= 1000 ? o.executions : null;
      const i = obj(o.input);
      const kind = typeof i?.kind === "string" && (ORDER_KINDS_ALLOWED as readonly string[]).includes(i.kind) ? (i.kind as OrderBlockInput["kind"]) : null;
      const sell = typeof i?.sell === "string" && SYMBOL.test(i.sell) ? i.sell : null;
      const buy = typeof i?.buy === "string" && SYMBOL.test(i.buy) ? i.buy : null;
      const amount = decimal(i?.amount);
      const int = (v: unknown, lo: number, hi: number) => (v === undefined ? undefined : typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
      const execs = int(i?.executions, 1, 1000);
      const interval = int(i?.intervalSeconds, 60, 30 * 86_400);
      const triggerPrice = i?.triggerPrice === undefined ? undefined : decimal(i.triggerPrice);
      const triggerAbove = i?.triggerAbove === undefined ? undefined : typeof i.triggerAbove === "boolean" ? i.triggerAbove : null;
      if (!summary || !environment || !decision || !reasons || reasons.some((r) => r === null) || !perExecution || Object.values(perExecution).some((v) => v === null) || approval === undefined || executions === null) return null;
      if (!kind || !sell || !buy || amount === null || execs === null || interval === null || triggerPrice === null || triggerAbove === null) return null;
      const input: OrderBlockInput = { kind, sell, buy, amount, ...(execs !== undefined ? { executions: execs } : {}), ...(interval !== undefined ? { intervalSeconds: interval } : {}), ...(triggerPrice !== undefined ? { triggerPrice } : {}), ...(triggerAbove !== undefined ? { triggerAbove } : {}) };
      return { kind: "order", summary, environment, decision, reasons: reasons as string[], perExecution: perExecution as { fee: string; swapped: string; minOut: string; symbolIn: string; symbolOut: string }, approval, executions, input };
    }
    case "leash-draft": {
      const title = str(o.title, 120);
      const note = nullable(o.note, (n) => str(n, 300));
      const d = obj(o.draft);
      const name = str(d?.name, 48);
      const template = d?.template === "pay-invoices" || d?.template === "trade-small" || d?.template === "earn" ? d.template : null;
      const perDayUsd = decimal(d?.perDayUsd);
      const perStepUsd = d?.perStepUsd === undefined ? undefined : decimal(d.perStepUsd);
      const days = typeof d?.days === "number" && Number.isInteger(d.days) && d.days >= 1 && d.days <= 365 ? d.days : null;
      const recipients = d?.recipients === undefined ? undefined : Array.isArray(d.recipients) && d.recipients.length <= 20 && d.recipients.every((r) => typeof r === "string" && ADDRESS.test(r)) ? (d.recipients as string[]) : null;
      const spendFrom = d?.spendFrom === undefined ? undefined : d.spendFrom === "arc" || d.spendFrom === "gateway" ? d.spendFrom : null;
      if (!title || note === undefined || !name || !template || !perDayUsd || perStepUsd === null || !days || recipients === null || spendFrom === null) return null;
      return { kind: "leash-draft", title, note, draft: { name, template, perDayUsd, days, ...(perStepUsd ? { perStepUsd } : {}), ...(recipients ? { recipients } : {}), ...(spendFrom ? { spendFrom } : {}) } };
    }
    case "autopilot-draft": {
      const perStepUsd = decimal(o.perStepUsd);
      const perDayUsd = decimal(o.perDayUsd);
      const days = typeof o.days === "number" && Number.isInteger(o.days) && o.days >= 1 && o.days <= 365 ? o.days : null;
      const payees = Array.isArray(o.payees) && o.payees.length <= 10 && o.payees.every((p) => typeof p === "string" && ADDRESS.test(p)) ? (o.payees as string[]) : null;
      const environment = o.environment === "mainnet" || o.environment === "testnet" ? o.environment : null;
      return perStepUsd && perDayUsd && days && payees && environment ? { kind: "autopilot-draft", perStepUsd, perDayUsd, days, payees, environment } : null;
    }
    case "autopilot-task": {
      const label = str(o.label, 200);
      const t = obj(o.task);
      const task = t && Object.keys(t).length <= 8 && Object.values(t).every((v) => typeof v === "string" && v.length <= 200) ? (t as Record<string, string>) : null;
      const environment = o.environment === "mainnet" || o.environment === "testnet" ? o.environment : null;
      const autopilot = o.autopilot === "on" || o.autopilot === "paused" || o.autopilot === "pending" || o.autopilot === "off" ? o.autopilot : null;
      return label && task && environment && autopilot ? { kind: "autopilot-task", label, task, environment, autopilot } : null;
    }
    case "agent-draft": {
      const name = str(o.name, 48);
      const role = str(o.role, 24);
      const dailyUsd = decimal(o.dailyUsd);
      const mission = nullable(o.mission, (m) => str(m, 400));
      const environment = o.environment === "mainnet" || o.environment === "testnet" ? o.environment : null;
      return name && role && dailyUsd && mission !== undefined && environment ? { kind: "agent-draft", name, role, dailyUsd, mission, environment } : null;
    }
    case "yields": {
      const token = typeof o.token === "string" && SYMBOL.test(o.token) ? o.token : null;
      const best = nullable(o.best, (b) => str(b, 80));
      const from = parseBlockSource(o.from);
      if (!token || best === undefined || !from || !Array.isArray(o.rows) || o.rows.length > 10) return null;
      const rows = o.rows.map((r) => {
        const x = obj(r);
        const venue = str(x?.venue, 80);
        const apyPercent = nullable(x?.apyPercent, decimal);
        const risk = x?.risk === "low" || x?.risk === "medium" || x?.risk === "high" ? x.risk : null;
        const source = str(x?.source, 60);
        return venue && apyPercent !== undefined && risk && source ? { venue, apyPercent, risk, source } : null;
      });
      if (rows.some((r) => r === null)) return null;
      return { kind: "yields", token, rows: rows as YieldRow[], best, from };
    }
    case "sample": {
      const address = typeof o.address === "string" && /^0x[0-9a-fA-F]{40}$/u.test(o.address) ? o.address : null;
      const line = str(o.line, 300);
      const cta = str(o.cta, 40);
      return address && line && cta ? { kind: "sample", address, line, cta } : null;
    }
    case "running": {
      const title = str(o.title, 160);
      const note = nullable(o.note, (x) => str(x, 300));
      if (!title || note === undefined || !Array.isArray(o.items) || o.items.length === 0 || o.items.length > 6) return null;
      const items = o.items.map((raw): RunningItem | null => {
        const r = obj(raw);
        if (!r) return null;
        const id = str(r.id, 160);
        const source = str(r.source, 40);
        const name = str(r.name, 240);
        const sourceLabel = str(r.sourceLabel, 60);
        const status = str(r.status, 24);
        const nextLine = nullable(r.nextLine, (x) => str(x, 300));
        if (!id || !source || !name || !sourceLabel || !status || nextLine === undefined) return null;
        const c = r.control === null || r.control === undefined ? null : obj(r.control);
        if (r.control !== null && r.control !== undefined && !c) return null;
        let control: RunningItem["control"] = null;
        if (c) {
          const action = (["pause", "resume", "stop", "cancel"] as const).find((a) => a === c.action);
          const method = (["get", "post", "delete"] as const).find((m) => m === c.method);
          const label = str(c.label, 24);
          // Only Lykia's own API paths: a card can never point a control anywhere else.
          const path = typeof c.path === "string" && /^\/v1\/[A-Za-z0-9/_%.:-]{1,200}$/u.test(c.path) && !c.path.includes("..") ? c.path : null;
          const pairs = (v: unknown): Record<string, string> | null | undefined => {
            if (v === null || v === undefined) return null;
            const m = obj(v);
            if (!m) return undefined;
            const entries = Object.entries(m);
            return entries.length <= 6 && entries.every(([k, x]) => k.length <= 40 && typeof x === "string" && x.length <= 120) ? (m as Record<string, string>) : undefined;
          };
          const query = pairs(c.query);
          const body = pairs(c.body);
          const sign = c.sign === undefined || c.sign === null ? null : c.sign === "order-cancel" || c.sign === "revoke-session" ? c.sign : undefined;
          if (!action || !method || !label || !path || query === undefined || body === undefined || sign === undefined) return null;
          control = { action, label, method, path, ...(query ? { query } : {}), ...(body ? { body } : {}), ...(sign ? { sign } : {}) };
        }
        return { id, source, name, sourceLabel, status, nextLine, control };
      });
      if (items.some((i) => i === null)) return null;
      return { kind: "running", title, items: items as RunningItem[], note };
    }
    case "settled": {
      const summary = str(o.summary, 200);
      const tx = typeof o.tx === "string" && TX_HASH.test(o.tx) ? o.tx : null;
      return summary && tx ? { kind: "settled", summary, tx } : null;
    }
    default:
      return null;
  }
}

/** Valid blocks only, at most MAX_BLOCKS. */
export function parseAnswerBlocks(raw: unknown): AnswerBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: AnswerBlock[] = [];
  for (const r of raw) {
    const b = parseAnswerBlock(r);
    if (b) out.push(b);
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

/** A validated step, or null when anything is off-shape. */
export function parseChatStep(raw: unknown): ChatStep | null {
  const o = obj(raw);
  if (!o) return null;
  const id = str(o.id, 40);
  const label = str(o.label, 80);
  if (!id || !label) return null;
  if (!(CHAT_STEP_KINDS as readonly unknown[]).includes(o.kind) || !(CHAT_STEP_STATES as readonly unknown[]).includes(o.state)) return null;
  const result = o.result === undefined ? undefined : str(o.result, 160);
  const detail = o.detail === undefined ? undefined : str(o.detail, 600);
  const agent = o.agent === undefined ? undefined : str(o.agent, 60);
  const ms = o.ms === undefined ? undefined : typeof o.ms === "number" && Number.isFinite(o.ms) && o.ms >= 0 && o.ms < 600_000 ? Math.round(o.ms) : null;
  if (result === null || detail === null || agent === null || ms === null) return null;
  return {
    id,
    kind: o.kind as ChatStepKind,
    label,
    state: o.state as ChatStepState,
    ...(result !== undefined ? { result } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(ms !== undefined ? { ms } : {}),
  };
}

/** The shortfall under the gas floor ("0" when at or above it), as a decimal string with up to 6 places. */
export function gasShortfall(block: Pick<Extract<AnswerBlock, { kind: "gas" }>, "balance" | "floor">): string {
  const gap = Number(block.floor) - Number(block.balance);
  if (!Number.isFinite(gap) || gap <= 0) return "0";
  return String(Math.round(gap * 1e6) / 1e6);
}
