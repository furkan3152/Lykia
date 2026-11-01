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
