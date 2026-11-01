/**
 * Aave V4 on Arc (Hub & Spoke). Lykia acts through the Spokes: supply,
 * withdraw, borrow and repay with the token approved to the Spoke (checked
 * with eth_call through Multicall3From on 2026-11-01). Reserve ids and
 * collateral factors below were read from the Spokes the same day; the
 * collateral factor is re-read live when it matters.
 *
 * Health factor (WAD) comes from Spoke.getUserAccountData. Values there are
 * in 1e26 per USD (collateral) and 1e26 * RAY per USD (debt); the projection
 * after a step uses the same units.
 */
import type { Address, ArcEnvironment } from "@lykia/core";
import { encodeFunctionData, maxUint256 } from "viem";
import type { ArcChains } from "../../chains/arc.js";
import { AAVE_SPOKE_ABI } from "../abis.js";
import type { RawCall } from "../calls.js";

export interface AaveReserve {
  readonly reserveId: number;
  readonly symbol: string;
  readonly decimals: number;
  /** Collateral factor in bps (0 = not collateral), as read on 2026-11-01. */
  readonly collateralFactorBps: number;
}

export interface AaveSpoke {
  readonly key: "main" | "forex";
  readonly label: string;
  readonly address: Address;
  readonly reserves: readonly AaveReserve[];
}

export const AAVE_SPOKES: Readonly<Partial<Record<ArcEnvironment, readonly AaveSpoke[]>>> = {
  mainnet: [
    {
      key: "main",
      label: "Aave V4 Main Spoke",
      address: "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d",
      reserves: [
        { reserveId: 0, symbol: "USDC", decimals: 6, collateralFactorBps: 0 },
        { reserveId: 1, symbol: "EURC", decimals: 6, collateralFactorBps: 0 },
        { reserveId: 2, symbol: "cirBTC", decimals: 8, collateralFactorBps: 7800 },
      ],
    },
    {
      key: "forex",
      label: "Aave V4 Forex Spoke",
      address: "0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB",
      reserves: [
        { reserveId: 0, symbol: "USDC", decimals: 6, collateralFactorBps: 0 },
        { reserveId: 1, symbol: "EURC", decimals: 6, collateralFactorBps: 9000 },
      ],
    },
  ],
};

export function aaveSpokes(environment: ArcEnvironment): readonly AaveSpoke[] {
  return AAVE_SPOKES[environment] ?? [];
}

export function aaveReserve(spoke: AaveSpoke, symbol: string): AaveReserve | null {
  return spoke.reserves.find((r) => r.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

export function aaveSpokeByKey(environment: ArcEnvironment, key: string): AaveSpoke | null {
  return aaveSpokes(environment).find((s) => s.key === key || s.address.toLowerCase() === key.toLowerCase()) ?? null;
}

export const aaveCalls = {
  supply(spoke: Address, reserveId: number, amount: bigint, onBehalf: Address, label: string): RawCall {
    return { to: spoke, data: encodeFunctionData({ abi: AAVE_SPOKE_ABI, functionName: "supply", args: [BigInt(reserveId), amount, onBehalf] }), label };
  },
  setCollateral(spoke: Address, reserveId: number, onBehalf: Address, label: string): RawCall {
    return { to: spoke, data: encodeFunctionData({ abi: AAVE_SPOKE_ABI, functionName: "setUsingAsCollateral", args: [BigInt(reserveId), true, onBehalf] }), label };
  },
  borrow(spoke: Address, reserveId: number, amount: bigint, onBehalf: Address, label: string): RawCall {
    return { to: spoke, data: encodeFunctionData({ abi: AAVE_SPOKE_ABI, functionName: "borrow", args: [BigInt(reserveId), amount, onBehalf] }), label };
  },
  /** `amount` null = repay the whole debt (type(uint256).max, checked to clear the debt exactly). */
  repay(spoke: Address, reserveId: number, amount: bigint | null, onBehalf: Address, label: string): RawCall {
    return { to: spoke, data: encodeFunctionData({ abi: AAVE_SPOKE_ABI, functionName: "repay", args: [BigInt(reserveId), amount ?? maxUint256, onBehalf] }), label };
  },
  /** `amount` null = withdraw everything supplied. */
  withdraw(spoke: Address, reserveId: number, amount: bigint | null, onBehalf: Address, label: string): RawCall {
    return { to: spoke, data: encodeFunctionData({ abi: AAVE_SPOKE_ABI, functionName: "withdraw", args: [BigInt(reserveId), amount ?? maxUint256, onBehalf] }), label };
  },
};

export interface AaveAccount {
  readonly healthFactorWad: bigint;
  readonly collateralValue: bigint;
  readonly avgCollateralFactorWad: bigint;
  readonly debtValueRay: bigint;
}

export async function readAaveAccount(chains: ArcChains, environment: ArcEnvironment, spoke: Address, user: Address): Promise<AaveAccount | null> {
  try {
    const d = await chains.client(environment).readContract({ address: spoke, abi: AAVE_SPOKE_ABI, functionName: "getUserAccountData", args: [user] });
    return { healthFactorWad: d.healthFactor, collateralValue: d.totalCollateralValue, avgCollateralFactorWad: d.avgCollateralFactor, debtValueRay: d.totalDebtValueRay };
  } catch {
    return null;
  }
}

/** Live collateral factor (bps) of a reserve; the static one when the read fails. */
export async function liveCollateralFactorBps(chains: ArcChains, environment: ArcEnvironment, spoke: AaveSpoke, reserve: AaveReserve): Promise<number> {
  try {
    const client = chains.client(environment);
    const r = await client.readContract({ address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getReserve", args: [BigInt(reserve.reserveId)] });
    const dyn = await client.readContract({ address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getDynamicReserveConfig", args: [BigInt(reserve.reserveId), r.dynamicConfigKey] });
    return dyn.collateralFactor;
  } catch {
    return reserve.collateralFactorBps;
  }
}

const VALUE_PER_USD_MICRO = 10n ** 20n; // 1e26 per USD = 1e20 per micro-dollar
const RAY = 10n ** 27n;
const WAD = 10n ** 18n;

/**
 * Health factor after adding collateral (USD micros, weighted by its factor)
 * and debt (USD micros). Null when there is no debt afterwards (unbounded).
 */
export function projectAaveHealth(account: AaveAccount | null, addCollateralMicros: bigint, collateralFactorBps: number, addDebtMicros: bigint): bigint | null {
  const weighted = account ? (account.collateralValue * account.avgCollateralFactorWad) / WAD : 0n;
  const debt = account ? account.debtValueRay / RAY : 0n;
  const newWeighted = weighted + (addCollateralMicros * VALUE_PER_USD_MICRO * BigInt(collateralFactorBps)) / 10_000n;
  const newDebt = debt + addDebtMicros * VALUE_PER_USD_MICRO;
  if (newDebt <= 0n) return null;
  return (newWeighted * WAD) / newDebt;
}

/** Collateral (USD micros) needed so that the health factor reaches `targetWad` after borrowing `addDebtMicros`. */
export function aaveCollateralNeededMicros(account: AaveAccount | null, collateralFactorBps: number, addDebtMicros: bigint, targetWad: bigint): bigint {
  if (collateralFactorBps <= 0) return -1n;
  const weighted = account ? (account.collateralValue * account.avgCollateralFactorWad) / WAD : 0n;
  const debt = (account ? account.debtValueRay / RAY : 0n) + addDebtMicros * VALUE_PER_USD_MICRO;
  const needWeighted = (debt * targetWad) / WAD - weighted;
  if (needWeighted <= 0n) return 0n;
  return (needWeighted * 10_000n + VALUE_PER_USD_MICRO * BigInt(collateralFactorBps) - 1n) / (VALUE_PER_USD_MICRO * BigInt(collateralFactorBps));
}

export async function aavePositions(chains: ArcChains, environment: ArcEnvironment, user: Address): Promise<{ spoke: AaveSpoke; reserve: AaveReserve; supplied: bigint; debt: bigint }[]> {
  const spokes = aaveSpokes(environment);
  if (spokes.length === 0) return [];
  const pairs = spokes.flatMap((spoke) => spoke.reserves.map((reserve) => ({ spoke, reserve })));
  const reads = await chains.client(environment).multicall({
    contracts: pairs.flatMap(({ spoke, reserve }) => [
      { address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getUserSuppliedAssets", args: [BigInt(reserve.reserveId), user] } as const,
      { address: spoke.address, abi: AAVE_SPOKE_ABI, functionName: "getUserTotalDebt", args: [BigInt(reserve.reserveId), user] } as const,
    ]),
    allowFailure: true,
  });
  return pairs
    .map((p, i) => ({ ...p, supplied: reads[2 * i]?.status === "success" ? (reads[2 * i]!.result as bigint) : 0n, debt: reads[2 * i + 1]?.status === "success" ? (reads[2 * i + 1]!.result as bigint) : 0n }))
    .filter((p) => p.supplied > 0n || p.debt > 0n);
}

export function wadToRatio(wad: bigint | null): string | null {
  if (wad === null) return null;
  if (wad > 10n ** 30n) return null;
  const whole = wad / WAD;
  const frac = ((wad % WAD) * 10_000n) / WAD;
  return `${whole}.${frac.toString().padStart(4, "0")}`;
}
