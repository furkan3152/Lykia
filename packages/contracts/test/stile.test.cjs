"use strict";
// LykiaStile: the ERC-1271 policy signer for a Circle Gateway deposit.
//
// Unit tests pin Gateway's hashing (type hashes, the EIP-712 digest of a burn intent and of a burn
// intent set, the byte-encoded TransferSpec hash) against independent encoders, then cover every
// check `reserve` makes, the owner functions, the pause and what `isValidSignature` answers.
// A stateful fuzz run replays seeded random sequences of reservations, time jumps, revocations,
// cancellations and pauses against a reference model and checks after every step:
//   S1  a reservation succeeds iff the model says every cap and rule allows it;
//   S2  lifetime consumption equals the model's and never exceeds the lifetime cap;
//   S3  no rolling 24 h window ever holds more than the daily cap;
//   S4  isValidSignature answers the magic value for exactly the digests the model considers live;
//   S5  isValidSignature never changes state (it runs under STATICCALL and the usage stays put).
// Seeds are fixed so failures reproduce; set LYKIA_FUZZ_RUNS for longer runs.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const U = (n) => BigInt(Math.round(Number(n) * 1_000_000));
const MAGIC = "0x1626ba7e";
const INVALID = "0xffffffff";
const ARC_DOMAIN = 26;
const BASE_DOMAIN = 6;
const ETH_DOMAIN = 0;
const BUCKET = 6 * 60 * 60;
const RUNS = Number(process.env.LYKIA_FUZZ_RUNS || 5);
const STEPS = 45;

const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const USDC = "0x3600000000000000000000000000000000000000";
const BASE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const FEE_RECIPIENT = "0x8c5281055b197443ff01dbbdfbf29fd63946ca1e";

const b32 = (a) => ethers.zeroPadValue(ethers.getAddress(a), 32);

// Gateway's EIP-712 types, as Circle's quickstart and Lykia's API sign them.
const TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
};
const SET_TYPES = { ...TYPES, BurnIntentSet: [{ name: "intents", type: "BurnIntent[]" }] };
const DOMAIN = { name: "GatewayWallet", version: "1" };

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

let saltCounter = 0;
function intent(stile, owner, over = {}) {
  saltCounter += 1;
  const spec = {
    version: 1,
    sourceDomain: ARC_DOMAIN,
    destinationDomain: over.destinationDomain ?? BASE_DOMAIN,
    sourceContract: b32(GATEWAY_WALLET),
    destinationContract: b32(GATEWAY_MINTER),
    sourceToken: b32(USDC),
    destinationToken: b32(BASE_USDC),
    sourceDepositor: b32(owner),
    destinationRecipient: b32(over.recipient ?? "0x2222222222222222222222222222222222222222"),
    sourceSigner: b32(stile),
    destinationCaller: ethers.ZeroHash,
    value: over.value ?? U(10),
    salt: over.salt ?? ethers.zeroPadValue(ethers.toBeHex(saltCounter), 32),
    hookData: "0x",
    ...(over.spec ?? {}),
  };
  return { maxBlockHeight: over.maxBlockHeight ?? 1_000_000_000n, maxFee: over.maxFee ?? U(0.02), spec };
}

/** [payment, fee] with Lykia's fee at `bps` (rounded up), on the payment's destination. */
function pair(stile, owner, over = {}, bps = 100, feeOver = {}) {
  const pay = intent(stile, owner, over);
  const value = (BigInt(pay.spec.value) * BigInt(bps) + 9_999n) / 10_000n;
  const fee = intent(stile, owner, { destinationDomain: pay.spec.destinationDomain, recipient: FEE_RECIPIENT, value: value === 0n ? 1n : value, ...feeOver });
  return [pay, fee];
}

function setDigest(intents) {
  return ethers.TypedDataEncoder.hash(DOMAIN, SET_TYPES, { intents });
}

function specBytesHash(s) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes4", "uint32", "uint32", "uint32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "uint32", "bytes"],
      ["0xca85def7", s.version, s.sourceDomain, s.destinationDomain, s.sourceContract, s.destinationContract, s.sourceToken, s.destinationToken, s.sourceDepositor, s.destinationRecipient, s.sourceSigner, s.destinationCaller, s.value, s.salt, ethers.dataLength(s.hookData), s.hookData],
    ),
  );
}

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

function limits(over = {}) {
  return { validUntil: over.validUntil, perTransfer: over.perTransfer ?? U(50), daily: over.daily ?? U(100), lifetime: over.lifetime ?? U(300), maxGatewayFee: over.maxGatewayFee ?? U(0.5), anyRecipient: over.anyRecipient ?? false };
}

async function deploy(owner, over = {}) {
  const F = await ethers.getContractFactory("LykiaStile", owner);
  const stile = await F.deploy(owner.address, GATEWAY_WALLET, GATEWAY_MINTER, USDC, ARC_DOMAIN, over.ceilingPerTransfer ?? U(100), over.ceilingDaily ?? U(300), over.feeBps ?? 100, over.feeRecipient ?? FEE_RECIPIENT);
  await stile.waitForDeployment();
  return stile;
}

async function session(stile, owner, key, over = {}) {
  const validUntil = over.validUntil ?? (await now()) + 30 * 86_400;
  const tx = await stile.connect(owner).createSession(key.address, limits({ ...over, validUntil }), over.destinations ?? [BASE_DOMAIN, ARC_DOMAIN], over.recipients ?? [b32("0x2222222222222222222222222222222222222222")], over.policyHash ?? ethers.id("lykia.fence/v1:stile"));
  const receipt = await tx.wait();
  const ev = receipt.logs.map((l) => stile.interface.parseLog(l)).find((p) => p && p.name === "SessionCreated");
  return ev.args.id;
}

function sig(id) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [id]);
}

describe("LykiaStile", function () {
  let owner, agent, other, stile, id, probe;

  beforeEach(async () => {
    [owner, agent, other] = await ethers.getSigners();
    stile = await deploy(owner);
    id = await session(stile, owner, agent);
    probe = await (await ethers.getContractFactory("StileProbe")).deploy();
  });

  describe("Gateway's hashing", () => {
    it("uses Circle's type hashes and domain", async () => {
      expect(await stile.TRANSFER_SPEC_TYPEHASH()).to.equal("0x44409c7ba8872720f5fc290d2788c2d70a3905b7ca1cdb2ffa152791a69e089b");
      expect(await stile.BURN_INTENT_TYPEHASH()).to.equal("0x8b99d17a83a2dd1add9fc2a450e22732c7e8564aa110ab99c20485a7a10ba37c");
      expect(await stile.BURN_INTENT_SET_TYPEHASH()).to.equal("0xe30760cf7d79e3521ad1553a73a6c6f8d33226ea613eaa29ceda6de148fbd07a");
      expect(await stile.GATEWAY_DOMAIN_SEPARATOR()).to.equal(ethers.TypedDataEncoder.hashDomain(DOMAIN));
    });

    it("computes the same EIP-712 digest as an independent encoder, for single intents and sets", async () => {
      const r = rng(7);
      for (let i = 0; i < 12; i++) {
        const hook = i % 3 === 0 ? ethers.hexlify(ethers.randomBytes(Math.floor(r() * 70))) : "0x";
        const one = intent(stile.target, owner.address, { value: BigInt(Math.floor(r() * 1e12)) + 1n, maxFee: BigInt(Math.floor(r() * 1e9)), maxBlockHeight: BigInt(Math.floor(r() * 1e15)), spec: { hookData: hook, destinationCaller: i % 2 ? b32(other.address) : ethers.ZeroHash } });
        expect(await stile.burnIntentDigest(one)).to.equal(ethers.TypedDataEncoder.hash(DOMAIN, TYPES, one));
        const two = [one, intent(stile.target, owner.address, { recipient: FEE_RECIPIENT })];
        expect(await stile.burnIntentSetDigest(two)).to.equal(setDigest(two));
        expect(await stile.transferSpecHash(one.spec)).to.equal(specBytesHash(one.spec));
      }
    });
  });

  it("hashes a real Arc testnet transfer to the transferSpecHash GatewayMinter emitted for it", async () => {
    // AttestationUsed in tx 0x7d622753607ef9ee12f257dc46e53f848666058e1ed047e0625337fa32b92381 (Arc testnet, block 71305366);
    // the spec as Gateway's GET /v1/transferSpec/{hash} returns it, value in base units.
    const spec = {
      version: 1,
      sourceDomain: 26,
      destinationDomain: 26,
      sourceContract: b32("0x0077777d7eba4688bdef3e311b846f25870a19b9"),
      destinationContract: b32("0x0022222abe238cc2c7bb1f21003f0a260052475b"),
      sourceToken: b32(USDC),
      destinationToken: b32(USDC),
      sourceDepositor: b32("0xb21c91a0f4d4c03f4b6a0fc5214f06e431ff2b2d"),
      destinationRecipient: b32("0x9336e3f0b913c4316fc75918fdb88aa5e1fe49dc"),
      sourceSigner: b32("0xb21c91a0f4d4c03f4b6a0fc5214f06e431ff2b2d"),
      destinationCaller: ethers.ZeroHash,
      value: 5_983_600n,
      salt: "0xe280ab1660196a3a3275a2328f01761b15a939f06371c9304ca03ba111f7fba4",
      hookData: "0x6b20f62a0000000100002717000000000000000000000000000000004cbdcaffe75f0a317482224dae64360000000000000000000000000000000000e2cdcbe22b4ab24138fac1ee982ae600000000000000000000000000000000000000000000000000000000000000000000000000",
    };
    expect(await stile.transferSpecHash(spec)).to.equal("0xa604e143a2e118f451dbb539f73a78faa9b28b95800067fb06e11192ef4b0eee");
  });

  describe("reserve", () => {
    it("reserves a payment with its fee leg and validates the set digest only", async () => {
      const intents = pair(stile.target, owner.address, { value: U(10) });
      const digest = setDigest(intents);
      await expect(stile.connect(agent).reserve(id, intents, ethers.toUtf8Bytes("lykia:1:out_x:s1:abcd")))
        .to.emit(stile, "Reserved")
        .withArgs(id, digest, specBytesHash(intents[0].spec), BASE_DOMAIN, intents[0].spec.destinationRecipient, U(10), U(0.1), specBytesHash(intents[1].spec), (v) => v > 0n)
        .and.to.emit(stile, "StileMemo");
      expect(await stile.isValidSignature(digest, sig(id))).to.equal(MAGIC);
      // The payment alone (what an agent might try to submit without the fee) is not reserved.
      expect(await stile.isValidSignature(ethers.TypedDataEncoder.hash(DOMAIN, TYPES, intents[0]), sig(id))).to.equal(INVALID);
      const [day, consumed] = await stile.getUsage(id);
      expect(day).to.equal(U(10.1));
      expect(consumed).to.equal(U(10.1));
      expect(await probe.check(stile.target, digest, sig(id))).to.equal(true);
    });

    it("only the session key reserves", async () => {
      const intents = pair(stile.target, owner.address);
      await expect(stile.connect(other).reserve(id, intents, "0x")).to.be.revertedWithCustomError(stile, "NotSessionKey");
      await expect(stile.connect(owner).reserve(id, intents, "0x")).to.be.revertedWithCustomError(stile, "NotSessionKey");
      await expect(stile.connect(agent).reserve(ethers.id("nope"), intents, "0x")).to.be.revertedWithCustomError(stile, "SessionInvalid");
    });

    it("refuses a second reservation of the same digest", async () => {
      const intents = pair(stile.target, owner.address);
      await stile.connect(agent).reserve(id, intents, "0x");
      await expect(stile.connect(agent).reserve(id, intents, "0x")).to.be.revertedWithCustomError(stile, "AlreadyReserved");
    });

    it("charges payment plus fee against the per-transfer, daily and lifetime caps", async () => {
      // perTransfer 50, daily 100, lifetime 300 (payment + 1% fee).
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(50) }), "0x")).to.be.revertedWithCustomError(stile, "PerTransferCapExceeded");
      await stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(49) }), "0x");
      await stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(49) }), "0x");
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(2) }), "0x")).to.be.revertedWithCustomError(stile, "DailyCapExceeded");
      expect(await stile.spendable(id)).to.equal(U(100) - 2n * U(49.49));
      await time.increase(31 * 3600);
      expect(await stile.spendable(id)).to.equal(U(50));
      for (let i = 0; i < 4; i++) {
        await stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(49) }), "0x");
        if (i % 2 === 1) await time.increase(31 * 3600);
      }
      // 6 x 49.49 = 296.94 consumed; 4 more (with fee 4.04) would pass 300.
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(4) }), "0x")).to.be.revertedWithCustomError(stile, "LifetimeCapExceeded");
      await stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(3) }), "0x");
    });

    it("checks the destination, the recipient and the Gateway fee", async () => {
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, { destinationDomain: ETH_DOMAIN }), "0x")).to.be.revertedWithCustomError(stile, "DestinationNotAllowed").withArgs(ETH_DOMAIN);
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, { recipient: other.address }), "0x")).to.be.revertedWithCustomError(stile, "RecipientNotAllowed");
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, { maxFee: U(0.51) }), "0x")).to.be.revertedWithCustomError(stile, "GatewayFeeTooHigh");
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, {}, 100, { maxFee: U(0.51) }), "0x")).to.be.revertedWithCustomError(stile, "GatewayFeeTooHigh");
    });

    it("requires Lykia's fee leg: right count, recipient, destination and at least feeBps", async () => {
      const [pay, fee] = pair(stile.target, owner.address, { value: U(10) });
      await expect(stile.connect(agent).reserve(id, [pay], "0x")).to.be.revertedWithCustomError(stile, "WrongIntentCount").withArgs(2, 1);
      await expect(stile.connect(agent).reserve(id, [pay, fee, fee], "0x")).to.be.revertedWithCustomError(stile, "WrongIntentCount");
      await expect(stile.connect(agent).reserve(id, [pay, { ...fee, spec: { ...fee.spec, destinationRecipient: b32(other.address) } }], "0x")).to.be.revertedWithCustomError(stile, "BadIntent").withArgs(1, "fee recipient");
      await expect(stile.connect(agent).reserve(id, [pay, { ...fee, spec: { ...fee.spec, destinationDomain: ARC_DOMAIN } }], "0x")).to.be.revertedWithCustomError(stile, "BadIntent").withArgs(1, "fee destination");
      await expect(stile.connect(agent).reserve(id, [pay, { ...fee, spec: { ...fee.spec, value: U(0.099999) } }], "0x")).to.be.revertedWithCustomError(stile, "LykiaFeeTooLow");
      await stile.connect(agent).reserve(id, [pay, { ...fee, spec: { ...fee.spec, value: U(0.1) } }], "0x");
    });

    it("refuses an intent that does not debit the owner's deposit through this signer on this chain", async () => {
      const cases = [
        ["version", { version: 2 }],
        ["source domain", { sourceDomain: BASE_DOMAIN }],
        ["source contract", { sourceContract: b32(other.address) }],
        ["destination contract", { destinationContract: b32(other.address) }],
        ["source token", { sourceToken: b32(BASE_USDC) }],
        ["source depositor", { sourceDepositor: b32(other.address) }],
        ["source signer", { sourceSigner: b32(other.address) }],
        ["hook data", { hookData: "0x01" }],
        ["value", { value: 0n }],
      ];
      for (const [reason, spec] of cases) {
        const [pay, fee] = pair(stile.target, owner.address);
        await expect(stile.connect(agent).reserve(id, [{ ...pay, spec: { ...pay.spec, ...spec } }, fee], "0x"), reason).to.be.revertedWithCustomError(stile, "BadIntent").withArgs(0, reason);
        await expect(stile.connect(agent).reserve(id, [pay, { ...fee, spec: { ...fee.spec, ...spec } }], "0x"), `fee ${reason}`).to.be.revertedWithCustomError(stile, "BadIntent").withArgs(1, reason);
      }
    });

    it("refuses long memos", async () => {
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address), "0x" + "ab".repeat(257))).to.be.revertedWithCustomError(stile, "MemoTooLong");
    });

    it("without a fee (feeBps 0) reserves one intent and validates its single digest", async () => {
      const free = await deploy(owner, { feeBps: 0, feeRecipient: ethers.ZeroAddress });
      const sid = await session(free, owner, agent);
      const one = intent(free.target, owner.address, { value: U(5) });
      await expect(free.connect(agent).reserve(sid, [one, one], "0x")).to.be.revertedWithCustomError(free, "WrongIntentCount").withArgs(1, 2);
      await free.connect(agent).reserve(sid, [one], "0x");
      expect(await free.isValidSignature(ethers.TypedDataEncoder.hash(DOMAIN, TYPES, one), sig(sid))).to.equal(MAGIC);
    });

    it("any-recipient sessions skip the recipient list but keep every other check", async () => {
      const sid = await session(stile, owner, other, { anyRecipient: true, recipients: [] });
      await stile.connect(other).reserve(sid, pair(stile.target, owner.address, { recipient: "0x9999999999999999999999999999999999999999" }), "0x");
      await expect(stile.connect(other).reserve(sid, pair(stile.target, owner.address, { destinationDomain: ETH_DOMAIN }), "0x")).to.be.revertedWithCustomError(stile, "DestinationNotAllowed");
    });
  });

  describe("isValidSignature", () => {
    let digest;
    beforeEach(async () => {
      const intents = pair(stile.target, owner.address);
      digest = setDigest(intents);
      await stile.connect(agent).reserve(id, intents, "0x");
    });

    it("is a view function and works under STATICCALL", async () => {
      const fn = stile.interface.getFunction("isValidSignature");
      expect(fn.stateMutability).to.equal("view");
      expect(await probe.check(stile.target, digest, sig(id))).to.equal(true);
      const gas = await stile.isValidSignature.estimateGas(digest, sig(id));
      expect(gas).to.be.lessThan(40_000n);
    });

    it("refuses an unknown digest, a wrong or malformed signature", async () => {
      expect(await stile.isValidSignature(ethers.id("other"), sig(id))).to.equal(INVALID);
      expect(await stile.isValidSignature(digest, sig(ethers.id("other session")))).to.equal(INVALID);
      expect(await stile.isValidSignature(digest, "0x")).to.equal(INVALID);
      expect(await stile.isValidSignature(digest, sig(id) + "00")).to.equal(INVALID);
      expect(await probe.check(stile.target, digest, "0x1234")).to.equal(false);
    });

    it("stops answering once the session is revoked (by the owner or its key)", async () => {
      await expect(stile.connect(other).revokeSession(id)).to.be.revertedWithCustomError(stile, "NotOwner");
      await stile.connect(owner).revokeSession(id);
      expect(await stile.isValidSignature(digest, sig(id))).to.equal(INVALID);
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address), "0x")).to.be.revertedWithCustomError(stile, "SessionInvalid");
      const sid = await session(stile, owner, other);
      const intents = pair(stile.target, owner.address);
      await stile.connect(other).reserve(sid, intents, "0x");
      await stile.connect(other).revokeSession(sid);
      expect(await stile.isValidSignature(setDigest(intents), sig(sid))).to.equal(INVALID);
    });

    it("stops answering when the reservation expires or the session ends", async () => {
      await time.increase(60 * 60 + 1);
      expect(await stile.isValidSignature(digest, sig(id))).to.equal(INVALID);
      const short = await session(stile, owner, other, { validUntil: (await now()) + 600 });
      const intents = pair(stile.target, owner.address);
      await stile.connect(other).reserve(short, intents, "0x");
      const r = await stile.getReservation(setDigest(intents));
      expect(r.expiresAt).to.equal((await stile.getSession(short)).validUntil);
      await time.increase(601);
      expect(await stile.isValidSignature(setDigest(intents), sig(short))).to.equal(INVALID);
      await expect(stile.connect(other).reserve(short, pair(stile.target, owner.address), "0x")).to.be.revertedWithCustomError(stile, "SessionInvalid");
    });

    it("stops answering for a cancelled reservation, which stays charged", async () => {
      const before = await stile.getUsage(id);
      await expect(stile.connect(other).cancelReservation(digest)).to.be.revertedWithCustomError(stile, "NotSessionKey");
      await stile.connect(agent).cancelReservation(digest);
      expect(await stile.isValidSignature(digest, sig(id))).to.equal(INVALID);
      expect((await stile.getUsage(id))[1]).to.equal(before[1]);
      await expect(stile.connect(owner).cancelReservation(ethers.id("x"))).to.be.revertedWithCustomError(stile, "UnknownReservation");
    });

    it("the global pause stops validation and reservations, and lifting it restores both", async () => {
      await expect(stile.connect(agent).setPaused(true)).to.be.revertedWithCustomError(stile, "NotOwner");
      await expect(stile.connect(owner).setPaused(true)).to.emit(stile, "PausedSet").withArgs(true);
      expect(await stile.isValidSignature(digest, sig(id))).to.equal(INVALID);
      expect(await stile.spendable(id)).to.equal(0n);
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address), "0x")).to.be.revertedWithCustomError(stile, "IsPaused");
      await stile.connect(owner).setPaused(false);
      expect(await stile.isValidSignature(digest, sig(id))).to.equal(MAGIC);
    });
  });

  describe("owner", () => {
    it("only the owner issues and changes sessions", async () => {
      const until = (await now()) + 86_400;
      await expect(stile.connect(agent).createSession(other.address, limits({ validUntil: until }), [BASE_DOMAIN], [b32(other.address)], ethers.ZeroHash)).to.be.revertedWithCustomError(stile, "NotOwner");
      await expect(stile.connect(agent).updateSession(id, limits({ validUntil: until }))).to.be.revertedWithCustomError(stile, "NotOwner");
      await expect(stile.connect(agent).setDestinations(id, [ETH_DOMAIN], true)).to.be.revertedWithCustomError(stile, "NotOwner");
      await expect(stile.connect(agent).setRecipients(id, [b32(other.address)], true)).to.be.revertedWithCustomError(stile, "NotOwner");
    });

    it("never issues a session above the ceilings or out of order", async () => {
      const until = (await now()) + 86_400;
      const go = (l, d = [BASE_DOMAIN], r = [b32(other.address)]) => stile.connect(owner).createSession(other.address, limits({ validUntil: until, ...l }), d, r, ethers.ZeroHash);
      await expect(go({ perTransfer: U(100.01), daily: U(200), lifetime: U(300) })).to.be.revertedWithCustomError(stile, "BadSpec").withArgs("per-transfer ceiling");
      await expect(go({ perTransfer: U(50), daily: U(300.01), lifetime: U(400) })).to.be.revertedWithCustomError(stile, "BadSpec").withArgs("daily ceiling");
      await expect(go({ perTransfer: U(60), daily: U(50), lifetime: U(300) })).to.be.revertedWithCustomError(stile, "BadSpec").withArgs("caps order");
      await expect(go({ validUntil: (await now()) - 1 })).to.be.revertedWithCustomError(stile, "BadSpec").withArgs("expiry");
      await expect(go({}, [])).to.be.revertedWithCustomError(stile, "BadSpec").withArgs("no destination");
      await expect(go({}, [BASE_DOMAIN], [])).to.be.revertedWithCustomError(stile, "BadSpec").withArgs("no recipient");
      await expect(stile.connect(owner).createSession(owner.address, limits({ validUntil: until }), [BASE_DOMAIN], [b32(other.address)], ethers.ZeroHash)).to.be.revertedWithCustomError(stile, "BadSpec").withArgs("key");
      await expect(stile.connect(owner).updateSession(id, limits({ validUntil: until, perTransfer: U(101), daily: U(200) }))).to.be.revertedWithCustomError(stile, "BadSpec");
    });

    it("updates limits and lists of a live session; a revoked one stays dead", async () => {
      const until = (await now()) + 86_400;
      await stile.connect(owner).updateSession(id, limits({ validUntil: until, perTransfer: U(5), daily: U(10), lifetime: U(10) }));
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(6) }), "0x")).to.be.revertedWithCustomError(stile, "PerTransferCapExceeded");
      await stile.connect(owner).setDestinations(id, [ETH_DOMAIN], true);
      await stile.connect(owner).setRecipients(id, [b32(other.address)], true);
      await stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(4), destinationDomain: ETH_DOMAIN, recipient: other.address }), "0x");
      await stile.connect(owner).setDestinations(id, [ETH_DOMAIN], false);
      await expect(stile.connect(agent).reserve(id, pair(stile.target, owner.address, { value: U(1), destinationDomain: ETH_DOMAIN }), "0x")).to.be.revertedWithCustomError(stile, "DestinationNotAllowed");
      await stile.connect(owner).revokeSession(id);
      await expect(stile.connect(owner).updateSession(id, limits({ validUntil: until }))).to.be.revertedWithCustomError(stile, "SessionInvalid");
    });

    it("rejects bad construction", async () => {
      const F = await ethers.getContractFactory("LykiaStile");
      await expect(F.deploy(ethers.ZeroAddress, GATEWAY_WALLET, GATEWAY_MINTER, USDC, 26, U(100), U(300), 100, FEE_RECIPIENT)).to.be.revertedWithCustomError(stile, "BadConfig");
      await expect(F.deploy(owner.address, GATEWAY_WALLET, GATEWAY_MINTER, USDC, 26, U(400), U(300), 100, FEE_RECIPIENT)).to.be.revertedWithCustomError(stile, "BadConfig");
      await expect(F.deploy(owner.address, GATEWAY_WALLET, GATEWAY_MINTER, USDC, 26, U(100), U(300), 301, FEE_RECIPIENT)).to.be.revertedWithCustomError(stile, "BadConfig");
      await expect(F.deploy(owner.address, GATEWAY_WALLET, GATEWAY_MINTER, USDC, 26, U(100), U(300), 100, ethers.ZeroAddress)).to.be.revertedWithCustomError(stile, "BadConfig");
    });
  });

  describe("invariants (stateful fuzz)", function () {
    this.timeout(600000);

    for (let run = 0; run < RUNS; run++) {
      it(`seed ${run + 1}: caps, validity and view-only validation hold`, async () => {
        const r = rng(1000 + run);
        const pick = (a) => a[Math.floor(r() * a.length)];
        const perTransfer = U(10 + Math.floor(r() * 40));
        const daily = perTransfer + U(Math.floor(r() * 60));
        const lifetime = daily + U(Math.floor(r() * 150));
        const sid = await session(stile, owner, other, { perTransfer, daily, lifetime, validUntil: (await now()) + 6 * 86_400 });
        const model = { consumed: 0n, spends: [], revoked: false, paused: false, reservations: [] };
        const validUntil = (await stile.getSession(sid)).validUntil;
        const windowUsed = (t) => model.spends.filter((s) => Math.floor(t / BUCKET) - s.bucket < 5).reduce((n, s) => n + s.amount, 0n);
        const recipients = ["0x2222222222222222222222222222222222222222", "0x4444444444444444444444444444444444444444"];

        for (let step = 0; step < STEPS; step++) {
          const roll = r();
          if (roll < 0.6) {
            const value = BigInt(Math.floor(r() * Number(perTransfer) * 1.1)) + 1n;
            const dest = r() < 0.85 ? pick([BASE_DOMAIN, ARC_DOMAIN]) : ETH_DOMAIN;
            const to = r() < 0.75 ? recipients[0] : pick([recipients[1], "0x9999999999999999999999999999999999999999"]);
            const intents = pair(stile.target, owner.address, { value, destinationDomain: dest, recipient: to });
            const amount = value + BigInt(intents[1].spec.value);
            const t = (await now()) + 1;
            const allowed = !model.paused && !model.revoked && t <= Number(validUntil) && dest !== ETH_DOMAIN && to === recipients[0] && amount <= perTransfer && windowUsed(t) + amount <= daily && model.consumed + amount <= lifetime;
            const p = stile.connect(other).reserve(sid, intents, "0x");
            if (allowed) {
              await p;
              const bucket = Math.floor((await now()) / BUCKET);
              model.consumed += amount;
              model.ok = (model.ok ?? 0) + 1;
              model.spends.push({ bucket, amount });
              const at = await now();
              model.reservations.push({ digest: setDigest(intents), expiresAt: Math.min(at + 3600, Number(validUntil)), cancelled: false });
            } else {
              await expect(p).to.be.reverted;
            }
          } else if (roll < 0.75) {
            await time.increase(Math.floor(r() * 14 * 3600));
          } else if (roll < 0.82 && model.reservations.length > 0) {
            const res = pick(model.reservations);
            await stile.connect(owner).cancelReservation(res.digest);
            res.cancelled = true;
          } else if (roll < 0.86 || (model.paused && roll < 0.95)) {
            model.paused = !model.paused;
            await stile.connect(owner).setPaused(model.paused);
          } else if (roll > 0.985 && step > STEPS / 2 && !model.revoked) {
            model.revoked = true;
            await stile.connect(owner).revokeSession(sid);
          } else {
            await time.increase(60);
          }

          // S2, S3
          const t = await now();
          const [day, consumed] = await stile.getUsage(sid);
          expect(consumed).to.equal(model.consumed);
          expect(consumed <= lifetime).to.equal(true);
          expect(day).to.equal(windowUsed(t));
          expect(day <= daily).to.equal(true);
          // S4, S5
          for (const res of model.reservations) {
            const live = !model.paused && !model.revoked && !res.cancelled && t <= res.expiresAt && t <= Number(validUntil);
            expect(await stile.isValidSignature(res.digest, sig(sid))).to.equal(live ? MAGIC : INVALID);
            expect(await probe.check(stile.target, res.digest, sig(sid))).to.equal(live);
          }
          const [day2, consumed2] = await stile.getUsage(sid);
          expect([day2, consumed2]).to.deep.equal([day, consumed]);
        }
        // The run exercised the success path, not only refusals.
        expect(model.ok ?? 0).to.be.greaterThan(0);
      });
    }
  });
});
