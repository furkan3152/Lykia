/**
 * Lyko Autopilot on Arc mainnet, simulated with eth_call: the session
 * transaction exactly as POST /v1/autopilot/enable builds it, Autopilot steps
 * as the leash wraps them for the session key, the Whistle, and the revoke
 * exactly as POST /v1/autopilot/stop builds it, run against the deployed
 * LykiaAccountFactory and the LykiaAccount implementation behind it. Nothing
 * is signed by an owner or broadcast, and Circle is not called: the Circle
 * Wallets API is answered locally with a stand-in wallet.
 *
 * The session key is Multicall3 (0xcA11…), standing in for the owner's Circle
 * EOA: LykiaAccount checks msg.sender against the session key, and inside one
 * eth_call from the owner only a contract can call the account as itself.
 * Each Autopilot step goes through Multicall3.aggregate3 with the exact
 * account calldata the leash builds (agentTransfer with the Arc Memo carrying
 * the verdict). In production Circle's EOA sends the same account calldata,
 * directly or through Arc's Multicall3From; the account sees the same sender.
 *
 * Run: npm run prove:autopilot -w @lykia/api    (AUTOPILOT_EVIDENCE=path writes the JSON)
 */
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { autopilotAckDigest, contractAddress, lykiaContracts, memoData, memoString, verdictTag, type Address } from "@lykia/core";
import { decodeErrorResult, decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";
import { loadConfig } from "../config.js";
import { closeContext, createContext } from "../context.js";
import { MemoryStore } from "../store/memory.js";
import { systemClock } from "../clock.js";
import { MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { ACCOUNT_ABI, ACCOUNT_ERRORS, sessionIdOf, wrapForSession } from "../leash/chain.js";
import { leashes } from "../leash/store.js";
import { leashService } from "../leash/service.js";
import { autopilotService } from "../autopilot/service.js";

const OWNER = (process.env.PROVE_OWNER ?? "0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb").toLowerCase() as Address;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const MULTICALL3 = (contractAddress("multicall3", "mainnet") as Address).toLowerCase() as Address;
const USDC = contractAddress("usdc", "mainnet") as Address;
const FACTORY = lykiaContracts.deployedAddress("mainnet", "LykiaAccountFactory") as Address;
const LIMITS = { perStepUsd: "100", perDayUsd: "300", days: 7 };
const MC3_ABI = parseAbi(["struct Call3 { address target; bool allowFailure; bytes callData; }", "struct Result { bool success; bytes returnData; }", "function aggregate3(Call3[] calls) payable returns (Result[] returnData)"]);
const WHISTLE_ABI = parseAbi(["function blowWhistle()", "function releaseWhistle()"]);

// The Circle Wallets API, answered locally: an entity public key and one EOA wallet whose address is the stand-in key.
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const circle = async (url: string): Promise<Response> => {
  const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  if (url.endsWith("/config/entity/publicKey")) return reply({ publicKey: pem });
  if (url.endsWith("/developer/walletSets")) return reply({ walletSet: { id: "00000000-0000-4000-8000-000000000000" } });
  if (url.endsWith("/developer/wallets")) return reply({ wallets: [{ id: "00000000-0000-4000-8000-000000000001", address: MULTICALL3, blockchain: "ARC", accountType: "EOA" }] });
  return new Response("{}", { status: 404 });
};
const fetchImpl = ((url: string, init?: RequestInit) => (String(url).startsWith("https://api.circle.com/") ? circle(String(url)) : fetch(url, init))) as typeof fetch;

const config = loadConfig({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/DATABASE_URL|POSTGRES_URL|CIRCLE_/u.test(k))), NODE_ENV: "development", LYKIA_MODE: "mainnet", LYKIA_LOG_LEVEL: "silent", LYKIA_CIRCLE_SERVER_WALLETS: "true", CIRCLE_API_KEY: "TEST_API_KEY:local:stand-in", CIRCLE_ENTITY_SECRET: "0".repeat(63) + "1" });
const ctx = createContext(config, { store: new MemoryStore(systemClock), fetch: fetchImpl as never });
const client = ctx.chains.client("mainnet");

interface Step {
  readonly label: string;
  readonly to: Address;
  readonly data: Hex;
  readonly expect: "ok" | RegExp;
  readonly read?: (data: Hex) => string;
  /** Sent by the session key (through Multicall3): the outcome is the account's own answer. */
  readonly byKey?: boolean;
}

function reason(data: Hex): string {
  for (const abi of [ACCOUNT_ERRORS, parseAbi(["error Error(string)"])]) {
    try {
      const e = decodeErrorResult({ abi, data });
      return `${e.errorName}(${(e.args ?? []).map(String).join(", ")})`;
    } catch {
      /* next */
    }
  }
  return data.slice(0, 74);
}

/** A step from the session key: the account calls in one Multicall3 aggregate3, each allowed to fail so its own error is kept. */
function fromKey(label: string, account: Address, calls: readonly Hex[], expect: Step["expect"]): Step {
  return { label, to: MULTICALL3, data: encodeFunctionData({ abi: MC3_ABI, functionName: "aggregate3", args: [calls.map((callData) => ({ target: account, allowFailure: true, callData }))] }), expect, byKey: true };
}

async function batch(name: string, steps: readonly Step[]) {
  const data = encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [steps.map((s) => ({ target: s.to, allowFailure: true, callData: s.data }))] });
  const block = await client.getBlockNumber();
  const balance = await client.getBalance({ address: OWNER, blockNumber: block });
  const raw = await client.call({ account: OWNER, to: contractAddress("multicall3From", "mainnet") as Address, data, blockNumber: block, stateOverride: [{ address: OWNER, balance: balance + 1_000n * 10n ** 18n }] });
  const results = decodeFunctionResult({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", data: raw.data as Hex }) as readonly { success: boolean; returnData: Hex }[];
  const rows = steps.map((s, i) => {
    const r = results[i]!;
    let ok = r.success;
    let outcome = r.success ? (s.read ? s.read(r.returnData) : "ok") : `reverted: ${reason(r.returnData)}`;
    if (s.byKey && r.success) {
      const inner = decodeFunctionResult({ abi: MC3_ABI, functionName: "aggregate3", data: r.returnData }) as readonly { success: boolean; returnData: Hex }[];
      const failed = inner.find((x) => !x.success);
      ok = !failed;
      outcome = failed ? `reverted: ${reason(failed.returnData)}` : `ok (${inner.length} account call${inner.length === 1 ? "" : "s"})`;
    }
    const pass = s.expect === "ok" ? ok : !ok && s.expect.test(outcome);
    return { call: s.label, to: s.to, selector: s.data.slice(0, 10), outcome, expected: s.expect === "ok" ? "success" : `revert ${s.expect.source}`, pass };
  });
  for (const row of rows) process.stdout.write(`${row.pass ? "PASS" : "FAIL"}  ${name} · ${row.call}: ${row.outcome}\n`);
  return { name, block: block.toString(), method: "eth_call (Multicall3From.aggregate3 from the owner; state override: the owner's native USDC balance only)", rpc: config.networks["arc-mainnet"].rpcUrls[0], rows };
}

async function main() {
  const ap = autopilotService(ctx);
  // 1. POST /v1/autopilot/enable, as the API builds it (the beta ceilings: $100 a step, $300 a day).
  const enabled = await ap.enable({ owner: OWNER, environment: "mainnet", ack: autopilotAckDigest(), limits: LIMITS, payees: [PAYEE], publicBaseUrl: "https://api.lykiaai.com" });
  const leash = await leashService(ctx).get(enabled.autopilot.leashId);
  const account = leash.session!.account;
  const [accountTx, sessionTx] = enabled.transactions.length === 2 ? enabled.transactions : [null, enabled.transactions[0]!];
  if (!sessionTx) throw new Error("no session transaction");
  const spec = decodeFunctionData({ abi: lykiaContracts.lykiaAccountArtifact.abi, data: sessionTx.data });
  const sessionId = sessionIdOf(account, MULTICALL3, BigInt(leash.session!.nonceAtCreation) + 1n);
  await leashes(ctx).put(leash.id, { ...leash, status: "active", session: { ...leash.session!, sessionId } });

  // 2. Autopilot steps as the leash wraps a transfer step for the session key: the payment and Lykia's 1% fee, each an agentTransfer with the memo.
  const feeTo = config.fee.recipient as Address;
  const step = (n: number, usdc: bigint, to: Address = PAYEE): Hex[] => {
    const memo = memoData({ intentId: `out_autopilot${n}`, stepId: "s1", verdict: verdictTag(`sha256:${String(n).padStart(64, "0")}`) });
    const fee = (usdc * 100n) / 10_000n;
    return wrapForSession(
      [{ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, usdc] }), value: "0" }, ...(fee > 0n && to !== OWNER ? [{ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [feeTo, fee] }), value: "0" }] : [])],
      { account, sessionId, memo },
    ).map((w) => w.data as Hex);
  };
  const memoExample = memoString({ intentId: "out_autopilot1", stepId: "s1", verdict: verdictTag(`sha256:${"1".padStart(64, "0")}`) });
  // 3. POST /v1/autopilot/stop, as the API builds it.
  const stopped = await ap.stop(OWNER, "mainnet", "owner");
  if (!stopped.transaction) throw new Error("no revoke transaction");
  const view = (fn: "isSessionValid" | "spendable"): Step => ({
    label: `${fn}()`,
    to: account,
    data: fn === "spendable" ? encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "spendable", args: [sessionId, USDC] }) : encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "isSessionValid", args: [sessionId] }),
    expect: "ok",
    read: (d) => {
      const v = decodeFunctionResult({ abi: ACCOUNT_ABI, functionName: fn, data: d });
      return fn === "spendable" ? `${(v as bigint).toString()} USDC units` : String(v);
    },
  });

  const result = await batch("Autopilot", [
    ...(accountTx ? [{ label: "createAccount (the API's first transaction, on the deployed factory)", to: accountTx.to, data: accountTx.data, expect: "ok" as const, read: (d: Hex) => `account ${decodeFunctionResult({ abi: lykiaContracts.lykiaAccountFactoryArtifact.abi, functionName: "createAccount", data: d })}` }] : []),
    { label: "fund the account with 400 USDC", to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, 400_000_000n] }), expect: "ok" },
    { label: "createSession (POST /v1/autopilot/enable's session transaction, key = the Autopilot signer)", to: sessionTx.to, data: sessionTx.data, expect: "ok", read: (d) => `session ${decodeFunctionResult({ abi: lykiaContracts.lykiaAccountArtifact.abi, functionName: "createSession", data: d })}` },
    view("spendable"),
    fromKey("Autopilot step: pay 50 USDC + 0.50 fee (inside the caps)", account, step(1, 50_000_000n), "ok"),
    fromKey("Autopilot step: pay 150 USDC (above the $100 per-call cap)", account, step(2, 150_000_000n).slice(0, 1), /PerCallCapExceeded/u),
    fromKey("Autopilot step: pay 99 USDC + 0.99 fee (150.49 of 300 today)", account, step(3, 99_000_000n), "ok"),
    fromKey("Autopilot step: pay 99 USDC + 0.99 fee (250.48 of 300 today)", account, step(4, 99_000_000n), "ok"),
    fromKey("Autopilot step: pay 60 USDC (over the $300 daily cap)", account, step(5, 60_000_000n).slice(0, 1), /DailyCapExceeded/u),
    fromKey("Autopilot step: pay a stranger 1 USDC (not a payee of the session)", account, step(6, 1_000_000n, "0x3333333333333333333333333333333333333333" as Address).slice(0, 1), /RecipientNotAllowed/u),
    view("spendable"),
    { label: "blowWhistle (the owner)", to: account, data: encodeFunctionData({ abi: WHISTLE_ABI, functionName: "blowWhistle" }), expect: "ok" },
    fromKey("Autopilot step under the Whistle: pay 1 USDC to the payee", account, step(7, 1_000_000n).slice(0, 1), /WhistleBlownOnlyHomeward/u),
    fromKey("Autopilot step under the Whistle: 1 USDC home to the owner", account, step(8, 1_000_000n, OWNER), "ok"),
    { label: "releaseWhistle (the owner)", to: account, data: encodeFunctionData({ abi: WHISTLE_ABI, functionName: "releaseWhistle" }), expect: "ok" },
    { label: "revokeSession (POST /v1/autopilot/stop's transaction)", to: stopped.transaction.to, data: stopped.transaction.data, expect: "ok" },
    view("isSessionValid"),
    view("spendable"),
    fromKey("Autopilot step after Stop: pay 1 USDC", account, step(9, 1_000_000n).slice(0, 1), /SessionInvalid/u),
  ]);

  const evidence = {
    at: new Date().toISOString(),
    network: "Arc mainnet (chain 5042)",
    factory: FACTORY,
    owner: OWNER,
    account,
    accountExisted: accountTx === null,
    limits: LIMITS,
    signerStandIn: MULTICALL3,
    sessionId,
    memoExample,
    sessionSpec: JSON.parse(JSON.stringify(spec.args, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))),
    batches: [result],
  };
  if (process.env.AUTOPILOT_EVIDENCE) writeFileSync(process.env.AUTOPILOT_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  const failed = result.rows.filter((r) => !r.pass).length;
  process.stdout.write(`\naccount ${account} · session ${sessionId} · block ${result.block}\n${failed === 0 ? "All calls behaved as expected." : `${failed} call(s) did not behave as expected.`}\n`);
  await closeContext(ctx);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await closeContext(ctx).catch(() => undefined);
  process.exit(1);
});
