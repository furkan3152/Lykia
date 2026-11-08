#!/usr/bin/env node
// LykiaStile for the owner's own wallet: the unsigned deployment and a read-only check afterwards.
// Nothing here holds a key, signs or broadcasts. Paste the printed data into your wallet (a contract
// creation: no "to"), or let the Fold's New leash sheet send it.
//
//   OWNER=0x... ENV=testnet [NONCE=12] node scripts/stile.cjs plan
//     prints the creation (bytecode + constructor arguments), the address it will get when sent at
//     the wallet's current nonce, and the addDelegate(USDC, stile) call for Gateway Wallet
//
//   OWNER=0x... STILE=0x... ENV=testnet node scripts/stile.cjs check
//     reads the deployed Stile and Gateway: code equals the artifact (immutables ignored), the
//     immutables are the expected ones, the Stile is a Gateway delegate of OWNER, OWNER's Gateway
//     balance on Arc, and isValidSignature refusing an unknown digest (simulated with eth_call)
//
// Run `npx hardhat compile` first. Gateway addresses: developers.circle.com/gateway/references/contract-addresses.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Interface, AbiCoder, getAddress, isAddress, getCreateAddress, keccak256, id, zeroPadValue } = require("ethers");

const ENVS = {
  testnet: { chainId: 5042002, rpc: process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.io", gatewayApi: "https://gateway-api-testnet.circle.com", wallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" },
  mainnet: { chainId: 5042, rpc: process.env.ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io", gatewayApi: "https://gateway-api.circle.com", wallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", minter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205" },
};
const USDC = "0x3600000000000000000000000000000000000000";
const ARC_DOMAIN = 26;
// Beta ceilings while LykiaStile is unaudited (USDC base units): $100 per transfer, $300 per rolling day.
const CEILING_PER_TRANSFER = 100_000_000n;
const CEILING_DAILY = 300_000_000n;
const FEE_BPS = Number(process.env.FEE_BPS ?? "100");
const FEE_RECIPIENT = process.env.FEE_RECIPIENT || "0x8c5281055b197443ff01dbbdfbf29fd63946ca1e";

const PKG = path.join(__dirname, "..");
const ART = path.join(PKG, "artifacts", "contracts", "stile", "LykiaStile.sol");

function artifact() {
  const p = path.join(ART, "LykiaStile.json");
  if (!fs.existsSync(p)) throw new Error("Run `npx hardhat compile` first.");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function immutableRanges() {
  const dbg = JSON.parse(fs.readFileSync(path.join(ART, "LykiaStile.dbg.json"), "utf8"));
  const info = JSON.parse(fs.readFileSync(path.resolve(ART, dbg.buildInfo), "utf8"));
  const refs = info.output.contracts["contracts/stile/LykiaStile.sol"].LykiaStile.evm.deployedBytecode.immutableReferences || {};
  return Object.values(refs).flat();
}

function address(name, required = true) {
  const value = process.env[name];
  if (!value) {
    if (required) throw new Error(`${name} is required (a 0x address).`);
    return null;
  }
  if (!isAddress(value)) throw new Error(`${name} is not an address.`);
  return getAddress(value);
}

function environment() {
  const env = process.env.ENV || "testnet";
  if (!ENVS[env]) throw new Error("ENV is testnet or mainnet.");
  return [env, ENVS[env]];
}

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function plan() {
  const [envName, env] = environment();
  const owner = address("OWNER");
  const a = artifact();
  const iface = new Interface(a.abi);
  const args = [owner, env.wallet, env.minter, USDC, ARC_DOMAIN, CEILING_PER_TRANSFER, CEILING_DAILY, FEE_BPS, FEE_BPS > 0 ? FEE_RECIPIENT : "0x0000000000000000000000000000000000000000"];
  const data = a.bytecode + iface.encodeDeploy(args).slice(2);
  const nonce = process.env.NONCE !== undefined ? Number(process.env.NONCE) : Number(await rpc(env.rpc, "eth_getTransactionCount", [owner, "pending"]));
  const predicted = getCreateAddress({ from: owner, nonce });
  const gateway = new Interface(["function addDelegate(address token, address delegate)"]);
  const out = {
    environment: envName,
    chainId: env.chainId,
    note: "Unsigned. Send from OWNER's own wallet, in this order, with nothing in between: the address follows from the wallet's nonce.",
    constructor: { owner, gatewayWallet: env.wallet, gatewayMinter: env.minter, token: USDC, sourceDomain: ARC_DOMAIN, ceilingPerTransfer: CEILING_PER_TRANSFER.toString(), ceilingDaily: CEILING_DAILY.toString(), feeBps: FEE_BPS, feeRecipient: FEE_BPS > 0 ? FEE_RECIPIENT : null },
    transactions: [
      { step: 1, label: "Create LykiaStile", from: owner, to: null, value: "0", nonce, predictedAddress: predicted, data },
      { step: 2, label: "addDelegate(USDC, stile) on Gateway Wallet", from: owner, to: env.wallet, value: "0", data: gateway.encodeFunctionData("addDelegate", [USDC, predicted]) },
    ],
    after: `OWNER=${owner} STILE=${predicted} ENV=${envName} node scripts/stile.cjs check`,
  };
  console.log(JSON.stringify(out, null, 2));
}

function maskImmutables(code, ranges) {
  const bytes = Buffer.from(code.slice(2), "hex");
  for (const r of ranges) bytes.fill(0, r.start, r.start + r.length);
  return bytes;
}

function stripMetadata(bytes) {
  if (bytes.length < 2) return bytes;
  const len = bytes.readUInt16BE(bytes.length - 2);
  return len + 2 <= bytes.length ? bytes.subarray(0, bytes.length - len - 2) : bytes;
}

async function check() {
  const [envName, env] = environment();
  const owner = address("OWNER");
  const stile = address("STILE");
  const a = artifact();
  const iface = new Interface(a.abi);
  const call = async (fn, args = []) => iface.decodeFunctionResult(fn, await rpc(env.rpc, "eth_call", [{ to: stile, data: iface.encodeFunctionData(fn, args) }, "latest"]));
  const results = [];
  const ok = (name, pass, detail) => results.push({ check: name, pass, ...(detail !== undefined ? { detail } : {}) });

  const code = await rpc(env.rpc, "eth_getCode", [stile, "latest"]);
  if (!code || code === "0x") {
    ok("deployed", false, "no code at STILE");
    console.log(JSON.stringify({ environment: envName, stile, results }, null, 2));
    process.exitCode = 1;
    return;
  }
  const ranges = immutableRanges();
  const same = code.length === a.deployedBytecode.length && keccak256(stripMetadata(maskImmutables(code, ranges))) === keccak256(stripMetadata(maskImmutables(a.deployedBytecode, ranges)));
  ok("code equals the LykiaStile artifact (immutables and metadata ignored)", same);
  if (!same) {
    console.log(JSON.stringify({ environment: envName, stile, results }, null, 2));
    process.exitCode = 1;
    return;
  }
  const pad = (x) => zeroPadValue(x, 32).toLowerCase();
  ok("owner", (await call("owner"))[0].toLowerCase() === owner.toLowerCase());
  ok("gatewayWallet", (await call("gatewayWallet"))[0].toLowerCase() === env.wallet.toLowerCase());
  ok("gatewayMinter", (await call("gatewayMinter"))[0].toLowerCase() === pad(env.minter));
  ok("token", (await call("token"))[0].toLowerCase() === USDC.toLowerCase());
  ok("sourceDomain", Number((await call("sourceDomain"))[0]) === ARC_DOMAIN);
  ok("ceilings", (await call("ceilingPerTransfer"))[0] === CEILING_PER_TRANSFER && (await call("ceilingDaily"))[0] === CEILING_DAILY);
  ok("fee", Number((await call("feeBps"))[0]) === FEE_BPS && (FEE_BPS === 0 || (await call("feeRecipient"))[0].toLowerCase() === pad(FEE_RECIPIENT)));
  ok("not paused", (await call("paused"))[0] === false);
  ok("sessions issued", true, Number((await call("sessionNonce"))[0]));
  const gw = new Interface(["function isAuthorizedForBalance(address token, address depositor, address addr) view returns (bool)"]);
  const auth = gw.decodeFunctionResult("isAuthorizedForBalance", await rpc(env.rpc, "eth_call", [{ to: env.wallet, data: gw.encodeFunctionData("isAuthorizedForBalance", [USDC, owner, stile]) }, "latest"]))[0];
  ok("Gateway delegate of OWNER (addDelegate landed)", auth);
  const unknown = await call("isValidSignature", [id("not reserved"), AbiCoder.defaultAbiCoder().encode(["bytes32"], [id("x")])]);
  ok("isValidSignature refuses an unknown digest", unknown[0] === "0xffffffff");
  try {
    const r = await fetch(`${env.gatewayApi}/v1/balances`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "USDC", sources: [{ domain: ARC_DOMAIN, depositor: owner }] }) });
    const j = await r.json();
    ok("Gateway balance on Arc (USDC)", true, j.balances?.[0]?.balance ?? null);
  } catch (e) {
    ok("Gateway balance on Arc (USDC)", false, String(e.message || e));
  }
  console.log(JSON.stringify({ environment: envName, stile, owner, results }, null, 2));
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}

const command = process.argv[2];
(command === "plan" ? plan() : command === "check" ? check() : Promise.reject(new Error("Usage: node scripts/stile.cjs plan|check"))).catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
