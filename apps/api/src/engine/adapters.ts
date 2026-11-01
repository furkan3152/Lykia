/**
 * Venue adapters: the calls each step needs, rebuilt fresh at prepare time
 * (allowances and quotes re-read; a price that moved past the planned
 * minimum refuses instead of signing a worse trade).
 *
 * Executable:
 *   transfer                 ERC-20 transfer with an Arc Memo                      mainnet + testnet
 *   bridge                   CCTP V2 depositForBurn                                mainnet + testnet
 *   gateway                  Circle Gateway deposit (unified USDC balance)         mainnet + testnet
 *   vault-deposit/withdraw   Morpho Vault V2 (ERC-4626)                            mainnet
 *   aave-*                   Aave V4 Spokes: supply, withdraw, borrow, repay       mainnet
 *   morpho-borrow/repay      Morpho Blue cirBTC markets                            mainnet
 *   swap / swap-path         Uniswap v3 single pool and two-hop paths              mainnet
 *   swap-v4                  Uniswap v4 through UniversalRouter + Permit2          mainnet
 *   practice-*               Lykia practice vault, swap and lending                testnet (once deployed)
 * Listed, not executable: StableFX RFQ (Circle credentials and a taker
 * signature flow), Aerodrome Slipstream (Metarouter not wired), USYC Teller
 * (unverified source).
 */
import {
  contractAddress,
  CCTP_DESTINATIONS,
  findCctpDestination,
  fromBaseUnits,
  getToken,
  tokenAddress,
  type Address,
  type ArcEnvironment,
  type StepFact,
  type StepKind,
} from "@lykia/core";
import { encodeFunctionData, erc20Abi, pad, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";
import type { FetchLike } from "../health/dependencies.js";
import { LykiaHttpError } from "../http/errors.js";
import { ERC4626_ABI } from "../flock/flock.js";
import { GATEWAY_WALLET_ABI, PERMIT2_ABI, PRACTICE_LENDING_ABI, PRACTICE_SWAP_ABI, QUOTER_V2_PATH_ABI, TOKEN_MESSENGER_V2_ABI } from "./abis.js";
import { aaveCalls } from "./venues/aave.js";
import { MORPHO_BLUE, morphoCalls, morphoMarkets, readMorphoPosition } from "./venues/morphoBlue.js";
import { quoteV3Single, quoteV4, uniswapCalls, v3Contracts, v4Contracts } from "./venues/uniswap.js";
import { approveCall, type RawCall } from "./calls.js";

export type AdapterId =
  | "transfer"
  | "bridge"
  | "gateway"
  | "vault-deposit"
  | "vault-withdraw"
  | "swap"
  | "swap-path"
  | "swap-v4"
  | "aave-supply"
  | "aave-withdraw"
  | "aave-borrow"
  | "aave-repay"
  | "morpho-borrow"
  | "morpho-repay"
  | "practice-vault-deposit"
  | "practice-vault-withdraw"
  | "practice-swap"
  | "practice-borrow"
  | "practice-repay";

/** Venues the engine executes per environment (practice venues once deployed, see venues/practice.ts). */
export const EXECUTABLE_VENUES: Readonly<Record<ArcEnvironment, ReadonlySet<string>>> = {
  mainnet: new Set(["arc-transfer", "cctp", "gateway", "morpho-vaults", "morpho-blue", "aave-v4", "uniswap-v3", "uniswap-v4"]),
  testnet: new Set(["arc-transfer", "cctp", "gateway", "lykia-practice"]),
};

export interface StepPlan {
  readonly adapter: AdapterId;
  readonly params: Readonly<Record<string, string>>;
}

export function noRoute(message: string): LykiaHttpError {
  return new LykiaHttpError("NO_ROUTE", 422, message);
}

export const IRIS_API: Readonly<Record<ArcEnvironment, string>> = { mainnet: "https://iris-api.circle.com", testnet: "https://iris-api-sandbox.circle.com" };
/** CCTP V2 finality thresholds: 1000 = fast, 2000 = standard (finalized). Arc is final on inclusion. */
export const CCTP_STANDARD_FINALITY = 2000;
export function addressToBytes32(address: Address): Hex {
  return pad(address, { size: 32 });
}

/** CCTP V2 fee in bps for a route (Iris fees API); null when unreadable. */
export async function cctpFeeBps(fetchImpl: FetchLike, environment: ArcEnvironment, destinationDomain: number): Promise<number | null> {
  try {
    const response = await fetchImpl(`${IRIS_API[environment]}/v2/burn/USDC/fees/26/${destinationDomain}`, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as Array<{ finalityThreshold?: number; minimumFee?: number }>;
    const standard = Array.isArray(body) ? body.find((f) => f.finalityThreshold === CCTP_STANDARD_FINALITY) : undefined;
    return typeof standard?.minimumFee === "number" ? standard.minimumFee : null;
  } catch {
    return null;
  }
}

export interface BuildContext {
  readonly environment: ArcEnvironment;
  readonly chains: ArcChains;
  readonly account: Address;
}

export interface BuiltCalls {
  /** Approvals first (empty when allowances already cover the step). */
  readonly approvals: RawCall[];
  /** The step's calls in order; the last one is the value-moving call that carries the memo. */
  readonly calls: RawCall[];
}

const PERMIT2_EXPIRY_SECONDS = 30 * 60;

/** The calls a step needs, built fresh at prepare time (allowances and quotes re-read). */
export async function buildCalls(plan: StepPlan, ctx: BuildContext): Promise<BuiltCalls> {
  const p = plan.params;
  const client = ctx.chains.client(ctx.environment);
  const big = (key: string) => BigInt(p[key] as string);
  const needApproval = async (token: Address, spender: Address, amount: bigint, symbol: string, venue: string, decimals = Number(p.decimals ?? 6)): Promise<RawCall[]> => {
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [ctx.account, spender] });
    return allowance >= amount ? [] : [approveCall(token, spender, amount, `Approve ${fromBaseUnits(amount, decimals)} ${symbol} to ${venue}`)];
  };
  const freshMinimum = async (quote: () => Promise<bigint | null>) => {
    const fresh = await quote();
    if (fresh === null || fresh < big("minOut")) throw new LykiaHttpError("NO_ROUTE", 422, "The price moved past the planned minimum; plan again.");
  };
  switch (plan.adapter) {
    case "transfer":
      return { approvals: [], calls: [{ to: p.token as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [p.to as Address, big("amount")] }), label: `Send ${p.display} to ${p.to}` }] };
    case "bridge": {
      const messenger = contractAddress("tokenMessengerV2", ctx.environment) as Address;
      const amount = big("amount");
      return {
        approvals: await needApproval(p.token as Address, messenger, amount, "USDC", "CCTP"),
        calls: [
          {
            to: messenger,
            data: encodeFunctionData({
              abi: TOKEN_MESSENGER_V2_ABI,
              functionName: "depositForBurn",
              args: [amount, Number(p.domain), addressToBytes32(p.recipient as Address), p.token as Address, pad("0x00", { size: 32 }), big("maxFee"), CCTP_STANDARD_FINALITY],
            }),
            label: `Bridge ${p.display} to ${p.destinationName} over CCTP`,
          },
        ],
      };
    }
    case "gateway": {
      const wallet = contractAddress("gatewayWallet", ctx.environment) as Address;
      const amount = big("amount");
      return { approvals: await needApproval(p.token as Address, wallet, amount, "USDC", "Gateway"), calls: [{ to: wallet, data: encodeFunctionData({ abi: GATEWAY_WALLET_ABI, functionName: "deposit", args: [p.token as Address, amount] }), label: `Deposit ${p.display} into Circle Gateway` }] };
    }
    case "vault-deposit":
    case "practice-vault-deposit": {
      const amount = big("amount");
      return {
        approvals: await needApproval(p.token as Address, p.vault as Address, amount, p.symbol as string, p.vaultName as string),
        calls: [{ to: p.vault as Address, data: encodeFunctionData({ abi: ERC4626_ABI, functionName: "deposit", args: [amount, ctx.account] }), label: `Deposit ${p.display} into ${p.vaultName}` }],
      };
    }
    case "vault-withdraw":
    case "practice-vault-withdraw": {
      const data =
        p.mode === "redeem"
          ? encodeFunctionData({ abi: ERC4626_ABI, functionName: "redeem", args: [big("shares"), ctx.account, ctx.account] })
          : encodeFunctionData({ abi: ERC4626_ABI, functionName: "withdraw", args: [big("amount"), ctx.account, ctx.account] });
      return { approvals: [], calls: [{ to: p.vault as Address, data, label: `Withdraw ${p.display} from ${p.vaultName}` }] };
    }
    case "swap": {
      const v3 = v3Contracts(ctx.environment);
      if (!v3) throw noRoute("Uniswap v3 is not deployed on this environment.");
      const amountIn = big("amountIn");
      await freshMinimum(async () => (await quoteV3Single(ctx.chains, ctx.environment, p.tokenIn as Address, p.tokenOut as Address, amountIn)).find((q) => q.fee === Number(p.fee))?.amountOut ?? null);
      return {
        approvals: await needApproval(p.tokenIn as Address, v3.router, amountIn, p.symbolIn as string, "Uniswap v3"),
        calls: [uniswapCalls.v3Single(v3.router, p.tokenIn as Address, p.tokenOut as Address, Number(p.fee), ctx.account, amountIn, big("minOut"), `Swap ${p.display} on Uniswap v3`)],
      };
    }
    case "swap-path": {
      const v3 = v3Contracts(ctx.environment);
      if (!v3) throw noRoute("Uniswap v3 is not deployed on this environment.");
      const amountIn = big("amountIn");
      await freshMinimum(async () => {
        try {
          const { result } = await client.simulateContract({ address: v3.quoter, abi: QUOTER_V2_PATH_ABI, functionName: "quoteExactInput", args: [p.path as Hex, amountIn] });
          return result[0];
        } catch {
          return null;
        }
      });
      return {
        approvals: await needApproval(p.tokenIn as Address, v3.router, amountIn, p.symbolIn as string, "Uniswap v3"),
        calls: [uniswapCalls.v3Path(v3.router, p.path as Hex, ctx.account, amountIn, big("minOut"), `Swap ${p.display} on Uniswap v3 (two hops)`)],
      };
    }
    case "swap-v4": {
      const v4 = v4Contracts(ctx.environment);
      if (!v4) throw noRoute("Uniswap v4 is not deployed on this environment.");
      const amountIn = big("amountIn");
      const key = { currency0: p.currency0 as Address, currency1: p.currency1 as Address, fee: Number(p.fee), tickSpacing: Number(p.tickSpacing), hooks: p.hooks as Address };
      await freshMinimum(async () => (await quoteV4(ctx.chains, ctx.environment, p.tokenIn as Address, p.tokenOut as Address, amountIn)).find((q) => q.key.fee === key.fee && q.key.tickSpacing === key.tickSpacing)?.amountOut ?? null);
      const now = Math.floor(Date.now() / 1000);
      const approvals = await needApproval(p.tokenIn as Address, v4.permit2, amountIn, p.symbolIn as string, "Permit2");
      let permitted: boolean;
      try {
        const [amount, expiration] = await client.readContract({ address: v4.permit2, abi: PERMIT2_ABI, functionName: "allowance", args: [ctx.account, p.tokenIn as Address, v4.router] });
        permitted = amount >= amountIn && Number(expiration) > now + 60;
      } catch {
        permitted = false;
      }
      if (!permitted) approvals.push(uniswapCalls.permit2Approve(v4.permit2, p.tokenIn as Address, v4.router, amountIn, now + PERMIT2_EXPIRY_SECONDS, `Permit2: let Uniswap's UniversalRouter pull ${p.symbolIn} for 30 minutes`));
      return { approvals, calls: [uniswapCalls.v4Single(v4.router, key, p.zeroForOne === "true", amountIn, big("minOut"), BigInt(now + PERMIT2_EXPIRY_SECONDS), `Swap ${p.display} on Uniswap v4`)] };
    }
    case "practice-swap": {
      const amountIn = big("amountIn");
      await freshMinimum(async () => {
        try {
          return await client.readContract({ address: p.pool as Address, abi: PRACTICE_SWAP_ABI, functionName: "quoteOut", args: [p.tokenIn as Address, amountIn] });
        } catch {
          return null;
        }
      });
      return {
        approvals: await needApproval(p.tokenIn as Address, p.pool as Address, amountIn, p.symbolIn as string, "Lykia Practice Swap"),
        calls: [{ to: p.pool as Address, data: encodeFunctionData({ abi: PRACTICE_SWAP_ABI, functionName: "swap", args: [p.tokenIn as Address, amountIn, big("minOut"), ctx.account] }), label: `Swap ${p.display} on Lykia Practice Swap` }],
      };
    }
    case "aave-supply": {
      const amount = big("amount");
      return {
        approvals: await needApproval(p.token as Address, p.spoke as Address, amount, p.symbol as string, p.spokeName as string),
        calls: [aaveCalls.supply(p.spoke as Address, Number(p.reserveId), amount, ctx.account, `Supply ${p.display} to ${p.spokeName}`)],
      };
    }
    case "aave-withdraw":
      return { approvals: [], calls: [aaveCalls.withdraw(p.spoke as Address, Number(p.reserveId), p.mode === "all" ? null : big("amount"), ctx.account, `Withdraw ${p.display} from ${p.spokeName}`)] };
    case "aave-borrow": {
      const collateral = big("collateral");
      const calls: RawCall[] = [];
      let approvals: RawCall[] = [];
      if (collateral > 0n) {
        approvals = await needApproval(p.collToken as Address, p.spoke as Address, collateral, p.collSymbol as string, p.spokeName as string, Number(p.decimals));
        calls.push(aaveCalls.supply(p.spoke as Address, Number(p.collReserve), collateral, ctx.account, `Supply ${fromBaseUnits(collateral, Number(p.decimals))} ${p.collSymbol} as collateral`));
        calls.push(aaveCalls.setCollateral(p.spoke as Address, Number(p.collReserve), ctx.account, `Use ${p.collSymbol} as collateral`));
      }
      calls.push(aaveCalls.borrow(p.spoke as Address, Number(p.loanReserve), big("amount"), ctx.account, `Borrow ${p.display} from ${p.spokeName}`));
      return { approvals, calls };
    }
    case "aave-repay": {
      const amount = big("amount");
      const approveAmount = p.mode === "all" ? amount + amount / 1000n + 1_000n : amount;
      return {
        approvals: await needApproval(p.token as Address, p.spoke as Address, approveAmount, p.symbol as string, p.spokeName as string),
        calls: [aaveCalls.repay(p.spoke as Address, Number(p.reserveId), p.mode === "all" ? null : amount, ctx.account, `Repay ${p.display} on ${p.spokeName}`)],
      };
    }
    case "morpho-borrow": {
      const market = morphoMarkets(ctx.environment).find((m) => m.id === p.market);
      if (!market) throw noRoute("That Morpho market is not on this environment.");
      const collateral = big("collateral");
      const calls: RawCall[] = [];
      let approvals: RawCall[] = [];
      if (collateral > 0n) {
        approvals = await needApproval(p.collToken as Address, MORPHO_BLUE[ctx.environment] as Address, collateral, p.collSymbol as string, "Morpho Blue", Number(p.decimals));
        calls.push(morphoCalls.supplyCollateral(ctx.environment, market, collateral, ctx.account, `Post ${fromBaseUnits(collateral, Number(p.decimals))} ${p.collSymbol} on ${market.label}`));
      }
      calls.push(morphoCalls.borrow(ctx.environment, market, big("amount"), ctx.account, `Borrow ${p.display} on ${market.label}`));
      return { approvals, calls };
    }
    case "morpho-repay": {
      const market = morphoMarkets(ctx.environment).find((m) => m.id === p.market);
      if (!market) throw noRoute("That Morpho market is not on this environment.");
      const all = p.mode === "all";
      const position = all ? await readMorphoPosition(ctx.chains, ctx.environment, market, ctx.account) : null;
      if (all && !position) throw noRoute("The Morpho position could not be read; plan again.");
      const assets = all ? (position as { borrowAssets: bigint }).borrowAssets : big("amount");
      const approveAmount = all ? assets + assets / 1000n + 1_000n : assets;
      return {
        approvals: await needApproval(p.token as Address, MORPHO_BLUE[ctx.environment] as Address, approveAmount, p.symbol as string, "Morpho Blue"),
        calls: [morphoCalls.repay(ctx.environment, market, all ? 0n : assets, all ? (position as { borrowShares: bigint }).borrowShares : 0n, ctx.account, `Repay ${p.display} on ${market.label}`)],
      };
    }
    case "practice-borrow": {
      const collateral = big("collateral");
      const calls: RawCall[] = [];
      let approvals: RawCall[] = [];
      if (collateral > 0n) {
        approvals = await needApproval(p.collToken as Address, p.pool as Address, collateral, p.collSymbol as string, "Lykia Practice Lending", Number(p.decimals));
        calls.push({ to: p.pool as Address, data: encodeFunctionData({ abi: PRACTICE_LENDING_ABI, functionName: "supplyCollateral", args: [collateral, ctx.account] }), label: `Post ${fromBaseUnits(collateral, Number(p.decimals))} ${p.collSymbol} on Lykia Practice Lending` });
      }
      calls.push({ to: p.pool as Address, data: encodeFunctionData({ abi: PRACTICE_LENDING_ABI, functionName: "borrow", args: [big("amount"), ctx.account] }), label: `Borrow ${p.display} on Lykia Practice Lending` });
      return { approvals, calls };
    }
    case "practice-repay": {
      const amount = big("amount");
      return {
        approvals: await needApproval(p.token as Address, p.pool as Address, amount, p.symbol as string, "Lykia Practice Lending"),
        calls: [{ to: p.pool as Address, data: encodeFunctionData({ abi: PRACTICE_LENDING_ABI, functionName: "repay", args: [amount, ctx.account] }), label: `Repay ${p.display} on Lykia Practice Lending` }],
      };
    }
  }
}

/** Venue id per adapter (for the registry and the Fence's venue rules). */
export const ADAPTER_VENUE: Readonly<Record<AdapterId, string>> = {
  transfer: "arc-transfer",
  bridge: "cctp",
  gateway: "gateway",
  "vault-deposit": "morpho-vaults",
  "vault-withdraw": "morpho-vaults",
  swap: "uniswap-v3",
  "swap-path": "uniswap-v3",
  "swap-v4": "uniswap-v4",
  "aave-supply": "aave-v4",
  "aave-withdraw": "aave-v4",
  "aave-borrow": "aave-v4",
  "aave-repay": "aave-v4",
  "morpho-borrow": "morpho-blue",
  "morpho-repay": "morpho-blue",
  "practice-vault-deposit": "lykia-practice",
  "practice-vault-withdraw": "lykia-practice",
  "practice-swap": "lykia-practice",
  "practice-borrow": "lykia-practice",
  "practice-repay": "lykia-practice",
};

export function stepKindOf(adapter: AdapterId, fx: boolean): StepKind {
  switch (adapter) {
    case "transfer":
      return "transfer";
    case "bridge":
      return "bridge";
    case "gateway":
      return "gateway-deposit";
    case "vault-deposit":
    case "practice-vault-deposit":
      return "deposit";
    case "aave-supply":
      return "supply";
    case "vault-withdraw":
    case "practice-vault-withdraw":
    case "aave-withdraw":
      return "withdraw";
    case "swap":
    case "swap-path":
    case "swap-v4":
    case "practice-swap":
      return fx ? "fx" : "swap";
    case "aave-borrow":
    case "morpho-borrow":
    case "practice-borrow":
      return "borrow";
    case "aave-repay":
    case "morpho-repay":
    case "practice-repay":
      return "repay";
  }
}

export { CCTP_DESTINATIONS, findCctpDestination, getToken, tokenAddress };
export type { StepFact };
