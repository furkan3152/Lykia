"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LykiaAccountFactory", function () {
  it("deploys at the predicted address, once, with the settings in the address", async function () {
    const [owner, guardian, stranger] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("LykiaAccountFactory")).deploy();
    const salt = ethers.id("treasury");
    const usdcFace = "0x3600000000000000000000000000000000000000";
    const predicted = await factory.predictAccount(owner.address, salt, guardian.address, usdcFace);
    await expect(factory.connect(stranger).createAccount(owner.address, salt, guardian.address, usdcFace))
      .to.emit(factory, "AccountCreated")
      .withArgs(predicted, owner.address, salt, guardian.address, usdcFace);
    const account = await ethers.getContractAt("LykiaAccount", predicted);
    expect(await account.owner()).to.equal(owner.address);
    expect(await account.nativeUsdc()).to.equal(usdcFace);
    // idempotent
    await expect(factory.createAccount(owner.address, salt, guardian.address, usdcFace)).to.not.emit(factory, "AccountCreated");
    // a front runner with other settings lands somewhere else
    const evil = await factory.predictAccount(owner.address, salt, stranger.address, usdcFace);
    expect(evil).to.not.equal(predicted);
    expect(await factory.predictAccount(stranger.address, salt, guardian.address, usdcFace)).to.not.equal(predicted);
  });
});
