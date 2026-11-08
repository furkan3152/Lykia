/**
 * Protocols DefiLlama lists with value on Arc (api.llama.fi/protocols, read 2026-11-01)
 * that Lykia has not verified contract by contract yet. They are listed so the
 * desk, Lyko and the MCP tools know they exist; none is executable, and each one
 * moves to protocolData.ts with addresses and eth_getCode evidence once verified.
 * Notes record why an entry is not routable yet.
 */
import type { ProtocolDescriptor } from "./protocols.js";

const listed = (id: string, name: string, category: ProtocolDescriptor["category"], summary: string, arcTvlUsd: number, website?: string, notes?: readonly string[]): ProtocolDescriptor => ({
  id,
  name,
  category,
  summary,
  ...(website ? { website } : {}),
  deployments: { mainnet: { status: "announced", contracts: {}, evidence: `DefiLlama lists about $${arcTvlUsd.toLocaleString("en-US")} on Arc (api.llama.fi/protocols, 2026-11-01); contracts not yet verified by Lykia.` } },
  verbs: [],
  tags: ["defillama-listed"],
  ...(notes ? { notes } : {}),
});

export const LISTED_PROTOCOL_ROWS: ProtocolDescriptor[] = [
  listed("extended-perps", "Extended Perps", "perps", "Perpetuals exchange holding USDC collateral on Arc; orders match on its own engine, not on Arc.", 107766696, "https://app.extended.exchange", ["Not routable: Extended documents deposits from Ethereum and Arbitrum (StarkEx contracts on Ethereum) but publishes no Arc deposit contract (docs.extended.exchange, 2026-11-08). Collateral deposits stay out until an official Arc path exists; opening positions is out of scope."]),
  listed("edgex-bridge", "edgeX Bridge", "bridge", "Bridge with deposits on Arc.", 5579714, "https://pro.edgex.exchange", ["Not routable: no official Arc deposit contract or API found in edgeX's docs (2026-11-08)."]),
  listed("vfat-io", "vfat.io", "vault", "Allocator or vault curator with capital on Arc.", 133946, "https://vfat.io/yield", ["Not routable: vfat runs per-user Sickle farm accounts over other DEXes' LP positions, not a single-asset vault Lykia could deposit USDC into."]),
  listed("topaz-cl", "Topaz CL", "dex", "DEX with liquidity on Arc.", 58612, "https://www.topazdex.com", ["Not routable: no verified router. Topaz's site documents its BNB Chain deployment only, and DefiLlama's Arc adapter is not public, so no Arc address has an official source."]),
  listed("dyorswap-amm", "DyorSwap AMM", "dex", "DEX with liquidity on Arc.", 55844, "https://dyorswap.finance", ["Not routable: no verified router. DyorSwap's docs cover Mode; no official Arc address list was found."]),
  listed("arctide-dex", "Arctide DEX", "dex", "DEX with liquidity on Arc.", 41445, "https://arctide.app/", ["Not routable: no verified router. Arctide publishes no Arc contract addresses."]),
  listed("sodex-bridge", "SoDEX Bridge", "bridge", "Bridge with deposits on Arc.", 25471, "https://ssi.sosovalue.com", ["Not routable: no official Arc deposit contract or API found."]),
  listed("noxa-fun", "NOXA Fun", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 19888, "https://fun.noxa.eth.limo/"),
  listed("beefy", "Beefy", "vault", "Allocator or vault curator with capital on Arc.", 19787, "https://beefy.com", ["Not routable: Beefy's three Arc vaults (api.beefy.finance) are Cowcentrated LP vaults over Aerodrome pairs (WETH-USDC, cirBTC-USDC, cirBTC-WETH) that take two tokens, and together hold about $22k: liquidity under the floor."]),
  listed("symbiosis", "Symbiosis", "bridge", "Bridge with deposits on Arc.", 17073, "https://symbiosis.finance", ["Not routable: api.symbiosis.finance quotes Arc (100 USDC to Base delivers 99.35), but Arc is in neither Symbiosis's docs nor its SDK config (symbiosis-js-sdk 3.11.60), and the MetaRouter it calls (0xcE8f\u2026eb4C) has no verified source on Arc: unverified contract."]),
  listed("team-finance", "Team Finance", "infra", "Arc infrastructure or service.", 14621, "https://www.team.finance"),
  listed("unitflow-finance-v2", "Unitflow Finance V2", "dex", "DEX with liquidity on Arc.", 12065, undefined, ["Not routable: Unitflow's contract page lists V3 contracts and token factories but no V2 AMM router."]),
  listed("foci", "Foci", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 9875, "https://foci.family/"),
  listed("mercurifi-launchpad", "Mercurifi Launchpad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 6087, "https://launch.mercuri.finance/"),
  listed("lift-v1", "LIFT V1", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 5862),
  listed("lunya-launchpad", "Lunya Launchpad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 2029),
  listed("ark-launch", "ARK Launch", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 1919),
  listed("synthra-launchpad", "Synthra Launchpad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 1917, "https://app.synthra.org"),
  listed("dexfi-aggregator", "DexFi Aggregator", "vault", "Allocator or vault curator with capital on Arc.", 1733, "https://dexfi.com/", ["Not routable: liquidity under the floor (about $1.7k) and no documented Arc vault interface."]),
  listed("buglefamily", "Buglefamily", "dex", "DEX with liquidity on Arc.", 1305, undefined, ["Not routable: liquidity under the floor (about $1.3k) and no official router."]),
  listed("arctide-launchpad", "Arctide Launchpad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 1028, "https://arctide.app/"),
  listed("arcpad-meme", "arcpad.meme", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 638, "https://arcpad.meme/"),
  listed("wonk-fun", "Wonk Fun", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 252),
  listed("kaleido-lending", "Kaleido Lending", "lending", "Lending market on Arc.", 231, "https://kaleidofi.xyz", ["Not routable: liquidity under the floor (about $231 on DefiLlama, 2026-11-08) and no documented market interface."]),
  listed("arclotls", "ArcLotls", "infra", "Arc infrastructure or service.", 217),
  listed("basedbid", "basedbid", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 129, "https://www.based.bid/"),
  listed("bonker", "Bonker", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 119, "https://bonker.wtf"),
  // Load: load.fun answered 404 on 2026-11-02 and arc.io/ecosystem has no entry for it, so no website until one is verified.
  listed("load", "Load", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 110),
  listed("solonpad-v3", "SolonPad V3", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 57, "https://solonpad.fun"),
  listed("solonpad", "SolonPad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 56, "https://solonpad.fun"),
  listed("lunya-dex", "Lunya DEX", "dex", "DEX with liquidity on Arc.", 32, undefined, ["Not routable: liquidity under the floor (about $32) and no official router."]),
  listed("parabolarc", "Parabolarc", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 20),
  listed("kpk", "KPK", "vault", "Morpho vault curator with USDC vaults on Arc.", 5, "https://kpk.io/", ["Not routable: KPK's only Arc vault (KPK wARS Yield, 0xF094\u20260ba5) holds about $5 of wARS, a token outside the registry: liquidity under the floor."]),
  listed("hinkal", "Hinkal", "infra", "Arc infrastructure or service.", 3, "https://hinkal.pro"),
  listed("peddlequest", "PeddleQuest", "infra", "Arc infrastructure or service.", 2),
  listed("aero-basic", "Aero Basic", "dex", "DEX with liquidity on Arc.", 1, "https://aero.xyz/", ["Not routable: liquidity under the floor (about $1)."]),
  listed("re7-labs", "Re7 Labs", "vault", "Morpho vault curator with USDC vaults on Arc.", 1, "https://www.re7labs.xyz", ["Not routable: no Re7 Morpho vault on Arc in api.morpho.org (2026-11-08)."]),
  listed("lagoon", "Lagoon", "vault", "Allocator or vault curator with capital on Arc.", 0, "https://lagoon.finance", ["Not routable: Lagoon vaults are asynchronous ERC-7540 (request, then settle) and DefiLlama counts $0 on Arc."]),
  listed("topaz-amm", "Topaz AMM", "dex", "DEX with liquidity on Arc.", 0, "https://www.topazdex.com", ["Not routable: $0 on Arc and no official Arc addresses."]),
  listed("sushiswap-v4", "SushiSwap V4", "dex", "DEX with liquidity on Arc.", 0, "https://sushi.com/", ["Not routable: $0 on Arc; Sushi trades route through the sushiswap entry (RedSnwapper)."]),
  listed("peddles", "Peddles", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 0),
  listed("frenlaunch", "frenlaunch", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 0),
  listed("solon-borrow", "Solon Borrow", "vault", "Morpho vault curator with USDC vaults on Arc.", 0, "https://solonlend.xyz", ["Not routable: DefiLlama counts $0 on Arc and no Solon vault is listed in api.morpho.org."]),
  listed("mercurifi-trade", "Mercurifi Trade", "dex", "DEX with liquidity on Arc.", 0, "https://launch.mercuri.finance/", ["Not routable: $0 on Arc and no official router."]),
  listed("fuci", "Fuci", "agent", "AI agent project on Arc.", 0),
];
