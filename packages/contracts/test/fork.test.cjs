"use strict";
// Optional: LYKIA_FORK=1 forks Arc testnet. Arc's public RPC answers eth_getStorageAt with zeros, so a
// forked chain sees contract code but not contract state (balances, owners). This test therefore only
// checks what a fork can prove: Arc's system contracts have code and a fresh account deploys and
// initializes on top of the fork.
const { expect } = require("chai");
const { ethers } = require("hardhat");

const FORK = process.env.LYKIA_FORK === "1";
(FORK ? describe : describe.skip)("Arc testnet fork", function () {
  it("sees Arc's contracts and deploys a LykiaAccount on top", async function () {
    const usdc = "0x3600000000000000000000000000000000000000";
    const memo = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
    expect((await ethers.provider.getCode(usdc)).length).to.be.gt(2);
    expect((await ethers.provider.getCode(memo)).length).to.be.gt(2);
    const [owner] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("LykiaAccountFactory")).deploy();
    await factory.createAccount(owner.address, ethers.ZeroHash, ethers.ZeroAddress, usdc);
    const account = await ethers.getContractAt("LykiaAccount", await factory.predictAccount(owner.address, ethers.ZeroHash, ethers.ZeroAddress, usdc));
    expect(await account.owner()).to.equal(owner.address);
    expect(await account.nativeUsdc()).to.equal(usdc);
  });
});
