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
  assert.equal(TOKENS.length, 4);
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
