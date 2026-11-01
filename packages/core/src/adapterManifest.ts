/**
 * The Lykia Adapter Manifest (`lykia.adapter/v1`): how a protocol team
 * tells Lykia what its contracts do, in the same model as the knowledge
 * rows (knowledgeData.ts). A manifest lists the contracts per environment,
 * the ABI fragments Lykia may encode, one capability per action (tokens in
 * and out, who receives the output, approvals, preconditions, failure
 * modes, gas), the read functions that price it (quote, APY, position) and
 * the risk facts with their evidence.
 *
 * A manifest moves through `submitted -> validated -> approved -> routable`
 * (or `rejected` / `suspended`). Only a routable manifest takes part in the
 * route search and the aggregator; the API merges it into the knowledge
 * model at runtime, with no redeploy.
 *
 * Pure: structural validation only. The API parses the ABI, checks every
 * address has code, calls the read functions and dry-simulates each
 * capability before a manifest can be validated.
 */
import { isAddress, type Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";
import type { ProtocolCategory } from "./protocols.js";
import type { RiskTier } from "./routes.js";
import { findToken } from "./assets.js";

export const ADAPTER_SPEC_VERSION = "lykia.adapter/v1" as const;

export const ADAPTER_VERBS = Object.freeze(["swap", "fx", "deposit", "withdraw", "supply", "borrow", "repay"] as const);
export type AdapterVerb = (typeof ADAPTER_VERBS)[number];

export const ADAPTER_STATUSES = Object.freeze(["submitted", "validated", "approved", "routable", "rejected", "suspended"] as const);
export type AdapterStatus = (typeof ADAPTER_STATUSES)[number];

/**
 * Argument templates a capability may use. Everything else is a literal
 * (a number, an address, `true`/`false`).
 *  - `$amount`   the amount the venue receives, base units (after Lykia's fee)
 *  - `$minOut`   the minimum output after slippage, base units (swaps)
 *  - `$account`  the signer (EOA or smart account)
 *  - `$tokenIn`, `$tokenOut`  token addresses on the environment
 *  - `$deadline` now + 20 minutes, unix seconds
 *  - `$contract:<key>`  another contract of the manifest
 */
export const ADAPTER_TEMPLATES = Object.freeze(["$amount", "$minOut", "$account", "$tokenIn", "$tokenOut", "$deadline"] as const);

export type AdapterReadScale = "raw" | "bps" | "wad" | "ray" | "1e6";

export interface AdapterRead {
  /** Unique within the manifest, kebab-case. */
  readonly id: string;
  /** Contract key. */
  readonly contract: string;
  /** A function name (or full signature) present in `abi`, view or pure. */
  readonly function: string;
  readonly args: readonly string[];
  /** How the uint256 result is scaled: APY as bps, wad (1e18 = 100%), ray (1e27), 1e6, or raw base units. */
  readonly scale: AdapterReadScale;
  readonly purpose: string;
}

export interface AdapterApproval {
  /** Registry token symbol, or `$tokenIn`. */
  readonly token: string;
  /** Contract key that pulls the tokens. */
  readonly spender: string;
  /** Always `$amount`: approvals are exact. */
  readonly amount: "$amount";
}

export interface AdapterCapability {
  /** Unique within the manifest, kebab-case. */
  readonly id: string;
  readonly verb: AdapterVerb;
  /** Contract key the call goes to. */
  readonly contract: string;
  /** Function name (or full signature) present in `abi`. */
  readonly function: string;
  readonly args: readonly string[];
  /** Registry token symbol the step spends (or the position it withdraws from). */
  readonly tokenIn: string;
  /** Registry token symbol, or a position `SYMBOL@<protocol id>`. */
  readonly tokenOut: string;
  /** Who receives the output: must be `$account` (Lykia never routes output elsewhere). */
  readonly receiver: "$account";
  readonly approvals: readonly AdapterApproval[];
  readonly preconditions: readonly string[];
  readonly failures: readonly { readonly reason: string; readonly meaning: string }[];
  /** Gas for the call alone. */
  readonly gas: number;
  /** Fee the venue itself takes, in bps; null when variable. */
  readonly venueFeeBps: number | null;
  /** Read id returning the output for `$amount` (swap/fx: required). */
  readonly quote?: string;
  /** Read id returning the APY (deposit/supply). */
  readonly apy?: string;
  /** Read id returning what `$account` holds there, in tokenIn base units (withdraw: required). */
  readonly position?: string;
  /** Whole-token amount for the dry simulation (default "1"). */
  readonly sampleAmount?: string;
  readonly settlement: "instant" | "async";
  readonly delaySeconds?: number;
}

export interface AdapterManifest {
  readonly schema: typeof ADAPTER_SPEC_VERSION;
  readonly protocol: {
    /** kebab-case, 2 to 48 characters; may not reuse a registry venue id. */
    readonly id: string;
    readonly name: string;
    readonly category: ProtocolCategory;
    readonly summary: string;
    readonly website?: string;
    readonly docs?: string;
    readonly contact?: string;
  };
  /** Contract addresses per environment, by key. */
  readonly contracts: Readonly<Partial<Record<ArcEnvironment, Readonly<Record<string, Address>>>>>;
  /** Human-readable ABI fragments ("function deposit(uint256 assets, address receiver) returns (uint256)"). */
  readonly abi: readonly string[];
  readonly capabilities: readonly AdapterCapability[];
  readonly reads: readonly AdapterRead[];
  readonly risk: {
    readonly tier: RiskTier;
    readonly oracle: string;
    readonly admin: string;
    readonly upgradeable: "yes" | "no" | "partly" | "unknown";
    readonly audits: readonly string[];
    readonly notes: readonly string[];
  };
  /** Where the facts come from: docs pages, verified source, audit links. */
  readonly evidence: string;
}

export interface AdapterIssue {
  readonly path: string;
  readonly message: string;
}

const KEBAB = /^[a-z0-9][a-z0-9-]{1,47}$/u;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,47}$/u;
const FRAGMENT = /^(?:function|event|error) \w+\(/u;
const CATEGORIES: readonly ProtocolCategory[] = ["circle", "lending", "dex", "vault", "fx", "bridge", "agent", "oracle", "infra", "launchpad", "perps"];

/** The function name in `deposit` or `deposit(uint256,address)`. */
export function adapterFunctionName(ref: string): string {
  return ref.replace(/\(.*$/u, "").trim();
}

function isTemplate(arg: string, contracts: ReadonlySet<string>): boolean {
  if ((ADAPTER_TEMPLATES as readonly string[]).includes(arg)) return true;
  if (arg.startsWith("$contract:")) return contracts.has(arg.slice("$contract:".length));
  return false;
}

function literalOk(arg: string): boolean {
  return /^(?:\d{1,78}|0x[0-9a-fA-F]{0,128}|true|false)$/u.test(arg);
}

/** Structural checks; the API adds ABI parsing and on-chain checks. Returns [] when well formed. */
export function validateAdapterManifest(input: unknown, options: { readonly reservedIds?: readonly string[] } = {}): AdapterIssue[] {
  const issues: AdapterIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (typeof input !== "object" || input === null) return [{ path: "", message: "A manifest is an object." }];
  const m = input as Partial<AdapterManifest>;
  if (m.schema !== ADAPTER_SPEC_VERSION) add("schema", `schema must be "${ADAPTER_SPEC_VERSION}".`);
  const p = m.protocol;
  if (!p || typeof p !== "object") add("protocol", "protocol is required.");
  else {
    if (typeof p.id !== "string" || !KEBAB.test(p.id)) add("protocol.id", "protocol.id must be kebab-case, 2 to 48 characters.");
    else if (options.reservedIds?.includes(p.id)) add("protocol.id", `${p.id} is a registry venue id; choose your own.`);
    if (typeof p.name !== "string" || p.name.trim().length < 2 || p.name.length > 64) add("protocol.name", "protocol.name is 2 to 64 characters.");
    if (!CATEGORIES.includes(p.category as ProtocolCategory)) add("protocol.category", `protocol.category must be one of ${CATEGORIES.join(", ")}.`);
    if (typeof p.summary !== "string" || p.summary.trim().length < 10 || p.summary.length > 400) add("protocol.summary", "protocol.summary is 10 to 400 characters.");
    for (const key of ["website", "docs"] as const) if (p[key] !== undefined && (typeof p[key] !== "string" || !/^https:\/\/\S{3,300}$/u.test(p[key] as string))) add(`protocol.${key}`, `protocol.${key} must be an https URL.`);
  }
  const contractKeys = new Set<string>();
  if (!m.contracts || typeof m.contracts !== "object") add("contracts", "contracts is required.");
  else {
    const envs = Object.keys(m.contracts);
    if (envs.length === 0) add("contracts", "List the contracts for mainnet, testnet or both.");
    for (const env of envs) {
      if (env !== "mainnet" && env !== "testnet") {
        add(`contracts.${env}`, "Environments are mainnet and testnet.");
        continue;
      }
      const list = (m.contracts as Record<string, Record<string, unknown>>)[env] ?? {};
      const entries = Object.entries(list);
      if (entries.length === 0 || entries.length > 16) add(`contracts.${env}`, "List 1 to 16 contracts.");
      for (const [key, address] of entries) {
        if (!KEY.test(key)) add(`contracts.${env}.${key}`, "Contract keys are identifiers (letters, digits, underscore).");
        if (!isAddress(address)) add(`contracts.${env}.${key}`, "Not an address.");
        contractKeys.add(key);
      }
    }
  }
  if (!Array.isArray(m.abi) || m.abi.length === 0 || m.abi.length > 64) add("abi", "abi lists 1 to 64 human-readable fragments.");
  else m.abi.forEach((f, i) => {
    if (typeof f !== "string" || !FRAGMENT.test(f) || f.length > 600) add(`abi.${i}`, "Each fragment reads like \"function name(type arg, ...) returns (type)\".");
  });
  const fnNames = new Set((Array.isArray(m.abi) ? m.abi : []).filter((f): f is string => typeof f === "string" && f.startsWith("function ")).map((f) => f.slice(9).replace(/\(.*$/u, "").trim()));
  const readIds = new Set<string>();
  if (!Array.isArray(m.reads) || m.reads.length > 32) add("reads", "reads lists at most 32 read functions (an empty list is fine).");
  else m.reads.forEach((r, i) => {
    const at = `reads.${i}`;
    if (!r || typeof r !== "object") return add(at, "A read is an object.");
    if (typeof r.id !== "string" || !KEBAB.test(r.id)) add(`${at}.id`, "Read ids are kebab-case.");
    else if (readIds.has(r.id)) add(`${at}.id`, "Duplicate read id.");
    else readIds.add(r.id);
    if (!contractKeys.has(r.contract)) add(`${at}.contract`, `Unknown contract key ${String(r.contract)}.`);
    if (typeof r.function !== "string" || !fnNames.has(adapterFunctionName(r.function))) add(`${at}.function`, `${String(r.function)} is not in the ABI.`);
    if (!Array.isArray(r.args) || r.args.length > 8) add(`${at}.args`, "args lists at most 8 values.");
    else (r.args as readonly unknown[]).forEach((a: unknown, j: number) => {
      if (typeof a !== "string" || !(isTemplate(a, contractKeys) || literalOk(a))) add(`${at}.args.${j}`, `Unknown template or literal ${String(a)}.`);
    });
    if (!["raw", "bps", "wad", "ray", "1e6"].includes(r.scale as string)) add(`${at}.scale`, "scale is raw, bps, wad, ray or 1e6.");
    if (typeof r.purpose !== "string" || r.purpose.trim().length < 3) add(`${at}.purpose`, "Say what the read is for.");
  });
  const capIds = new Set<string>();
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0 || m.capabilities.length > 24) add("capabilities", "capabilities lists 1 to 24 actions.");
  else m.capabilities.forEach((c, i) => {
    const at = `capabilities.${i}`;
    if (!c || typeof c !== "object") return add(at, "A capability is an object.");
    if (typeof c.id !== "string" || !KEBAB.test(c.id)) add(`${at}.id`, "Capability ids are kebab-case.");
    else if (capIds.has(c.id)) add(`${at}.id`, "Duplicate capability id.");
    else capIds.add(c.id);
    if (!(ADAPTER_VERBS as readonly string[]).includes(c.verb as string)) add(`${at}.verb`, `verb must be one of ${ADAPTER_VERBS.join(", ")}.`);
    if (!contractKeys.has(c.contract)) add(`${at}.contract`, `Unknown contract key ${String(c.contract)}.`);
    if (typeof c.function !== "string" || !fnNames.has(adapterFunctionName(c.function))) add(`${at}.function`, `${String(c.function)} is not in the ABI.`);
    if (!Array.isArray(c.args) || c.args.length > 12) add(`${at}.args`, "args lists at most 12 values.");
    else {
      (c.args as readonly unknown[]).forEach((a: unknown, j: number) => {
        if (typeof a !== "string" || !(isTemplate(a, contractKeys) || literalOk(a))) add(`${at}.args.${j}`, `Unknown template or literal ${String(a)}.`);
      });
      if (!c.args.includes("$amount")) add(`${at}.args`, "A capability must pass $amount.");
      if ((c.verb === "swap" || c.verb === "fx") && !c.args.includes("$minOut")) add(`${at}.args`, "A swap must pass $minOut so slippage is enforced on chain.");
    }
    if (typeof c.tokenIn !== "string" || !findToken("mainnet", c.tokenIn)) add(`${at}.tokenIn`, "tokenIn must be a registry token symbol.");
    const outSymbol = typeof c.tokenOut === "string" ? c.tokenOut.split("@")[0]! : "";
    if (typeof c.tokenOut !== "string" || !findToken("mainnet", outSymbol)) add(`${at}.tokenOut`, "tokenOut must be a registry token or SYMBOL@<protocol id>.");
    else if (c.tokenOut.includes("@") && p && c.tokenOut.split("@")[1] !== p.id) add(`${at}.tokenOut`, "A position must be held at this protocol (SYMBOL@<protocol id>).");
    if ((c.verb === "fx") && !((c.tokenIn === "USDC" && outSymbol === "EURC") || (c.tokenIn === "EURC" && outSymbol === "USDC"))) add(`${at}.verb`, "fx is USDC <-> EURC; use swap for other pairs.");
    if (c.receiver !== "$account") add(`${at}.receiver`, "receiver must be $account: Lykia only routes output back to the signer.");
    if (!Array.isArray(c.approvals) || c.approvals.length > 2) add(`${at}.approvals`, "approvals lists at most 2 approvals.");
    else (c.approvals as readonly AdapterApproval[]).forEach((a: AdapterApproval, j: number) => {
      if (!a || (a.token !== "$tokenIn" && !findToken("mainnet", String(a.token)))) add(`${at}.approvals.${j}.token`, "Approve a registry token or $tokenIn.");
      if (!a || !contractKeys.has(a.spender)) add(`${at}.approvals.${j}.spender`, "The spender is a contract key of the manifest.");
      if (!a || a.amount !== "$amount") add(`${at}.approvals.${j}.amount`, "Approvals are exact: amount is $amount.");
    });
    if (!Array.isArray(c.preconditions)) add(`${at}.preconditions`, "preconditions is a list.");
    if (!Array.isArray(c.failures) || c.failures.length === 0) add(`${at}.failures`, "List at least one failure mode (revert reason and meaning).");
    if (typeof c.gas !== "number" || !Number.isInteger(c.gas) || c.gas <= 0 || c.gas > 5_000_000) add(`${at}.gas`, "gas is a positive integer under 5,000,000.");
    if (c.venueFeeBps !== null && !(Number.isInteger(c.venueFeeBps) && (c.venueFeeBps as number) >= 0 && (c.venueFeeBps as number) <= 1_000)) add(`${at}.venueFeeBps`, "venueFeeBps is 0 to 1000, or null.");
    if ((c.verb === "swap" || c.verb === "fx") && (!c.quote || !readIds.has(c.quote))) add(`${at}.quote`, "A swap needs a quote read (output for $amount).");
    if (c.verb === "withdraw" && (!c.position || !readIds.has(c.position))) add(`${at}.position`, "A withdraw needs a position read.");
    if (c.apy !== undefined && !readIds.has(c.apy)) add(`${at}.apy`, "apy names an unknown read.");
    if (c.quote !== undefined && !readIds.has(c.quote)) add(`${at}.quote`, "quote names an unknown read.");
    if (c.sampleAmount !== undefined && !/^\d{1,12}(?:\.\d{1,18})?$/u.test(c.sampleAmount)) add(`${at}.sampleAmount`, "sampleAmount is a decimal string.");
    if (c.settlement !== "instant" && c.settlement !== "async") add(`${at}.settlement`, "settlement is instant or async.");
  });
  const r = m.risk;
  if (!r || typeof r !== "object") add("risk", "risk is required.");
  else {
    if (!["low", "medium", "high"].includes(r.tier as string)) add("risk.tier", "risk.tier is low, medium or high.");
    if (typeof r.oracle !== "string" || r.oracle.trim().length < 2) add("risk.oracle", "Name the oracle, or say none.");
    if (typeof r.admin !== "string" || r.admin.trim().length < 2) add("risk.admin", "Say who holds admin keys.");
    if (!["yes", "no", "partly", "unknown"].includes(r.upgradeable as string)) add("risk.upgradeable", "upgradeable is yes, no, partly or unknown.");
    if (!Array.isArray(r.audits) || !Array.isArray(r.notes)) add("risk", "audits and notes are lists.");
    else if (r.audits.length === 0 && r.notes.length === 0) add("risk.audits", "List audits, or add a note saying there are none.");
  }
  if (typeof m.evidence !== "string" || m.evidence.trim().length < 10) add("evidence", "Say where the facts come from (docs, verified source, audits).");
  return issues;
}

/** One stored manifest with its review state. */
export interface AdapterRecord {
  readonly id: string;
  readonly status: AdapterStatus;
  readonly manifest: AdapterManifest;
  /** Who submitted it: a developer address or a key id. */
  readonly submittedBy: string;
  readonly submittedAt: string;
  readonly updatedAt: string;
  /** The last validation report, when one ran. */
  readonly validation?: AdapterValidation;
  readonly review?: { readonly by: string; readonly at: string; readonly decision: "approved" | "rejected" | "routable" | "suspended"; readonly note?: string };
  readonly history: readonly { readonly at: string; readonly status: AdapterStatus; readonly by: string; readonly note?: string }[];
}

export interface AdapterCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface AdapterValidation {
  readonly environment: ArcEnvironment;
  readonly ok: boolean;
  readonly checks: readonly AdapterCheck[];
  readonly at: string;
  readonly block: string | null;
}

/** Which status changes are allowed, and who may make them. */
export function adapterTransition(from: AdapterStatus, to: AdapterStatus): "owner" | "admin" | null {
  if (to === "validated" && (from === "submitted" || from === "validated" || from === "rejected")) return "owner";
  if (to === "submitted") return "owner";
  if (to === "approved" && from === "validated") return "admin";
  if (to === "routable" && (from === "approved" || from === "suspended")) return "admin";
  if (to === "rejected" && from !== "routable") return "admin";
  if (to === "suspended" && (from === "routable" || from === "approved")) return "admin";
  return null;
}
