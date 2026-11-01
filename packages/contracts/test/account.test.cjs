"use strict";
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const h = require("./helpers.cjs");

const U = (n) => ethers.parseUnits(String(n), 6);

describe("LykiaAccount", function () {
  let owner, guardian, agent, agent2, stranger, relayer, payee;
  let usdc, eurc, btc, account, factory, venue, swapSel, sinkSel, payNativeSel;

  async function rootSession(over = {}) {
    const validUntil = over.validUntil ?? (await h.now()) + 30 * h.DAY;
    const s = h.spec({
      key: over.key ?? agent.address,
      validUntil,
      maxCalls: over.maxCalls,
      tokens: over.tokens ?? [h.limit(usdc, U(100), U(300), U(1000)), h.limit(eurc, U(100), U(300), U(1000))],
      calls: over.calls ?? [h.rule(venue, swapSel, 1 << 4)],
      recipients: over.recipients ?? [payee.address],
    });
    return h.sessionIdFrom(account.connect(owner).createSession(s), account);
  }

  function swapData(tokenIn, amountIn, tokenOut, out, receiver) {
    return venue.interface.encodeFunctionData("swap", [tokenIn.target, amountIn, tokenOut.target, out, receiver]);
  }

  beforeEach(async function () {
    [owner, guardian, agent, agent2, stranger, relayer, payee] = await ethers.getSigners();
    ({ usdc, eurc, btc } = await h.deployTokens());
    ({ account, factory } = await h.deployAccount(owner, guardian.address));
    venue = await (await ethers.getContractFactory("MockVenue")).deploy();
    swapSel = venue.interface.getFunction("swap").selector;
    sinkSel = venue.interface.getFunction("sink").selector;
    payNativeSel = venue.interface.getFunction("payNative").selector;
    await usdc.mint(account.target, U(10_000));
    await eurc.mint(venue.target, U(10_000));
    await usdc.mint(venue.target, U(10_000));
  });

  describe("setup", function () {
    it("is initialized once, by the factory only", async function () {
      expect(await account.owner()).to.equal(owner.address);
      expect(await account.guardian()).to.equal(guardian.address);
      await expect(account.initialize(stranger.address, stranger.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(account, "NotFactory");
      const impl = await ethers.getContractAt("LykiaAccount", await factory.implementation());
      expect(await impl.owner()).to.equal(ethers.ZeroAddress);
    });

    it("lets the owner execute and withdraw, nobody else", async function () {
      await expect(account.connect(owner).withdraw(usdc.target, U(5))).to.changeTokenBalance(usdc, owner, U(5));
      await expect(account.connect(stranger).withdraw(usdc.target, 1)).to.be.revertedWithCustomError(account, "NotOwner");
      const data = usdc.interface.encodeFunctionData("transfer", [payee.address, U(1)]);
      await expect(account.connect(owner).execute(usdc.target, 0, data)).to.changeTokenBalance(usdc, payee, U(1));
      await expect(account.connect(stranger).execute(usdc.target, 0, data)).to.be.revertedWithCustomError(account, "NotOwner");
    });

    it("refuses malformed sessions", async function () {
      const t = (await h.now()) + h.DAY;
      const base = { key: agent.address, validUntil: t };
      await expect(account.connect(stranger).createSession(h.spec(base))).to.be.revertedWithCustomError(account, "NotOwner");
      await expect(account.connect(owner).createSession(h.spec({ ...base, validUntil: 1 }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, key: owner.address }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, maxCalls: 0 }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, tokens: [h.limit(usdc, U(10), U(5), U(100))] }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, tokens: [h.limit(usdc, U(1), U(5), U(4))] }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, tokens: [h.limit(usdc, 1, 1, 1), h.limit(usdc, 1, 1, 1)] }))).to.be.revertedWithCustomError(account, "BadSpec");
      // value-moving selectors and EOAs are never allowlisted
      await expect(account.connect(owner).createSession(h.spec({ ...base, calls: [h.rule(usdc, "0x095ea7b3")] }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, calls: [h.rule(usdc, "0xa9059cbb")] }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, calls: [h.rule(stranger.address, swapSel)] }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, calls: [h.rule(account.target, swapSel)] }))).to.be.revertedWithCustomError(account, "BadSpec");
      await expect(account.connect(owner).createSession(h.spec({ ...base, calls: [h.rule(venue, swapSel, 1 << 16)] }))).to.be.revertedWithCustomError(account, "BadSpec");
    });
  });

  describe("agent calls", function () {
    it("runs an allowlisted call, charges what left, resets the allowance and logs the memo", async function () {
      const id = await rootSession();
      const memo = ethers.toUtf8Bytes("lykia:1:out_1:s1:sha256:abcd");
      const c = h.call(id, venue, swapData(usdc, U(50), eurc, U(43), account.target), { spendToken: usdc.target, spendAmount: U(50), memo });
      await expect(account.connect(agent).agentExecute(c))
        .to.emit(account, "AgentCall")
        .withArgs(id, venue.target, swapSel, 0, ethers.keccak256(memo))
        .and.to.emit(account, "AgentMemo")
        .and.to.emit(account, "Charged")
        .withArgs(id, usdc.target, U(50));
      expect(await eurc.balanceOf(account.target)).to.equal(U(43));
      expect(await usdc.allowance(account.target, venue.target)).to.equal(0);
      const [, usage] = await account.getLimit(id, usdc.target);
      expect(usage.dayAmount).to.equal(U(50));
      expect(usage.consumed).to.equal(U(50));
      expect((await account.getSession(id)).callsUsed).to.equal(1);
    });

    it("forces outputs back to the account (receiver words)", async function () {
      const id = await rootSession();
      const c = h.call(id, venue, swapData(usdc, U(10), eurc, U(9), agent.address), { spendToken: usdc.target, spendAmount: U(10) });
      await expect(account.connect(agent).agentExecute(c)).to.be.revertedWithCustomError(account, "ReceiverMismatch").withArgs(4);
      const short = h.call(id, venue, swapSel, { spendToken: usdc.target, spendAmount: U(10) });
      await expect(account.connect(agent).agentExecute(short)).to.be.revertedWithCustomError(account, "ReceiverMismatch");
    });

    it("refuses strangers, unlisted calls and unlisted spend tokens", async function () {
      const id = await rootSession();
      const c = h.call(id, venue, swapData(usdc, U(10), eurc, U(9), account.target), { spendToken: usdc.target, spendAmount: U(10) });
      await expect(account.connect(stranger).agentExecute(c)).to.be.revertedWithCustomError(account, "NotSessionKey");
      const sink = h.call(id, venue, sinkSel);
      await expect(account.connect(agent).agentExecute(sink)).to.be.revertedWithCustomError(account, "CallNotAllowed");
      await btc.mint(account.target, 10n ** 8n);
      const btcSpend = h.call(id, venue, swapData(btc, 1000n, eurc, 1n, account.target), { spendToken: btc.target, spendAmount: 1000n });
      await expect(account.connect(agent).agentExecute(btcSpend)).to.be.revertedWithCustomError(account, "TokenNotAllowed");
      await expect(account.connect(agent).agentExecute(h.call(id, venue, "0x01"))).to.be.revertedWithCustomError(account, "CallNotAllowed");
    });

    it("an exact allowance stops a greedy venue", async function () {
      const greedySel = venue.interface.getFunction("greedy").selector;
      const id = await rootSession({ calls: [h.rule(venue, greedySel)] });
      const data = venue.interface.encodeFunctionData("greedy", [usdc.target, U(10)]);
      await expect(account.connect(agent).agentExecute(h.call(id, venue, data, { spendToken: usdc.target, spendAmount: U(10) }))).to.be.reverted;
      expect(await usdc.balanceOf(account.target)).to.equal(U(10_000));
    });

    it("enforces per-call, daily (rolling to the next day) and lifetime caps", async function () {
      const id = await rootSession();
      const swap = (amt) => h.call(id, venue, swapData(usdc, amt, eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: amt });
      await expect(account.connect(agent).agentExecute(swap(U(101)))).to.be.revertedWithCustomError(account, "PerCallCapExceeded");
      for (let i = 0; i < 3; i++) await account.connect(agent).agentExecute(swap(U(100)));
      await expect(account.connect(agent).agentExecute(swap(U(1)))).to.be.revertedWithCustomError(account, "DailyCapExceeded");
      expect(await account.spendable(id, usdc.target)).to.equal(0);
      await time.increase(h.DAY);
      expect(await account.spendable(id, usdc.target)).to.equal(U(100));
      for (let i = 0; i < 3; i++) await account.connect(agent).agentExecute(swap(U(100)));
      await time.increase(h.DAY);
      for (let i = 0; i < 3; i++) await account.connect(agent).agentExecute(swap(U(100)));
      await time.increase(h.DAY);
      // 900 consumed of a 1000 budget
      await account.connect(agent).agentExecute(swap(U(100)));
      await expect(account.connect(agent).agentExecute(swap(U(1)))).to.be.revertedWithCustomError(account, "BudgetExceeded");
    });

    it("stops at maxCalls and at expiry", async function () {
      const id = await rootSession({ maxCalls: 1 });
      const swap = h.call(id, venue, swapData(usdc, U(1), eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: U(1) });
      await account.connect(agent).agentExecute(swap);
      await expect(account.connect(agent).agentExecute(swap)).to.be.revertedWithCustomError(account, "CallsExhausted");
      const id2 = await rootSession({ key: agent2.address, validUntil: (await h.now()) + 100 });
      await time.increase(200);
      const swap2 = { ...swap, sessionId: id2 };
      await expect(account.connect(agent2).agentExecute(swap2)).to.be.revertedWithCustomError(account, "SessionInvalid");
    });

    it("charges native value to the native cap, and refuses it without one", async function () {
      await owner.sendTransaction({ to: account.target, value: ethers.parseEther("10") });
      const id = await rootSession({ tokens: [h.limit(h.NATIVE, ethers.parseEther("1"), ethers.parseEther("2"))], calls: [h.rule(venue, sinkSel)] });
      await account.connect(agent).agentExecute(h.call(id, venue, sinkSel, { value: ethers.parseEther("1") }));
      const [, usage] = await account.getLimit(id, h.NATIVE);
      expect(usage.consumed).to.equal(ethers.parseEther("1"));
      await expect(account.connect(agent).agentExecute(h.call(id, venue, sinkSel, { value: ethers.parseEther("1.5") }))).to.be.revertedWithCustomError(account, "PerCallCapExceeded");
      const id2 = await rootSession({ key: agent2.address, calls: [h.rule(venue, sinkSel)] });
      await expect(account.connect(agent2).agentExecute(h.call(id2, venue, sinkSel, { value: 1n }))).to.be.revertedWithCustomError(account, "TokenNotAllowed");
    });

    it("on Arc, charges native spends to the USDC face, rounded up to 6 decimals", async function () {
      const arc = await h.deployAccount(owner, ethers.ZeroAddress, usdc.target, ethers.id("arc"));
      await owner.sendTransaction({ to: arc.account.target, value: ethers.parseEther("1") });
      const s = h.spec({ key: agent.address, validUntil: (await h.now()) + h.DAY, tokens: [h.limit(usdc, U(10), U(10))], calls: [h.rule(venue, sinkSel)] });
      const id = await h.sessionIdFrom(arc.account.connect(owner).createSession(s), arc.account);
      await arc.account.connect(agent).agentExecute(h.call(id, venue, sinkSel, { value: 10n ** 12n + 1n }));
      const [, usage] = await arc.account.getLimit(id, usdc.target);
      expect(usage.consumed).to.equal(2n);
      await expect(arc.account.connect(agent).agentTransfer(id, h.NATIVE, owner.address, ethers.parseEther("0.000003"), "0x"))
        .to.emit(arc.account, "Charged")
        .withArgs(id, usdc.target, 3n);
    });

    it("measures native coming in vs going out (no charge for receipts)", async function () {
      await owner.sendTransaction({ to: venue.target, value: ethers.parseEther("1") });
      const id = await rootSession({ calls: [h.rule(venue, payNativeSel, 1)] });
      const data = venue.interface.encodeFunctionData("payNative", [account.target, ethers.parseEther("0.5")]);
      await expect(account.connect(agent).agentExecute(h.call(id, venue, data))).to.not.emit(account, "Charged");
    });
  });

  describe("transfers", function () {
    it("pays allowlisted recipients and the owner, nobody else", async function () {
      const id = await rootSession();
      await expect(account.connect(agent).agentTransfer(id, usdc.target, payee.address, U(20), ethers.toUtf8Bytes("invoice 12")))
        .to.emit(account, "AgentTransfer")
        .withArgs(id, usdc.target, payee.address, U(20), ethers.keccak256(ethers.toUtf8Bytes("invoice 12")));
      await expect(account.connect(agent).agentTransfer(id, usdc.target, owner.address, U(20), "0x")).to.changeTokenBalance(usdc, owner, U(20));
      await expect(account.connect(agent).agentTransfer(id, usdc.target, stranger.address, U(1), "0x")).to.be.revertedWithCustomError(account, "RecipientNotAllowed");
      await expect(account.connect(agent).agentTransfer(id, usdc.target, payee.address, U(101), "0x")).to.be.revertedWithCustomError(account, "PerCallCapExceeded");
      await expect(account.connect(agent).agentTransfer(id, btc.target, payee.address, 1n, "0x")).to.be.revertedWithCustomError(account, "TokenNotAllowed");
    });
  });

  describe("whistle", function () {
    it("stops everything but homeward moves; only the owner releases it", async function () {
      const repaySel = venue.interface.getFunction("swapNative").selector; // stands in for a homeward call
      const id = await rootSession({ calls: [h.rule(venue, swapSel, 1 << 4), h.rule(venue, repaySel, 1 << 2, true)] });
      await expect(account.connect(stranger).blowWhistle()).to.be.revertedWithCustomError(account, "NotGuardianOrOwner");
      await expect(account.connect(guardian).blowWhistle()).to.emit(account, "WhistleBlown").withArgs(guardian.address);
      const swap = h.call(id, venue, swapData(usdc, U(1), eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: U(1) });
      await expect(account.connect(agent).agentExecute(swap)).to.be.revertedWithCustomError(account, "WhistleBlownOnlyHomeward");
      await expect(account.connect(agent).agentTransfer(id, usdc.target, payee.address, U(1), "0x")).to.be.revertedWithCustomError(account, "WhistleBlownOnlyHomeward");
      await expect(account.connect(agent).agentTransfer(id, usdc.target, owner.address, U(1), "0x")).to.changeTokenBalance(usdc, owner, U(1));
      const home = venue.interface.encodeFunctionData("swapNative", [eurc.target, 0, account.target]);
      await expect(account.connect(agent).agentExecute(h.call(id, venue, home))).to.emit(account, "AgentCall");
      await expect(account.connect(guardian).releaseWhistle()).to.be.revertedWithCustomError(account, "NotOwner");
      await account.connect(owner).releaseWhistle();
      await expect(account.connect(agent).agentExecute(swap)).to.emit(account, "AgentCall");
    });

    it("the owner still acts while the whistle is blown", async function () {
      await account.connect(owner).blowWhistle();
      await expect(account.connect(owner).withdraw(usdc.target, U(1))).to.changeTokenBalance(usdc, owner, U(1));
    });
  });

  describe("revocation", function () {
    it("revokes one session or all of them", async function () {
      const id = await rootSession();
      const id2 = await rootSession({ key: agent2.address });
      await expect(account.connect(stranger).revokeSession(id)).to.be.revertedWithCustomError(account, "NotAncestor");
      await account.connect(owner).revokeSession(id);
      expect(await account.isSessionValid(id)).to.equal(false);
      expect(await account.isSessionValid(id2)).to.equal(true);
      await account.connect(owner).revokeAll();
      expect(await account.isSessionValid(id2)).to.equal(false);
      const swap = h.call(id2, venue, swapData(usdc, U(1), eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: U(1) });
      await expect(account.connect(agent2).agentExecute(swap)).to.be.revertedWithCustomError(account, "SessionInvalid");
    });
  });

  describe("sub-agents", function () {
    let parentId, until;
    beforeEach(async function () {
      until = (await h.now()) + 10 * h.DAY;
      parentId = await rootSession({ validUntil: until, maxCalls: 10 });
    });

    function child(over = {}) {
      return h.spec({
        key: over.key ?? agent2.address,
        validUntil: over.validUntil ?? until,
        maxCalls: over.maxCalls ?? 5,
        tokens: over.tokens ?? [h.limit(usdc, U(50), U(200), U(400))],
        calls: over.calls ?? [h.rule(venue, swapSel, 1 << 4)],
        recipients: over.recipients ?? [],
      });
    }

    it("a session key issues a sub-session inside its own limits", async function () {
      const kid = await h.sessionIdFrom(account.connect(agent).createSubSession(parentId, child()), account);
      const s = await account.getSession(kid);
      expect(s.parent).to.equal(parentId);
      expect(s.depth).to.equal(1);
      await expect(account.connect(stranger).createSubSession(parentId, child())).to.be.revertedWithCustomError(account, "NotSessionKey");
    });

    it("refuses every limit that does not fit inside the parent", async function () {
      const bad = [
        child({ validUntil: until + 1 }),
        child({ maxCalls: 11 }),
        child({ tokens: [h.limit(btc, 1, 1, 1)] }),
        child({ tokens: [h.limit(usdc, U(101), U(200), U(400))] }),
        child({ tokens: [h.limit(usdc, U(50), U(301), U(400))] }),
        child({ tokens: [h.limit(usdc, U(50), U(200), U(1001))] }),
        child({ calls: [h.rule(venue, sinkSel)] }),
        child({ calls: [h.rule(venue, swapSel, 0)] }),
        child({ calls: [h.rule(venue, swapSel, 1 << 4, true)] }),
        child({ recipients: [stranger.address] }),
      ];
      for (const b of bad) await expect(account.connect(agent).createSubSession(parentId, b)).to.be.revertedWithCustomError(account, "BadSpec");
      // stronger receiver checks and a listed recipient are fine
      await account.connect(agent).createSubSession(parentId, child({ calls: [h.rule(venue, swapSel, (1 << 4) | 1)], recipients: [payee.address] }));
    });

    it("carves budgets from what the parent has left", async function () {
      const swap = (id, amt) => h.call(id, venue, swapData(usdc, amt, eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: amt });
      for (let i = 0; i < 3; i++) {
        await account.connect(agent).agentExecute(swap(parentId, U(100)));
        await time.increase(h.DAY);
      }
      // parent consumed 300 of 1000: a child can get at most 700
      await expect(account.connect(agent).createSubSession(parentId, child({ tokens: [h.limit(usdc, U(50), U(200), U(701))] }))).to.be.revertedWithCustomError(account, "BadSpec");
      await account.connect(agent).createSubSession(parentId, child({ tokens: [h.limit(usdc, U(50), U(200), U(700))] }));
    });

    it("charges the whole chain, so siblings share the parent's daily cap", async function () {
      const a = await h.sessionIdFrom(account.connect(agent).createSubSession(parentId, child({ tokens: [h.limit(usdc, U(100), U(200), U(400))] })), account);
      const [, , , extra] = await ethers.getSigners().then((s) => s.slice(7));
      const b = await h.sessionIdFrom(account.connect(agent).createSubSession(parentId, child({ key: extra.address, tokens: [h.limit(usdc, U(100), U(200), U(400))] })), account);
      const swap = (id, amt) => h.call(id, venue, swapData(usdc, amt, eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: amt });
      await account.connect(agent2).agentExecute(swap(a, U(100)));
      await account.connect(agent2).agentExecute(swap(a, U(100)));
      await account.connect(extra).agentExecute(swap(b, U(100)));
      // parent daily is 300: b's second call would make it 400
      await expect(account.connect(extra).agentExecute(swap(b, U(100)))).to.be.revertedWithCustomError(account, "DailyCapExceeded");
      const [, pu] = await account.getLimit(parentId, usdc.target);
      expect(pu.dayAmount).to.equal(U(300));
      expect((await account.getSession(parentId)).callsUsed).to.equal(3);
      expect(await account.spendable(b, usdc.target)).to.equal(0);
    });

    it("parent calls bound the pack", async function () {
      const kid = await h.sessionIdFrom(account.connect(agent).createSubSession(parentId, child({ maxCalls: 10 })), account);
      const swap = (id) => h.call(id, venue, swapData(usdc, U(1), eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: U(1) });
      for (let i = 0; i < 9; i++) await account.connect(agent).agentExecute(swap(parentId));
      await account.connect(agent2).agentExecute(swap(kid));
      await expect(account.connect(agent2).agentExecute(swap(kid))).to.be.revertedWithCustomError(account, "CallsExhausted").withArgs(parentId);
    });

    it("revoking a parent kills every descendant; ancestors may revoke, siblings may not", async function () {
      const signers = await ethers.getSigners();
      const k1 = signers[8], k2 = signers[9], k3 = signers[10];
      const c1 = await h.sessionIdFrom(account.connect(agent).createSubSession(parentId, child({ key: k1.address })), account);
      const c2 = await h.sessionIdFrom(account.connect(k1).createSubSession(c1, child({ key: k2.address, maxCalls: 2, tokens: [h.limit(usdc, U(10), U(20), U(40))] })), account);
      const sib = await h.sessionIdFrom(account.connect(agent).createSubSession(parentId, child({ key: k3.address })), account);
      expect((await account.getSession(c2)).depth).to.equal(2);
      await expect(account.connect(k3).revokeSession(c2)).to.be.revertedWithCustomError(account, "NotAncestor");
      await expect(account.connect(k2).revokeSession(c2)).to.be.revertedWithCustomError(account, "NotAncestor");
      await account.connect(agent).revokeSession(c1);
      expect(await account.isSessionValid(c1)).to.equal(false);
      expect(await account.isSessionValid(c2)).to.equal(false);
      expect(await account.isSessionValid(sib)).to.equal(true);
      const swap = h.call(c2, venue, swapData(usdc, U(1), eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: U(1) });
      await expect(account.connect(k2).agentExecute(swap)).to.be.revertedWithCustomError(account, "SessionInvalid").withArgs(c1);
      await expect(account.connect(k2).createSubSession(c2, child({ key: k3.address, maxCalls: 1 }))).to.be.revertedWithCustomError(account, "SessionInvalid");
    });

    it("stops at the maximum depth", async function () {
      const signers = await ethers.getSigners();
      let id = parentId;
      let key = agent;
      for (let d = 1; d <= 3; d++) {
        const next = signers[10 + d];
        id = await h.sessionIdFrom(account.connect(key).createSubSession(id, child({ key: next.address, maxCalls: 10 - d, tokens: [h.limit(usdc, 1, 1, 1)] })), account);
        key = next;
      }
      await expect(account.connect(key).createSubSession(id, child({ key: signers[15].address, maxCalls: 1, tokens: [h.limit(usdc, 1, 1, 1)] }))).to.be.revertedWithCustomError(account, "BadSpec");
    });
  });

  describe("signatures", function () {
    it("a relayer submits a session-signed call; replays and forgeries fail", async function () {
      const id = await rootSession();
      const c = h.call(id, venue, swapData(usdc, U(5), eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: U(5) });
      const deadline = (await h.now()) + 600;
      const sig = await h.signAgentCall(agent, account, c, 0n, deadline);
      expect(await account.hashAgentCall(c, 0n, deadline)).to.be.a("string");
      await expect(account.connect(relayer).agentExecuteWithSig(c, 0n, deadline, sig)).to.emit(account, "AgentCall");
      await expect(account.connect(relayer).agentExecuteWithSig(c, 0n, deadline, sig)).to.be.revertedWithCustomError(account, "BadNonce");
      const sig1 = await h.signAgentCall(stranger, account, c, 1n, deadline);
      await expect(account.connect(relayer).agentExecuteWithSig(c, 1n, deadline, sig1)).to.be.revertedWithCustomError(account, "BadSignature");
      const tampered = { ...c, spendAmount: U(6) };
      const sig2 = await h.signAgentCall(agent, account, c, 1n, deadline);
      await expect(account.connect(relayer).agentExecuteWithSig(tampered, 1n, deadline, sig2)).to.be.revertedWithCustomError(account, "BadSignature");
      const old = (await h.now()) - 1;
      const sig3 = await h.signAgentCall(agent, account, c, 1n, old);
      await expect(account.connect(relayer).agentExecuteWithSig(c, 1n, old, sig3)).to.be.revertedWithCustomError(account, "SignatureExpired");
    });

    it("a signature for one account does not work on another", async function () {
      const other = await h.deployAccount(owner, guardian.address, ethers.ZeroAddress, ethers.id("other"));
      await usdc.mint(other.account.target, U(100));
      const id = await rootSession();
      const s = h.spec({ key: agent.address, validUntil: (await h.now()) + h.DAY, tokens: [h.limit(usdc, U(100), U(300))], calls: [h.rule(venue, swapSel, 1 << 4)] });
      const otherId = await h.sessionIdFrom(other.account.connect(owner).createSession(s), other.account);
      const c = h.call(id, venue, swapData(usdc, U(5), eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: U(5) });
      const deadline = (await h.now()) + 600;
      const sig = await h.signAgentCall(agent, account, c, 0n, deadline);
      const moved = { ...c, sessionId: otherId };
      await expect(other.account.connect(relayer).agentExecuteWithSig(moved, 0n, deadline, sig)).to.be.revertedWithCustomError(other.account, "BadSignature");
    });

    it("session-signed transfers", async function () {
      const id = await rootSession();
      const t = { sessionId: id, token: usdc.target, to: payee.address, amount: U(7), memo: ethers.toUtf8Bytes("payroll 11/2026") };
      const deadline = (await h.now()) + 600;
      const sig = await h.signAgentTransfer(agent, account, t, 0n, deadline);
      await expect(account.connect(relayer).agentTransferWithSig(t.sessionId, t.token, t.to, t.amount, t.memo, 0n, deadline, sig)).to.changeTokenBalance(usdc, payee, U(7));
      await expect(account.connect(relayer).agentTransferWithSig(t.sessionId, t.token, t.to, t.amount, t.memo, 0n, deadline, sig)).to.be.revertedWithCustomError(account, "BadNonce");
    });

    it("ERC-1271: owner signatures validate, wrapped in this account's domain", async function () {
      const hash = ethers.id("hello arc");
      const net = await ethers.provider.getNetwork();
      const domain = { name: "LykiaAccount", version: "1", chainId: net.chainId, verifyingContract: account.target };
      const types = { LykiaAccountMessage: [{ name: "hash", type: "bytes32" }] };
      const sig = await owner.signTypedData(domain, types, { hash });
      expect(await account.isValidSignature(hash, sig)).to.equal("0x1626ba7e");
      const bad = await stranger.signTypedData(domain, types, { hash });
      expect(await account.isValidSignature(hash, bad)).to.equal("0xffffffff");
      const other = await h.deployAccount(owner, guardian.address, ethers.ZeroAddress, ethers.id("x"));
      expect(await other.account.isValidSignature(hash, sig)).to.equal("0xffffffff");
    });
  });

  describe("reentrancy", function () {
    it("a venue cannot re-enter the account mid-call", async function () {
      const re = await (await ethers.getContractFactory("Reenterer")).deploy();
      const pokeSel = re.interface.getFunction("poke").selector;
      const id = await rootSession({ calls: [h.rule(venue, swapSel, 1 << 4), h.rule(re, pokeSel)] });
      const inner = h.call(id, venue, swapData(usdc, U(5), eurc, 1n, account.target), { spendToken: usdc.target, spendAmount: U(5) });
      const deadline = (await h.now()) + 600;
      const sig = await h.signAgentCall(agent, account, inner, 0n, deadline);
      await re.arm(account.target, account.interface.encodeFunctionData("agentExecuteWithSig", [inner, 0n, deadline, sig]));
      await expect(account.connect(agent).agentExecute(h.call(id, re, pokeSel))).to.be.revertedWithCustomError(account, "ReentrancyGuardReentrantCall");
    });
  });
});
