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

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}  ${r.detail}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
