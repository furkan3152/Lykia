/**
 * Aggregator proofs for `npm run prove`: quote -> build on Arc mainnet for
 * swap, FX, bridge, deposit, withdraw (through an adapter manifest) and a
 * batch, plus the on-chain validation of the example adapter manifest.
 * Each build runs exactly as POST /v1/aggregator/build does: the Fence, one
 * Multicall3From eth_call over the whole route (inputs the owner does not
 * hold funded with state overrides: `preview`) and the security layer on
 * every step. Nothing is signed or broadcast.
 */
import type { Address } from "@lykia/core";
import type { AppContext } from "../context.js";
import { buildAction, quoteAction, type ActionRequest } from "../aggregator/service.js";
import { EXAMPLE_MANIFEST } from "../integrations/example.js";
import { setAdapterStatus, submitAdapter } from "../integrations/registry.js";
import { validateOnChain } from "../integrations/validate.js";

export interface ProofRow {
  readonly flow: string;
  readonly result: "PASS" | "FAIL" | "REFUSED (expected)" | "GATED";
  readonly detail: string;
}

export async function proveAggregator(ctx: AppContext, owner: Address, record: (row: ProofRow) => void): Promise<void> {
  const run = async (flow: string, req: ActionRequest, options: { confirm?: boolean } = {}) => {
    try {
      const quote = await quoteAction(ctx, req);
      const built = await buildAction(ctx, { quoteId: quote.id }, { preview: true, ...(options.confirm ? { confirm: true } : {}) });
      const ok = built.simulation.ok && built.security.decision !== "block";
      const out = quote.buy.map((b) => `${b.amount} ${b.symbol}${b.minimum ? ` (min ${b.minimum})` : ""}`).join(", ");
      record({
        flow,
        result: ok ? "PASS" : "FAIL",
        detail: `${quote.route.steps.map((s) => s.summary).join(" → ")}. Quote ${quote.id.slice(0, 8)}…: ${out ? `out ${out}, ` : ""}impact ${quote.priceImpactBps ?? "n/a"} bps, gas ${Number(quote.gas.usdc).toFixed(5)} USDC, fees $${quote.fees.totalUsd ?? "unpriced"}, ${quote.alternatives.length} alternatives. Build: ${built.transactions.length} tx, ${built.calls.length} calls, simulation ${built.simulation.ok ? `ok at block ${built.simulation.block}` : `failed (${built.simulation.reason})`}, security ${built.security.decision}, Fence ${built.fence.decision}.`,
      });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      record({ flow, result: "FAIL", detail: `${e.code ?? "ERROR"}: ${e.message ?? String(error)}` });
    }
  };
  await run("Aggregator: swap 100 USDC → cirBTC (quote → build)", { kind: "swap", taker: owner, tokenIn: "USDC", tokenOut: "cirBTC", amount: "100", environment: "mainnet" });
  await run("Aggregator: FX 100 USDC → EURC (quote → build)", { kind: "fx", taker: owner, tokenIn: "USDC", tokenOut: "EURC", amount: "100", environment: "mainnet" });
  await run("Aggregator: FX 100 EURC → USDC, integrator fee 20 bps (quote → build)", { kind: "fx", taker: owner, tokenIn: "EURC", tokenOut: "USDC", amount: "100", environment: "mainnet", integratorFee: { bps: 20, recipient: "0x2222222222222222222222222222222222222222" } });
  await run("Aggregator: bridge 50 USDC to Base over CCTP V2 (quote → build)", { kind: "bridge", taker: owner, amount: "50", destination: "base", environment: "mainnet" }, { confirm: true });
  await run("Aggregator: deposit 200 USDC at the best venue (quote → build)", { kind: "deposit", taker: owner, token: "USDC", amount: "200", environment: "mainnet" });
  await run("Aggregator: batch FX 50 USDC → EURC + deposit 100 USDC (quote → build)", { kind: "batch", taker: owner, environment: "mainnet", actions: [{ verb: "fx", from: "USDC", to: "EURC", amount: { exact: "50" } }, { verb: "earn", token: "USDC", amount: { exact: "100" } }] });

  // Adapter manifests: the example validates on chain, then routes once approved.
  const flow = "Adapter manifest: validate the example (eth_getCode, reads, dry simulation of deposit and withdraw)";
  try {
    const validation = await validateOnChain(ctx, EXAMPLE_MANIFEST, "mainnet");
    const failed = validation.checks.filter((c) => !c.ok);
    record({ flow, result: validation.ok ? "PASS" : "FAIL", detail: validation.ok ? `${validation.checks.filter((c) => !c.id.startsWith("info:")).length} checks passed at block ${validation.block}: ${validation.checks.filter((c) => c.id.startsWith("simulate:")).map((c) => c.detail).join(" ")}` : failed.map((c) => `${c.id}: ${c.detail}`).join("; ") });
    if (validation.ok) {
      await submitAdapter(ctx, EXAMPLE_MANIFEST, owner);
      await setAdapterStatus(ctx, EXAMPLE_MANIFEST.protocol.id, "validated", { by: owner, role: "owner", validation });
      await setAdapterStatus(ctx, EXAMPLE_MANIFEST.protocol.id, "approved", { by: "prove", role: "admin" });
      await setAdapterStatus(ctx, EXAMPLE_MANIFEST.protocol.id, "routable", { by: "prove", role: "admin" });
      // Wait out the router's 15 s earn cache, so the new venue is quoted.
      await new Promise((r) => setTimeout(r, 15_500));
      await run("Aggregator: deposit 10 USDC through the routable example adapter (quote → build)", { kind: "deposit", taker: owner, token: "USDC", amount: "10", environment: "mainnet", venue: EXAMPLE_MANIFEST.protocol.id });
    }
  } catch (error) {
    record({ flow, result: "FAIL", detail: error instanceof Error ? error.message : String(error) });
  }
}
