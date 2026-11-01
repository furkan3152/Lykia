/**
 * Gateway and CCTP destinations Lykia can address from Arc: domain, chain
 * id, USDC address. Addresses are copied from Circle's published tables
 * (developers.circle.com/stablecoins/usdc-contract-addresses and
 * /gateway/references/contract-addresses, read 2026-11-01). Gateway's
 * wallet and minter share one vanity address per environment on every EVM
 * chain Circle lists.
 */
import type { Address, ArcEnvironment } from "@lykia/core";

export interface GatewayChain {
  readonly key: string;
  readonly name: string;
  readonly domain: number;
  readonly chainId: { readonly mainnet: number; readonly testnet: number };
  readonly usdc: { readonly mainnet: Address; readonly testnet: Address };
  /** Source-side gas fee Gateway charges per burn intent (USDC). */
  readonly gasFeeUsdc: string;
}

export const GATEWAY_WALLET: Readonly<Record<ArcEnvironment, Address>> = { mainnet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", testnet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" };
export const GATEWAY_MINTER: Readonly<Record<ArcEnvironment, Address>> = { mainnet: "0x2222222d7164433c4C09B0b0D809a9b52C04C205", testnet: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" };
/** Crosschain Gateway transfer fee, in basis points (0.005%). Same-chain transfers pay none. */
export const GATEWAY_TRANSFER_FEE_BPS = 0.5;

export const GATEWAY_CHAINS: readonly GatewayChain[] = [
  { key: "arc", name: "Arc", domain: 26, chainId: { mainnet: 5042, testnet: 5042002 }, usdc: { mainnet: "0x3600000000000000000000000000000000000000", testnet: "0x3600000000000000000000000000000000000000" }, gasFeeUsdc: "0.0035" },
  { key: "ethereum", name: "Ethereum", domain: 0, chainId: { mainnet: 1, testnet: 11155111 }, usdc: { mainnet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", testnet: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" }, gasFeeUsdc: "1.00" },
  { key: "avalanche", name: "Avalanche", domain: 1, chainId: { mainnet: 43114, testnet: 43113 }, usdc: { mainnet: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", testnet: "0x5425890298aed601595a70AB815c96711a31Bc65" }, gasFeeUsdc: "0.02" },
  { key: "optimism", name: "OP Mainnet", domain: 2, chainId: { mainnet: 10, testnet: 11155420 }, usdc: { mainnet: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", testnet: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" }, gasFeeUsdc: "0.0015" },
  { key: "arbitrum", name: "Arbitrum", domain: 3, chainId: { mainnet: 42161, testnet: 421614 }, usdc: { mainnet: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", testnet: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" }, gasFeeUsdc: "0.01" },
  { key: "base", name: "Base", domain: 6, chainId: { mainnet: 8453, testnet: 84532 }, usdc: { mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", testnet: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }, gasFeeUsdc: "0.01" },
  { key: "polygon", name: "Polygon PoS", domain: 7, chainId: { mainnet: 137, testnet: 80002 }, usdc: { mainnet: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", testnet: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582" }, gasFeeUsdc: "0.0015" },
  { key: "unichain", name: "Unichain", domain: 10, chainId: { mainnet: 130, testnet: 1301 }, usdc: { mainnet: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", testnet: "0x31d0220469e10c4E71834a79b1f276d740d3768F" }, gasFeeUsdc: "0.001" },
  { key: "sonic", name: "Sonic", domain: 13, chainId: { mainnet: 146, testnet: 14601 }, usdc: { mainnet: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", testnet: "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51" }, gasFeeUsdc: "0.01" },
  { key: "worldchain", name: "World Chain", domain: 14, chainId: { mainnet: 480, testnet: 4801 }, usdc: { mainnet: "0x79A02482A880bCe3F13E09da970dC34dB4cD24D1", testnet: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88" }, gasFeeUsdc: "0.01" },
  { key: "sei", name: "Sei", domain: 16, chainId: { mainnet: 1329, testnet: 1328 }, usdc: { mainnet: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", testnet: "0x4fCF1784B31630811181f670Aea7A7bEF803eaED" }, gasFeeUsdc: "0.001" },
  { key: "hyperevm", name: "HyperEVM", domain: 19, chainId: { mainnet: 999, testnet: 998 }, usdc: { mainnet: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", testnet: "0x2B3370eE501B4a559b57D449569354196457D8Ab" }, gasFeeUsdc: "0.05" },
];

export function gatewayChain(key: string): GatewayChain | null {
  const k = key.trim().toLowerCase();
  return GATEWAY_CHAINS.find((c) => c.key === k || c.name.toLowerCase() === k) ?? null;
}
