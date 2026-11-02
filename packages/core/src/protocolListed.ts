/**
 * Protocols DefiLlama lists with value on Arc (api.llama.fi/protocols, read 2026-11-01)
 * that Lykia has not verified contract by contract yet. They are listed so the
 * desk, Lyko and the MCP tools know they exist; none is executable, and each one
 * moves to protocolData.ts with addresses and eth_getCode evidence once verified.
 */
import type { ProtocolDescriptor } from "./protocols.js";

const listed = (id: string, name: string, category: ProtocolDescriptor["category"], summary: string, arcTvlUsd: number, website?: string): ProtocolDescriptor => ({
  id,
  name,
  category,
  summary,
  ...(website ? { website } : {}),
  deployments: { mainnet: { status: "announced", contracts: {}, evidence: `DefiLlama lists about $${arcTvlUsd.toLocaleString("en-US")} on Arc (api.llama.fi/protocols, 2026-11-01); contracts not yet verified by Lykia.` } },
  verbs: [],
  tags: ["defillama-listed"],
});

export const LISTED_PROTOCOL_ROWS: ProtocolDescriptor[] = [
  listed("extended-perps", "Extended Perps", "perps", "Perpetuals exchange holding USDC collateral on Arc; orders match on its own engine, not on Arc.", 107766696, "https://app.extended.exchange"),
  listed("galaxy-curation", "Galaxy Curation", "vault", "Morpho vault curator with USDC vaults on Arc.", 80450956, "https://www.galaxy.com/"),
  listed("keyrock", "Keyrock", "vault", "Morpho vault curator with USDC vaults on Arc.", 75156862, "https://keyrock.com/"),
  listed("edgex-bridge", "edgeX Bridge", "bridge", "Bridge with deposits on Arc.", 5579714, "https://pro.edgex.exchange"),
  listed("steakhouse-financial", "Steakhouse Financial", "vault", "Morpho vault curator with USDC vaults on Arc.", 5281868, "https://www.steakhouse.financial/"),
  listed("vfat-io", "vfat.io", "vault", "Allocator or vault curator with capital on Arc.", 133946, "https://vfat.io/yield"),
  listed("gauntlet", "Gauntlet", "vault", "Morpho vault curator with USDC vaults on Arc.", 101016, "https://www.gauntlet.xyz"),
  listed("bitwise", "Bitwise", "vault", "Morpho vault curator with USDC vaults on Arc.", 76644, "https://app.morpho.org/curator/bitwise"),
  listed("topaz-cl", "Topaz CL", "dex", "DEX with liquidity on Arc.", 58612, "https://www.topazdex.com"),
  listed("dyorswap-amm", "DyorSwap AMM", "dex", "DEX with liquidity on Arc.", 55844, "https://dyorswap.finance"),
  listed("arctide-dex", "Arctide DEX", "dex", "DEX with liquidity on Arc.", 41445, "https://arctide.app/"),
  listed("sodex-bridge", "SoDEX Bridge", "bridge", "Bridge with deposits on Arc.", 25471, "https://ssi.sosovalue.com"),
  listed("noxa-fun", "NOXA Fun", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 19888, "https://fun.noxa.eth.limo/"),
  listed("beefy", "Beefy", "vault", "Allocator or vault curator with capital on Arc.", 19787, "https://beefy.com"),
  listed("symbiosis", "Symbiosis", "bridge", "Bridge with deposits on Arc.", 17073, "https://symbiosis.finance"),
  listed("team-finance", "Team Finance", "infra", "Arc infrastructure or service.", 14621, "https://www.team.finance"),
  listed("unitflow-finance-v2", "Unitflow Finance V2", "dex", "DEX with liquidity on Arc.", 12065),
  listed("foci", "Foci", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 9875, "https://foci.family/"),
  listed("unitflow-finance-v3", "Unitflow Finance V3", "dex", "DEX with liquidity on Arc.", 9031),
  listed("mercurifi-launchpad", "Mercurifi Launchpad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 6087, "https://launch.mercuri.finance/"),
  listed("lift-v1", "LIFT V1", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 5862),
  listed("lunya-launchpad", "Lunya Launchpad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 2029),
  listed("ark-launch", "ARK Launch", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 1919),
  listed("synthra-launchpad", "Synthra Launchpad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 1917, "https://app.synthra.org"),
  listed("dexfi-aggregator", "DexFi Aggregator", "vault", "Allocator or vault curator with capital on Arc.", 1733, "https://dexfi.com/"),
  listed("buglefamily", "Buglefamily", "dex", "DEX with liquidity on Arc.", 1305),
  listed("arctide-launchpad", "Arctide Launchpad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 1028, "https://arctide.app/"),
  listed("arcpad-meme", "arcpad.meme", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 638, "https://arcpad.meme/"),
  listed("wonk-fun", "Wonk Fun", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 252),
  listed("kaleido-lending", "Kaleido Lending", "lending", "Lending market on Arc.", 231, "https://kaleidofi.xyz"),
  listed("arclotls", "ArcLotls", "infra", "Arc infrastructure or service.", 217),
  listed("basedbid", "basedbid", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 129, "https://www.based.bid/"),
  listed("bonker", "Bonker", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 119, "https://bonker.wtf"),
  // Load: load.fun answered 404 on 2026-11-02 and arc.io/ecosystem has no entry for it, so no website until one is verified.
  listed("load", "Load", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 110),
  listed("solonpad-v3", "SolonPad V3", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 57, "https://solonpad.fun"),
  listed("solonpad", "SolonPad", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 56, "https://solonpad.fun"),
  listed("lunya-dex", "Lunya DEX", "dex", "DEX with liquidity on Arc.", 32),
  listed("parabolarc", "Parabolarc", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 20),
  listed("sushiswap", "SushiSwap", "dex", "DEX with liquidity on Arc.", 14, "https://sushi.com/"),
  listed("kpk", "KPK", "vault", "Morpho vault curator with USDC vaults on Arc.", 5, "https://kpk.io/"),
  listed("hinkal", "Hinkal", "infra", "Arc infrastructure or service.", 3, "https://hinkal.pro"),
  listed("peddlequest", "PeddleQuest", "infra", "Arc infrastructure or service.", 2),
  listed("aero-basic", "Aero Basic", "dex", "DEX with liquidity on Arc.", 1, "https://aero.xyz/"),
  listed("re7-labs", "Re7 Labs", "vault", "Morpho vault curator with USDC vaults on Arc.", 1, "https://www.re7labs.xyz"),
  listed("lagoon", "Lagoon", "vault", "Allocator or vault curator with capital on Arc.", 0, "https://lagoon.finance"),
  listed("topaz-amm", "Topaz AMM", "dex", "DEX with liquidity on Arc.", 0, "https://www.topazdex.com"),
  listed("sushiswap-v4", "SushiSwap V4", "dex", "DEX with liquidity on Arc.", 0, "https://sushi.com/"),
  listed("peddles", "Peddles", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 0),
  listed("frenlaunch", "frenlaunch", "launchpad", "Token launchpad on Arc. Launch tokens are where the wolves live: Scent them first.", 0),
  listed("solon-borrow", "Solon Borrow", "vault", "Morpho vault curator with USDC vaults on Arc.", 0, "https://solonlend.xyz"),
  listed("mercurifi-trade", "Mercurifi Trade", "dex", "DEX with liquidity on Arc.", 0, "https://launch.mercuri.finance/"),
  listed("fuci", "Fuci", "agent", "AI agent project on Arc.", 0),
];
