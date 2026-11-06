/** ABIs the position readers use (view functions and the static `collect`). */
import { parseAbi } from "viem";

export const ERC721_ENUM_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

/** Uniswap v3 NonfungiblePositionManager. */
export const V3_NFPM_ABI = parseAbi([
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }",
  "function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)",
]);

/** Aerodrome Slipstream NonfungiblePositionManager: like v3, with the tick spacing where v3 has the fee. */
export const SLIPSTREAM_NFPM_ABI = parseAbi([
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }",
  "function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)",
]);

export const V3_FACTORY_ABI = parseAbi(["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"]);
export const SLIPSTREAM_FACTORY_ABI = parseAbi(["function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)"]);

/** Both v3 and Slipstream pools answer slot0 with sqrtPriceX96 and tick first. */
export const V3_POOL_SLOT0_ABI = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"]);
export const SLIPSTREAM_POOL_SLOT0_ABI = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)"]);

/** Uniswap v4 PositionManager (not enumerable: token ids come from Transfer events). */
export const V4_POSM_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns (PoolKey poolKey, uint256 info)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function nextTokenId() view returns (uint256)",
]);

export const V4_STATE_VIEW_POSITIONS_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
  "function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)",
]);

export const ERC20_META_ABI = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);

export const CHAINLINK_ROUNDS_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
