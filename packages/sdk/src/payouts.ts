/** `@lykia/sdk/payouts`: batch payouts with an Arc Memo per row, CSV import and row-by-row status. */
import type { Address, ArcEnvironment, Fence, Payout, PayoutRowInput } from "@lykia/core";
import { q, type LykiaTransport } from "./transport.js";

export interface CreatePayoutInput {
  readonly payer: Address;
  readonly rows: readonly PayoutRowInput[];
  readonly projectId?: string;
  readonly environment?: ArcEnvironment;
  readonly fence?: Fence;
  /** Execute from this Circle developer-controlled wallet (its address is the payer). */
  readonly circleWalletId?: string;
  readonly dryRun?: boolean;
  readonly confirm?: boolean;
}

export function payoutsApi(t: LykiaTransport) {
  const env = <T extends { environment?: ArcEnvironment }>(input: T) => ({ ...input, environment: t.env(input.environment) });
  return {
    /** Validates, screens payees, checks balances, the Fence and the beta cap, and builds Multicall3From batches. */
    create: (input: CreatePayoutInput) => t.request<Payout>("POST", "/v1/payouts", env(input)),
    /** The same from a CSV (to, token, amount, reference, memo). */
    importCsv: (csv: string, input: Omit<CreatePayoutInput, "rows">) => t.request<Payout>("POST", "/v1/payouts/import", { ...env(input), csv }),
    parseCsv: (csv: string) => t.request<{ rows: PayoutRowInput[]; issues: { path: string; message: string }[] }>("POST", "/v1/payouts/parse-csv", { csv }),
    list: (filter: { projectId?: string; status?: string } = {}) => t.request<{ payouts: Payout[] }>("GET", `/v1/payouts${q(filter)}`),
    get: (id: string) => t.request<Payout>("GET", `/v1/payouts/${encodeURIComponent(id)}`),
    /** After the payer broadcast batch `index`: verified against the prepared transaction, settled from its Memo events. */
    submit: (id: string, index: number, hash: string) => t.request<Payout>("POST", `/v1/payouts/${encodeURIComponent(id)}/batches/${index}/submit`, { hash }),
    /** Executes ready batches from the payout's Circle developer-controlled wallet. */
    executeWithCircle: (id: string) => t.request<Payout>("POST", `/v1/payouts/${encodeURIComponent(id)}/execute`, {}),
  };
}

export type PayoutsApi = ReturnType<typeof payoutsApi>;
export type { Payout, PayoutRowInput };
