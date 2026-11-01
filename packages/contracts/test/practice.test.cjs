"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const h = require("./helpers.cjs");

const U = (n) => ethers.parseUnits(String(n), 6);
const B = (n) => ethers.parseUnits(String(n), 8);

describe("Practice venues (Arc testnet only)", function () {
  let owner, alice, bob, usdc, eurc, btc;
  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    ({ usdc, eurc, btc } = await h.deployTokens());
    for (const s of [owner, alice, bob]) {
      await usdc.mint(s.address, U(100_000));
      await eurc.mint(s.address, U(100_000));
      await btc.mint(s.address, B(10));
    }
  });

  describe("PracticeVault", function () {
    it("drips owner-funded yield into the share price", async function () {
      const vault = await (await ethers.getContractFactory("PracticeVault")).deploy(usdc.target, "Practice USDC", "pUSDC", owner.address);
      await usdc.connect(alice).approve(vault.target, ethers.MaxUint256);
      await usdc.connect(owner).approve(vault.target, ethers.MaxUint256);
      await vault.connect(alice).deposit(U(1000), alice.address);
      await vault.connect(owner).fund(U(100), U(1)); // 1 USDC per second until 100 is released
      expect(await vault.totalAssets()).to.equal(U(1000));
      await time.increase(50);
      const mid = await vault.totalAssets();
      expect(mid).to.be.gte(U(1049)).and.lte(U(1051));
      await time.increase(1000);
      expect(await vault.totalAssets()).to.equal(U(1100));
      const shares = await vault.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares, alice.address, alice.address);
      expect(await usdc.balanceOf(alice.address)).to.be.closeTo(U(100_100), U(0.01));
      await expect(vault.connect(alice).fund(1, 1)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("resists the first-depositor donation attack", async function () {
      const vault = await (await ethers.getContractFactory("PracticeVault")).deploy(usdc.target, "Practice USDC", "pUSDC", owner.address);
      await usdc.connect(alice).approve(vault.target, ethers.MaxUint256);
      await usdc.connect(bob).approve(vault.target, ethers.MaxUint256);
      await vault.connect(alice).deposit(1n, alice.address);
      await usdc.connect(alice).transfer(vault.target, U(10_000));
      await vault.connect(bob).deposit(U(1000), bob.address);
      const bobAssets = await vault.convertToAssets(await vault.balanceOf(bob.address));
      expect(bobAssets).to.be.gte(U(999));
    });
  });

  describe("PracticeSwap", function () {
    let pool;
    beforeEach(async function () {
      pool = await (await ethers.getContractFactory("PracticeSwap")).deploy(usdc.target, eurc.target, ethers.parseEther("0.86"), 10, owner.address);
      await usdc.connect(owner).approve(pool.target, ethers.MaxUint256);
      await eurc.connect(owner).approve(pool.target, ethers.MaxUint256);
      await pool.addLiquidity(U(10_000), U(10_000));
    });

    it("quotes both ways with the spread and pays from reserves", async function () {
      expect(await pool.quoteOut(usdc.target, U(100))).to.equal(U(85.914));
      expect(await pool.quoteOut(eurc.target, U(86))).to.equal(U(99.9));
      await usdc.connect(alice).approve(pool.target, ethers.MaxUint256);
      await expect(pool.connect(alice).swap(usdc.target, U(100), U(85.914), bob.address)).to.changeTokenBalance(eurc, bob, U(85.914));
      await expect(pool.connect(alice).swap(usdc.target, U(100), U(86), bob.address)).to.be.revertedWithCustomError(pool, "InsufficientOutput");
      await expect(pool.quoteOut(btc.target, 1)).to.be.revertedWithCustomError(pool, "BadToken");
      await expect(pool.connect(alice).swap(usdc.target, U(20_000), 0, bob.address)).to.be.revertedWithCustomError(pool, "InsufficientReserves");
      await expect(pool.setRate(0, 0)).to.be.revertedWithCustomError(pool, "BadRate");
      await expect(pool.setRate(1, 501)).to.be.revertedWithCustomError(pool, "BadRate");
    });
  });

  describe("PracticeLending", function () {
    let lend;
    beforeEach(async function () {
      // BTC at 100,000 USDC, LTV 70%, liquidation at 80%, 5% bonus
      lend = await (await ethers.getContractFactory("PracticeLending")).deploy(btc.target, usdc.target, 100_000n * 10n ** 8n, 7000, 8000, 500, owner.address);
      await usdc.connect(owner).approve(lend.target, ethers.MaxUint256);
      await usdc.mint(owner.address, U(500_000));
      await lend.fund(U(500_000));
      await btc.connect(alice).approve(lend.target, ethers.MaxUint256);
      await usdc.connect(alice).approve(lend.target, ethers.MaxUint256);
      await usdc.connect(bob).approve(lend.target, ethers.MaxUint256);
    });

    it("borrows within LTV and reports the health factor", async function () {
      await lend.connect(alice).supplyCollateral(B(1), alice.address);
      expect(await lend.collateralValue(alice.address)).to.equal(U(100_000));
      expect(await lend.maxBorrow(alice.address)).to.equal(U(70_000));
      await expect(lend.connect(alice).borrow(U(70_001), alice.address)).to.be.revertedWithCustomError(lend, "ExceedsLtv");
      await lend.connect(alice).borrow(U(50_000), alice.address);
      expect(await lend.healthFactor(alice.address)).to.equal(ethers.parseEther("1.6"));
      expect(await lend.healthFactorAfter(alice.address, 0, U(14_000))).to.equal(ethers.parseEther("1.25"));
      expect(await lend.healthFactorAfter(alice.address, -50_000_000n, 0)).to.equal(ethers.parseEther("0.8"));
      await expect(lend.connect(alice).withdrawCollateral(B(0.5), alice.address)).to.be.revertedWithCustomError(lend, "ExceedsLtv");
      await lend.connect(alice).repay(U(60_000), alice.address);
      expect(await lend.debtOf(alice.address)).to.equal(0);
      expect(await lend.healthFactor(alice.address)).to.equal(ethers.MaxUint256);
      await lend.connect(alice).withdrawCollateral(B(1), alice.address);
    });

    it("liquidates only unhealthy positions, with the bonus", async function () {
      await lend.connect(alice).supplyCollateral(B(1), alice.address);
      await lend.connect(alice).borrow(U(70_000), alice.address);
      await expect(lend.connect(bob).liquidate(alice.address, U(10_000))).to.be.revertedWithCustomError(lend, "Healthy");
      await lend.setPrice(80_000n * 10n ** 8n); // HF = 80000*0.8/70000 < 1
      expect(await lend.healthFactor(alice.address)).to.be.lt(ethers.parseEther("1"));
      const before = await btc.balanceOf(bob.address);
      await lend.connect(bob).liquidate(alice.address, U(10_000));
      // 10,000 USDC * 1.05 / 80,000 = 0.13125 BTC
      expect((await btc.balanceOf(bob.address)) - before).to.equal(B(0.13125));
      expect(await lend.debtOf(alice.address)).to.equal(U(60_000));
      await expect(lend.setParams(8000, 7000, 0)).to.be.revertedWithCustomError(lend, "BadParams");
    });
  });
});
