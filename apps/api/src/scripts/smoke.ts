/**
 * Read-only live smoke test against Arc's public RPC and Circle's public
 * APIs. Signs nothing, sends nothing. Run: npm run smoke -w @lykia/api
 */
import { contractAddress, NETWORKS, type ArcEnvironment } from "@lykia/core";
import { encodeFunctionData, erc20Abi, parseAbi, toHex, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PriceService } from "../arc/prices.js";
import { ArcChains } from "../chains/arc.js";
import { systemClock } from "../clock.js";
import { MEMO_ABI, MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { quoteVenues } from "../engine/api.js";
import { VenueRouter } from "../engine/router.js";
import { aaveCalls } from "../engine/venues/aave.js";
import { buildCalls } from "../engine/adapters.js";
import { shape } from "../engine/calls.js";
import { YieldService } from "../engine/venues/yields.js";
import { FlockService } from "../flock/flock.js";
import { silentLogger } from "../log.js";
import { ScentService } from "../scent/scent.js";
import { TRANSFER_WITH_AUTHORIZATION_TYPES } from "../x402/x402.js";

const chains = new ArcChains(NETWORKS);
const results: { check: string; ok: boolean; detail: string }[] = [];
const check = async (name: string, fn: () => Promise<string>) => {
  try {
    results.push({ check: name, ok: true, detail: await fn() });
  } catch (error) {
    results.push({ check: name, ok: false, detail: error instanceof Error ? error.message.slice(0, 160) : String(error) });
  }
};

for (const env of ["mainnet", "testnet"] as ArcEnvironment[]) {
  const client = chains.client(env);
  await check(`${env}: chain id`, async () => {
    const id = await client.getChainId();
    if (id !== chains.network(env).chainId) throw new Error(`got ${id}`);
    return String(id);
  });
  await check(`${env}: USDC accepts an x402 authorization signed for domain "USDC" v2 (eth_call)`, async () => {
    const usdc = contractAddress("usdc", env) as Address;
    const account = privateKeyToAccount(generatePrivateKey());
    const message = { from: account.address, to: "0x2222222222222222222222222222222222222222" as Address, value: 1000n, validAfter: 0n, validBefore: 4_000_000_000n, nonce: toHex(crypto.getRandomValues(new Uint8Array(32))) };
    const signature = await account.signTypedData({ domain: { name: "USDC", version: "2", chainId: chains.network(env).chainId, verifyingContract: usdc }, types: TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: "TransferWithAuthorization", message });
    const data = encodeFunctionData({ abi: parseAbi(["function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)"]), functionName: "transferWithAuthorization", args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, signature] });
    // The payer gets a native USDC balance through a state override; nothing is broadcast.
    await chains.rawRpc(env, "eth_call", [{ from: "0x1111111111111111111111111111111111111111", to: usdc, data }, "latest", { [account.address]: { balance: "0xde0b6b3a7640000" } }]);
    return "transferWithAuthorization simulates";
  });
  await check(`${env}: Memo inside Multicall3From composes (eth_call)`, async () => {
    const usdc = contractAddress("usdc", env) as Address;
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: ["0x2222222222222222222222222222222222222222", 0n] });
    const memo = encodeFunctionData({ abi: MEMO_ABI, functionName: "memo", args: [usdc, transfer, `0x${"11".repeat(32)}`, "0x6c796b6961"] });
    const data = encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [[{ target: usdc, allowFailure: false, callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: ["0x2222222222222222222222222222222222222222", 0n] }) }, { target: contractAddress("memo", env) as Address, allowFailure: false, callData: memo }]] });
    await client.call({ account: "0x1111111111111111111111111111111111111111", to: contractAddress("multicall3From", env) as Address, data });
    return "ok";
  });
}

const prices = new PriceService({ chains, clock: systemClock });
await check("Chainlink EURC/USD and BTC/USD", async () => {
  const [eurc, btc] = await Promise.all([prices.price("EURC"), prices.price("cirBTC")]);
  if (!eurc.usd || !btc.usd) throw new Error(`${eurc.source} / ${btc.source}`);
  return `EURC ${eurc.usd}, BTC ${btc.usd}`;
});
const flock = new FlockService({ chains, prices, clock: systemClock, fetch: (i, init) => fetch(i, init), log: silentLogger });
await check("Flock of the Uniswap USDC/cirBTC pool (mainnet)", async () => {
  const snapshot = await flock.snapshot("mainnet", "0x82916bee18fcef517b26c72d7cb5f13694e1db41");
  return `total $${snapshot.totalUsd}, ${snapshot.holdings.length} holdings, gateway ${snapshot.gateway.unifiedUsdc ?? snapshot.gateway.note}`;
});
const scent = new ScentService({ chains, clock: systemClock });
await check("Scent: USDC verified", async () => (await scent.sniff("mainnet", "0x3600000000000000000000000000000000000000")).level);
await check("Scent: a launchpad token", async () => {
  const report = await scent.sniff("mainnet", "0xeCe5cA8bf9220718E5727754026757512212cb3c");
  return `${report.symbol}: ${report.level} [${report.wolves.join(", ")}]`;
});

const yields = new YieldService({ fetch: (i, init) => fetch(i, init), clock: systemClock });
const router = new VenueRouter({ chains, prices, yields });
await check("Rates: Morpho API and Aave API answer", async () => {
  const r = await yields.rates("mainnet");
  if (r.sources.morpho !== "live" || r.sources.aave !== "live") throw new Error(JSON.stringify(r.sources));
  return `${r.vaults.length} vaults, ${r.markets.length} markets, ${r.reserves.length} Aave reserves`;
});
await check("Route: 1000 USDC -> EURC across Uniswap v3, v4 and Aerodrome", async () => {
  const q = await quoteVenues(router, { kind: "swap", environment: "mainnet", from: "USDC", to: "EURC", amount: "1000" });
  if (!q.choice) throw new Error("no route");
  return `${q.options.length} options; ${q.choice.reason}`;
});
await check("Route: best USDC yield within medium risk", async () => {
  const q = await quoteVenues(router, { kind: "earn", environment: "mainnet", token: "USDC" });
  if (!q.choice) throw new Error("no yield venue");
  return q.choice.reason;
});
await check("Route: borrow 1000 USDC against cirBTC at health >= 1.8 (Aave V4 vs Morpho Blue)", async () => {
  const q = await quoteVenues(router, { kind: "borrow", environment: "mainnet", token: "USDC", amount: "1000", minHealth: "1.8", account: "0x82916bee18fcef517b26c72d7cb5f13694e1db41" });
  if (!q.choice) throw new Error("no borrow venue");
  return q.choice.reason;
});
await check("Aave V4 Main Spoke: approve + supply + withdraw compose (eth_call)", async () => {
  const whale = "0x82916bee18fcef517b26c72d7cb5f13694e1db41" as Address;
  const spoke = "0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d" as Address;
  const usdc = contractAddress("usdc", "mainnet") as Address;
  const calls = [
    { target: usdc, allowFailure: false, callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spoke, 1_000_000n] }) },
    { target: spoke, allowFailure: false, callData: aaveCalls.supply(spoke, 0, 1_000_000n, whale, "s").data },
    { target: spoke, allowFailure: false, callData: aaveCalls.withdraw(spoke, 0, null, whale, "w").data },
  ];
  await chains.client("mainnet").call({ account: whale, to: contractAddress("multicall3From", "mainnet") as Address, data: encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [calls] }) });
  return "ok";
});

await check("Aerodrome Slipstream: routed 1000 USDC -> EURC, approve + Memo(Metarouter.execute) simulates (eth_call)", async () => {
  const swap = await router.swap("mainnet", "USDC", "EURC", 1_000_000_000n);
  const aero = swap.candidates.find((c) => c.adapter === "swap-aerodrome" && c.params.pool?.toLowerCase() === "0x6f57b4c22155cef09f17184c954f227ff0493742");
  if (!aero) throw new Error("no Aerodrome candidate");
  const user = "0x7a3000000000000000000000000000000000a11c" as Address;
  const minOut = (aero.amountOut * 9950n) / 10_000n;
  const built = await buildCalls({ adapter: "swap-aerodrome", params: { ...aero.params, minOut: minOut.toString(), display: "1000 USDC" } }, { environment: "mainnet", chains, account: user });
  const [tx] = shape(built.calls, built.approvals, { environment: "mainnet", chainId: 5042, from: user, memo: { intentId: "out_smoke", stepId: "s1", verdict: "0000000000000000" }, account: "eoa" });
  await chains.client("mainnet").call({ account: user, to: tx!.to as Address, data: tx!.data as `0x${string}`, stateOverride: [{ address: user, balance: 10n ** 22n }] });
  return `quote ${aero.amountOut} EURC units, min ${minOut}; batch simulates`;
});

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}  ${r.detail}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
