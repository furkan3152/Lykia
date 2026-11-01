"use strict";
// Stateful fuzz and invariant tests for LykiaAccount: caps (per call, rolling 24-30 h window, lifetime
// budget), sub-session charging up the chain, the Whistle and revocation. Each run replays a seeded
// random sequence of agent transfers, time jumps and owner actions against a reference model and
// checks, after every step, that the contract agrees with the model:
//   I1  an agent transfer succeeds iff the model says every cap in the chain allows it;
//   I2  a session's lifetime consumption never exceeds its budget, and equals the model's;
//   I3  a parent's consumption is at least the sum of its children's (spends are charged up the chain);
//   I4  with the Whistle blown, nothing but transfers to the owner ever succeeds;
//   I5  after revokeAll (or revoking a parent) no descendant can act again;
//   I6  the account's token balance only falls by what the model charged.
// Seeds are fixed so failures reproduce; set LYKIA_FUZZ_RUNS for longer runs.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const h = require("./helpers.cjs");

const U = (n) => BigInt(n) * 1_000_000n;
const BUCKET = 6 * 60 * 60;
const RUNS = Number(process.env.LYKIA_FUZZ_RUNS || 6);
const STEPS = 40;

/** Small deterministic PRNG (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference model of one session's limit on one token. */
class Model {
  constructor(perCall, daily, budget, parent = null) {
    Object.assign(this, { perCall, daily, budget, parent, consumed: 0n, spends: [], revoked: false });
  }
  windowUsed(bucket) {
    return this.spends.filter((s) => bucket - s.bucket < 5).reduce((n, s) => n + s.amount, 0n);
  }
  chain() {
    const out = [];
    for (let m = this; m; m = m.parent) out.push(m);
    return out;
  }
  allows(amount, bucket) {
    return this.chain().every((m) => !m.revoked && amount <= m.perCall && m.windowUsed(bucket) + amount <= m.daily && m.consumed + amount <= m.budget);
  }
  charge(amount, bucket) {
    for (const m of this.chain()) {
      m.consumed += amount;
      m.spends.push({ bucket, amount });
    }
  }
}

describe("LykiaAccount invariants (stateful fuzz)", function () {
  this.timeout(600000);

  async function fixture() {
    const [owner, agent, pup, payee, guardian] = await ethers.getSigners();
    const { usdc } = await h.deployTokens();
    const { account } = await h.deployAccount(owner, guardian.address);
    await usdc.mint(account.target, U(10_000_000));
    return { owner, agent, pup, payee, guardian, usdc, account };
  }

  async function bucketNow() {
    return Math.floor((await h.now()) / BUCKET);
  }

  for (let run = 0; run < RUNS; run++) {
    const seed = 0x1ce5 + run * 7919;
    it(`caps, sub-sessions and the Whistle agree with the model (seed ${seed})`, async function () {
      const r = rng(seed);
      const pick = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
      const { owner, agent, pup, payee, guardian, usdc, account } = await fixture();

      const perCall = U(pick(20, 120));
      const daily = perCall * BigInt(pick(1, 4));
      const budget = daily * BigInt(pick(1, 5));
      const validUntil = (await h.now()) + 60 * h.DAY;
      const rootId = await h.sessionIdFrom(account.connect(owner).createSession(h.spec({ key: agent.address, validUntil, maxCalls: 10_000, tokens: [h.limit(usdc, perCall, daily, budget)], recipients: [payee.address] })), account);
      const root = new Model(perCall, daily, budget);

      const childPer = perCall / 2n > 0n ? perCall / 2n : perCall;
      const childDaily = daily / 2n >= childPer ? daily / 2n : childPer;
      const childBudget = budget / 3n >= childDaily ? budget / 3n : childDaily;
      const childId = await h.sessionIdFrom(account.connect(agent).createSubSession(rootId, h.spec({ key: pup.address, validUntil, maxCalls: 5_000, tokens: [h.limit(usdc, childPer, childDaily, childBudget)], recipients: [payee.address] })), account);
      const child = new Model(childPer, childDaily, childBudget, root);

      let whistle = false;
      let balanceModel = await usdc.balanceOf(account.target);

      for (let step = 0; step < STEPS; step++) {
        const roll = r();
        if (roll < 0.12) {
          await time.increase(pick(1, 12) * 60 * 60);
          continue;
        }
        if (roll < 0.17) {
          if (whistle) await account.connect(owner).releaseWhistle();
          else await account.connect(r() < 0.5 ? owner : guardian).blowWhistle();
          whistle = !whistle;
          continue;
        }
        const useChild = r() < 0.4;
        const model = useChild ? child : root;
        const id = useChild ? childId : rootId;
        const signer = useChild ? pup : agent;
        const toOwner = r() < 0.25;
        const to = toOwner ? owner.address : payee.address;
        const amount = U(1) * BigInt(pick(1, Number(model.perCall / U(1)) + 15));
        const bucket = Math.floor(((await h.now()) + 1) / BUCKET);
        const tx = account.connect(signer).agentTransfer(id, usdc.target, to, amount, "0x");
        const expectOk = (!whistle || toOwner) && model.allows(amount, bucket);
        if (expectOk) {
          await expect(tx, `step ${step}`).to.emit(account, "AgentTransfer");
          // The bucket is read again after mining: the block may land in the next 6 h bucket.
          model.charge(amount, await bucketNow());
          balanceModel -= amount;
        } else {
          await expect(tx, `step ${step}`).to.be.reverted;
          if (whistle && !toOwner) await expect(account.connect(signer).agentTransfer(id, usdc.target, to, amount, "0x")).to.be.revertedWithCustomError(account, "WhistleBlownOnlyHomeward");
        }
        // I2, I3, I6
        const [, rootUsage] = await account.getLimit(rootId, usdc.target);
        const [, childUsage] = await account.getLimit(childId, usdc.target);
        expect(rootUsage.consumed).to.equal(root.consumed);
        expect(childUsage.consumed).to.equal(child.consumed);
        // the rolling window the contract reports matches the model's
        const nowBucket = await bucketNow();
        expect(rootUsage.dayAmount).to.equal(root.windowUsed(nowBucket));
        expect(childUsage.dayAmount).to.equal(child.windowUsed(nowBucket));
        expect(root.consumed <= root.budget && child.consumed <= child.budget).to.equal(true);
        expect(rootUsage.consumed >= childUsage.consumed).to.equal(true);
        expect(await usdc.balanceOf(account.target)).to.equal(balanceModel);
      }

      // I5: revoking the parent kills the child; revokeAll kills everything.
      if (whistle) await account.connect(owner).releaseWhistle();
      await account.connect(owner).revokeSession(rootId);
      await expect(account.connect(pup).agentTransfer(childId, usdc.target, owner.address, 1n, "0x")).to.be.revertedWithCustomError(account, "SessionInvalid");
      const freshId = await h.sessionIdFrom(account.connect(owner).createSession(h.spec({ key: agent.address, validUntil, tokens: [h.limit(usdc, U(10), U(10), U(10))], recipients: [] })), account);
      await account.connect(owner).revokeAll();
      await expect(account.connect(agent).agentTransfer(freshId, usdc.target, owner.address, 1n, "0x")).to.be.revertedWithCustomError(account, "SessionInvalid");
    });
  }

  it("fuzz: a sub-session can never be created looser than its parent", async function () {
    const r = rng(0xbeef);
    const pick = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    const { owner, agent, pup, payee, usdc, account } = await fixture();
    const validUntil = (await h.now()) + 10 * h.DAY;
    const rootId = await h.sessionIdFrom(account.connect(owner).createSession(h.spec({ key: agent.address, validUntil, maxCalls: 100, tokens: [h.limit(usdc, U(100), U(300), U(1000))], recipients: [payee.address] })), account);
    for (let i = 0; i < 30; i++) {
      const perCall = U(pick(1, 150));
      const daily = perCall + U(pick(0, 300));
      const budget = daily + U(pick(0, 1200));
      const until = validUntil + (r() < 0.2 ? pick(1, 1000) : -pick(0, 1000));
      const calls = r() < 0.15 ? 101 : pick(1, 100);
      const recipients = r() < 0.15 ? [owner.address] : [payee.address];
      const fits = perCall <= U(100) && daily <= U(300) && budget <= U(1000) && until <= validUntil && calls <= 100 && recipients[0] === payee.address;
      const tx = account.connect(agent).createSubSession(rootId, h.spec({ key: pup.address, validUntil: until, maxCalls: calls, tokens: [h.limit(usdc, perCall, daily, budget)], recipients }));
      if (fits) await expect(tx, `case ${i}`).to.emit(account, "SessionCreated");
      else await expect(tx, `case ${i}`).to.be.revertedWithCustomError(account, "BadSpec");
    }
  });
});
