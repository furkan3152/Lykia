// Plan -> verdict -> prepare -> simulate -> (optionally) sign and submit, with @lykia/sdk and viem.
//
// By default the calls are only simulated with eth_call from the owner; nothing is signed or sent.
// To execute for real, set PRIVATE_KEY (the owner's key, kept on your machine) and EXECUTE=1.
import { Lykia } from "@lykia/sdk";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const API = process.env.LYKIA_API ?? "https://api.lykiaai.com";
const arc = defineChain({ id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } } });
const account = process.env.PRIVATE_KEY ? privateKeyToAccount(process.env.PRIVATE_KEY) : null;
const owner = account?.address ?? process.env.OWNER ?? "0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb";
const execute = process.env.EXECUTE === "1" && account !== null;

const lykia = new Lykia({ baseUrl: API, environment: "mainnet", ...(process.env.LYKIA_API_KEY ? { apiKey: process.env.LYKIA_API_KEY } : {}) });
const chain = createPublicClient({ chain: arc, transport: http() });

const fees = await lykia.fees();
console.log(`Lykia fee: ${fees.percent} to ${fees.recipient}`);

// 1. Plan. Lykia compares every Arc venue and puts its fee inside the step.
const plan = await lykia.intents.create({ owner, text: process.env.SENTENCE ?? "swap 20 USDC to EURC" });
const { intent } = plan;
console.log(`\nPlan ${intent.id} (${intent.steps.length} step${intent.steps.length === 1 ? "" : "s"})`);
for (const s of intent.steps) console.log(`  ${s.id} ${s.summary}${s.route ? `\n     why: ${s.route.reason}` : ""}`);

// 2. The Fence verdict, with one reason per rule and a digest that goes in the Arc Memo.
console.log(`Verdict: ${intent.verdict.decision} (${intent.verdict.digest.slice(0, 20)}…)`);
for (const r of intent.verdict.reasons.filter((r) => r.decision !== "allow")) console.log(`  - ${r.rule}: ${r.message}`);
if (intent.verdict.decision === "deny") process.exit(0);

// 3. Prepare each ready step and simulate it from the owner. With EXECUTE=1, sign it in your own wallet and report the hash.
const wallet = execute ? createWalletClient({ account, chain: arc, transport: http() }) : null;
for (const step of intent.steps) {
  if (step.status !== "ready") {
    console.log(`  ${step.id}: waits for ${step.dependsOn.join(", ")}`);
    continue;
  }
  const prepared = await lykia.intents.prepare(intent.id, step.id, { confirm: true });
  const hashes = [];
  for (const tx of prepared.transactions) {
    await chain.call({ account: tx.from, to: tx.to, data: tx.data, value: BigInt(tx.value) });
    console.log(`  ${step.id} simulated on Arc mainnet: ${tx.label}`);
    if (wallet) hashes.push(await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) }));
  }
  if (!wallet) continue;
  for (const hash of hashes) await chain.waitForTransactionReceipt({ hash });
  const result = await lykia.intents.submit(intent.id, step.id, hashes);
  console.log(`  ${step.id}: ${result.step.status} ${hashes.join(", ")}`);
}
if (!execute) console.log("\nSimulated only. Set PRIVATE_KEY and EXECUTE=1 to sign from your own wallet.");
