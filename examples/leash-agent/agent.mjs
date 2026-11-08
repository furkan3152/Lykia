// An agent that lives outside Lykia and spends only inside its leash.
//
// It holds two things the owner gave it: a leash key (lk_leash_…), which
// works for this one leash and nothing else, and its own session key, which
// the owner's LykiaAccount accepts within the leash's on-chain caps. It asks
// Lykia to plan, signs the one transaction that comes back with its session
// key, and reports the hash. Anything outside the leash comes back as a
// clean refusal: reason codes and what is left.
import { Lykia, LykiaError } from "@lykia/sdk";

/**
 * Runs the agent's tasks in order. `send(tx)` signs and broadcasts one
 * transaction from the session key and returns its hash; without it the
 * agent only plans.
 */
export async function runLeashedAgent({ lykia, leashId, tasks, send = null, log = console.log }) {
  const leash = await lykia.leashes.get(leashId);
  const u = leash.usage;
  log(`${leash.agentName} on ${leash.id} (${leash.template}): $${u.day.remainingUsd} left today, $${u.total.remainingUsd} in total, until ${leash.expiresAt}.`);
  const results = [];
  for (const task of tasks) {
    try {
      let plan = await lykia.leashes.plan(leashId, { text: task });
      log(`OK     "${task}": ${plan.intent.steps.map((s) => s.summary).join("; ")} (Fence ${plan.intent.verdict.decision}, verdict ${plan.intent.verdict.digest.slice(7, 23)})`);
      let step = plan.prepared;
      const settled = [];
      while (step) {
        if (!send) {
          log(`       to sign: ${step.transaction.label} -> ${step.transaction.to} (${step.calls.map((c) => c.kind).join(" + ")}); not sent.`);
          break;
        }
        const hash = await send(step.transaction);
        const done = await lykia.leashes.submit(leashId, { intentId: step.intentId, stepId: step.stepId, hash });
        log(`       ${step.stepId} ${done.status}${done.chainProven ? ", proven on chain" : ""}: ${hash}`);
        settled.push({ stepId: step.stepId, hash, status: done.status, chainProven: done.chainProven });
        step = done.next;
      }
      results.push({ task, ok: true, intentId: plan.intent.id, settled });
    } catch (error) {
      if (!(error instanceof LykiaError) || error.code !== "LEASH_DENIED") throw error;
      const { reasons, remaining } = error.details;
      log(`DENIED "${task}": ${reasons.map((r) => `[${r.code}] ${r.message}`).join(" ")} Left: $${remaining.stepUsd} a step, $${remaining.dayUsd} today, $${remaining.totalUsd} in total.`);
      results.push({ task, ok: false, reasons: reasons.map((r) => r.code), remaining });
    }
  }
  return results;
}

/** From the command line: LYKIA_LEASH_KEY, LYKIA_LEASH_ID, and AGENT_PRIVATE_KEY with SEND=1 to sign. */
async function main() {
  const key = process.env.LYKIA_LEASH_KEY;
  const leashId = process.env.LYKIA_LEASH_ID;
  if (!key || !leashId) {
    console.log("Set LYKIA_LEASH_KEY and LYKIA_LEASH_ID (from POST /v1/leashes, `lykia leash create` or the Fold). Add AGENT_PRIVATE_KEY and SEND=1 to sign.");
    return;
  }
  const lykia = new Lykia({ apiKey: key, ...(process.env.LYKIA_API ? { baseUrl: process.env.LYKIA_API } : {}) });
  let send = null;
  if (process.env.SEND === "1" && process.env.AGENT_PRIVATE_KEY) {
    const { createWalletClient, http, defineChain } = await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const arc = defineChain({ id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } } });
    const wallet = createWalletClient({ account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY), chain: arc, transport: http() });
    send = (tx) => wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
  }
  await runLeashedAgent({ lykia, leashId, send, tasks: [process.env.TASK ?? "swap 5 USDC to EURC", "swap 5000 USDC to EURC"] });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
