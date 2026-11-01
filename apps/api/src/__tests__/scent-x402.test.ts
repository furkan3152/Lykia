import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { cloneTarget, levelOf, mappingKey, privilegedIn, wordToAddress } from "../scent/scent.js";
import { decodePayment, requirementsFor, TRANSFER_WITH_AUTHORIZATION_TYPES, verifyPayment, type PaymentPayload } from "../x402/x402.js";

describe("scent", () => {
  it("finds privileged selectors pushed in bytecode", () => {
    const code = "0x6080604052" + "6340c10f19" + "00" + "633659cfe6" as `0x${string}`;
    const found = privilegedIn(code).map((p) => p.signature);
    assert.deepEqual(found.sort(), ["mint(address,uint256)", "upgradeTo(address)"]);
    assert.deepEqual(privilegedIn("0x6080"), []);
  });

  it("recognises EIP-1167 clones and slot words", () => {
    const target = "122c82cfca7a3a2227285cc21f4522e8f551db3a";
    assert.equal(cloneTarget(`0x363d3d373d3d3d363d73${target}5af43d82803e903d91602b57fd5bf3`), `0x${target}`);
    assert.equal(cloneTarget("0x6080"), null);
    assert.equal(wordToAddress(`0x${"0".repeat(24)}${target}`), `0x${target}`);
    assert.equal(wordToAddress(`0x${"0".repeat(64)}`), null);
  });

  it("derives Solidity mapping keys", () => {
    const holder = "0x00000000000000000000000000000000004c796b";
    assert.equal(mappingKey(holder, 0n), keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, 0n])));
  });

  it("never says safe; wolves raise the level", () => {
    assert.equal(levelOf([{ id: "bytecode", ok: true, detail: "" }], []), "no-red-flags");
    assert.equal(levelOf([{ id: "simulation", ok: null, detail: "" }], []), "unknown");
    assert.equal(levelOf([], ["owner-active"]), "caution");
    assert.equal(levelOf([], ["honeypot"]), "danger");
  });
});

describe("x402 exact payments on Arc", () => {
  const payTo = "0x2222222222222222222222222222222222222222" as const;
  const req = requirementsFor("testnet", payTo, "10000", "/v1/x402/scent/0x", "test");
  const now = 1_800_000_000;

  async function signed(overrides: Partial<{ to: `0x${string}`; value: string; validBefore: string }> = {}) {
    const account = privateKeyToAccount(generatePrivateKey());
    const authorization = { from: account.address, to: overrides.to ?? payTo, value: overrides.value ?? "10000", validAfter: "0", validBefore: overrides.validBefore ?? String(now + 60), nonce: `0x${"ab".repeat(32)}` as `0x${string}` };
    const signature = await account.signTypedData({
      domain: { name: "USDC", version: "2", chainId: 5042002, verifyingContract: req.asset },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: { ...authorization, value: BigInt(authorization.value), validAfter: 0n, validBefore: BigInt(authorization.validBefore) },
    });
    const payment: PaymentPayload = { x402Version: 2, accepted: { scheme: "exact", network: "eip155:5042002" }, payload: { signature, authorization } };
    return { account, payment, header: Buffer.from(JSON.stringify(payment)).toString("base64") };
  }

  it("states USDC on Arc as the asset with the EIP-712 domain", () => {
    assert.equal(req.network, "eip155:5042002");
    assert.equal(req.asset, "0x3600000000000000000000000000000000000000");
    assert.deepEqual(req.extra, { name: "USDC", version: "2" });
  });

  it("accepts a valid authorization and names the payer", async () => {
    const { account, header } = await signed();
    const payment = decodePayment(header);
    assert.ok(payment);
    const result = await verifyPayment(payment, req, now);
    assert.deepEqual(result, { ok: true, payer: account.address });
  });

  it("refuses the wrong recipient, too little, expired or forged", async () => {
    assert.equal((await verifyPayment((await signed({ to: "0x3333333333333333333333333333333333333333" })).payment, req, now)).ok, false);
    assert.equal((await verifyPayment((await signed({ value: "9999" })).payment, req, now)).ok, false);
    assert.equal((await verifyPayment((await signed({ validBefore: String(now - 1) })).payment, req, now)).ok, false);
    const { payment } = await signed();
    const forged = { ...payment, payload: { ...payment.payload, authorization: { ...payment.payload.authorization, from: "0x4444444444444444444444444444444444444444" as const } } };
    assert.equal((await verifyPayment(forged, req, now)).ok, false);
    assert.equal(decodePayment("not base64 json"), null);
  });
});
