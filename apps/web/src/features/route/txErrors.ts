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
import { t as tr } from "../../i18n";

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
  "sign-again": tr("route.txErrors.tryAgain"),
  resubmit: tr("route.txErrors.checkArcAgain"),
  replan: tr("route.txErrors.planAgain"),
  "switch-chain": tr("route.txErrors.switchNetworkAndSign"),
  confirm: tr("route.txErrors.confirmAndSign"),
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
      return failure("quote", tr("route.txErrors.theQuoteMoved"), tr("route.txErrors.thePriceMovedPastThisPlan"), "replan", false, raw);
    if (error.code === "STEP_NOT_READY" || error.code === "CONFLICT")
      return failure("quote", tr("route.txErrors.thePlanChanged"), tr("route.txErrors.thisStepIsNotReadyTo"), "replan", sent, raw);
    if (error.code === "BINDING_MISMATCH")
      return failure("quote", tr("route.txErrors.theTransactionDoesNotMatchThe"), tr("route.txErrors.arcHasATransactionThatIs"), "replan", sent, raw);
    if (error.code === "CONFIRMATION_REQUIRED")
      return failure("fence", tr("route.txErrors.yourFenceAsksYouToConfirm"), tr("route.txErrors.readTheFenceSLinesAbove"), "confirm", false, raw);
    if (error.code === "PREFLIGHT_ACK_REQUIRED")
      return failure("fence", tr("route.txErrors.lykoFoundSomethingToCheckFirst"), tr("route.txErrors.readBeforeYouSignTickIt", { value: msg }), "confirm", false, raw);
    if (error.code === "PREFLIGHT_BLOCKED")
      return failure("fence", tr("route.txErrors.lykoStoppedThisOne"), tr("route.txErrors.pickAFixUnderBeforeYou", { value: msg }), "replan", false, raw);
    if (error.code === "NOT_SIGNABLE")
      return failure("fence", tr("route.txErrors.nothingToSign"), tr("route.txErrors.changeTheRequestOrYourFence", { value: msg }), "replan", false, raw);
    if (error.code === "INSUFFICIENT_BALANCE")
      return failure("funds", tr("route.txErrors.notEnoughFunds"), tr("route.txErrors.topUpTheWalletOrAsk", { value: msg }), "replan", false, raw);
    if (error.code === "SECURITY_BLOCKED" || error.code === "SECURITY_BLOCK")
      return failure("revert", tr("route.txErrors.theSecurityCheckStoppedThisStep"), tr("route.txErrors.nothingWasSent", { value: msg }), "none", false, raw);
    if (error.code === "NOT_FOUND" && /does not know/iu.test(msg))
      return failure("rpc", tr("route.txErrors.arcHasNotSeenTheTransaction"), tr("route.txErrors.yourWalletSentItButThe"), "resubmit", true, raw);
    if (error.retryable)
      return failure("rpc", sent ? tr("route.txErrors.lykiaCouldNotRecordTheStep") : tr("route.txErrors.theLykiaApiDidNotAnswer"), sent ? tr("route.txErrors.yourWalletSentTheTransactionLykia") : tr("route.txErrors.nothingWasSentTryAgainIn", { value: msg }), sent ? "resubmit" : "sign-again", sent, raw);
    return failure("unknown", tr("route.txErrors.theStepDidNotGoThrough"), msg, sent ? "resubmit" : "sign-again", sent, raw);
  }

  if (s.code === 4001 || s.code === "ACTION_REJECTED" || /UserRejected/u.test(s.name) || /user (?:rejected|denied|cancel+ed)|rejected the request|request (?:was )?rejected|denied transaction/u.test(text))
    return failure("rejected", tr("route.txErrors.youCancelledInYourWallet"), partialOf(error) > 0 ? (partialOf(error) === 1 ? tr("route.txErrors.firstApprovalWentThrough") : tr("route.txErrors.firstTransactionsWentThrough", { n: partialOf(error) })) : sent ? tr("route.txErrors.theWalletStoppedBeforeEveryTransaction") : tr("route.txErrors.nothingWasSentSignAgainWhen"), sent ? "resubmit" : "sign-again", sent, raw);
  if (s.code === 4902 || /ChainMismatch|SwitchChain|ChainNotConfigured/u.test(s.name) || /chain mismatch|does not match the target chain|switch (?:the )?(?:chain|network)|unrecognized chain|chain (?:id )?.*not (?:supported|configured)|wrong network|is on arc (?:mainnet|testnet); switch/u.test(text))
    return failure("chain", tr("route.txErrors.yourWalletIsOnAnotherNetwork"), tr("route.txErrors.thisPlanRunsOnLykiaAsks", { network }), "switch-chain", false, raw);
  if (/InsufficientFunds/u.test(s.name) || /insufficient funds|exceeds (?:the )?balance|gas required exceeds|not enough (?:native|usdc) for gas/u.test(text))
    return failure("gas", tr("route.txErrors.notEnoughUsdcForGas"), tr("route.txErrors.arcPaysGasInUsdcAdd"), "sign-again", sent, raw);
  if (/ContractFunctionRevert|ExecutionReverted|EstimateGasExecution|CallExecution/u.test(s.name) || /execution reverted|reverted|revert|simulation failed|would fail/u.test(text)) {
    const reason = /reason:?\s*([^|]{3,120})/iu.exec(s.text)?.[1]?.trim();
    return sent
      ? failure("revert", tr("route.txErrors.theTransactionRevertedOnArc"), reason ? tr("route.txErrors.arcRanItReason", { reason }) : tr("route.txErrors.arcRanIt"), "replan", true, raw)
      : failure("revert", tr("route.txErrors.theSimulationSaysThisWouldFail"), reason ? tr("route.txErrors.callRevertsReason", { reason }) : tr("route.txErrors.callReverts"), "sign-again", false, raw);
  }
  if (/HttpRequest|Timeout|RpcRequest|InternalRpc|LimitExceeded|ResourceUnavailable/u.test(s.name) || s.code === -32603 || s.code === -32005 || /failed to fetch|fetch failed|network error|timed? ?out|rate limit|too many requests|503|502|econnreset|socket hang up/u.test(text))
    return failure("rpc", sent ? tr("route.txErrors.arcSRpcDidNotAnswer") : tr("route.txErrors.arcSRpcDidNotAnswer"), sent ? tr("route.txErrors.yourWalletMayHaveSentThe") : tr("route.txErrors.nothingWasSentArcSRpc"), sent ? "resubmit" : "sign-again", sent, raw);
  return failure("unknown", tr("route.txErrors.theStepDidNotGoThrough"), raw, sent ? "resubmit" : "sign-again", sent, raw);
}
