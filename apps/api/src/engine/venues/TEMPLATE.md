# Adding a venue

A venue becomes routable in five small, typed changes. Aerodrome Slipstream
(`aerodrome.ts`) is the reference: read it next to this page.

## 1. The registry row (`packages/core/src/protocolData.ts`)

```ts
{
  id: "your-protocol",                 // kebab-case, unique, and the id everything else uses
  name: "Your Protocol",
  category: "vault",                   // circle | lending | dex | vault | fx | bridge | agent | oracle | infra | launchpad | perps
  summary: "One sentence: what it is and what Lykia does with it.",
  website: "https://your.protocol",
  deployments: {
    mainnet: {
      status: "live",                  // "announced" until the evidence below exists
      contracts: { vault: "0x…", router: "0x…" },
      evidence: "Addresses from docs.your.protocol/contracts; eth_getCode non-empty 2026-11-01; deposit simulated with eth_call 2026-11-01",
    },
  },
  verbs: ["deposit", "withdraw", "approve"],
}
```

`validateProtocols` refuses a `live` row without evidence, a malformed
address or a duplicate id at load time.

## 2. The venue module (`apps/api/src/engine/venues/yourProtocol.ts`)

Two pure pieces: reads that quote, and builders that return unsigned calls.

```ts
import type { Address, ArcEnvironment } from "@lykia/core";
import { encodeFunctionData, parseAbi } from "viem";
import type { ArcChains } from "../../chains/arc.js";
import type { RawCall } from "../calls.js";

const VAULT_ABI = parseAbi([
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
]);

/** Reads only. Returns null when the venue cannot answer; never a guess. */
export async function quoteDeposit(chains: ArcChains, environment: ArcEnvironment, vault: Address, assets: bigint): Promise<bigint | null> {
  try {
    return await chains.client(environment).readContract({ address: vault, abi: VAULT_ABI, functionName: "previewDeposit", args: [assets] });
  } catch {
    return null;
  }
}

/** Unsigned calls. The engine adds approvals, Lykia's fee and the Arc Memo around them. */
export const yourProtocolCalls = {
  deposit: (vault: Address, assets: bigint, receiver: Address, label: string): RawCall => ({
    to: vault,
    data: encodeFunctionData({ abi: VAULT_ABI, functionName: "deposit", args: [assets, receiver] }),
    label,
  }),
};
```

## 3. The adapter (`apps/api/src/engine/adapters.ts`)

- Add an `AdapterId`, for example `"your-deposit"`.
- Map it in `ADAPTER_VENUE` (`"your-deposit": "your-protocol"`) and in `stepKindOf`.
- Add a `case` to `buildCalls` that re-checks the minimum with a fresh quote
  (`freshMinimum`), asks for the approval it needs (`needApproval`) and
  returns `{ approvals, calls }`.
- Add the id to `EXECUTABLE_VENUES` for each network where it was simulated.

## 4. The router (`apps/api/src/engine/router.ts`)

Push a candidate with the quote, its net value after gas and the adapter
params. The router compares it with every other venue and records why it
won or lost in the step's `route`.

## 5. Proof

- A unit test next to the others in `src/__tests__` that builds the calls
  against a fake chain.
- One line in `src/scripts/smoke.ts` (or a scenario in `src/scripts/e2e.ts`)
  that simulates the batch on mainnet with `eth_call`.
- `npm run verify` stays green.

Nothing in this path signs. The Fence checks every step before it can be
prepared, and the user signs in their own wallet.
