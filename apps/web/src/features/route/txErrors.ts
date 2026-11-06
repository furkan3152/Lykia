/**
 * Why a step did not go through, in plain words, with the one retry that
 * makes sense (pure). Wallet, viem and Lykia API failures arrive in many
 * shapes; the review modal and the step runner show only these kinds:
 *
 *   quote     the price moved past the plan's minimum, or the plan changed: plan again
 *   revert    the simulation (or Arc) says the call would fail / failed
 *   chain     the wallet is on another network
 *   rejected  the owner cancelled in the wallet
 *   gas       not enough USDC for gas (Arc pays gas in USDC)
 *   funds     not enough of the token the step spends
 *   rpc       Arc's RPC or the Lykia API did not answer
 *   fence     the Fence needs a confirmation, or refuses
 *   unknown   anything else, with the original message
 *
 * `stage` says how far the step got: an error after the wallet sent the
 * transaction is never fixed by signing again (that could send twice); it
 * is retried by submitting the same hashes.
 */
import { ApiError, describeError } from "../../lib/apiErrors";

export type TxFailureKind = "quote" | "revert" | "chain" | "rejected" | "gas" | "funds" | "rpc" | "fence" | "unknown";
/** What the retry button does. */
export type TxRetry = "sign-again" | "resubmit" | "replan" | "switch-chain" | "confirm" | "none";
export type TxStage = "prepare" | "chain" | "sign" | "submit";

export interface TxFailure {
  readonly kind: TxFailureKind;
  readonly title: string;
  readonly detail: string;
  readonly retry: TxRetry;
  /** The retry button's label. */
  readonly retryLabel: string | null;
  /** True when a transaction may already be on Arc (never sign again blindly). */
  readonly sent: boolean;
  /** The original message, for the "details" disclosure. */
  readonly raw: string;
}

interface Shape {
  readonly code: unknown;
  readonly name: string;
  readonly text: string;
}

/** Walks `cause` chains (viem nests the useful error several levels down). */
function shapeOf(error: unknown): Shape {
  const names: string[] = [];
  const texts: string[] = [];
  let code: unknown = undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const e = current as { name?: unknown; code?: unknown; shortMessage?: unknown; message?: unknown; details?: unknown; cause?: unknown };
    if (typeof e.name === "string") names.push(e.name);
    if (code === undefined && (typeof e.code === "number" || typeof e.code === "string")) code = e.code;
    for (const t of [e.shortMessage, e.message, e.details]) if (typeof t === "string") texts.push(t);
    current = e.cause;
  }
  if (typeof error === "string") texts.push(error);
  return { code, name: names.join(" "), text: texts.join(" | ") };
}

const LABEL: Readonly<Record<TxRetry, string | null>> = {
  "sign-again": "Try again",
  resubmit: "Check Arc again",
  replan: "Plan again",
  "switch-chain": "Switch network and sign",
  confirm: "Confirm and sign",
  none: null,
};

function failure(kind: TxFailureKind, title: string, detail: string, retry: TxRetry, sent: boolean, raw: string): TxFailure {
  return { kind, title, detail, retry, retryLabel: LABEL[retry], sent, raw };
}

/** How many of a step's calls landed before the wallet stopped (useLykiaWallet sendSequentially). */
function partialOf(error: unknown): number {
  const partial = typeof error === "object" && error !== null ? (error as { partialHashes?: unknown }).partialHashes : undefined;
  return Array.isArray(partial) ? partial.length : 0;
}

export function classifyTxError(error: unknown, stage: TxStage, context: { readonly network?: string } = {}): TxFailure {
  const raw = describeError(error);
  // A wallet error that says a call already ran on Arc (useLykiaWallet sendSequentially) counts as sent.
  const sent = stage === "submit" || (typeof error === "object" && error !== null && (error as { onChain?: unknown }).onChain === true);
  const network = context.network ?? "Arc";
  const s = shapeOf(error);
  const text = s.text.toLowerCase();

  if (error instanceof ApiError) {
    const msg = error.message;
    if (error.code === "NO_ROUTE" && /price moved|planned minimum|plan again/iu.test(msg))
      return failure("quote", "The quote moved", "The price moved past this plan's minimum since it was planned, so Lykia refused to build a worse trade. Nothing was sent. Plan again for a fresh quote.", "replan", false, raw);
    if (error.code === "STEP_NOT_READY" || error.code === "CONFLICT")
      return failure("quote", "The plan changed", "This step is not ready to sign any more (it changed or ran meanwhile). Nothing new was sent. Reload the plan, or plan again.", "replan", sent, raw);
    if (error.code === "BINDING_MISMATCH")
      return failure("quote", "The transaction does not match the plan", "Arc has a transaction that is not the one Lykia prepared, so the step was not recorded. Plan again for fresh calls.", "replan", sent, raw);
    if (error.code === "CONFIRMATION_REQUIRED")
      return failure("fence", "Your Fence asks you to confirm", "Read the Fence's lines above, tick the confirmation and sign.", "confirm", false, raw);
    if (error.code === "NOT_SIGNABLE")
      return failure("fence", "Nothing to sign", `${msg} Change the request or your Fence and plan again.`, "replan", false, raw);
    if (error.code === "INSUFFICIENT_BALANCE")
      return failure("funds", "Not enough funds", `${msg} Top up the wallet or ask for less, then plan again.`, "replan", false, raw);
    if (error.code === "SECURITY_BLOCKED" || error.code === "SECURITY_BLOCK")
      return failure("revert", "The security check stopped this step", `${msg} Nothing was sent.`, "none", false, raw);
    if (error.code === "NOT_FOUND" && /does not know/iu.test(msg))
      return failure("rpc", "Arc has not seen the transaction yet", "Your wallet sent it, but the node Lykia asked has not seen it yet. Check again in a moment; do not sign again.", "resubmit", true, raw);
    if (error.retryable)
      return failure("rpc", sent ? "Lykia could not record the step yet" : "The Lykia API did not answer", sent ? "Your wallet sent the transaction; Lykia could not confirm it yet. Check again; do not sign again." : `${msg} Nothing was sent. Try again in a moment.`, sent ? "resubmit" : "sign-again", sent, raw);
    return failure("unknown", "The step did not go through", msg, sent ? "resubmit" : "sign-again", sent, raw);
  }

  if (s.code === 4001 || s.code === "ACTION_REJECTED" || /UserRejected/u.test(s.name) || /user (?:rejected|denied|cancel+ed)|rejected the request|request (?:was )?rejected|denied transaction/u.test(text))
    return failure("rejected", "You cancelled in your wallet", partialOf(error) > 0 ? `The first ${partialOf(error) === 1 ? "transaction (the approval)" : `${partialOf(error)} transactions`} went through, then you stopped. Nothing else moved. Sign again to finish; Lykia rebuilds the rest of the step.` : sent ? "The wallet stopped before every transaction was sent. Lykia checks what reached Arc when you try again." : "Nothing was sent. Sign again when you are ready.", sent ? "resubmit" : "sign-again", sent, raw);
  if (s.code === 4902 || /ChainMismatch|SwitchChain|ChainNotConfigured/u.test(s.name) || /chain mismatch|does not match the target chain|switch (?:the )?(?:chain|network)|unrecognized chain|chain (?:id )?.*not (?:supported|configured)|wrong network|is on arc (?:mainnet|testnet); switch/u.test(text))
    return failure("chain", "Your wallet is on another network", `This plan runs on ${network}. Lykia asks your wallet to switch; approve the switch (or switch in the wallet) and sign again.`, "switch-chain", false, raw);
  if (/InsufficientFunds/u.test(s.name) || /insufficient funds|exceeds (?:the )?balance|gas required exceeds|not enough (?:native|usdc) for gas/u.test(text))
    return failure("gas", "Not enough USDC for gas", "Arc pays gas in USDC. Add a little USDC to this wallet (a few cents covers most steps) and sign again.", "sign-again", sent, raw);
  if (/ContractFunctionRevert|ExecutionReverted|EstimateGasExecution|CallExecution/u.test(s.name) || /execution reverted|reverted|revert|simulation failed|would fail/u.test(text)) {
    const reason = /reason:?\s*([^|]{3,120})/iu.exec(s.text)?.[1]?.trim();
    return sent
      ? failure("revert", "The transaction reverted on Arc", `Arc ran it and it failed${reason ? ` (${reason})` : ""}. Only the gas was spent; your other funds did not move. Plan again for fresh calls.`, "replan", true, raw)
      : failure("revert", "The simulation says this would fail", `The call reverts against the current state of Arc${reason ? ` (${reason})` : ""}. Nothing was sent. Try again for a fresh quote, or plan again if it keeps failing.`, "sign-again", false, raw);
  }
  if (/HttpRequest|Timeout|RpcRequest|InternalRpc|LimitExceeded|ResourceUnavailable/u.test(s.name) || s.code === -32603 || s.code === -32005 || /failed to fetch|fetch failed|network error|timed? ?out|rate limit|too many requests|503|502|econnreset|socket hang up/u.test(text))
    return failure("rpc", sent ? "Arc's RPC did not answer" : "Arc's RPC did not answer", sent ? "Your wallet may have sent the transaction. Check again before signing anything new." : "Nothing was sent. Arc's RPC or your wallet's node did not answer; try again in a moment.", sent ? "resubmit" : "sign-again", sent, raw);
  return failure("unknown", "The step did not go through", raw, sent ? "resubmit" : "sign-again", sent, raw);
}
