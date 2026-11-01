/**
 * Ownership hardening for the owner console (admin role). Returns unsigned
 * calls only: the owner sends them from their own wallet and their Safe.
 *
 *   GET /admin/ownership?environment=&safe=&timelock=&delay=
 *
 * LykiaRouter and LykiaOrders are Ownable2Step, so a transfer proposes and
 * the new owner accepts. With a timelock (a LykiaTimelock whose only proposer
 * and executor is the Safe, with no admin), the Safe schedules
 * acceptOwnership and executes it after the delay. LykiaAccountFactory has no
 * owner. Mirrors packages/contracts/scripts/ownership-plan.cjs.
 */
import { keccak256, toHex, encodeFunctionData, parseAbi, type Hex } from "viem";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseQuery } from "../http/validate.js";
import { listDeployments } from "../platform/admin.js";
import { mustSession } from "../platform/session.js";
import { environmentSchema } from "./common.js";

const OWNABLE = parseAbi(["function transferOwnership(address newOwner)", "function acceptOwnership()"]);
const TIMELOCK = parseAbi(["function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)", "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)"]);
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
export const ARC_SAFE_141 = { singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a", proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" } as const;

export function ownershipPlan(input: { targets: readonly { name: string; address: Hex }[]; safe: Hex; timelock?: Hex; delaySeconds: number }) {
  const newOwner = input.timelock ?? input.safe;
  const accept = encodeFunctionData({ abi: OWNABLE, functionName: "acceptOwnership" });
  const steps = input.targets.flatMap(({ name, address }) => {
    const propose = { step: `${name}: propose the new owner`, from: "current owner", to: address, data: encodeFunctionData({ abi: OWNABLE, functionName: "transferOwnership", args: [newOwner] }), value: "0" };
    if (!input.timelock) return [propose, { step: `${name}: accept from the Safe`, from: "safe", to: address, data: accept, value: "0" }];
    const salt = keccak256(toHex(`lykia:accept:${address.toLowerCase()}`));
    return [
      propose,
      { step: `${name}: Safe schedules acceptOwnership`, from: "safe", to: input.timelock, data: encodeFunctionData({ abi: TIMELOCK, functionName: "schedule", args: [address, 0n, accept, ZERO32, salt, BigInt(input.delaySeconds)] }), value: "0" },
      { step: `${name}: Safe executes it after ${input.delaySeconds} s`, from: "safe", to: input.timelock, data: encodeFunctionData({ abi: TIMELOCK, functionName: "execute", args: [address, 0n, accept, ZERO32, salt] }), value: "0" },
    ];
  });
  return { safe: input.safe, timelock: input.timelock ?? null, delaySeconds: input.timelock ? input.delaySeconds : null, factory: "LykiaAccountFactory has no owner: nothing to transfer.", arcSafe141: ARC_SAFE_141, steps, guide: "docs/security/ownership.md", note: "Unsigned calls. Nothing is signed or sent by Lykia." };
}

export const ownershipModule: ApiModule = {
  name: "ownership",
  register(router, ctx) {
    router.get("/admin/ownership", async (req, res) => {
      await mustSession(ctx, req, "admin");
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional(), safe: evmAddress, timelock: evmAddress.optional(), delay: z.coerce.number().int().min(3600).max(30 * 86400).default(172800) }));
      const deployments = await listDeployments(ctx, q.environment ?? ctx.config.mode);
      const targets = deployments.filter((d) => d.contract === "LykiaRouter" || d.contract === "LykiaOrders").map((d) => ({ name: d.name, address: d.address as Hex }));
      res.json(ownershipPlan({ targets, safe: q.safe as Hex, ...(q.timelock ? { timelock: q.timelock as Hex } : {}), delaySeconds: q.delay }));
    });
  },
};
