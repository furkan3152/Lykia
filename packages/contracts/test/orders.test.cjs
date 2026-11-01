"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const h = require("./helpers.cjs");

const U = (n) => ethers.parseUnits(String(n), 6);
const P = (n) => ethers.parseUnits(String(n), 8);
const KIND = { LIMIT: 0, STOP_LOSS: 1, TAKE_PROFIT: 2, DCA: 3, TWAP: 4 };

const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "maxTip", type: "uint256" },
    { name: "maxFeeBps", type: "uint16" },
    { name: "oracle", type: "address" },
    { name: "triggerPrice", type: "int256" },
    { name: "triggerAbove", type: "bool" },
    { name: "maxOracleAge", type: "uint32" },
    { name: "kind", type: "uint8" },
    { name: "executions", type: "uint32" },
    { name: "interval", type: "uint32" },
    { name: "startTime", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};

describe("LykiaOrders", function () {
  let owner, maker, keeper, treasury, other, usdc, eurc, venue, router, feed, orders, domain;

  beforeEach(async function () {
    [owner, maker, keeper, treasury, other] = await ethers.getSigners();
    ({ usdc, eurc } = await h.deployTokens());
    venue = await (await ethers.getContractFactory("MockVenue")).deploy();
    router = await (await ethers.getContractFactory("LykiaRouter")).deploy(owner.address, [venue.target]);
    feed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(8, P("1.10"));
    orders = await (await ethers.getContractFactory("LykiaOrders")).deploy(owner.address, router.target, 100, treasury.address);
    await usdc.mint(maker.address, U(10_000));
    await eurc.mint(venue.target, U(100_000));
    await usdc.connect(maker).approve(orders.target, ethers.MaxUint256);
    const { chainId } = await ethers.provider.getNetwork();
    domain = { name: "LykiaOrders", version: "1", chainId, verifyingContract: orders.target };
  });

  async function order(over = {}) {
    const t = await h.now();
    return {
      maker: maker.address,
      tokenIn: usdc.target,
      tokenOut: eurc.target,
      amountIn: U(100),
      minAmountOut: U(85),
      maxTip: U(0.5),
      maxFeeBps: 100,
      oracle: feed.target,
      triggerPrice: P("1.09"),
      triggerAbove: false,
      maxOracleAge: 3600,
      kind: KIND.LIMIT,
      executions: 1,
      interval: 0,
      startTime: t - 10,
      deadline: t + 7 * h.DAY,
      nonce: 1,
      ...over,
    };
  }

  const sign = (o, signer = maker) => signer.signTypedData(domain, ORDER_TYPES, o);

  /** One router step selling exactly what the order contract forwards; `out` EURC to `receiver`. */
  function route(o, tip, out, receiver = router.target, v = venue) {
    const rest = o.amountIn - (o.amountIn * 100n) / 10_000n - tip;
    const data = venue.interface.encodeFunctionData("swap", [usdc.target, rest, eurc.target, out, receiver]);
    return [{ venue: v.target, tokenIn: usdc.target, amountIn: 0, tokenOut: eurc.target, minOut: 1, data }];
  }

  it("matches the EIP-712 digest the maker signs", async function () {
    const o = await order();
    expect(await orders.digest(o)).to.equal(ethers.TypedDataEncoder.hash(domain, ORDER_TYPES, o));
  });

  it("executes a limit order when the trigger holds: fee to treasury, tip to keeper, output to maker", async function () {
    const o = await order();
    await feed.set(P("1.08"));
    const tip = U(0.2);
    await expect(orders.connect(keeper).execute(o, await sign(o), route(o, tip, U(90)), tip)).to.emit(orders, "OrderExecuted");
    expect(await eurc.balanceOf(maker.address)).to.equal(U(90));
    expect(await usdc.balanceOf(treasury.address)).to.equal(U(1));
    expect(await usdc.balanceOf(keeper.address)).to.equal(tip);
    expect(await usdc.balanceOf(maker.address)).to.equal(U(9_900));
    expect(await usdc.balanceOf(orders.target)).to.equal(0);
    expect(await usdc.balanceOf(router.target)).to.equal(0);
    await expect(orders.connect(keeper).execute(o, await sign(o), route(o, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "NotActive");
  });

  it("refuses an unmet trigger and a stale price", async function () {
    const o = await order();
    await expect(orders.execute(o, await sign(o), route(o, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "ConditionNotMet");
    await feed.setAt(P("1.05"), (await h.now()) - 7200);
    await expect(orders.execute(o, await sign(o), route(o, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "StalePrice");
    const [ok, reason] = await orders.canExecute(o);
    expect(ok).to.equal(false);
    expect(reason).to.equal("stale price");
  });

  it("refuses tampered orders and foreign signatures", async function () {
    const o = await order();
    await feed.set(P("1.08"));
    const sig = await sign(o);
    await expect(orders.execute({ ...o, minAmountOut: 1 }, sig, route(o, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "BadSignature");
    await expect(orders.execute(o, await sign(o, other), route(o, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "BadSignature");
  });

  it("keeps the maker whole: a route below the floor or one that pays someone else reverts", async function () {
    const o = await order();
    await feed.set(P("1.08"));
    const sig = await sign(o);
    await expect(orders.execute(o, sig, route(o, 0n, U(80)), 0)).to.be.revertedWithCustomError(router, "FinalOutputTooLow");
    // Front-running keeper tries to route the output to itself.
    await expect(orders.connect(keeper).execute(o, sig, route(o, 0n, U(90), keeper.address), 0)).to.be.reverted;
    expect(await eurc.balanceOf(keeper.address)).to.equal(0);
    expect(await usdc.balanceOf(maker.address)).to.equal(U(10_000));
  });

  it("bounds the keeper tip and the fee", async function () {
    const o = await order();
    await feed.set(P("1.08"));
    const sig = await sign(o);
    await expect(orders.execute(o, sig, route(o, U(0.6), U(90)), U(0.6))).to.be.revertedWithCustomError(orders, "TipTooHigh");
    const big = await order({ maxTip: U(5), nonce: 2 });
    await expect(orders.execute(big, await sign(big), route(big, U(2), U(90)), U(2))).to.be.revertedWithCustomError(orders, "TipTooHigh");
    await orders.setFee(150, treasury.address);
    await expect(orders.execute(o, sig, route(o, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "FeeTooHigh");
    await expect(orders.setFee(301, treasury.address)).to.be.revertedWithCustomError(orders, "FeeTooHigh");
    await expect(orders.connect(other).setFee(10, other.address)).to.be.revertedWithCustomError(orders, "OwnableUnauthorizedAccount");
  });

  it("runs TWAP slices on their interval and stops when filled", async function () {
    const o = await order({ kind: KIND.TWAP, executions: 3, interval: 3600, oracle: ethers.ZeroAddress, triggerPrice: 0, maxOracleAge: 0, amountIn: U(50), minAmountOut: U(40) });
    const sig = await sign(o);
    const r = route(o, 0n, U(44));
    await orders.connect(keeper).execute(o, sig, r, 0);
    await expect(orders.connect(keeper).execute(o, sig, r, 0)).to.be.revertedWithCustomError(orders, "NotActive").withArgs("interval");
    await time.increase(3600);
    await orders.connect(keeper).execute(o, sig, r, 0);
    await time.increase(3600);
    await orders.connect(keeper).execute(o, sig, r, 0);
    await time.increase(3600);
    await expect(orders.connect(keeper).execute(o, sig, r, 0)).to.be.revertedWithCustomError(orders, "NotActive").withArgs("filled");
    expect(await eurc.balanceOf(maker.address)).to.equal(U(132));
    const st = await orders.states(await orders.hashOrder(o));
    expect(st.executed).to.equal(3);
  });

  it("lets only the maker cancel, honours nonce floors, start and deadline", async function () {
    const o = await order();
    await feed.set(P("1.08"));
    const sig = await sign(o);
    await expect(orders.connect(other).cancel(o)).to.be.revertedWithCustomError(orders, "NotMaker");
    await orders.connect(maker).cancel(o);
    await expect(orders.execute(o, sig, route(o, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "NotActive").withArgs("cancelled");

    const n = await order({ nonce: 5 });
    await orders.connect(maker).invalidateNonces(6);
    await expect(orders.execute(n, await sign(n), route(n, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "NotActive").withArgs("nonce");

    const later = await order({ nonce: 7, startTime: (await h.now()) + 1000 });
    await expect(orders.execute(later, await sign(later), route(later, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "NotActive").withArgs("not started");

    const soon = await order({ nonce: 8, deadline: (await h.now()) + 100 });
    const soonSig = await sign(soon);
    await time.increase(200);
    await feed.set(P("1.08"));
    await expect(orders.execute(soon, soonSig, route(soon, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "NotActive").withArgs("expired");
  });

  it("validates order shapes and the route ends", async function () {
    await feed.set(P("1.08"));
    const multiLimit = await order({ executions: 2 });
    await expect(orders.execute(multiLimit, await sign(multiLimit), route(multiLimit, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "BadOrder").withArgs("executions");
    const stopNoOracle = await order({ kind: KIND.STOP_LOSS, oracle: ethers.ZeroAddress });
    await expect(orders.execute(stopNoOracle, await sign(stopNoOracle), route(stopNoOracle, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "BadOrder").withArgs("trigger");
    const o = await order();
    const wrongEnd = route(o, 0n, U(90)).map((s) => ({ ...s, tokenOut: usdc.target }));
    await expect(orders.execute(o, await sign(o), wrongEnd, 0)).to.be.revertedWithCustomError(orders, "BadRoute");
  });

  it("only routes through the router's allowlisted venues", async function () {
    const rogue = await (await ethers.getContractFactory("MockVenue")).deploy();
    await eurc.mint(rogue.target, U(1_000));
    const o = await order();
    await feed.set(P("1.08"));
    await expect(orders.execute(o, await sign(o), route(o, 0n, U(90), router.target, rogue), 0)).to.be.revertedWithCustomError(router, "VenueNotAllowed");
  });

  it("cannot be re-entered through a venue", async function () {
    const re = await (await ethers.getContractFactory("Reenterer")).deploy();
    await router.setVenue(re.target, true);
    const o = await order();
    await feed.set(P("1.08"));
    const sig = await sign(o);
    const payload = orders.interface.encodeFunctionData("execute", [o, sig, route(o, 0n, U(90)), 0]);
    await re.arm(orders.target, payload);
    const step = [{ venue: re.target, tokenIn: usdc.target, amountIn: 0, tokenOut: eurc.target, minOut: 1, data: re.interface.encodeFunctionData("poke") }];
    await expect(orders.execute(o, sig, step, 0)).to.be.reverted;
    expect(await usdc.balanceOf(maker.address)).to.equal(U(10_000));
  });

  it("stops while paused", async function () {
    const o = await order();
    await feed.set(P("1.08"));
    await orders.pause();
    await expect(orders.execute(o, await sign(o), route(o, 0n, U(90)), 0)).to.be.revertedWithCustomError(orders, "EnforcedPause");
    await orders.unpause();
    await orders.execute(o, await sign(o), route(o, 0n, U(90)), 0);
  });
});
