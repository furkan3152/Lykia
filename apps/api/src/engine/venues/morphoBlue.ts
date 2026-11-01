/**
 * Morpho Blue markets on Arc. Lykia posts cirBTC collateral and borrows the
 * loan token (supplyCollateral + borrow, simulated through Multicall3From
 * on 2026-11-01), repays by shares (exact, no dust) and withdraws
 * collateral. Health factor = collateral * oracle price / 1e36 * LLTV /
 * borrowed assets.
 */
import type { Address, ArcEnvironment } from "@lykia/core";
import { encodeFunctionData } from "viem";
import type { ArcChains } from "../../chains/arc.js";
import { MORPHO_BLUE_ABI, MORPHO_ORACLE_ABI } from "../abis.js";
import type { RawCall } from "../calls.js";

export const MORPHO_BLUE: Readonly<Partial<Record<ArcEnvironment, Address>>> = { mainnet: "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD" };

export interface MorphoMarket {
  readonly id: `0x${string}`;
  readonly label: string;
  readonly loan: string;
  readonly collateral: string;
  readonly params: { readonly loanToken: Address; readonly collateralToken: Address; readonly oracle: Address; readonly irm: Address; readonly lltv: bigint };
}

/** Markets Lykia borrows from, read with idToMarketParams on 2026-11-01. */
export const MORPHO_MARKETS: Readonly<Partial<Record<ArcEnvironment, readonly MorphoMarket[]>>> = {
  mainnet: [
    {
      id: "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d",
      label: "Morpho cirBTC/USDC 86%",
      loan: "USDC",
      collateral: "cirBTC",
      params: { loanToken: "0x3600000000000000000000000000000000000000", collateralToken: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", oracle: "0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab", irm: "0xF02615d094Fc02fC031C35fe705e175aA4653f20", lltv: 860_000_000_000_000_000n },
    },
    {
      id: "0x6ea1ea96a1cc671615f3a3bdf51481c5b79e362a8b634396e680d1070137daf4",
      label: "Morpho cirBTC/EURC 86%",
      loan: "EURC",
      collateral: "cirBTC",
      params: { loanToken: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", collateralToken: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", oracle: "0x6945246777DfdF4744D957323857F797Ec19Ca1e", irm: "0xF02615d094Fc02fC031C35fe705e175aA4653f20", lltv: 860_000_000_000_000_000n },
    },
  ],
};

export function morphoMarkets(environment: ArcEnvironment): readonly MorphoMarket[] {
  return MORPHO_MARKETS[environment] ?? [];
}

export function morphoMarketFor(environment: ArcEnvironment, loan: string, collateral: string): MorphoMarket | null {
  return morphoMarkets(environment).find((m) => m.loan.toLowerCase() === loan.toLowerCase() && m.collateral.toLowerCase() === collateral.toLowerCase()) ?? null;
}

const params = (m: MorphoMarket) => ({ ...m.params });

export const morphoCalls = {
  supplyCollateral(environment: ArcEnvironment, m: MorphoMarket, amount: bigint, onBehalf: Address, label: string): RawCall {
    return { to: MORPHO_BLUE[environment] as Address, data: encodeFunctionData({ abi: MORPHO_BLUE_ABI, functionName: "supplyCollateral", args: [params(m), amount, onBehalf, "0x"] }), label };
  },
  borrow(environment: ArcEnvironment, m: MorphoMarket, amount: bigint, onBehalf: Address, label: string): RawCall {
    return { to: MORPHO_BLUE[environment] as Address, data: encodeFunctionData({ abi: MORPHO_BLUE_ABI, functionName: "borrow", args: [params(m), amount, 0n, onBehalf, onBehalf] }), label };
  },
  /** Exactly one of assets / shares is non-zero; repaying by shares clears the debt with no dust. */
  repay(environment: ArcEnvironment, m: MorphoMarket, assets: bigint, shares: bigint, onBehalf: Address, label: string): RawCall {
    return { to: MORPHO_BLUE[environment] as Address, data: encodeFunctionData({ abi: MORPHO_BLUE_ABI, functionName: "repay", args: [params(m), assets, shares, onBehalf, "0x"] }), label };
  },
  withdrawCollateral(environment: ArcEnvironment, m: MorphoMarket, amount: bigint, onBehalf: Address, label: string): RawCall {
    return { to: MORPHO_BLUE[environment] as Address, data: encodeFunctionData({ abi: MORPHO_BLUE_ABI, functionName: "withdrawCollateral", args: [params(m), amount, onBehalf, onBehalf] }), label };
  },
};

export interface MorphoPosition {
  readonly collateral: bigint;
  readonly borrowShares: bigint;
  readonly borrowAssets: bigint;
  /** Oracle price: loan units per collateral unit, scaled by 1e36. */
  readonly price: bigint;
}

export async function readMorphoPosition(chains: ArcChains, environment: ArcEnvironment, m: MorphoMarket, user: Address): Promise<MorphoPosition | null> {
  const blue = MORPHO_BLUE[environment];
  if (!blue) return null;
  try {
    const client = chains.client(environment);
    const [pos, market, price] = await Promise.all([
      client.readContract({ address: blue, abi: MORPHO_BLUE_ABI, functionName: "position", args: [m.id, user] }),
      client.readContract({ address: blue, abi: MORPHO_BLUE_ABI, functionName: "market", args: [m.id] }),
      client.readContract({ address: m.params.oracle, abi: MORPHO_ORACLE_ABI, functionName: "price" }),
    ]);
    const borrowShares = pos[1];
    const totalBorrowAssets = market[2];
    const totalBorrowShares = market[3];
    const borrowAssets = totalBorrowShares === 0n ? 0n : (borrowShares * totalBorrowAssets + totalBorrowShares - 1n) / totalBorrowShares;
    return { collateral: pos[2], borrowShares, borrowAssets, price };
  } catch {
    return null;
  }
}

const WAD = 10n ** 18n;
const ORACLE_SCALE = 10n ** 36n;

/** Health factor (WAD) after adding collateral units and borrowing loan units. Null when there is no debt. */
export function projectMorphoHealth(m: MorphoMarket, position: Pick<MorphoPosition, "collateral" | "borrowAssets" | "price">, addCollateral: bigint, addBorrow: bigint): bigint | null {
  const debt = position.borrowAssets + addBorrow;
  if (debt <= 0n) return null;
  const maxBorrow = ((position.collateral + addCollateral) * position.price) / ORACLE_SCALE * m.params.lltv / WAD;
  return (maxBorrow * WAD) / debt;
}

/** Collateral units needed so that the health factor reaches `targetWad` after borrowing `addBorrow`. */
export function morphoCollateralNeeded(m: MorphoMarket, position: Pick<MorphoPosition, "collateral" | "borrowAssets" | "price">, addBorrow: bigint, targetWad: bigint): bigint {
  const debt = position.borrowAssets + addBorrow;
  if (position.price === 0n) return -1n;
  const needValue = (debt * targetWad) / m.params.lltv; // loan units of collateral value
  const needCollateral = (needValue * ORACLE_SCALE + position.price - 1n) / position.price;
  return needCollateral > position.collateral ? needCollateral - position.collateral : 0n;
}

export async function morphoPositions(chains: ArcChains, environment: ArcEnvironment, user: Address): Promise<{ market: MorphoMarket; position: MorphoPosition }[]> {
  const out: { market: MorphoMarket; position: MorphoPosition }[] = [];
  for (const market of morphoMarkets(environment)) {
    const position = await readMorphoPosition(chains, environment, market, user);
    if (position && (position.collateral > 0n || position.borrowShares > 0n)) out.push({ market, position });
  }
  return out;
}
