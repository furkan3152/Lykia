/** ABIs the engine encodes. Sources: verified Arc sources (Memo, Multicall3From, ERC-8004 v2.0.0), Circle CCTP V2 and Gateway docs, Uniswap v3 periphery. */
import { parseAbi } from "viem";

export const MEMO_ABI = parseAbi([
  "function memo(address target, bytes data, bytes32 memoId, bytes memoData)",
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
]);

export const MULTICALL3_FROM_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) returns (Result[] returnData)",
]);

export const TOKEN_MESSENGER_V2_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);

/** depositForBurnWithHook: the burn carries hook data (Circle's Forwarding Service reads it). */
export const TOKEN_MESSENGER_HOOK_ABI = parseAbi([
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);

/** Forwarding Service hook, version 0: "cctp-forward" in 24 bytes, version 0, no extra data (developers.circle.com/cctp/concepts/forwarding-service). */
export const CCTP_FORWARDING_HOOK_DATA = "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;

export const GATEWAY_WALLET_ABI = parseAbi(["function deposit(address token, uint256 value)"]);

export const QUOTER_V2_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const SWAP_ROUTER_02_ABI = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

export const IDENTITY_REGISTRY_ABI = parseAbi([
  "struct MetadataEntry { string metadataKey; bytes metadataValue; }",
  "function register(string agentURI, MetadataEntry[] metadata) returns (uint256)",
  "function register(string agentURI) returns (uint256)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

export const VALIDATION_REGISTRY_ABI = parseAbi([
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "function getAgentValidations(uint256 agentId) view returns (bytes32[])",
  "function getSummary(uint256 agentId, address[] validatorAddresses, string tag) view returns (uint64 count, uint8 averageResponse)",
  "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
]);

export const REPUTATION_REGISTRY_ABI = parseAbi([
  "function getClients(uint256 agentId) view returns (address[])",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

/** Aave V4 Spoke (implementation 0xf76b…ba79, verified on Etherscan for chain 5042). */
export const AAVE_SPOKE_ABI = parseAbi([
  "function supply(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function borrow(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function repay(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)",
  "function setUsingAsCollateral(uint256 reserveId, bool usingAsCollateral, address onBehalfOf)",
  "struct UserAccountData { uint256 riskPremium; uint256 avgCollateralFactor; uint256 healthFactor; uint256 totalCollateralValue; uint256 totalDebtValueRay; uint256 activeCollateralCount; uint256 borrowCount; }",
  "function getUserAccountData(address user) view returns (UserAccountData)",
  "function getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)",
  "function getUserTotalDebt(uint256 reserveId, address user) view returns (uint256)",
  "function getUserReserveStatus(uint256 reserveId, address user) view returns (bool, bool)",
  "function getReserveSuppliedAssets(uint256 reserveId) view returns (uint256)",
  "function getReserveTotalDebt(uint256 reserveId) view returns (uint256)",
  "struct Reserve { address underlying; address hub; uint16 assetId; uint8 decimals; uint24 collateralRisk; uint8 flags; uint32 dynamicConfigKey; }",
  "function getReserve(uint256 reserveId) view returns (Reserve)",
  "struct DynamicReserveConfig { uint16 collateralFactor; uint32 maxLiquidationBonus; uint16 liquidationFee; }",
  "function getDynamicReserveConfig(uint256 reserveId, uint32 dynamicConfigKey) view returns (DynamicReserveConfig)",
]);

/** Morpho Blue (the canonical singleton interface). */
export const MORPHO_BLUE_ABI = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)",
  "function withdrawCollateral(MarketParams marketParams, uint256 assets, address onBehalf, address receiver)",
  "function borrow(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
  "function repay(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
]);

export const MORPHO_ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);

export const QUOTER_V2_PATH_ABI = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export const SWAP_ROUTER_02_PATH_ABI = parseAbi([
  "struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }",
  "function exactInput(ExactInputParams params) payable returns (uint256 amountOut)",
]);

export const V4_QUOTER_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

export const V4_STATE_VIEW_ABI = parseAbi(["function getLiquidity(bytes32 poolId) view returns (uint128)"]);

export const UNIVERSAL_ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

export const PERMIT2_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

export const CL_POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function fee() view returns (uint24)",
  "function token0() view returns (address)",
  "function liquidity() view returns (uint128)",
]);

export const MESSAGE_TRANSMITTER_V2_ABI = parseAbi(["function receiveMessage(bytes message, bytes attestation) returns (bool)"]);

/** Lykia practice venues on Arc testnet (packages/contracts/contracts/practice). */
export const PRACTICE_SWAP_ABI = parseAbi([
  "function base() view returns (address)",
  "function quote() view returns (address)",
  "function quoteOut(address tokenIn, uint256 amountIn) view returns (uint256)",
  "function swap(address tokenIn, uint256 amountIn, uint256 minOut, address recipient) returns (uint256 amountOut)",
  "function reserves() view returns (uint256 baseReserve, uint256 quoteReserve)",
]);

export const PRACTICE_LENDING_ABI = parseAbi([
  "function collateral() view returns (address)",
  "function debtToken() view returns (address)",
  "function healthFactor(address user) view returns (uint256)",
  "function healthFactorAfter(address user, int256 collateralDelta, int256 debtDelta) view returns (uint256)",
  "function maxBorrow(address user) view returns (uint256)",
  "function collateralOf(address user) view returns (uint256)",
  "function debtOf(address user) view returns (uint256)",
  "function supplyCollateral(uint256 amount, address onBehalf)",
  "function withdrawCollateral(uint256 amount, address to)",
  "function borrow(uint256 amount, address to)",
  "function repay(uint256 amount, address onBehalf) returns (uint256 repaid)",
]);
