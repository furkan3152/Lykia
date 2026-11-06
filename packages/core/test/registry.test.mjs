import { test } from "node:test";
import assert from "node:assert/strict";
import { NETWORKS, resolveNetwork, ARC_CONTRACTS, contractAddress, requireContract, TOKENS, findToken, assessToken, PROTOCOLS, validateProtocols, nativeUsdcToErc20, erc20UsdcToNative, findCctpDestination, validateActions } from "../dist/index.js";

test("networks resolve by key, chain id, caip and alias", () => {
  assert.equal(NETWORKS["arc-mainnet"].chainId, 5042);
  assert.equal(NETWORKS["arc-testnet"].chainId, 5042002);
  assert.equal(resolveNetwork(5042)?.key, "arc-mainnet");
  assert.equal(resolveNetwork("eip155:5042002")?.key, "arc-testnet");
  assert.equal(resolveNetwork("arc", "mainnet")?.key, "arc-mainnet");
  assert.equal(resolveNetwork("solana"), null);
});

test("contracts are checksummed addresses; ERC-8183 is testnet only", () => {
  for (const c of Object.values(ARC_CONTRACTS)) for (const a of Object.values(c.addresses)) assert.match(a, /^0x[0-9a-fA-F]{40}$/u);
  assert.equal(contractAddress("agenticCommerce", "mainnet"), null);
  assert.throws(() => requireContract("agenticCommerce", "mainnet"));
});

test("tokens: registry, aliases, look-alikes", () => {
  assert.equal(TOKENS.length, 19);
  assert.ok(TOKENS.some((t) => t.symbol === "WETH" && t.decimals === 18));
  assert.equal(findToken("mainnet", "gbpa")?.decimals, 6);
  assert.equal(findToken("testnet", "gbpa"), null);
  assert.equal(findToken("mainnet", "yen")?.symbol, "JPYC");
  assert.equal(new Set(TOKENS.map((t) => t.symbol.toLowerCase())).size, TOKENS.length);
  const aliases = TOKENS.flatMap((t) => t.aliases);
  assert.equal(new Set(aliases).size, aliases.length, "aliases are unique across tokens");
  assert.equal(findToken("testnet", "euro")?.symbol, "EURC");
  assert.equal(findToken("mainnet", "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1")?.symbol, "EURC");
  assert.equal(assessToken({ environment: "mainnet", address: "0x3600000000000000000000000000000000000000" }).status, "verified");
  assert.equal(assessToken({ environment: "mainnet", address: "0x9999999999999999999999999999999999999999", symbol: "UЅDC" }).status, "lookalike");
  assert.equal(assessToken({ environment: "mainnet", address: "0x9999999999999999999999999999999999999999", symbol: "DOGE" }).status, "unverified");
});

test("USDC native (18) and ERC-20 (6) faces convert exactly", () => {
  assert.equal(erc20UsdcToNative(1_500_000n), 1_500_000_000_000_000_000n);
  assert.equal(nativeUsdcToErc20(1_500_000_000_000_000_000n), 1_500_000n);
  assert.throws(() => nativeUsdcToErc20(1n));
  assert.equal(nativeUsdcToErc20(1_999_999_999_999n, "floor"), 1n);
});

test("protocol registry is valid", () => {
  assert.deepEqual(validateProtocols(PROTOCOLS), []);
  assert.ok(PROTOCOLS.some((p) => p.id === "erc8004"));
});

test("cctp destinations and actions", () => {
  assert.equal(findCctpDestination("Base")?.domain, 6);
  assert.equal(findCctpDestination("narnia"), null);
  assert.deepEqual(validateActions([{ verb: "send", token: "USDC", amount: { exact: "20" }, to: "0x1111111111111111111111111111111111111111", memo: "invoice 12" }]), []);
  assert.ok(validateActions([{ verb: "bridge", token: "USDC", amount: { exact: "0" }, destination: "narnia" }]).length >= 2);
});

test("coverage: routable, read-only and mapped are counted from the registry", async () => {
  const { registryCoverage, coverageOf, coverageLine, protocolsFor, getProtocol } = await import("../dist/index.js");
  const executable = new Set(["arc-transfer", "cctp", "gateway", "morpho-vaults", "morpho-blue", "aave-v4", "uniswap-v3", "uniswap-v4", "aerodrome-slipstream", "lykia-router"]);
  const c = registryCoverage("mainnet", executable);
  assert.equal(c.protocols, protocolsFor("mainnet").length);
  assert.equal(c.routable + c.readOnly + c.mapped, c.protocols);
  assert.equal(c.routable + c.readOnly, c.verified);
  // lykia-router is an engine venue, not a registry entry: it never inflates the count.
  assert.equal(c.routable, protocolsFor("mainnet").filter((p) => executable.has(p.id)).length);
  assert.equal(coverageOf(getProtocol("aave-v4"), "mainnet", executable), "routable");
  assert.equal(coverageOf(getProtocol("synthra"), "mainnet", executable), "read-only");
  assert.equal(coverageOf(getProtocol("beefy"), "mainnet", executable), "mapped");
  assert.equal(coverageLine({ routable: 9, protocols: 94 }), "9 venues Lykia can route through today · 94 protocols mapped on Arc");
  assert.equal(coverageLine({ routable: 1, protocols: 1 }), "1 venue Lykia can route through today · 1 protocol mapped on Arc");
});

test("a yield choice names every venue it compared, best first", async () => {
  const { chooseYield } = await import("../dist/index.js");
  const route = chooseYield([
    { venue: "aave-v4", label: "Aave V4 Main Spoke EURC", apy: "0.0067", tvlUsd: "1500000", risk: "medium", executable: true, notes: [] },
    { venue: "morpho-vaults", label: "Morpho Galaxy EURC", apy: "0.0118", tvlUsd: "562000", risk: "high", executable: true, notes: [] },
    { venue: "aave-v4", label: "Aave V4 Forex Spoke EURC", apy: "0.0067", tvlUsd: "68000", risk: "high", executable: true, notes: [] },
    { venue: "morpho-vaults", label: "Morpho Steakhouse Prime EURC", apy: "0.0197", tvlUsd: "9900", risk: "high", executable: false, notes: [] },
  ], "medium");
  assert.equal(route.chosen.label, "Aave V4 Main Spoke EURC");
  assert.match(route.reason, /Compared 4 venues: Morpho Steakhouse Prime EURC 1\.97% APY \(not executable\), Morpho Galaxy EURC 1\.18% APY, Aave V4 Forex Spoke EURC 0\.67% APY, Aave V4 Main Spoke EURC 0\.67% APY\./u);
  assert.match(route.reason, /Morpho Galaxy EURC pay more but sit above the medium-risk ceiling/u);
});
