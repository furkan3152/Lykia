"use strict";
// Ownership hardening: LykiaRouter and LykiaOrders move from the deployer's wallet to a multisig
// (a Safe on Arc; an EOA stands in for it here) behind a LykiaTimelock delay. Two-step ownership
// means a mistyped address can never take the contracts: the new owner must accept.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DELAY = 2 * 24 * 60 * 60;

describe("Ownership hardening: Safe + timelock", function () {
  async function setup() {
    const [deployer, safe, stranger, venue] = await ethers.getSigners();
    const router = await (await ethers.getContractFactory("LykiaRouter")).deploy(deployer.address, []);
    const orders = await (await ethers.getContractFactory("LykiaOrders")).deploy(deployer.address, router.target, 100, deployer.address);
    const timelock = await (await ethers.getContractFactory("LykiaTimelock")).deploy(DELAY, [safe.address], [safe.address], ethers.ZeroAddress);
    return { deployer, safe, stranger, venue, router, orders, timelock };
  }

  async function scheduleAndRun(timelock, safe, target, data, salt) {
    await timelock.connect(safe).schedule(target, 0, data, ethers.ZeroHash, salt, DELAY);
    await expect(timelock.connect(safe).execute(target, 0, data, ethers.ZeroHash, salt)).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    await time.increase(DELAY);
    await timelock.connect(safe).execute(target, 0, data, ethers.ZeroHash, salt);
  }

  it("the factory has no owner at all: nothing to transfer", async function () {
    const factory = await (await ethers.getContractFactory("LykiaAccountFactory")).deploy();
    expect(factory.interface.getFunction("owner", [])).to.equal(null);
    expect(factory.interface.getFunction("transferOwnership", [])).to.equal(null);
  });

  it("router and orders move to the timelock in two steps; admin calls then need the delay", async function () {
    const { deployer, safe, stranger, venue, router, orders, timelock } = await setup();
    for (const c of [router, orders]) {
      await c.connect(deployer).transferOwnership(timelock.target);
      expect(await c.owner()).to.equal(deployer.address);
      expect(await c.pendingOwner()).to.equal(timelock.target);
      const accept = c.interface.encodeFunctionData("acceptOwnership");
      await scheduleAndRun(timelock, safe, c.target, accept, ethers.id(`accept:${c.target}`));
      expect(await c.owner()).to.equal(timelock.target);
    }
    // the old owner and strangers are out
    await expect(router.connect(deployer).setVenue(venue.address, true)).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    await expect(orders.connect(deployer).pause()).to.be.revertedWithCustomError(orders, "OwnableUnauthorizedAccount");
    // only the Safe proposes
    const data = router.interface.encodeFunctionData("setVenue", [orders.target, true]);
    await expect(timelock.connect(stranger).schedule(router.target, 0, data, ethers.ZeroHash, ethers.ZeroHash, DELAY)).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
    // a delay shorter than the minimum is refused
    await expect(timelock.connect(safe).schedule(router.target, 0, data, ethers.ZeroHash, ethers.ZeroHash, DELAY - 1)).to.be.revertedWithCustomError(timelock, "TimelockInsufficientDelay");
    await scheduleAndRun(timelock, safe, router.target, data, ethers.id("venue"));
    expect(await router.venueAllowed(orders.target)).to.equal(true);
  });

  it("the Safe can cancel a queued action; the timelock has no admin to bypass the delay", async function () {
    const { safe, deployer, router, timelock, venue } = await setup();
    await router.connect(deployer).transferOwnership(timelock.target);
    const data = router.interface.encodeFunctionData("acceptOwnership");
    await timelock.connect(safe).schedule(router.target, 0, data, ethers.ZeroHash, ethers.ZeroHash, DELAY);
    const id = await timelock.hashOperation(router.target, 0, data, ethers.ZeroHash, ethers.ZeroHash);
    await timelock.connect(safe).cancel(id);
    await time.increase(DELAY);
    await expect(timelock.connect(safe).execute(router.target, 0, data, ethers.ZeroHash, ethers.ZeroHash)).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    const admin = await timelock.DEFAULT_ADMIN_ROLE();
    expect(await timelock.hasRole(admin, deployer.address)).to.equal(false);
    expect(await timelock.hasRole(admin, timelock.target)).to.equal(true);
    expect(await router.owner()).to.equal(deployer.address);
    void venue;
  });
});

describe("scripts/ownership-plan.cjs", function () {
  it("prints unsigned calls that match the contracts' ABIs", async function () {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { ROUTER: "0x1111111111111111111111111111111111111111", SAFE: "0x3333333333333333333333333333333333333333", TIMELOCK: "0x4444444444444444444444444444444444444444", DELAY: "3600" });
      delete process.env.ORDERS;
      const { plan } = require("../scripts/ownership-plan.cjs");
      const out = plan();
      const router = (await ethers.getContractFactory("LykiaRouter")).interface;
      expect(out.steps).to.have.length(3);
      expect(router.decodeFunctionData("transferOwnership", out.steps[0].data)[0]).to.equal(process.env.TIMELOCK);
      const tl = (await ethers.getContractFactory("LykiaTimelock")).interface;
      const scheduled = tl.decodeFunctionData("schedule", out.steps[1].data);
      expect(scheduled.delay).to.equal(3600n);
      expect(scheduled.data).to.equal(router.encodeFunctionData("acceptOwnership"));
    } finally {
      process.env = saved;
    }
  });
});
