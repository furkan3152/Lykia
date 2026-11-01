/** `@lykia/sdk/circle`: Circle's stack through Lykia (CCTP, Gateway, x402 services, Compliance screening). */
import type { Address, ArcEnvironment, Fence, FenceVerdict, UnsignedTransaction } from "@lykia/core";
import type { CircleStatusResponse, GatewayTransferDraft, GatewayTransferResult, X402DiscoveryResponse } from "@lykia/core/api/circle";
import { q, type LykiaTransport } from "./transport.js";

export function circleApi(t: LykiaTransport) {
  return {
    status: () => t.request<CircleStatusResponse>("GET", "/v1/circle/status"),
    services: (input: { query?: string; category?: string; maxUsdPrice?: number; environment?: ArcEnvironment } = {}) =>
      t.request<X402DiscoveryResponse>("GET", `/v1/circle/services${q({ query: input.query, category: input.category, maxUsdPrice: input.maxUsdPrice === undefined ? undefined : String(input.maxUsdPrice), environment: t.env(input.environment) })}`),
    cctpFees: (destination: string, forward = false, environment?: ArcEnvironment) => t.request<unknown>("GET", `/v1/circle/cctp/fees${q({ destination, forward: forward ? "true" : undefined, environment: t.env(environment) })}`),
    cctpForward: (input: { owner: Address; destination: string; amount: string; recipient?: Address; fast?: boolean; environment?: ArcEnvironment }) =>
      t.request<{ transactions: UnsignedTransaction[]; maxFee: string; burn: string }>("POST", "/v1/circle/cctp/forward", { ...input, environment: t.env(input.environment) }),
    gatewayDraft: (input: { owner: Address; destination: string; amount: string; recipient?: Address; environment?: ArcEnvironment }) => t.request<GatewayTransferDraft>("POST", "/v1/circle/gateway/transfer/draft", { ...input, environment: t.env(input.environment) }),
    gatewayTransfer: (input: { destination: string; burnIntents: readonly unknown[]; signatures: readonly `0x${string}`[]; environment?: ArcEnvironment }) => t.request<GatewayTransferResult>("POST", "/v1/circle/gateway/transfer", { ...input, environment: t.env(input.environment) }),
    /** Reads a service's 402, checks the price and payee against the Fence and returns EIP-3009 typed data to sign. */
    x402Prepare: (input: { resource: string; owner: Address; method?: "GET" | "POST"; signer?: "wallet" | "agent"; fence?: Fence; environment?: ArcEnvironment }) =>
      t.request<{ paymentId: string | null; priceUsdc: string; verdict: FenceVerdict; typedData: unknown }>("POST", "/v1/circle/x402/prepare", { ...input, environment: t.env(input.environment) }),
    x402Pay: (paymentId: string, signature: `0x${string}`, body?: string) => t.request<{ paid: boolean; status: number; settlement: unknown; body: string }>("POST", "/v1/circle/x402/pay", { paymentId, signature, ...(body ? { body } : {}) }),
    screen: (address: Address, environment?: ArcEnvironment) => t.request<unknown>("POST", "/v1/circle/screen", { address, environment: t.env(environment) }),
  };
}

export type CircleApi = ReturnType<typeof circleApi>;
export type { CircleStatusResponse, GatewayTransferDraft, GatewayTransferResult, X402DiscoveryResponse };
