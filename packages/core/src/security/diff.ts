/**
 * Layer 1, the balance diff. Compares what a step's calls would do with
 * what the plan says the step does, and refuses anything that is not in
 * the plan: a transfer to someone else, a fee above the quoted fee, an
 * approval larger than the step spends or to a contract the step never
 * calls, a changed receiver, native value nobody planned, an unknown
 * contract, `transferFrom`, `setApprovalForAll`. Pure: the API decodes the
 * calldata with viem and hands the decoded calls in.
 */
import { sameAddress, type Address } from "../contracts.js";
import type { BalanceChange, DecodedCall, SecurityFinding, SigningSummary } from "./types.js";

export const UNLIMITED_APPROVAL = 2n ** 255n;

export interface ExpectedFlow {
  readonly stepId: string;
  /** The signer (`step.account`). */
  readonly account: Address;
  readonly owner: Address;
  readonly kind: string;
  /** What the plan spends, per token (base units). */
  readonly inputs: readonly { readonly token: Address; readonly symbol: string; readonly amount: string }[];
  /** Fee transfers the plan quoted (Lykia's and the integrator's). */
  readonly fees: readonly { readonly token: Address; readonly recipient: Address; readonly amount: string }[];
  /** External recipients the plan names (a send's `to`, a bridge's `recipient`). */
  readonly recipients: readonly Address[];
  /** Contracts the step may call besides the tokens it spends (registry venues, Arc system contracts, plan parameters). */
  readonly knownContracts: readonly Address[];
  /** Native USDC (18 decimals) the plan sends as value; usually zero. */
  readonly nativeValue?: string;
  /** Repay-all approves 0.1 % + 1000 units of headroom for interest that accrues before inclusion. */
  readonly repayHeadroom?: boolean;
}

/** The most a repay-all approval may exceed the debt it clears. */
export function repayHeadroomOf(amount: bigint): bigint {
  return amount / 1000n + 1_000n;
}

const includes = (list: readonly string[], address: string) => list.some((a) => sameAddress(a, address));

function addTo(map: Map<string, bigint>, key: string, by: bigint) {
  map.set(key.toLowerCase(), (map.get(key.toLowerCase()) ?? 0n) + by);
}

export interface FlowAnalysis {
  readonly findings: SecurityFinding[];
  readonly summary: Omit<SigningSummary, "lines">;
}

export function analyzeFlow(expect: ExpectedFlow, calls: readonly DecodedCall[]): FlowAnalysis {
  const findings: SecurityFinding[] = [];
  const block = (rule: string, message: string, address?: Address) => findings.push({ layer: "simulation", rule: `simulation.${rule}`, severity: "block", message, stepId: expect.stepId, ...(address ? { address } : {}) });
  const need = new Map<string, bigint>();
  for (const input of expect.inputs) addTo(need, input.token, BigInt(input.amount));
  const feeBudget = new Map<string, bigint>();
  for (const fee of expect.fees) addTo(feeBudget, `${fee.token}:${fee.recipient}`, BigInt(fee.amount));
  const allowedOut = new Map<string, bigint>(need);
  if (expect.repayHeadroom) for (const [token, amount] of need) allowedOut.set(token, amount + repayHeadroomOf(amount));
  for (const fee of expect.fees) addTo(allowedOut, fee.token, BigInt(fee.amount));
  const tokens = expect.inputs.map((i) => i.token);
  const symbols = new Map(expect.inputs.map((i) => [i.token.toLowerCase(), i.symbol]));

  const targets = calls.flatMap((c) => (c.kind === "call" ? [c.target] : c.kind === "erc20-transfer" || c.kind === "erc20-approve" ? [c.token] : []));
  const out = new Map<string, bigint>();
  const feePaid = new Map<string, bigint>();
  const approvals: SigningSummary["approvals"][number][] = [];
  const touched = new Set<string>();
  const receiversOk = [expect.account, expect.owner, ...expect.recipients];

  for (const call of calls) {
    switch (call.kind) {
      case "erc20-transfer": {
        touched.add(call.token.toLowerCase());
        const amount = BigInt(call.amount);
        addTo(out, call.token, amount);
        const feeKey = `${call.token}:${call.to}`.toLowerCase();
        if (feeBudget.has(feeKey)) {
          addTo(feePaid, feeKey, amount);
        } else if (!includes(expect.recipients, call.to) && !sameAddress(call.to, expect.owner)) {
          block("unexpected-transfer", `A transfer of ${call.amount} base units to ${call.to} is not in the plan.`, call.to);
        }
        break;
      }
      case "erc20-approve": {
        touched.add(call.token.toLowerCase());
        const amount = BigInt(call.amount);
        const needed = need.get(call.token.toLowerCase()) ?? 0n;
        approvals.push({ token: call.token, spender: call.spender, amount: call.amount, exact: amount === needed });
        if (amount === 0n) break; // a reset is always safe
        addTo(out, call.token, amount);
        const ceiling = expect.repayHeadroom ? needed + repayHeadroomOf(needed) : needed;
        if (amount >= UNLIMITED_APPROVAL) block("unlimited-approval", `An unlimited approval to ${call.spender} was prepared; Lykia only approves exact amounts.`, call.spender);
        else if (amount > needed && amount <= ceiling) findings.push({ layer: "approvals", rule: "approvals.headroom", severity: "warn", message: `The repay approval to ${call.spender} leaves up to ${amount - needed} base units of headroom; reset it to zero afterwards.`, stepId: expect.stepId, address: call.spender });
        else if (amount > ceiling) block("approval-exceeds-need", `The approval to ${call.spender} is larger than the ${needed} base units this step spends.`, call.spender);
        const calledLater = calls.some((c) => c.kind === "call" && sameAddress(c.target, call.spender));
        if (!calledLater && !includes(expect.knownContracts, call.spender)) block("unknown-spender", `The approval goes to ${call.spender}, which this step never calls and Lykia does not know.`, call.spender);
        break;
      }
      case "erc20-transfer-from":
        block("transfer-from", `A transferFrom moving tokens from ${call.from} to ${call.to} is not something Lykia prepares.`, call.to);
        break;
      case "approval-for-all":
        if (call.approved) block("approval-for-all", `setApprovalForAll would hand every token at ${call.target} to ${call.operator}.`, call.operator);
        break;
      case "permit":
      case "permit2-approve": {
        const amount = BigInt(call.amount);
        const needed = need.get(call.token.toLowerCase()) ?? 0n;
        approvals.push({ token: call.token, spender: call.spender, amount: call.amount, exact: amount === needed });
        if (amount >= UNLIMITED_APPROVAL || amount > needed) block("permit-exceeds-need", `A ${call.kind === "permit" ? "Permit" : "Permit2"} signature for ${call.amount} base units exceeds what this step spends.`, call.spender);
        else if (!includes(expect.knownContracts, call.spender) && !targets.some((t) => sameAddress(t, call.spender))) block("unknown-spender", `The ${call.kind === "permit" ? "Permit" : "Permit2"} spender ${call.spender} is not a contract this step uses.`, call.spender);
        break;
      }
      case "native": {
        const planned = BigInt(expect.nativeValue ?? "0");
        if (BigInt(call.value) > planned) block("native-value", `${call.value} wei of native USDC would leave the wallet; the plan sends ${planned}.`, call.to);
        break;
      }
      case "call": {
        touched.add(call.target.toLowerCase());
        const known = includes(expect.knownContracts, call.target) || includes(tokens, call.target) || approvals.some((a) => sameAddress(a.spender, call.target));
        if (!known) block("unknown-contract", `The step calls ${call.target}${call.fn ? ` (${call.fn})` : ""}, which is not part of the plan.`, call.target);
        for (const r of call.receivers) {
          if (!includes(receiversOk, r.address)) block("changed-recipient", `${call.fn ?? call.selector} names ${r.address} as ${r.name}; the plan pays ${expect.recipients[0] ?? expect.account}.`, r.address);
        }
        break;
      }
    }
  }
  for (const [key, paid] of feePaid) {
    const budget = feeBudget.get(key) ?? 0n;
    if (paid > budget) block("fee-overcharge", `The fee transfer is ${paid} base units; the plan quoted ${budget}.`);
  }
  for (const [token, amount] of out) {
    const allowed = allowedOut.get(token) ?? 0n;
    if (amount > allowed) block("outflow-exceeds-plan", `${amount} base units of ${symbols.get(token) ?? token} could leave the wallet; the plan allows ${allowed}.`, token as Address);
  }
  const balanceChanges: BalanceChange[] = [...out].map(([token, amount]) => ({ token: token as Address, symbol: symbols.get(token) ?? null, out: amount.toString(), in: null }));
  return { findings, summary: { calls, balanceChanges, approvals, contractsTouched: [...touched] as Address[] } };
}

/** One plain line per decoded call, for the "What you will sign" panel. */
export function describeCall(call: DecodedCall, symbolOf: (token: string) => string | null = () => null): string {
  const sym = (t: string) => symbolOf(t) ?? t;
  switch (call.kind) {
    case "erc20-transfer":
      return `Transfer ${call.amount} base units of ${sym(call.token)} to ${call.to}`;
    case "erc20-approve":
      return BigInt(call.amount) === 0n ? `Reset the ${sym(call.token)} allowance of ${call.spender} to zero` : `Approve ${call.spender} to pull ${call.amount} base units of ${sym(call.token)}`;
    case "erc20-transfer-from":
      return `Move ${call.amount} base units of ${sym(call.token)} from ${call.from} to ${call.to}`;
    case "permit":
      return `Sign a Permit letting ${call.spender} pull ${call.amount} base units of ${sym(call.token)}`;
    case "permit2-approve":
      return `Approve ${call.spender} on Permit2 for ${call.amount} base units of ${sym(call.token)}`;
    case "approval-for-all":
      return `${call.approved ? "Grant" : "Revoke"} approval for all tokens at ${call.target} to ${call.operator}`;
    case "native":
      return `Send ${call.value} wei of native USDC to ${call.to}`;
    case "call":
      return `Call ${call.fn ?? call.selector} on ${call.target}${call.memo ? " with an Arc memo" : ""}`;
  }
}
