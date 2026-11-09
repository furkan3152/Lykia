/**
 * Preflight (`lykia.preflight/v1`): what will go wrong before anything is
 * signed. Every check is deterministic code over figures read from the
 * chain or an official API; the model never decides a finding and never
 * writes a fix. A finding names its figures with their source and read
 * time, and carries zero or more fixes: concrete alternative actions the
 * code computed (a smaller amount, a different recipient, wait for funds
 * already on their way, pause something in Herding).
 *
 *   block  cannot be signed until it is fixed
 *   warn   may be signed once the owner acknowledges it
 *   note   for the record; never in the way
 */
import type { PlanAction } from "../actions.js";
import type { Decision, FenceRule } from "../fenceEvaluate.js";
import type { Fence } from "../fence.js";
import type { StepKind, StepAmount } from "../intent.js";
import type { ArcEnvironment } from "../networks.js";
import type { RouteChoice } from "../routes.js";
import type { StepFee } from "../fee.js";

export const PREFLIGHT_SCHEMA = "lykia.preflight/v1" as const;

export type FindingSeverity = "block" | "warn" | "note";

/** The pixel icon a finding is drawn with: gas pump, coin, shield, clock, address tag, bridge, network, approval key. */
export type CheckFamily = "gas" | "money" | "cost" | "risk" | "time" | "address" | "bridge" | "network" | "approval" | "limits";

export type PreflightCheckId =
  | "gas-reserve"
  | "cash-floor"
  | "obligations"
  | "dust"
  | "insufficient"
  | "cost-ratio"
  | "price-impact"
  | "fx-band"
  | "price-stale"
  | "quote-age"
  | "round-trip"
  | "loan-health"
  | "vault-state"
  | "lp-range"
  | "approvals"
  | "recipient"
  | "bridge-destination"
  | "network"
  | "duplicate"
  | "fence-room"
  | "budget"
  | "conflict"
  | "unpriced"
  | "plan-refused";

/** One number a check used, with where and when it was read. */
export interface FindingFigure {
  readonly label: string;
  readonly value: string;
  readonly source: string;
  /** ISO time of the read; null when the source has no time (Lykia's fee schedule, the owner's preference). */
  readonly readAt: string | null;
}

export type FixKind =
  /** Plan again with these actions (the sentence is what the owner "says" when the chip is tapped). */
  | "replan"
  /** Funds already on their way would cover it: wait for them. */
  | "wait"
  /** Pause a Herding row (an automation, a recurring payment) through its own control. */
  | "pause"
  /** The wallet is on another chain. */
  | "switch-network"
  /** Open the Fence (a looser rule needs the owner's signature there). */
  | "change-fence"
  /** Send USDC to this wallet from elsewhere: needs no gas from this wallet. */
  | "add-funds"
  /** Open a page in the app (the earlier plan, Your Lyko). */
  | "open";

export interface FindingFix {
  readonly id: string;
  readonly kind: FixKind;
  /** The chip: "Use 1.50 USDC". */
  readonly label: string;
  /** One line under the chip: "keeps 0.50 USDC for gas". */
  readonly detail?: string;
  /** The question the chat ends its warning with ("Use 1.50 USDC and keep 0.50 for gas?"). */
  readonly question?: string;
  /** replan: the owner-chosen sentence the planner reads back into `actions`. */
  readonly sentence?: string;
  readonly actions?: readonly PlanAction[];
  /** pause: the row's own control; open / change-fence: an app path. */
  readonly path?: string;
  readonly method?: "get" | "post";
  readonly body?: Readonly<Record<string, unknown>>;
  /** wait: seconds until the funds are expected. */
  readonly etaSeconds?: number;
  /** add-funds: the address to send USDC to on Arc. */
  readonly address?: string;
  /** switch-network: the chain the plan is on. */
  readonly chainId?: number;
  /** True when the fix itself is a transaction from this wallet (so it needs gas). */
  readonly needsGas: boolean;
}

export interface Finding {
  /** Stable for the same condition: the check id plus what it is about ("recipient:s2"). */
  readonly id: string;
  readonly check: PreflightCheckId;
  readonly family: CheckFamily;
  readonly severity: FindingSeverity;
  /** One plain line. */
  readonly title: string;
  /** Why it matters, in one or two plain sentences. */
  readonly why: string;
  /** What Lyko says first in the chat, one sentence (code-written, every figure from `figures`). */
  readonly say: string;
  readonly figures: readonly FindingFigure[];
  /** Before -> after, shown in mono digits ("USDC for gas · 2.01 -> 0.00"). */
  readonly change?: { readonly label: string; readonly before: string; readonly after: string };
  readonly fixes: readonly FindingFix[];
  /** The step it is about, when one. */
  readonly step?: string;
}

/** A plan step as the checks see it: the graph step plus its Fence fact and the gas it is expected to use. */
export interface PreflightStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly venue: string;
  readonly summary: string;
  readonly inputs: readonly StepAmount[];
  readonly outputs: readonly StepAmount[];
  readonly fee?: StepFee;
  readonly settlement: { readonly kind: "receipt" } | { readonly kind: "cctp" | "gateway"; readonly destination: string; readonly expectedSeconds: number };
  readonly route?: RouteChoice;
  readonly stage?: number;
  readonly status: string;
  /** Gas units this step is expected to use (the venue's documented gas plus the batch overhead). */
  readonly gasUnits: number;
  /** Index into `PreflightPlan.actions` of the action the step came from; null when unknown. */
  readonly action: number | null;
  readonly usd: string | null;
  readonly recipient?: string;
  readonly destination?: string;
  readonly slippageBps?: number;
  readonly healthFactorAfter?: string | null;
  readonly fxDeviationBps?: number | null;
  /** The adapter's parameters (addresses the step touches: the vault, the spender, the router). */
  readonly params: Readonly<Record<string, string>>;
}

export interface PreflightPlan {
  readonly id: string;
  readonly environment: ArcEnvironment;
  readonly owner: string;
  /** The account that signs (the owner, or the agent's address). */
  readonly account: string;
  /** "smart": a LykiaAccount whose session key pays the gas, so the wallet's own USDC is not the gas tank. */
  readonly accountKind: "eoa" | "smart";
  readonly source: string;
  readonly dryRun: boolean;
  readonly createdAt: string;
  readonly actions: readonly PlanAction[];
  readonly steps: readonly PreflightStep[];
  readonly verdict: { readonly decision: Decision; readonly reasons: readonly { readonly rule: FenceRule; readonly decision: Decision; readonly message: string; readonly step?: string }[] };
  readonly fence: Fence;
  readonly spent: { readonly dayUsd: string | null; readonly weekUsd: string | null } | null;
}

export interface Reading {
  readonly source: string;
  readonly readAt: string | null;
}

export interface PriceReading {
  readonly usd: string | null;
  readonly updatedAt: string | null;
  /** The feed's allowed age (heartbeat plus grace); null when the token has no feed (USDC is the unit). */
  readonly maxAgeSeconds: number | null;
  readonly source: string;
}

/** Money that leaves the wallet on its own soon: a recurring payment, an order slice. */
export interface Obligation {
  readonly id: string;
  readonly name: string;
  /** "Recurring payment", "Order". */
  readonly kind: string;
  readonly symbol: string;
  /** Base units due within the window. */
  readonly units: string;
  readonly decimals: number;
  readonly dueAt: string | null;
  /** The row's own pause control, when it has one. */
  readonly pause?: { readonly path: string; readonly method: "get" | "post"; readonly body?: Readonly<Record<string, unknown>> };
}

/** A running Herding row that may move the same money (a sweep tonight). */
export interface RunningRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** What it does, matched against the tokens the plan spends (its plan sentence). */
  readonly text?: string;
  readonly nextRunAt: string | null;
  readonly pause?: Obligation["pause"];
}

export interface RecentPlan {
  readonly id: string;
  readonly createdAt: string;
  /** planned, running, settled, failed, stopped, denied. */
  readonly status: string;
  /** Kind, symbols, amounts and recipients of every step: equal fingerprints are the same plan. */
  readonly fingerprint: string;
  readonly swaps: readonly { readonly from: string; readonly to: string; readonly settledAt: string | null; readonly feeUsd: string | null }[];
  /** Recipients of settled sends: past counterparties. */
  readonly paid: readonly string[];
}

export interface Incoming {
  readonly label: string;
  readonly symbol: string;
  readonly units: string;
  readonly decimals: number;
  readonly etaSeconds: number | null;
}

export interface VaultReading {
  /** ERC-4626 maxDeposit for the account: how much more the vault takes (base units). */
  readonly maxDeposit: string | null;
  readonly apyNow: number | null;
  /** The APY Lykia recorded for this vault at least 7 days ago; null until it has a week of readings. */
  readonly apyWeekAgo: number | null;
  readonly read: Reading;
}

export interface PreflightState {
  readonly now: number;
  /** Balances the plan starts from, base units by symbol. */
  readonly wallet: { readonly balances: Readonly<Record<string, string>>; readonly read: Reading } | null;
  /** Arc's gas price (wei of native USDC); null falls back to the network's fee floor. */
  readonly gas: { readonly priceWei: string; readonly read: Reading } | null;
  readonly prices: Readonly<Record<string, PriceReading>>;
  /** `explicit`: the owner saved these in Your Lyko (otherwise they are Lykia's defaults). */
  readonly prefs: { readonly gasReserveUsdc: string; readonly cashFloorUsd: string; readonly explicit?: boolean; readonly read: Reading };
  readonly obligations: readonly Obligation[];
  readonly running: readonly RunningRow[];
  readonly recent: readonly RecentPlan[];
  /** Known payees (confirmed contacts and settled sends); null when they could not be read. */
  readonly counterparties: readonly { readonly address: string; readonly label: string | null }[] | null;
  /** Lower-case address -> has contract code on Arc. */
  readonly code: Readonly<Record<string, boolean>>;
  /** Registry token and Lykia contract addresses on this network (never a payee). */
  readonly contracts: readonly { readonly address: string; readonly name: string }[];
  readonly incoming: readonly Incoming[];
  /** Age of Arc's latest block as the RPC reports it. */
  readonly head: { readonly ageSeconds: number; readonly read: Reading } | null;
  /** `${destination}:${recipient}` -> the recipient's native gas balance on the destination chain. */
  readonly destinations: Readonly<Record<string, { readonly nativeWei: string | null; readonly nativeSymbol: string; readonly chainName: string; readonly read: Reading }>>;
  readonly unlimitedApprovals: readonly { readonly symbol: string; readonly spender: string; readonly venue: string }[];
  /** Lower-case vault address -> its state. */
  readonly vaults: Readonly<Record<string, VaultReading>>;
  /** Venue -> health factor now. */
  readonly health: Readonly<Record<string, string | null>>;
  /** Whose budget the Fence's caps are: the owner's Fence, a leash, an agent, Autopilot. */
  readonly budget: { readonly kind: "fence" | "leash" | "agent" | "autopilot"; readonly name: string };
  readonly beta: { readonly perStepUsd: string; readonly perDayUsd: string } | null;
  /** The minimum maxFeePerGas the network accepts, in gwei. */
  readonly minFeeGwei: number;
}

/** What one check does, for the capability map and the docs. */
export interface PreflightCheckInfo {
  readonly id: PreflightCheckId;
  readonly family: CheckFamily;
  readonly name: string;
  /** What it reads and when it speaks up. */
  readonly plain: string;
  /** "plan" checks run on every plan and prepare; "review" ones in the review modal; "watch" ones on Lyko on watch. */
  readonly runs: readonly ("plan" | "prepare" | "review" | "watch")[];
}
