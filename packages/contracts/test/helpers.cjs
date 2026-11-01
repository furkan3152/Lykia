"use strict";
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;
// The rolling daily window keeps spends for 24 to 30 h (five 6 h buckets); waiting WINDOW always clears them.
const WINDOW = 30 * 60 * 60;
const NATIVE = ethers.ZeroAddress;
const MAX128 = (1n << 128n) - 1n;

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function deployTokens() {
  const T = await ethers.getContractFactory("MockToken");
  const usdc = await T.deploy("USDC", "USDC", 6);
  const eurc = await T.deploy("EURC", "EURC", 6);
  const btc = await T.deploy("Circle Wrapped Bitcoin", "cirBTC", 8);
  return { usdc, eurc, btc };
}

/** Factory + one account for `owner` (guardian optional, nativeUsdc optional). */
async function deployAccount(owner, guardian = ethers.ZeroAddress, nativeUsdc = ethers.ZeroAddress, salt = ethers.ZeroHash) {
  const F = await ethers.getContractFactory("LykiaAccountFactory");
  const factory = await F.deploy();
  await factory.createAccount(owner.address, salt, guardian, nativeUsdc);
  const address = await factory.predictAccount(owner.address, salt, guardian, nativeUsdc);
  const account = await ethers.getContractAt("LykiaAccount", address);
  return { factory, account };
}

function spec(over = {}) {
  return {
    key: over.key,
    validUntil: over.validUntil,
    maxCalls: over.maxCalls ?? 100,
    fenceHash: over.fenceHash ?? ethers.id("lykia.fence/v1:test"),
    tokens: over.tokens ?? [],
    calls: over.calls ?? [],
    recipients: over.recipients ?? [],
  };
}

function limit(token, perCall, daily, budget) {
  return { token: typeof token === "string" ? token : token.target, perCall, daily, budget: budget ?? MAX128 };
}

function rule(target, selector, receiverWords = 0, homeward = false) {
  return { target: typeof target === "string" ? target : target.target, selector, receiverWords, homeward };
}

/** Creates a session through `tx` and returns its id from the SessionCreated event. */
async function sessionIdFrom(txPromise, account) {
  const receipt = await (await txPromise).wait();
  for (const log of receipt.logs) {
    try {
      const parsed = account.interface.parseLog(log);
      if (parsed && parsed.name === "SessionCreated") return parsed.args.id;
    } catch {
      /* other contract */
    }
  }
  throw new Error("no SessionCreated");
}

function call(sessionId, target, data, over = {}) {
  return {
    sessionId,
    target: typeof target === "string" ? target : target.target,
    value: over.value ?? 0n,
    data,
    spendToken: over.spendToken ?? ethers.ZeroAddress,
    spendAmount: over.spendAmount ?? 0n,
    memo: over.memo ?? "0x",
  };
}

async function signAgentCall(signer, account, c, nonce, deadline) {
  const net = await ethers.provider.getNetwork();
  const domain = { name: "LykiaAccount", version: "1", chainId: net.chainId, verifyingContract: account.target };
  const types = {
    AgentCall: [
      { name: "sessionId", type: "bytes32" },
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "dataHash", type: "bytes32" },
      { name: "spendToken", type: "address" },
      { name: "spendAmount", type: "uint256" },
      { name: "memoHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value = {
    sessionId: c.sessionId,
    target: c.target,
    value: c.value,
    dataHash: ethers.keccak256(c.data),
    spendToken: c.spendToken,
    spendAmount: c.spendAmount,
    memoHash: ethers.keccak256(c.memo),
    nonce,
    deadline,
  };
  return signer.signTypedData(domain, types, value);
}

async function signAgentTransfer(signer, account, t, nonce, deadline) {
  const net = await ethers.provider.getNetwork();
  const domain = { name: "LykiaAccount", version: "1", chainId: net.chainId, verifyingContract: account.target };
  const types = {
    AgentTransfer: [
      { name: "sessionId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memoHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return signer.signTypedData(domain, types, { ...t, memoHash: ethers.keccak256(t.memo), nonce, deadline });
}

module.exports = { DAY, WINDOW, NATIVE, MAX128, now, deployTokens, deployAccount, spec, limit, rule, sessionIdFrom, call, signAgentCall, signAgentTransfer };
