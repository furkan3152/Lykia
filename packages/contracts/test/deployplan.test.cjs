"use strict";
// The owner-console deployment plan from @lykia/core, executed against an in-process chain the
// way the owner console does it: plain contract-creation transactions sent from the owner's own
// wallet, so the owner is the creator of every core contract.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

describe("deployPlan (core): direct CREATE from the owner's wallet", function () {
  let core, owner, other;
  before(async function () {
    core = (await import("@lykia/core")).lykiaContracts;
    [owner, other] = await ethers.getSigners();
    // Put 6- and 8-decimal tokens at Arc testnet's USDC, EURC and cirBTC addresses.
    const T = await ethers.getContractFactory("MockToken");
    const arc = (await import("@lykia/core")).ARC_CONTRACTS;
    for (const [key, dec] of [["usdc", 6], ["eurc", 6], ["cirbtc", 8]]) {
      const t = await T.deploy(key, key, dec);
      await network.provider.send("hardhat_setCode", [arc[key].addresses.testnet, await ethers.provider.getCode(t.target)]);
    }
  });

  it("encodes constructor args exactly like the ABI coder and predicts CREATE addresses", async function () {
    const args = [
      { name: "a", type: "address", value: owner.address },
      { name: "s", type: "string", value: "Lykia Practice USDC" },
      { name: "n", type: "uint256", value: "860000000000000000" },
      { name: "l", type: "address[]", value: [owner.address, other.address] },
      { name: "b", type: "bool", value: true },
      { name: "x", type: "uint16", value: "7000" },
    ];
    const expected = ethers.AbiCoder.defaultAbiCoder().encode(["address", "string", "uint256", "address[]", "bool", "uint16"], [owner.address, "Lykia Practice USDC", 860000000000000000n, [owner.address, other.address], true, 7000]);
    expect(core.encodeArgs(args)).to.equal(expected);
    expect(core.functionSelector("setVenue(address,bool)")).to.equal(ethers.id("setVenue(address,bool)").slice(0, 10));
    expect(core.toChecksum(owner.address.toLowerCase())).to.equal(owner.address);
    for (const n of [0, 1, 0x7f, 0x80, 0xff, 0x100, 65535, 1_000_000]) expect(core.predictCreate(owner.address, n)).to.equal(ethers.getCreateAddress({ from: owner.address, nonce: n }));
    expect(() => core.resolveStep({ ...core.deployPlan("mainnet", owner.address).steps[1], constructorArgs: [{ name: "x", type: "address", value: { ref: "LykiaAccountFactory" } }] }, {})).to.throw(/not deployed yet/);
  });

  it("testnet: every step is created by the owner at its predicted address, code matches, init calls work", async function () {
    const nonce = await ethers.provider.getTransactionCount(owner.address);
    const plan = core.deployPlan("testnet", owner.address, { nonce });
    expect(plan.chainId).to.equal(5042002);
    expect(plan.deployer).to.equal(owner.address);
    expect(plan.steps.map((s) => s.name)).to.deep.equal(["LykiaAccountFactory", "LykiaRouter", "PracticeVaultUSDC", "PracticeVaultEURC", "PracticeSwap", "PracticeLending", "LykiaOrders"]);
    const deployed = {};
    for (const step of plan.steps) {
      expect(step.tx.to).to.equal(null);
      const tx = core.resolveStep(step, deployed);
      expect(tx.data).to.equal(step.tx.data);
      const sent = await owner.sendTransaction({ data: tx.data });
      const receipt = await sent.wait();
      expect(sent.to).to.equal(null);
      expect(receipt.from).to.equal(owner.address);
      expect(receipt.contractAddress, step.name).to.equal(step.predictedAddress);
      const code = await ethers.provider.getCode(receipt.contractAddress);
      expect(core.codeMatchesArtifact(step.contract, code), step.name).to.equal(true);
      deployed[step.name] = receipt.contractAddress;
    }
    for (const call of plan.initCalls) {
      const tx = core.resolveCall(call, deployed);
      expect(tx.data).to.equal(call.tx.data);
      await (await owner.sendTransaction({ to: tx.to, data: tx.data })).wait();
    }
    const router = await ethers.getContractAt("LykiaRouter", deployed.LykiaRouter);
    expect(await router.owner()).to.equal(owner.address);
    expect(await router.paused()).to.equal(false);
    for (const v of ["PracticeVaultUSDC", "PracticeVaultEURC", "PracticeSwap", "PracticeLending"]) expect(await router.venueAllowed(deployed[v])).to.equal(true);
    const factory = await ethers.getContractAt("LykiaAccountFactory", deployed.LykiaAccountFactory);
    expect(await factory.implementation()).to.not.equal(ethers.ZeroAddress);
    expect((await ethers.getContractAt("PracticeSwap", deployed.PracticeSwap)).rate).to.exist;
    expect(await (await ethers.getContractAt("PracticeLending", deployed.PracticeLending)).ltvBps()).to.equal(7000);
    const orders = await ethers.getContractAt("LykiaOrders", deployed.LykiaOrders);
    expect(await orders.router()).to.equal(deployed.LykiaRouter);
    expect(await orders.feeBps()).to.equal(100);
    expect(await orders.owner()).to.equal(owner.address);
    // Code from a different contract never matches.
    expect(core.codeMatchesArtifact("LykiaRouter", await ethers.provider.getCode(deployed.PracticeSwap))).to.equal(false);
  });

  it("without a nonce: no predictions, init calls resolve from receipts", async function () {
    const plan = core.deployPlan("testnet", owner.address);
    expect(plan.steps.every((s) => s.predictedAddress === null && s.nonce === null)).to.equal(true);
    // Only steps that reference an earlier contract wait for its receipt.
    expect(plan.steps.filter((s) => s.tx === null).map((s) => s.name)).to.deep.equal(["LykiaOrders"]);
    expect(plan.initCalls.every((c) => c.tx === null && c.address === null)).to.equal(true);
    const deployed = {};
    for (const step of plan.steps) {
      const receipt = await (await owner.sendTransaction({ data: core.resolveStep(step, deployed).data })).wait();
      deployed[step.name] = receipt.contractAddress;
    }
    for (const call of plan.initCalls) await (await owner.sendTransaction(core.resolveCall(call, deployed))).wait();
    const router = await ethers.getContractAt("LykiaRouter", deployed.LykiaRouter);
    expect(await router.venueAllowed(deployed.PracticeLending)).to.equal(true);
    expect(await (await ethers.getContractAt("LykiaOrders", deployed.LykiaOrders)).router()).to.equal(deployed.LykiaRouter);
  });

  it("mainnet: factory, router and orders, addresses follow the owner's nonce", async function () {
    const plan = core.deployPlan("mainnet", owner.address, { nonce: 7 });
    expect(plan.steps.map((s) => s.name)).to.deep.equal(["LykiaAccountFactory", "LykiaRouter", "LykiaOrders"]);
    expect(plan.initCalls.map((c) => c.args[0].value)).to.deep.equal(["0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77", "0x0fef9e88a7b76bcdbf451780c6774fe32965ee98"]);
    expect(plan.steps[2].predictedAddress).to.equal(ethers.getCreateAddress({ from: owner.address, nonce: 9 }));
    expect(plan.steps[0].predictedAddress).to.equal(ethers.getCreateAddress({ from: owner.address, nonce: 7 }));
    expect(plan.steps[1].predictedAddress).to.equal(ethers.getCreateAddress({ from: owner.address, nonce: 8 }));
    expect(plan.notes.join(" ")).to.match(/creator/);
    expect(core.deployedAddress("mainnet", "LykiaRouter")).to.equal("0xc9c0ea4d22ddbef4504a634759fb78334efc5d18");
    expect(core.deployedAddress("mainnet", "LykiaOrders")).to.equal(null);
  });
});
