/** Contract types for /v1/circle/*. */

export type CircleProductState = "live" | "configured" | "needs-key" | "unavailable-on-arc" | "console-only";

export interface CircleProductStatus {
  readonly id: string;
  readonly name: string;
  readonly state: CircleProductState;
  /** Which environment variable unlocks it, when one does. */
  readonly needs?: readonly string[];
  readonly arc: { readonly mainnet: boolean; readonly testnet: boolean };
  readonly what: string;
  readonly lykia: string;
  readonly docs: string;
  readonly evidence?: string;
}

export interface CircleStatusResponse {
  readonly products: readonly CircleProductStatus[];
  readonly checkedAt: string;
}

export interface X402Service {
  readonly resource: string;
  readonly provider: string;
  readonly category: string | null;
  readonly description: string | null;
  readonly method: string | null;
  /** Arc payment option, when the service accepts USDC on Arc. */
  readonly arc: { readonly network: string; readonly amount: string; readonly payTo: string; readonly asset: string; readonly priceUsdc: string } | null;
  readonly networks: readonly string[];
  readonly gateway: boolean;
}

export interface X402DiscoveryResponse {
  readonly services: readonly X402Service[];
  readonly source: string;
}

export interface GatewayTransferDraft {
  /** EIP-712 typed data per burn intent, for the depositor's wallet to sign. */
  readonly typedData: readonly unknown[];
  readonly burnIntents: readonly unknown[];
  readonly fee: {
    readonly maxFee: string;
    readonly transferFeeBps: number;
    readonly gasFeeUsdc: string;
    /** "estimate": Gateway's POST /v1/estimate set maxFee; "formula": Circle's published formula (gas fee + 0.005%). */
    readonly source?: "estimate" | "formula";
    /** Forwarding Service fee in USDC when the transfer is forwarded (from the estimate). */
    readonly forwardingFeeUsdc?: string | null;
  };
  /** True when Circle's Forwarding Service will submit the destination mint. */
  readonly forward?: boolean;
  readonly submit: string;
}

export interface GatewayTransferResult {
  /** Null when the transfer was forwarded: Circle submits the mint and the response may omit it. */
  readonly attestation: string | null;
  readonly signature: string | null;
  readonly transferId: string | null;
  /** Unsigned gatewayMint on the destination chain; null when Circle's Forwarding Service mints. */
  readonly mint: { readonly chainId: number | null; readonly to: string; readonly data: string; readonly value: string } | null;
  readonly forwarded?: boolean;
}
