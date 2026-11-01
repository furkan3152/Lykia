/**
 * Venue adapters. Each one plans a step from an action (live reads and
 * quotes, the facts the Fence needs) and later builds the unsigned calls
 * for it. Planned parameters are plain strings so the plan can be stored
 * and rebuilt at prepare time with fresh allowances.
 *
 * Executable today:
 *   transfer      ERC-20 transfer with an Arc Memo                 mainnet + testnet
 *   bridge        CCTP V2 depositForBurn                           mainnet + testnet
 *   gateway       Circle Gateway deposit (unified USDC balance)     mainnet + testnet
 *   vault         Morpho Vault V2 (ERC-4626) deposit / withdraw     mainnet
 *   swap          Uniswap v3 QuoterV2 + SwapRouter02                mainnet (also USDC<->EURC fx)
 * Not executable (the planner explains why): StableFX RFQ (needs Circle
 * credentials and a taker signature flow), borrow/repay (Morpho Blue and
 * Aave V4 adapters are not built yet).
 */
import {
  contractAddress,
  CCTP_DESTINATIONS,
  findCctpDestination,
  fromBaseUnits,
  getProtocol,
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
import { ERC4626_ABI, morphoVaults } from "../flock/flock.js";
import { GATEWAY_WALLET_ABI, QUOTER_V2_ABI, SWAP_ROUTER_02_ABI, TOKEN_MESSENGER_V2_ABI } from "./abis.js";
import { approveCall, type RawCall } from "./calls.js";

export type AdapterId = "transfer" | "bridge" | "gateway" | "vault-deposit" | "vault-withdraw" | "swap";

export const EXECUTABLE_VENUES: Readonly<Record<ArcEnvironment, ReadonlySet<string>>> = {
  mainnet: new Set(["arc-transfer", "cctp", "gateway", "morpho-vaults", "uniswap-v3"]),
  testnet: new Set(["arc-transfer", "cctp", "gateway"]),
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
export const UNISWAP_FEE_TIERS = [100, 500, 3000, 10000] as const;

export function addressToBytes32(address: Address): Hex {
  return pad(address, { size: 32 });
}

/** CCTP V2 fee in bps for a route (Iris fees API); 0 when the API says standard transfers are free. */
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

export interface UniswapQuote {
  readonly fee: number;
  readonly amountOut: bigint;
}

export async function bestUniswapQuote(chains: ArcChains, environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<UniswapQuote | null> {
  const venue = getProtocol("uniswap-v3")?.deployments[environment];
  if (!venue) return null;
  const quoter = venue.contracts.quoterV2 as Address;
  const client = chains.client(environment);
  const quotes = await Promise.all(
    UNISWAP_FEE_TIERS.map(async (fee): Promise<UniswapQuote | null> => {
      try {
        const { result } = await client.simulateContract({ address: quoter, abi: QUOTER_V2_ABI, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }] });
        return { fee, amountOut: result[0] };
      } catch {
        return null;
      }
    }),
  );
  return quotes.filter((q): q is UniswapQuote => q !== null && q.amountOut > 0n).sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0] ?? null;
}

/** Largest Morpho vault for an asset (by totalAssets), or the one named by `venue` ("morpho-vaults:galaxyUsdc"). */
export async function pickVault(chains: ArcChains, environment: ArcEnvironment, asset: "USDC" | "EURC", venue?: string): Promise<{ id: string; address: Address; totalAssets: bigint } | null> {
  const vaults = morphoVaults(environment).filter((v) => v.asset === asset);
  const named = venue?.includes(":") ? venue.split(":")[1] : undefined;
  const candidates = named ? vaults.filter((v) => v.id.toLowerCase().startsWith((named as string).toLowerCase().replace(/usdc|eurc/u, "")) && v.asset === asset) : vaults;
  if (candidates.length === 0) return null;
  const client = chains.client(environment);
  const sizes = await client.multicall({ contracts: candidates.map((v) => ({ address: v.address, abi: ERC4626_ABI, functionName: "totalAssets" }) as const), allowFailure: true });
  return candidates
    .map((v, i) => ({ id: v.id, address: v.address, totalAssets: sizes[i]?.status === "success" ? (sizes[i].result as bigint) : 0n }))
    .sort((a, b) => (b.totalAssets > a.totalAssets ? 1 : -1))[0] ?? null;
}

export interface BuildContext {
  readonly environment: ArcEnvironment;
  readonly chains: ArcChains;
  readonly account: Address;
}

/** Main call and the approval it needs (null when the allowance already covers it). */
export async function buildCalls(plan: StepPlan, ctx: BuildContext): Promise<{ main: RawCall; approval: RawCall | null }> {
  const p = plan.params;
  const client = ctx.chains.client(ctx.environment);
  const needApproval = async (token: Address, spender: Address, amount: bigint, symbol: string, venue: string): Promise<RawCall | null> => {
    const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [ctx.account, spender] });
    return allowance >= amount ? null : approveCall(token, spender, amount, `Approve ${fromBaseUnits(amount, Number(p.decimals ?? 6))} ${symbol} to ${venue}`);
  };
  switch (plan.adapter) {
    case "transfer":
      return {
        main: { to: p.token as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [p.to as Address, BigInt(p.amount as string)] }), label: `Send ${p.display} to ${p.to}` },
        approval: null,
      };
    case "bridge": {
      const messenger = contractAddress("tokenMessengerV2", ctx.environment) as Address;
      const amount = BigInt(p.amount as string);
      return {
        main: {
          to: messenger,
          data: encodeFunctionData({
            abi: TOKEN_MESSENGER_V2_ABI,
            functionName: "depositForBurn",
            args: [amount, Number(p.domain), addressToBytes32(p.recipient as Address), p.token as Address, pad("0x00", { size: 32 }), BigInt(p.maxFee as string), CCTP_STANDARD_FINALITY],
          }),
          label: `Bridge ${p.display} to ${p.destinationName} over CCTP`,
        },
        approval: await needApproval(p.token as Address, messenger, amount, "USDC", "CCTP"),
      };
    }
    case "gateway": {
      const wallet = contractAddress("gatewayWallet", ctx.environment) as Address;
      const amount = BigInt(p.amount as string);
      return {
        main: { to: wallet, data: encodeFunctionData({ abi: GATEWAY_WALLET_ABI, functionName: "deposit", args: [p.token as Address, amount] }), label: `Deposit ${p.display} into Circle Gateway` },
        approval: await needApproval(p.token as Address, wallet, amount, "USDC", "Gateway"),
      };
    }
    case "vault-deposit": {
      const amount = BigInt(p.amount as string);
      return {
        main: { to: p.vault as Address, data: encodeFunctionData({ abi: ERC4626_ABI, functionName: "deposit", args: [amount, ctx.account] }), label: `Deposit ${p.display} into ${p.vaultName}` },
        approval: await needApproval(p.token as Address, p.vault as Address, amount, p.symbol as string, p.vaultName as string),
      };
    }
    case "vault-withdraw": {
      const data =
        p.mode === "redeem"
          ? encodeFunctionData({ abi: ERC4626_ABI, functionName: "redeem", args: [BigInt(p.shares as string), ctx.account, ctx.account] })
          : encodeFunctionData({ abi: ERC4626_ABI, functionName: "withdraw", args: [BigInt(p.amount as string), ctx.account, ctx.account] });
      return { main: { to: p.vault as Address, data, label: `Withdraw ${p.display} from ${p.vaultName}` }, approval: null };
    }
    case "swap": {
      const router = getProtocol("uniswap-v3")?.deployments[ctx.environment]?.contracts.swapRouter02 as Address | undefined;
      if (!router) throw noRoute("Uniswap v3 is not deployed on this environment.");
      const amountIn = BigInt(p.amountIn as string);
      const fresh = await bestUniswapQuote(ctx.chains, ctx.environment, p.tokenIn as Address, p.tokenOut as Address, amountIn);
      if (!fresh || fresh.amountOut < BigInt(p.minOut as string)) throw new LykiaHttpError("NO_ROUTE", 422, "The price moved past the planned minimum; plan again.");
      return {
        main: {
          to: router,
          data: encodeFunctionData({
            abi: SWAP_ROUTER_02_ABI,
            functionName: "exactInputSingle",
            args: [{ tokenIn: p.tokenIn as Address, tokenOut: p.tokenOut as Address, fee: Number(p.fee), recipient: ctx.account, amountIn, amountOutMinimum: BigInt(p.minOut as string), sqrtPriceLimitX96: 0n }],
          }),
          label: `Swap ${p.display} on Uniswap v3`,
        },
        approval: await needApproval(p.tokenIn as Address, router, amountIn, p.symbolIn as string, "Uniswap"),
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
      return "deposit";
    case "vault-withdraw":
      return "withdraw";
    case "swap":
      return fx ? "fx" : "swap";
  }
}

export { CCTP_DESTINATIONS, findCctpDestination, getToken, tokenAddress };
export type { StepFact };
