import { test } from "node:test";
import assert from "node:assert/strict";
import { lykiaContracts } from "@lykia/core";
import { allDeployed, creationBlocker, deployedFromRecords, nextAddress, stepStates } from "../model";

const OWNER = "0x8c5281055b197443ff01dbbdfbf29fd63946ca1e" as const;

test("plan steps are contract creations from the owner's wallet", () => {
  const plan = lykiaContracts.deployPlan("testnet", OWNER);
  assert.equal(plan.deployer, OWNER);
  for (const s of plan.steps) assert.equal(s.tx?.to, null);
  assert.ok(plan.notes.some((n) => /creator/u.test(n)));
});

test("resume: recorded steps are done, the first missing one is next, references resolve", () => {
  const plan = lykiaContracts.deployPlan("testnet", OWNER);
  const deployed = deployedFromRecords([
    { environment: "testnet", contract: "LykiaAccountFactory", name: "LykiaAccountFactory", address: "0x1111111111111111111111111111111111111111" },
    { environment: "testnet", contract: "LykiaRouter", name: "LykiaRouter", address: "0x2222222222222222222222222222222222222222" },
    { environment: "mainnet", contract: "PracticeVault", name: "PracticeVaultUSDC", address: "0x3333333333333333333333333333333333333333" },
  ], "testnet");
  const states = stepStates(plan, deployed);
  assert.equal(states.LykiaRouter, "done");
  assert.equal(states.PracticeVaultUSDC, "next");
  assert.equal(states.PracticeLending, "waiting");
  assert.equal(allDeployed(plan, deployed), false);
  assert.throws(() => lykiaContracts.resolveCall(plan.initCalls[0]!, deployed), /not deployed yet/u);
  const full = { ...deployed, PracticeVaultUSDC: "0x4444444444444444444444444444444444444444", PracticeVaultEURC: "0x5555555555555555555555555555555555555555", PracticeSwap: "0x6666666666666666666666666666666666666666", PracticeLending: "0x7777777777777777777777777777777777777777" } as const;
  assert.equal(allDeployed(plan, full), true);
  const call = lykiaContracts.resolveCall(plan.initCalls[0]!, full);
  assert.equal(call.to, "0x2222222222222222222222222222222222222222");
});

test("passkey accounts cannot be the creator; CREATE address follows the nonce", () => {
  assert.equal(creationBlocker("browser"), null);
  assert.match(creationBlocker("passkey") ?? "", /EOA/u);
  assert.notEqual(nextAddress(OWNER, 0), nextAddress(OWNER, 1));
  assert.equal(nextAddress(OWNER, 5), lykiaContracts.deployPlan("mainnet", OWNER, { nonce: 5 }).steps[0]!.predictedAddress);
});
