/**
 * Position math in integers, mirroring the contracts:
 * - Uniswap TickMath.getSqrtRatioAtTick (Q64.96) and LiquidityAmounts
 *   (token amounts held by a liquidity range at the current price);
 * - fee growth: tokens owed = liquidity * (feeGrowthInside now - last) / 2^128,
 *   with uint256 wrap-around, as Uniswap v3 and v4 account fees;
 * - prices from sqrtPriceX96 adjusted for decimals;
 * - ERC-4626 shares to assets (the vault's own convertToAssets is used on
 *   chain; this is for tests and projections);
 * - health factor and LTV ratios.
 */

const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;
const Q256 = 2n ** 256n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/** sqrt(1.0001^tick) * 2^96, rounded up like TickMath. */
export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new RangeError(`tick ${tick} out of range`);
  const absTick = BigInt(Math.abs(tick));
  let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const steps: readonly [bigint, bigint][] = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, mul] of steps) if ((absTick & bit) !== 0n) ratio = (ratio * mul) >> 128n;
  if (tick > 0) ratio = (Q256 - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function amount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  return (((liquidity << 96n) * (hi - lo)) / hi) / lo;
}

function amount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  return (liquidity * (hi - lo)) / Q96;
}

/**
 * Token amounts (base units, rounded down) a range holds at the current price
 * (LiquidityAmounts.getAmountsForLiquidity). Below the range everything is
 * token0, above it everything is token1.
 */
export function amountsForLiquidity(sqrtPriceX96: bigint, tickLower: number, tickUpper: number, liquidity: bigint): { amount0: bigint; amount1: bigint } {
  const sqrtA = sqrtRatioAtTick(tickLower);
  const sqrtB = sqrtRatioAtTick(tickUpper);
  if (liquidity <= 0n) return { amount0: 0n, amount1: 0n };
  if (sqrtPriceX96 <= sqrtA) return { amount0: amount0Delta(sqrtA, sqrtB, liquidity), amount1: 0n };
  if (sqrtPriceX96 < sqrtB) return { amount0: amount0Delta(sqrtPriceX96, sqrtB, liquidity), amount1: amount1Delta(sqrtA, sqrtPriceX96, liquidity) };
  return { amount0: 0n, amount1: amount1Delta(sqrtA, sqrtB, liquidity) };
}

/** In range means the current tick is inside [tickLower, tickUpper): the range earns fees. */
export function inRange(tick: number, tickLower: number, tickUpper: number): boolean {
  return tick >= tickLower && tick < tickUpper;
}

/** Fees owed since the last checkpoint: liquidity * (inside - last) / 2^128, modulo 2^256 as the contracts subtract. */
export function feesOwed(liquidity: bigint, feeGrowthInsideX128: bigint, feeGrowthInsideLastX128: bigint): bigint {
  const delta = (((feeGrowthInsideX128 - feeGrowthInsideLastX128) % Q256) + Q256) % Q256;
  return (delta * liquidity) / Q128;
}

/**
 * Uniswap v3 style fee growth inside a range from the pool's global growth
 * and the two ticks' outside growth (Tick.getFeeGrowthInside).
 */
export function feeGrowthInside(tick: number, tickLower: number, tickUpper: number, global: bigint, lowerOutside: bigint, upperOutside: bigint): bigint {
  const below = tick >= tickLower ? lowerOutside : global - lowerOutside;
  const above = tick < tickUpper ? upperOutside : global - upperOutside;
  return (((global - below - above) % Q256) + Q256) % Q256;
}

/** How many token1 one token0 buys at sqrtPriceX96, adjusted for decimals. */
export function priceFromSqrt(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const s = Number(sqrtPriceX96) / Number(Q96);
  return s * s * 10 ** (decimals0 - decimals1);
}

/** 1.0001^tick adjusted for decimals: token1 per token0 at a tick. */
export function priceAtTick(tick: number, decimals0: number, decimals1: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimals0 - decimals1);
}

/** ERC-4626 convertToAssets with OpenZeppelin's virtual offset (rounded down). */
export function sharesToAssets(shares: bigint, totalAssets: bigint, totalSupply: bigint, decimalsOffset = 0): bigint {
  const virtualShares = 10n ** BigInt(decimalsOffset);
  return (shares * (totalAssets + 1n)) / (totalSupply + virtualShares);
}

/** Morpho Blue shares to assets, rounding up for borrows and down for supplies (SharesMathLib with its virtual offset). */
export function morphoSharesToAssets(shares: bigint, totalAssets: bigint, totalShares: bigint, roundUp: boolean): bigint {
  const VIRTUAL_SHARES = 10n ** 6n;
  const VIRTUAL_ASSETS = 1n;
  const num = shares * (totalAssets + VIRTUAL_ASSETS);
  const den = totalShares + VIRTUAL_SHARES;
  return roundUp ? (num + den - 1n) / den : num / den;
}

const WAD = 10n ** 18n;
const ORACLE_SCALE = 10n ** 36n;

/** Morpho Blue health factor (WAD): collateral * price / 1e36 * LLTV / borrowed. Null without debt. */
export function morphoHealthWad(collateral: bigint, oraclePrice: bigint, lltvWad: bigint, borrowAssets: bigint): bigint | null {
  if (borrowAssets <= 0n) return null;
  const maxBorrow = (((collateral * oraclePrice) / ORACLE_SCALE) * lltvWad) / WAD;
  return (maxBorrow * WAD) / borrowAssets;
}

/** Morpho LTV (WAD): borrowed / collateral value in loan units. Null without collateral. */
export function morphoLtvWad(collateral: bigint, oraclePrice: bigint, borrowAssets: bigint): bigint | null {
  const value = (collateral * oraclePrice) / ORACLE_SCALE;
  if (value <= 0n) return null;
  return (borrowAssets * WAD) / value;
}

/** A WAD as a decimal string with `places` decimals (truncated). */
export function wadString(wad: bigint, places = 4): string {
  const neg = wad < 0n;
  const abs = neg ? -wad : wad;
  const scale = 10n ** BigInt(places);
  const scaled = (abs * scale) / WAD;
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(places, "0");
  return `${neg ? "-" : ""}${whole}${places > 0 ? `.${frac}` : ""}`;
}

/** APY (percent) from two NAV readings `seconds` apart, compounded over a year; null when it cannot be judged. */
export function navApyPercent(navNow: bigint, navThen: bigint, seconds: number): number | null {
  if (navThen <= 0n || navNow <= 0n || seconds < 86_400) return null;
  const growth = Number((navNow * 10n ** 12n) / navThen) / 1e12;
  const apy = (Math.pow(growth, (365 * 86_400) / seconds) - 1) * 100;
  return Number.isFinite(apy) ? apy : null;
}
