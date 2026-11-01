#!/usr/bin/env node
// Prints the ownership-hardening plan for Lykia's owned contracts: unsigned calls only.
// Nothing here connects to a network, holds a key, signs or broadcasts.
//
//   ROUTER=0x... ORDERS=0x... SAFE=0x... [TIMELOCK=0x...] [DELAY=172800] node scripts/ownership-plan.cjs
//
// Without TIMELOCK: owner -> Safe directly (transferOwnership from the deployer wallet, then
// acceptOwnership from the Safe). With TIMELOCK (a LykiaTimelock whose only proposer and executor is
// the Safe and which has no admin): owner -> timelock, and the Safe schedules then executes
// acceptOwnership after DELAY seconds. LykiaAccountFactory has no owner; it is immutable and needs
// nothing. Safe 1.4.1 on Arc mainnet: singleton 0x41675C099F32341bf84BFc5382aF534df5C7461a,
// proxy factory 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67 (see docs/security/ownership.md).
"use strict";
const { Interface, isAddress, getAddress, ZeroHash, id } = require("ethers");

const OWNABLE = new Interface(["function transferOwnership(address newOwner)", "function acceptOwnership()", "function owner() view returns (address)", "function pendingOwner() view returns (address)"]);
const TIMELOCK = new Interface([
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)",
]);

function addressFrom(name, required) {
  const value = process.env[name];
  if (!value) {
    if (required) throw new Error(`${name} is required (a 0x address).`);
    return null;
  }
  if (!isAddress(value)) throw new Error(`${name} is not an address.`);
  return getAddress(value);
}

function plan() {
  const safe = addressFrom("SAFE", true);
  const timelock = addressFrom("TIMELOCK", false);
  const delay = BigInt(process.env.DELAY || "172800");
  const targets = [
    ["LykiaRouter", addressFrom("ROUTER", false)],
    ["LykiaOrders", addressFrom("ORDERS", false)],
  ].filter(([, a]) => a !== null);
  if (targets.length === 0) throw new Error("Set ROUTER and/or ORDERS.");
  const newOwner = timelock ?? safe;
  const steps = [];
  for (const [name, address] of targets) {
    steps.push({ step: `${name}: propose the new owner`, from: "current owner (deployer wallet)", to: address, data: OWNABLE.encodeFunctionData("transferOwnership", [newOwner]), value: "0", check: `pendingOwner() == ${newOwner}` });
    const accept = OWNABLE.encodeFunctionData("acceptOwnership");
    if (!timelock) {
      steps.push({ step: `${name}: accept from the Safe`, from: `Safe ${safe} (Safe transaction, threshold signatures)`, to: address, data: accept, value: "0", check: `owner() == ${safe}` });
    } else {
      const salt = id(`lykia:accept:${address.toLowerCase()}`);
      steps.push({ step: `${name}: Safe schedules acceptOwnership on the timelock`, from: `Safe ${safe}`, to: timelock, data: TIMELOCK.encodeFunctionData("schedule", [address, 0n, accept, ZeroHash, salt, delay]), value: "0" });
      steps.push({ step: `${name}: after ${delay} s, Safe executes it`, from: `Safe ${safe}`, to: timelock, data: TIMELOCK.encodeFunctionData("execute", [address, 0n, accept, ZeroHash, salt]), value: "0", check: `owner() == ${timelock}` });
    }
  }
  return { safe, timelock, delaySeconds: timelock ? delay.toString() : null, factory: "LykiaAccountFactory has no owner: nothing to transfer.", steps, note: "Unsigned. Send each call from the wallet named in `from`; for Safe steps, use the Safe app's transaction builder (to, value 0, data)." };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(plan(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { plan };
