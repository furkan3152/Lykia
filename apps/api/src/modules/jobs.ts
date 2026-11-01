/**
 * ERC-8183 agent jobs on Arc testnet: a client escrows USDC for a provider
 * agent, an evaluator releases or rejects. Lykia reads jobs and builds the
 * unsigned calls; the owner's or agent's wallet signs. Testnet only: the
 * reference AgenticCommerce contract is not deployed on mainnet.
 *
 *   GET  /jobs/:id?environment=testnet         the job (client, provider, evaluator, budget, status)
 *   POST /jobs/draft                           createJob
 *   POST /jobs/:id/fund                        setBudget + approve + fund
 *   POST /jobs/:id/complete | /reject          evaluator decisions
 *   POST /jobs/:id/refund                      claimRefund after expiry
 */
import { contractAddress, toBaseUnitsBig, type Address, type UnsignedTransaction } from "@lykia/core";
import { encodeFunctionData, parseAbi, stringToHex, type Hex } from "viem";
import { z } from "zod";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams } from "../http/validate.js";

export const AGENTIC_COMMERCE_ABI = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, bytes optParams)",
  "function complete(uint256 jobId, bytes32 reason, bytes optParams)",
  "function reject(uint256 jobId, bytes32 reason, bytes optParams)",
  "function claimRefund(uint256 jobId)",
  "function paymentToken() view returns (address)",
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))",
]);
const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const STATUS = ["open", "funded", "submitted", "completed", "rejected", "expired"] as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const CHAIN = 5042002;

const IdParams = z.object({ id: z.string().regex(/^\d{1,20}$/u) });
const reason = (text: string | undefined): Hex => (text ? stringToHex(text.slice(0, 31), { size: 32 }) : `0x${"0".repeat(64)}`);

function escrow(): Address {
  const address = contractAddress("agenticCommerce", "testnet");
  if (!address) throw new LykiaHttpError("NO_ROUTE", 422, "ERC-8183 AgenticCommerce is only deployed on Arc testnet.");
  return address;
}

export const jobsModule: ApiModule = {
  name: "jobs",
  register(router, ctx) {
    router.get("/jobs/:id", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const client = ctx.chains.client("testnet");
      const job = (await client.readContract({ address: escrow(), abi: AGENTIC_COMMERCE_ABI, functionName: "getJob", args: [BigInt(id)] })) as { id: bigint; client: Address; provider: Address; evaluator: Address; description: string; budget: bigint; expiredAt: bigint; status: number; hook: Address };
      res.json({ id, client: job.client, provider: job.provider, evaluator: job.evaluator, description: job.description, budgetUnits: job.budget.toString(), expiredAt: new Date(Number(job.expiredAt) * 1000).toISOString(), status: STATUS[job.status] ?? `status-${job.status}`, hook: job.hook, environment: "testnet" });
    });

    router.post("/jobs/draft", async (req, res) => {
      const b = parseBody(req, z.object({ owner: evmAddress, provider: evmAddress, evaluator: evmAddress.optional(), description: z.string().min(3).max(500), expiresInHours: z.number().int().min(1).max(24 * 90) }));
      const expiredAt = BigInt(Math.floor(ctx.clock.now() / 1000) + b.expiresInHours * 3600);
      const tx: UnsignedTransaction = { chainId: CHAIN, from: b.owner as Address, to: escrow(), data: encodeFunctionData({ abi: AGENTIC_COMMERCE_ABI, functionName: "createJob", args: [b.provider as Address, (b.evaluator ?? b.owner) as Address, expiredAt, b.description, ZERO] }), value: "0", label: `Create an ERC-8183 job for ${b.provider}` };
      res.json({ transactions: [tx], note: "The job id is in the JobCreated event of the receipt; fund it next with POST /v1/jobs/:id/fund." });
    });

    router.post("/jobs/:id/fund", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const b = parseBody(req, z.object({ owner: evmAddress, amount: z.string().regex(/^\d{1,9}(?:\.\d{1,6})?$/u) }));
      const token = (await ctx.chains.client("testnet").readContract({ address: escrow(), abi: AGENTIC_COMMERCE_ABI, functionName: "paymentToken" })) as Address;
      const units = toBaseUnitsBig(b.amount, 6);
      const from = b.owner as Address;
      const txs: UnsignedTransaction[] = [
        { chainId: CHAIN, from, to: escrow(), data: encodeFunctionData({ abi: AGENTIC_COMMERCE_ABI, functionName: "setBudget", args: [BigInt(id), units, "0x"] }), value: "0", label: `Set job ${id} budget to ${b.amount}` },
        { chainId: CHAIN, from, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [escrow(), units] }), value: "0", label: `Approve ${b.amount} to the job escrow` },
        { chainId: CHAIN, from, to: escrow(), data: encodeFunctionData({ abi: AGENTIC_COMMERCE_ABI, functionName: "fund", args: [BigInt(id), "0x"] }), value: "0", label: `Fund job ${id}` },
      ];
      res.json({ transactions: txs, paymentToken: token });
    });

    for (const action of ["complete", "reject"] as const) {
      router.post(`/jobs/:id/${action}`, async (req, res) => {
        const { id } = parseParams(req, IdParams);
        const b = parseBody(req, z.object({ evaluator: evmAddress, reason: z.string().max(31).optional() }));
        res.json({ transactions: [{ chainId: CHAIN, from: b.evaluator as Address, to: escrow(), data: encodeFunctionData({ abi: AGENTIC_COMMERCE_ABI, functionName: action, args: [BigInt(id), reason(b.reason), "0x"] }), value: "0", label: `${action === "complete" ? "Release" : "Reject"} job ${id}` } satisfies UnsignedTransaction] });
      });
    }

    router.post("/jobs/:id/refund", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const b = parseBody(req, z.object({ owner: evmAddress }));
      res.json({ transactions: [{ chainId: CHAIN, from: b.owner as Address, to: escrow(), data: encodeFunctionData({ abi: AGENTIC_COMMERCE_ABI, functionName: "claimRefund", args: [BigInt(id)] }), value: "0", label: `Claim the refund of job ${id}` } satisfies UnsignedTransaction] });
    });
  },
};
