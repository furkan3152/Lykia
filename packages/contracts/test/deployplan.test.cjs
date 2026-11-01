"use strict";
// The owner-console deployment plan from @lykia/core, executed against an in-process chain that
// carries the same CREATE2 deployer as Arc (runtime code read from Arc on 2026-11-01).
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const DEPLOYER_CODE = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

describe("deployPlan (core) on a chain with Arc's CREATE2 deployer", function () {
  let core, owner;
  before(async function () {
    core = (await import("@lykia/core")).lykiaContracts;
    [owner] = await ethers.getSigners();
    await network.provider.send("hardhat_setCode", [core.CREATE2_DEPLOYER, DEPLOYER_CODE]);
    // Put 6- and 8-decimal tokens at Arc testnet's USDC, EURC and cirBTC addresses.
    const T = await ethers.getContractFactory("MockToken");
    const arc = (await import("@lykia/core")).ARC_CONTRACTS;
    for (const [key, dec] of [["usdc", 6], ["eurc", 6], ["cirbtc", 8]]) {
      const t = await T.deploy(key, key, dec);
      await network.provider.send("hardhat_setCode", [arc[key].addresses.testnet, await ethers.provider.getCode(t.target)]);
    }
  });

  it("encodes constructor args exactly like the ABI coder", async function () {
    const args = [
      { name: "a", type: "address", value: owner.address },
      { name: "s", type: "string", value: "Lykia Practice USDC" },
      { name: "n", type: "uint256", value: "860000000000000000" },
      { name: "l", type: "address[]", value: [owner.address, core.CREATE2_DEPLOYER] },
      { name: "b", type: "bool", value: true },
      { name: "x", type: "uint16", value: "7000" },
    ];
    const expected = ethers.AbiCoder.defaultAbiCoder().encode(["address", "string", "uint256", "address[]", "bool", "uint16"], [owner.address, "Lykia Practice USDC", 860000000000000000n, [owner.address, core.CREATE2_DEPLOYER], true, 7000]);
    expect(core.encodeArgs(args)).to.equal(expected);
    expect(core.functionSelector("setVenue(address,bool)")).to.equal(ethers.id("setVenue(address,bool)").slice(0, 10));
    expect(core.toChecksum(owner.address.toLowerCase())).to.equal(owner.address);
  });

  it("testnet: every step lands at its predicted address and the checks pass", async function () {
    const plan = core.deployPlan("testnet", owner.address);
    expect(plan.chainId).to.equal(5042002);
    expect(plan.steps.map((s) => s.name)).to.deep.equal(["LykiaAccountFactory", "LykiaRouter", "PracticeVaultUSDC", "PracticeVaultEURC", "PracticeSwap", "PracticeLending"]);
    for (const step of plan.steps) {
      await (await owner.sendTransaction({ to: step.tx.to, data: step.tx.data })).wait();
      expect((await ethers.provider.getCode(step.predictedAddress)).length, step.name).to.be.gt(2);
    }
    for (const call of plan.initCalls) await (await owner.sendTransaction({ to: call.tx.to, data: call.tx.data })).wait();
    const at = (name) => plan.steps.find((s) => s.name === name).predictedAddress;
    const router = await ethers.getContractAt("LykiaRouter", at("LykiaRouter"));
    expect(await router.owner()).to.equal(owner.address);
    expect(await router.paused()).to.equal(false);
    for (const v of ["PracticeVaultUSDC", "PracticeVaultEURC", "PracticeSwap", "PracticeLending"]) expect(await router.venueAllowed(at(v))).to.equal(true);
    const factory = await ethers.getContractAt("LykiaAccountFactory", at("LykiaAccountFactory"));
    expect(await factory.implementation()).to.not.equal(ethers.ZeroAddress);
    const swap = await ethers.getContractAt("PracticeSwap", at("PracticeSwap"));
    expect(await swap.rate()).to.equal(860000000000000000n);
    const lending = await ethers.getContractAt("PracticeLending", at("PracticeLending"));
    expect(await lending.ltvBps()).to.equal(7000);
  });

  it("mainnet: factory and router only, deterministic per owner", async function () {
    const plan = core.deployPlan("mainnet", owner.address);
    expect(plan.steps.map((s) => s.name)).to.deep.equal(["LykiaAccountFactory", "LykiaRouter"]);
    expect(plan.initCalls).to.have.length(0);
    const again = core.deployPlan("mainnet", owner.address);
    expect(again.steps[1].predictedAddress).to.equal(plan.steps[1].predictedAddress);
    // the factory has no constructor args: same address on both environments for the same label
    expect(plan.steps[0].predictedAddress).to.equal(core.deployPlan("testnet", owner.address).steps[0].predictedAddress);
    expect(core.deployedAddress("mainnet", "LykiaRouter")).to.equal(null);
  });
});
