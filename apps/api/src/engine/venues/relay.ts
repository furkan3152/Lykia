/**
 * Relay out of Arc: USDC deposited into Relay's depository on Arc, filled on
 * the destination chain by a Relay solver. Cross-chain: the money arrives on
 * the other chain, not on Arc.
 *
 * The quote comes from Relay's official API (api.relay.link/quote). Lykia
 * checks it before using it: the deposit step must call the registry's
 * depository with depositErc20(depositor = the account, token = USDC,
 * amount = the step's amount, id), the output must be USDC on the asked
 * chain to the asked recipient, and the destination amount must cover the
 * planned minimum. Lykia then encodes the depositErc20 call itself from
 * those checked fields. The batch [USDC.approve(depository),
 * Memo(depositErc20)] runs through Multicall3From like every other step.
 */
import { getProtocol, sameAddress, type Address, type ArcEnvironment } from "@lykia/core";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import type { FetchLike } from "../../health/dependencies.js";
import { RELAY_DEPOSITORY_ABI } from "../abis.js";
import type { RawCall } from "../calls.js";

const RELAY_API = "https://api.relay.link";
const ARC_CHAIN_ID = 5042;

export interface RelayQuote {
  readonly requestId: Hex;
  /** Depository deposit id (bytes32) from the deposit step. */
  readonly depositId: Hex;
  readonly depository: Address;
  readonly amountIn: bigint;
  /** What the recipient receives on the destination chain (base units). */
  readonly amountOut: bigint;
  /** Relay's fees in USDC base units on Arc (relayer + service + gas). */
  readonly feeUnits: bigint;
  readonly timeEstimateSeconds: number | null;
}

export function relayDepository(environment: ArcEnvironment): Address | null {
  return (getProtocol("relay")?.deployments[environment]?.contracts.depository as Address | undefined) ?? null;
}

/** The destination chain's USDC, from Relay's own chain list (id "usdc"). */
async function destinationUsdc(fetchImpl: FetchLike, chainId: number): Promise<Address | null> {
  const response = await fetchImpl(`${RELAY_API}/chains`, { signal: AbortSignal.timeout(6_000) });
  if (!response.ok) return null;
  const body = (await response.json()) as { chains?: Array<{ id?: number; disabled?: boolean; depositEnabled?: boolean; erc20Currencies?: Array<{ id?: string; symbol?: string; address?: string; supportsBridging?: boolean }> }> };
  const chain = body.chains?.find((c) => c.id === chainId);
  if (!chain || chain.disabled) return null;
  const usdc = chain.erc20Currencies?.find((c) => c.id === "usdc" && c.symbol === "USDC" && c.supportsBridging !== false);
  return (usdc?.address as Address | undefined) ?? null;
}

/**
 * Relay's quote for bridging `amount` USDC from Arc to `destinationChainId`,
 * checked against the registry and the request; null when the API does not
 * answer or anything does not match.
 */
export async function quoteRelay(fetchImpl: FetchLike, environment: ArcEnvironment, input: { readonly user: Address; readonly recipient: Address; readonly usdc: Address; readonly amount: bigint; readonly destinationChainId: number }): Promise<RelayQuote | null> {
  const depository = relayDepository(environment);
  if (environment !== "mainnet" || !depository || input.amount <= 0n) return null;
  try {
    const currencyOut = await destinationUsdc(fetchImpl, input.destinationChainId);
    if (!currencyOut) return null;
    const response = await fetchImpl(`${RELAY_API}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: input.user, recipient: input.recipient, originChainId: ARC_CHAIN_ID, destinationChainId: input.destinationChainId, originCurrency: input.usdc, destinationCurrency: currencyOut, amount: input.amount.toString(), tradeType: "EXACT_INPUT" }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      requestId?: string;
      steps?: Array<{ id?: string; items?: Array<{ data?: { to?: string; data?: string; value?: string; chainId?: number } }> }>;
      fees?: Record<string, { amount?: string; currency?: { chainId?: number; address?: string } }>;
      details?: { recipient?: string; currencyOut?: { amount?: string; currency?: { chainId?: number; address?: string } }; timeEstimate?: number };
    };
    const deposit = body.steps?.find((s) => s.id === "deposit")?.items?.[0]?.data;
    if (!body.requestId || !deposit?.to || !deposit.data || deposit.chainId !== ARC_CHAIN_ID || BigInt(deposit.value ?? "0") !== 0n) return null;
    if (!sameAddress(deposit.to, depository)) return null;
    const decoded = decodeFunctionData({ abi: RELAY_DEPOSITORY_ABI, data: deposit.data as Hex });
    const [depositor, token, amount, id] = decoded.args;
    if (!sameAddress(depositor, input.user) || !sameAddress(token, input.usdc) || amount !== input.amount) return null;
    const out = body.details?.currencyOut;
    if (!out?.amount || out.currency?.chainId !== input.destinationChainId || !out.currency.address || !sameAddress(out.currency.address, currencyOut)) return null;
    if (!body.details?.recipient || !sameAddress(body.details.recipient, input.recipient)) return null;
    const onArc = (key: string) => {
      const fee = body.fees?.[key];
      return fee?.amount && fee.currency?.chainId === ARC_CHAIN_ID && fee.currency.address && sameAddress(fee.currency.address, input.usdc) ? BigInt(fee.amount) : 0n;
    };
    return {
      requestId: body.requestId as Hex,
      depositId: id,
      depository,
      amountIn: amount,
      amountOut: BigInt(out.amount),
      feeUnits: onArc("relayer") + onArc("app"),
      timeEstimateSeconds: typeof body.details.timeEstimate === "number" ? body.details.timeEstimate : null,
    };
  } catch {
    return null;
  }
}

export const relayCalls = {
  /** depositErc20 credited to the account, for the request id Relay's solver fills. */
  deposit(depository: Address, account: Address, token: Address, amount: bigint, depositId: Hex, label: string): RawCall {
    return { to: depository, data: encodeFunctionData({ abi: RELAY_DEPOSITORY_ABI, functionName: "depositErc20", args: [account, token, amount, depositId] }), label };
  },
};

/** Relay's status for a request ("success", "pending", "failure", "refund", "waiting"); null when unreadable. */
export async function relayStatus(fetchImpl: FetchLike, requestId: string): Promise<{ status: string; destinationTx: string | null } | null> {
  try {
    const response = await fetchImpl(`${RELAY_API}/intents/status/v3?requestId=${requestId}`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { status?: string; txHashes?: string[] };
    return typeof body.status === "string" ? { status: body.status, destinationTx: body.txHashes?.[0] ?? null } : null;
  } catch {
    return null;
  }
}
