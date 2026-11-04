/**
 * Circle-on-Arc proofs for `npm run prove`, against Arc mainnet and Circle's
 * live keyless APIs. Nothing is signed by a real key, submitted to Circle
 * or broadcast:
 *  - CCTP V2 with the Forwarding Service: live Iris fee, then approve +
 *    depositForBurnWithHook run as one Multicall3From eth_call from the owner;
 *  - Gateway: Gateway's own /v1/estimate (forwarded) sets maxFee and expiry;
 *    the burn intent is signed by a throwaway key and recovered (never sent);
 *  - USYC: the Entitlements read gates the Teller (fail-closed), and the
 *    Teller itself refuses the same calldata from a non-entitled wallet;
 *  - Compliance Engine: only with CIRCLE_API_KEY (otherwise GATED).
 */
import { contractAddress, type Address } from "@lykia/core";
import { decodeFunctionResult, encodeFunctionData, recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { AppContext } from "../context.js";
import { cctpTransferStatus, forwardedBridge } from "../circle/cctp.js";
import { screenAddress } from "../circle/compliance.js";
import { draftGatewayTransferEstimated } from "../circle/gateway.js";
import { planUsyc, usycEligibility, USYC_TELLER_ABI } from "../circle/usyc.js";
import { MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { revertReason } from "../engine/simulate.js";
import type { ProofRow } from "./proveAggregator.js";

const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;

export async function proveCircle(ctx: AppContext, owner: Address, record: (row: ProofRow) => void): Promise<void> {
  const client = ctx.chains.client("mainnet");

  /** One aggregate3 from the owner, native USDC topped up (USDC is Arc's native asset, so this funds the ERC-20 face too). */
  const batch = async (calls: readonly { to: string; data: string; label: string }[]) => {
    const data = encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [calls.map((c) => ({ target: c.to as Address, allowFailure: true, callData: c.data as Hex }))] });
    const balance = await client.getBalance({ address: owner });
    const block = await client.getBlockNumber();
    const result = await client.call({ account: owner, to: contractAddress("multicall3From", "mainnet") as Address, data, blockNumber: block, stateOverride: [{ address: owner, balance: balance + 1_000n * 10n ** 18n }] });
    const decoded = decodeFunctionResult({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", data: result.data as Hex }) as readonly { success: boolean; returnData: Hex }[];
    const index = decoded.findIndex((r) => !r.success);
    return { ok: index < 0, block, reason: index < 0 ? null : `${calls[index]!.label}: ${revertReason(decoded[index]!.returnData)}` };
  };

  // CCTP V2 + Forwarding Service, built exactly as POST /v1/circle/cctp/forward builds it.
  {
    const flow = "Circle CCTP V2: 25 USDC to Base with the Forwarding Service (approve + depositForBurnWithHook, one Multicall3From call)";
    try {
      const built = await forwardedBridge(ctx.fetch, { environment: "mainnet", owner, recipient: RECIPIENT, destination: "base", amountUnits: 25_000_000n, fast: false });
      const sim = await batch(built.transactions.map((t) => ({ to: t.to, data: t.data, label: t.label })));
      const unseen = await cctpTransferStatus(ctx.fetch, "mainnet", `0x${"00".repeat(32)}`).catch(() => null);
      record({ flow, result: sim.ok ? "PASS" : "FAIL", detail: `${sim.ok ? `ok at block ${sim.block}` : sim.reason}. Live Iris fee: forwarding ${built.fee.forwardFee?.med ?? "?"} units (med), protocol ${built.fee.minimumFeeBps} bps at threshold ${built.finalityThreshold}; burn ${built.burn} units, maxFee ${built.maxFee}. Iris status endpoint answered ${unseen ? (unseen.found ? "found" : "not found (expected for a zero hash)") : "an error"}.` });
    } catch (error) {
      record({ flow, result: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  // Gateway: the estimate is Circle's; the signature is a throwaway key's and never leaves this process.
  {
    const flow = "Circle Gateway: forwarded transfer of 10 USDC Arc → Base, maxFee from Gateway's /v1/estimate, burn intent signed and recovered (not submitted)";
    try {
      const signer = privateKeyToAccount(generatePrivateKey());
      const draft = await draftGatewayTransferEstimated(ctx.fetch, { environment: "mainnet", depositor: signer.address, destination: "base", valueUnits: 10_000_000n, forward: true });
      const typed = draft.typedData[0] as Parameters<typeof signer.signTypedData>[0];
      const signature = await signer.signTypedData(typed);
      const recovered = await recoverTypedDataAddress({ ...(typed as object), signature } as Parameters<typeof recoverTypedDataAddress>[0]);
      const ok = recovered.toLowerCase() === signer.address.toLowerCase() && draft.fee.source === "estimate";
      record({ flow, result: ok ? "PASS" : "FAIL", detail: `fee source ${draft.fee.source}, maxFee ${draft.fee.maxFee} units (forwarding fee ${draft.fee.forwardingFeeUsdc ?? "?"} USDC), expiry block ${(draft.burnIntents[0] as { maxBlockHeight: string }).maxBlockHeight}; EIP-712 signature recovers to the depositor. Submitting needs a funded Gateway balance and the owner's signature.` });
    } catch (error) {
      record({ flow, result: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  // USYC: Lykia refuses before building; the Teller refuses the same calldata on chain.
  {
    const flow = "Circle USYC: subscribe 100 USDC from a wallet without USYC entitlement";
    try {
      const eligibility = await usycEligibility(ctx.chains, "mainnet", owner);
      const preview = (await client.readContract({ address: eligibility.contracts.teller, abi: USYC_TELLER_ABI, functionName: "previewDeposit", args: [100_000_000n] })) as bigint;
      let lykia = "built";
      try {
        await planUsyc(ctx.chains, { environment: "mainnet", owner, side: "subscribe", amountUnits: 100_000_000n });
      } catch (error) {
        lykia = `refused (${error instanceof Error ? error.message.split(".")[0] : "error"})`;
      }
      const raw = [
        { to: eligibility.contracts.usdc, data: encodeFunctionData({ abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [eligibility.contracts.teller, 100_000_000n] }), label: "approve" },
        { to: eligibility.contracts.teller, data: encodeFunctionData({ abi: USYC_TELLER_ABI, functionName: "deposit", args: [100_000_000n, owner] }), label: "Teller.deposit" },
      ];
      const sim = await batch(raw);
      const expected = eligibility.subscribe === false && lykia.startsWith("refused") && !sim.ok;
      record({ flow, result: expected ? "REFUSED (expected)" : eligibility.subscribe ? "PASS" : "FAIL", detail: `Entitlements.canCall(owner, Teller, deposit) = ${eligibility.subscribe}; Lykia ${lykia}; the Teller ${sim.ok ? "accepted" : `reverts the same calldata (${sim.reason})`}. Teller preview: 100 USDC → ${Number(preview) / 1e6} USYC.` });
    } catch (error) {
      record({ flow, result: "FAIL", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  // Compliance Engine: needs a key with Compliance Engine access.
  {
    const flow = "Circle Compliance Engine: screen a recipient before planning";
    const apiKey = ctx.config.circle.apiKey;
    if (!apiKey) {
      record({ flow, result: "GATED", detail: "CIRCLE_API_KEY is not set; recipients are reported as not screened, never as approved." });
    } else {
      const r = await screenAddress(ctx.fetch, apiKey, "mainnet", RECIPIENT, Date.now());
      record({ flow, result: r.result === "UNKNOWN" ? "GATED" : "PASS", detail: `${r.result}${r.screenedAs ? ` (as ${r.screenedAs})` : ""}${r.reason ? `: ${r.reason}` : ""}` });
    }
  }
}
