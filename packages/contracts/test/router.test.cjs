"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const h = require("./helpers.cjs");

const U = (n) => ethers.parseUnits(String(n), 6);

describe("LykiaRouter", function () {
  let owner, user, integrator, recipient, stranger;
  let usdc, eurc, btc, venue, router;

  const swap = (tokenIn, amountIn, tokenOut, out) =>
    venue.interface.encodeFunctionData("swap", [tokenIn.target, amountIn, tokenOut.target, out, router.target]);
  const step = (tokenIn, amountIn, tokenOut, out, minOut, data) => ({
    venue: venue.target,
    tokenIn: tokenIn === h.NATIVE ? h.NATIVE : tokenIn.target,
    amountIn,
    tokenOut: tokenOut.target,
    minOut,
    data: data ?? swap(tokenIn, amountIn, tokenOut, out),
  });
  const intent = (over) => ({
    intentId: ethers.id("out_1"),
    tokenIn: usdc.target,
    amountIn: U(100),
    steps: [],
    recipient: recipient.address,
    minFinalOut: 0,
    integrator: ethers.ZeroAddress,
    feeBps: 0,
    ...over,
  });

  beforeEach(async function () {
    [owner, user, integrator, recipient, stranger] = await ethers.getSigners();
    ({ usdc, eurc, btc } = await h.deployTokens());
    venue = await (await ethers.getContractFactory("MockVenue")).deploy();
    router = await (await ethers.getContractFactory("LykiaRouter")).deploy(owner.address, [venue.target]);
    await usdc.mint(user.address, U(1000));
    await eurc.mint(venue.target, U(10_000));
    await usdc.mint(venue.target, U(10_000));
    await btc.mint(venue.target, 10n ** 9n);
    await usdc.connect(user).approve(router.target, ethers.MaxUint256);
  });

  it("runs one step, floors the output and sends everything to the recipient", async function () {
    const i = intent({ steps: [step(usdc, U(100), eurc, U(86), U(85))] });
    await expect(router.connect(user).run(i))
      .to.emit(router, "IntentStep")
      .withArgs(i.intentId, 0, venue.target, usdc.target, U(100), eurc.target, U(86))
      .and.to.emit(router, "IntentSettled");
    expect(await eurc.balanceOf(recipient.address)).to.equal(U(86));
    expect(await eurc.balanceOf(router.target)).to.equal(0);
    expect(await usdc.balanceOf(router.target)).to.equal(0);
    expect(await usdc.allowance(router.target, venue.target)).to.equal(0);
  });

  it("chains steps with amountIn 0 (use what the last step produced)", async function () {
    const s1 = step(usdc, U(100), eurc, U(86), U(86));
    const s2 = { ...step(eurc, 0, btc, 0n, 1000n), data: venue.interface.encodeFunctionData("swap", [eurc.target, U(86), btc.target, 1200n, router.target]) };
    await router.connect(user).run(intent({ steps: [s1, s2], minFinalOut: 1200n }));
    expect(await btc.balanceOf(recipient.address)).to.equal(1200n);
  });

  it("returns leftovers of intermediate tokens to the recipient", async function () {
    const s1 = step(usdc, U(60), eurc, U(50), U(50));
    await router.connect(user).run(intent({ steps: [s1] }));
    expect(await usdc.balanceOf(recipient.address)).to.equal(U(40));
    expect(await eurc.balanceOf(recipient.address)).to.equal(U(50));
  });

  it("takes a capped integrator fee from the final output", async function () {
    const i = intent({ steps: [step(usdc, U(100), eurc, U(100), U(100))], integrator: integrator.address, feeBps: 50 });
    await router.connect(user).run(i);
    expect(await eurc.balanceOf(integrator.address)).to.equal(U(0.5));
    expect(await eurc.balanceOf(recipient.address)).to.equal(U(99.5));
    await expect(router.connect(user).run({ ...i, feeBps: 51 })).to.be.revertedWithCustomError(router, "FeeTooHigh");
    await expect(router.connect(user).run({ ...i, integrator: ethers.ZeroAddress })).to.be.revertedWithCustomError(router, "BadIntent");
  });

  it("enforces step and final floors", async function () {
    await expect(router.connect(user).run(intent({ steps: [step(usdc, U(100), eurc, U(80), U(85))] }))).to.be.revertedWithCustomError(router, "InsufficientOutput");
    await expect(router.connect(user).run(intent({ steps: [step(usdc, U(100), eurc, U(86), 0n)] }))).to.be.revertedWithCustomError(router, "BadIntent");
    await expect(router.connect(user).run(intent({ steps: [step(usdc, U(100), eurc, U(86), U(80))], minFinalOut: U(87) }))).to.be.revertedWithCustomError(router, "FinalOutputTooLow");
  });

  it("refuses unknown venues, value-moving selectors, bad shapes and works only unpaused", async function () {
    const other = await (await ethers.getContractFactory("MockVenue")).deploy();
    const s = { ...step(usdc, U(10), eurc, U(9), U(9)), venue: other.target };
    await expect(router.connect(user).run(intent({ amountIn: U(10), steps: [s] }))).to.be.revertedWithCustomError(router, "VenueNotAllowed");
    await router.setVenue(usdc.target, true);
    const drain = { venue: usdc.target, tokenIn: usdc.target, amountIn: U(10), tokenOut: eurc.target, minOut: 1n, data: usdc.interface.encodeFunctionData("transfer", [stranger.address, U(10)]) };
    await expect(router.connect(user).run(intent({ amountIn: U(10), steps: [drain] }))).to.be.revertedWithCustomError(router, "ForbiddenCall");
    await expect(router.connect(user).run(intent({ steps: [] }))).to.be.revertedWithCustomError(router, "BadIntent");
    await expect(router.connect(user).run(intent({ steps: [step(usdc, U(100), eurc, U(86), U(85))], recipient: ethers.ZeroAddress }))).to.be.revertedWithCustomError(router, "BadIntent");
    await expect(router.connect(user).run(intent({ steps: [step(usdc, U(100), eurc, U(86), U(85))] }), { value: 1n })).to.be.revertedWithCustomError(router, "BadIntent");
    await expect(router.connect(stranger).setVenue(venue.target, false)).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    await router.pause();
    await expect(router.connect(user).run(intent({ steps: [step(usdc, U(100), eurc, U(86), U(85))] }))).to.be.revertedWithCustomError(router, "EnforcedPause");
  });

  it("takes native input as value", async function () {
    const data = venue.interface.encodeFunctionData("swapNative", [eurc.target, U(3), router.target]);
    const s = { venue: venue.target, tokenIn: h.NATIVE, amountIn: 0, tokenOut: eurc.target, minOut: U(3), data };
    await router.connect(user).run(intent({ tokenIn: h.NATIVE, amountIn: ethers.parseEther("1"), steps: [s] }), { value: ethers.parseEther("1") });
    expect(await eurc.balanceOf(recipient.address)).to.equal(U(3));
    expect(await ethers.provider.getBalance(venue.target)).to.equal(ethers.parseEther("1"));
  });

  it("never sweeps tokens that were already sitting in the router", async function () {
    await eurc.mint(router.target, U(5));
    await router.connect(user).run(intent({ steps: [step(usdc, U(100), eurc, U(86), U(85))] }));
    expect(await eurc.balanceOf(recipient.address)).to.equal(U(86));
    expect(await eurc.balanceOf(router.target)).to.equal(U(5));
    await router.rescue(eurc.target, owner.address, U(5));
    expect(await eurc.balanceOf(owner.address)).to.equal(U(5));
  });

  it("cannot be re-entered by a venue", async function () {
    const re = await (await ethers.getContractFactory("Reenterer")).deploy();
    await router.setVenue(re.target, true);
    const inner = intent({ steps: [step(usdc, U(1), eurc, U(1), U(1))] });
    await re.arm(router.target, router.interface.encodeFunctionData("run", [inner]));
    const s = { venue: re.target, tokenIn: usdc.target, amountIn: U(1), tokenOut: eurc.target, minOut: 1n, data: re.interface.encodeFunctionData("poke") };
    await expect(router.connect(user).run(intent({ amountIn: U(1), steps: [s] }))).to.be.revertedWithCustomError(router, "ReentrancyGuardReentrantCall");
  });

  it("works from a LykiaAccount session (account -> router)", async function () {
    const [accOwner, agent] = [owner, stranger];
    const { account } = await h.deployAccount(accOwner);
    await usdc.mint(account.target, U(500));
    const runSel = router.interface.getFunction("run").selector;
    // recipient lives in the tuple's dynamic part, so the router call is only allowlisted when the
    // account checks the intent recipient off-chain; this test pins the cap accounting.
    const s = h.spec({ key: agent.address, validUntil: (await h.now()) + h.DAY, tokens: [h.limit(usdc, U(100), U(200))], calls: [h.rule(router, runSel)] });
    const id = await h.sessionIdFrom(account.connect(accOwner).createSession(s), account);
    const i = intent({ steps: [step(usdc, U(100), eurc, U(86), U(85))], recipient: account.target });
    const data = router.interface.encodeFunctionData("run", [i]);
    await account.connect(agent).agentExecute(h.call(id, router, data, { spendToken: usdc.target, spendAmount: U(100) }));
    expect(await eurc.balanceOf(account.target)).to.equal(U(86));
    const [, usage] = await account.getLimit(id, usdc.target);
    expect(usage.consumed).to.equal(U(100));
  });
});
