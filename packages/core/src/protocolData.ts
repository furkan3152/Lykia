/**
 * Venue rows. Circle-native rows reuse the addresses in contracts.ts (each
 * checked with eth_getCode on 2026-11-01). Add a row only with evidence:
 * where the address came from and how it was checked.
 */
import { ARC_CONTRACTS } from "./contracts.js";
import type { ProtocolDescriptor } from "./protocols.js";

const C = ARC_CONTRACTS;
const CHECKED = "eth_getCode non-empty on Arc public RPC, 2026-11-01; docs.arc.io contract-addresses";

export const PROTOCOL_ROWS: ProtocolDescriptor[] = [
  {
    id: "arc-transfer",
    name: "Arc transfer + Memo",
    category: "circle",
    summary: "Native USDC/EURC transfers carrying an Arc Memo (invoice, payroll line, outrun id).",
    docs: "https://docs.arc.io/arc/concepts/transaction-memos",
    deployments: {
      mainnet: { status: "live", contracts: { memo: C.memo.addresses.mainnet!, usdc: C.usdc.addresses.mainnet!, eurc: C.eurc.addresses.mainnet! }, evidence: CHECKED },
      testnet: { status: "testnet-live", contracts: { memo: C.memo.addresses.testnet!, usdc: C.usdc.addresses.testnet!, eurc: C.eurc.addresses.testnet! }, evidence: CHECKED },
    },
    verbs: ["transfer", "approve"],
    tags: ["memo", "payments"],
  },
  {
    id: "cctp",
    name: "Circle CCTP V2",
    category: "bridge",
    summary: "Burn USDC on Arc, mint native USDC on another chain. Fast transfer when the fee allows.",
    docs: "https://developers.circle.com/cctp",
    deployments: {
      mainnet: { status: "live", contracts: { tokenMessengerV2: C.tokenMessengerV2.addresses.mainnet!, messageTransmitterV2: C.messageTransmitterV2.addresses.mainnet! }, evidence: CHECKED },
      testnet: { status: "testnet-live", contracts: { tokenMessengerV2: C.tokenMessengerV2.addresses.testnet!, messageTransmitterV2: C.messageTransmitterV2.addresses.testnet! }, evidence: CHECKED },
    },
    verbs: ["bridge", "approve"],
    tags: ["usdc", "crosschain"],
  },
  {
    id: "gateway",
    name: "Circle Gateway",
    category: "circle",
    summary: "One unified USDC balance across Gateway chains; deposit on Arc, spend anywhere in under a second.",
    docs: "https://developers.circle.com/gateway",
    deployments: {
      mainnet: { status: "live", contracts: { gatewayWallet: C.gatewayWallet.addresses.mainnet!, gatewayMinter: C.gatewayMinter.addresses.mainnet! }, evidence: CHECKED },
      testnet: { status: "testnet-live", contracts: { gatewayWallet: C.gatewayWallet.addresses.testnet!, gatewayMinter: C.gatewayMinter.addresses.testnet! }, evidence: CHECKED },
    },
    verbs: ["gateway-deposit", "approve"],
    tags: ["usdc", "unified-balance", "nanopayments"],
  },
  {
    id: "stablefx",
    name: "Circle StableFX",
    category: "fx",
    summary: "RFQ FX between USDC and EURC with on-chain settlement through FxEscrow and Permit2.",
    docs: "https://developers.circle.com/stablefx",
    deployments: {
      mainnet: { status: "live", contracts: { fxEscrow: C.fxEscrow.addresses.mainnet!, permit2: C.permit2.addresses.mainnet! }, evidence: CHECKED },
      testnet: { status: "testnet-live", contracts: { fxEscrow: C.fxEscrow.addresses.testnet!, permit2: C.permit2.addresses.testnet! }, evidence: CHECKED },
    },
    verbs: ["fx", "approve"],
    tags: ["fx", "rfq", "eurc"],
  },
  {
    id: "erc8004",
    name: "ERC-8004 Trustless Agents",
    category: "agent",
    summary: "Agent identity, reputation and validation registries. Lykia's Künye lives here.",
    docs: "https://eips.ethereum.org/EIPS/eip-8004",
    deployments: {
      mainnet: { status: "live", contracts: { identityRegistry: C.identityRegistry.addresses.mainnet!, reputationRegistry: C.reputationRegistry.addresses.mainnet!, validationRegistry: C.validationRegistry.addresses.mainnet! }, evidence: CHECKED },
      testnet: { status: "testnet-live", contracts: { identityRegistry: C.identityRegistry.addresses.testnet!, reputationRegistry: C.reputationRegistry.addresses.testnet!, validationRegistry: C.validationRegistry.addresses.testnet! }, evidence: CHECKED },
    },
    verbs: ["register-agent", "attest"],
    tags: ["agents", "identity"],
  },
  {
    id: "erc8183",
    name: "ERC-8183 Agentic Commerce",
    category: "agent",
    summary: "USDC escrow for agent jobs (reference contract). Testnet only.",
    docs: "https://docs.arc.io/arc/tutorials/create-your-first-erc-8183-job",
    deployments: {
      testnet: { status: "testnet-live", contracts: { agenticCommerce: C.agenticCommerce.addresses.testnet! }, evidence: CHECKED },
    },
    verbs: [],
    tags: ["agents", "escrow"],
  },
  {
    id: "multicall3from",
    name: "Multicall3From",
    category: "infra",
    summary: "Batches calls and keeps msg.sender through Arc's CallFrom precompile: approve + act in one final transaction.",
    docs: "https://docs.arc.io/arc/concepts/batched-transactions",
    deployments: {
      mainnet: { status: "live", contracts: { multicall3From: C.multicall3From.addresses.mainnet! }, evidence: CHECKED },
      testnet: { status: "testnet-live", contracts: { multicall3From: C.multicall3From.addresses.testnet! }, evidence: CHECKED },
    },
    verbs: [],
    tags: ["batching"],
  },
];
