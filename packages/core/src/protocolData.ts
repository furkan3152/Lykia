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

  {
    id: "morpho-vaults",
    name: "Morpho Vaults V2",
    category: "vault",
    summary: "Curated ERC-4626 vaults over Morpho Blue markets; the backend of Circle App Kit Earn. Lykia's earn venue.",
    website: "https://morpho.org",
    docs: "https://docs.morpho.org",
    deployments: {
      mainnet: {
        status: "live",
        contracts: {
          galaxyUsdc: "0x8E357432CC12ff425c36432F312968aEb16112AF",
          keyrockPrimeUsdc: "0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123",
          steakhousePrimeUsdc: "0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298",
          gauntletUsdcBalanced: "0x10AF7238C6355Aa8dDB5eD60E2e9b55a72827B51",
          gauntletUsdcPrime: "0xdECcd53BE5453215821184824B519E04C7e00bC7",
          galaxyEurc: "0x389abDf4355e0cF4f19298179991705a98f21c18",
          gauntletEurcPrime: "0x05863F54B05e96092069eF30c9Ca6060336e50B9",
          steakhousePrimeEurc: "0xbeef00be37BdE921BAE06fad223125BAB16c41D1",
        },
        evidence: "api.morpho.org vaultV2s(chainId 5042), listed vaults; eth_getCode non-empty on rpc.mainnet.arc.io 2026-11-01",
      },
    },
    verbs: ["deposit", "withdraw", "approve"],
    tags: ["erc4626", "earn", "usdc", "eurc"],
  },
  {
    id: "morpho-blue",
    name: "Morpho Blue",
    category: "lending",
    summary: "Isolated lending markets; cirBTC/USDC 86% LLTV is the main market (the backend of App Kit Borrow).",
    website: "https://morpho.org",
    docs: "https://docs.morpho.org",
    deployments: {
      mainnet: {
        status: "live",
        contracts: { morphoBlue: "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD", adaptiveCurveIrm: "0xF02615d094Fc02fC031C35fe705e175aA4653f20", vaultV2Factory: "0x3b0eefaBfa22ec7CF2c73877ac16e78D76749f12" },
        evidence: "morpho-org/sdks addresses.ts (ArcMainnet); eth_getCode non-empty on rpc.mainnet.arc.io 2026-11-01",
      },
    },
    verbs: [],
    tags: ["borrow", "cirbtc"],
  },
  {
    id: "aave-v4",
    name: "Aave V4",
    category: "lending",
    summary: "Aave's Hub and Spoke design: Core Hub with Main, Forex and Maple spokes. Listed for discovery; Lykia does not execute it yet.",
    website: "https://aave.com",
    deployments: {
      mainnet: {
        status: "live",
        contracts: {
          coreHub: "0x17288dfc86205301064577b98B02b81017e6F79C",
          mainSpoke: "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d",
          forexSpoke: "0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB",
          usdcMapleSpoke: "0x18Dde098d25722C14e09842a6Fa7db6aAFC395a2",
          signatureGateway: "0x0d36A4a21119BBBDe559d59002254171D976289f",
        },
        evidence: "bgd-labs/aave-address-book AaveV4Arc.ts; eth_getCode non-empty on rpc.mainnet.arc.io 2026-11-01",
      },
    },
    verbs: [],
    tags: ["lending", "hub-spoke"],
  },
  {
    id: "uniswap-v3",
    name: "Uniswap v3",
    category: "dex",
    summary: "Concentrated-liquidity AMM. Main pools: USDC/cirBTC 0.01% and USDC/EURC 0.05%. Lykia quotes with QuoterV2 and swaps through SwapRouter02.",
    website: "https://uniswap.org",
    docs: "https://docs.uniswap.org",
    deployments: {
      mainnet: {
        status: "live",
        contracts: {
          factory: "0xf0db7b58379503491d857db50ac9ece64c653918",
          swapRouter02: "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77",
          quoterV2: "0x7dfd4f31be6814d2906bde155c3e1b146eac1468",
          poolUsdcCirbtc001: "0x82916bee18fcef517b26c72d7cb5f13694e1db41",
          poolUsdcEurc005: "0x6fd5f2fb831940dcd61a98c5b3acb7d8c6f3bfc1",
        },
        evidence: "Uniswap/sdks sdk-core addresses.ts (ChainId.ARC=5042); pools from Factory.getPool; eth_getCode non-empty on rpc.mainnet.arc.io 2026-11-01",
      },
    },
    verbs: ["swap", "approve"],
    tags: ["amm", "concentrated-liquidity"],
  },
  {
    id: "uniswap-v4",
    name: "Uniswap v4",
    category: "dex",
    summary: "Singleton pool manager with hooks; launchpads on Arc build on it. Listed for discovery.",
    website: "https://uniswap.org",
    deployments: {
      mainnet: {
        status: "live",
        contracts: { poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951", v4Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94", universalRouter: "0x8702463e73f74d0b6765aBceb314Ef07aCb92650" },
        evidence: "Uniswap/sdks addresses.ts and universal-router-sdk constants ([5042]); eth_getCode non-empty 2026-11-01",
      },
    },
    verbs: [],
    tags: ["amm", "hooks"],
  },
  {
    id: "curve-lite",
    name: "Curve (lite)",
    category: "dex",
    summary: "Curve factories are deployed on Arc but hold no pools yet.",
    deployments: {
      mainnet: { status: "live", contracts: { stableswapNgFactory: "0x8271e06E5887FE5ba05234f5315c19f3Ec90E8aD", router: "0xFF5Cb29241F002fFeD2eAa224e3e996D24A6E8d1" }, evidence: "api-core.curve.finance getDeployment/arc; pool_count() = 0; eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
    tags: ["empty"],
  },
  {
    id: "archery",
    name: "Archery",
    category: "dex",
    summary: "Arc-native ve(3,3)-style DEX.",
    deployments: {
      mainnet: { status: "live", contracts: { v2Factory: "0x0769d7d58e064d3dd4c2bb17274506f4824a9657", v3Factory: "0xc481038c013fe96f38ce7a2dc417b2b1b78b16a4" }, evidence: "DefiLlama adapter projects/archery; eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
  },
  {
    id: "synthra",
    name: "Synthra",
    category: "dex",
    summary: "Arc-native concentrated-liquidity DEX with a launchpad.",
    deployments: {
      mainnet: { status: "live", contracts: { v3Factory: "0x6307fc239C7964942c1BfFE51930E55606619c74", launchpad: "0x18D33De5eefB2F91B09385f35f6a1317659cc1F9" }, evidence: "DefiLlama adapters synthra-v3 / synthra-launchpad; eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
  },
  {
    id: "aerodrome-slipstream",
    name: "Aerodrome Slipstream (lite)",
    category: "dex",
    summary: "Concentrated-liquidity pools from the Aerodrome family.",
    deployments: {
      mainnet: { status: "live", contracts: { clFactory: "0x7F83235643181E440433400a027618Cd50879751" }, evidence: "DefiLlama adapter projects/aero-lite; eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
  },
  {
    id: "argus",
    name: "ArgusPad",
    category: "launchpad",
    summary: "Token launchpad on Uniswap v3/v4. Launch tokens are where the wolves live: Scent them first.",
    deployments: {
      mainnet: { status: "live", contracts: { argusToken: "0xeCe5cA8bf9220718E5727754026757512212cb3c" }, evidence: "DefiLlama adapter projects/arguspad; eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
    tags: ["launchpad"],
  },
  {
    id: "chainlink",
    name: "Chainlink Data Feeds",
    category: "oracle",
    summary: "USD reference prices. Lykia prices EURC and cirBTC with them and uses EURC/USD as the FX reference rate.",
    website: "https://chain.link",
    deployments: {
      mainnet: {
        status: "live",
        contracts: { usdcUsd: "0x84EA90AC252Dc437031461836DB5164219147905", eurcUsd: "0x361b95c10b76Ca3f35C686d423e43A951755Bf23", btcUsd: "0xa109B535C70C8Be9995be64Bb6751AcDB27e03De", eurUsd: "0xDd5B15443cd733D3966a50a3E48cB7DF9Fb5DE0D" },
        evidence: "Chainlink feeds-arc-mainnet-1 and aave-address-book ChainlinkArc.ts; eth_getCode non-empty 2026-11-01",
      },
    },
    verbs: [],
    tags: ["prices"],
  },
  {
    id: "pyth",
    name: "Pyth",
    category: "oracle",
    summary: "Pull-based price feeds.",
    deployments: {
      mainnet: { status: "live", contracts: { pythCore: "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a" }, evidence: "docs.pyth.network contract-addresses/evm (Arc); eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
  },
  {
    id: "stork",
    name: "Stork",
    category: "oracle",
    summary: "Sub-second pull oracle.",
    deployments: {
      mainnet: { status: "live", contracts: { stork: "0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62" }, evidence: "docs.stork.network contract-addresses/evm#arc; eth_getCode non-empty 2026-11-01" },
      testnet: { status: "testnet-live", contracts: { stork: "0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62" }, evidence: "docs.stork.network contract-addresses/evm#arc; eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
  },
  {
    id: "circle-x402",
    name: "Circle x402 Facilitator",
    category: "circle",
    summary: "Verifies and settles x402 pay-per-call USDC payments on Arc.",
    docs: "https://developers.circle.com",
    deployments: {
      mainnet: { status: "live", contracts: { x402Permit2Proxy: "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" }, evidence: "developers.circle.com facilitator supported networks; eth_getCode non-empty 2026-11-01" },
      testnet: { status: "testnet-live", contracts: { x402Permit2Proxy: "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" }, evidence: "developers.circle.com facilitator supported networks; eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
    tags: ["x402", "payments"],
  },
  {
    id: "usyc-teller",
    name: "Circle USYC Teller",
    category: "circle",
    summary: "Mints and redeems USYC for entitled (non-US, allowlisted) holders.",
    deployments: {
      mainnet: { status: "live", contracts: { teller: "0x51A8CE47dC08ba5CD19c7aa84EA6fD6664f60f9b", entitlements: "0xb69ecb156Dc0028198028c501340d5367845ca72" }, evidence: "docs.arc.io contract-addresses; eth_getCode non-empty 2026-11-01" },
      testnet: { status: "testnet-live", contracts: { teller: "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A", entitlements: "0xcc205224862c7641930c87679e98999d23c26113" }, evidence: "docs.arc.io contract-addresses; eth_getCode non-empty 2026-11-01" },
    },
    verbs: [],
    tags: ["restricted", "yield"],
  },
];
