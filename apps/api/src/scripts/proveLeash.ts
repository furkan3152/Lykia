/**
 * Leash on Arc mainnet, simulated with eth_call: the exact calldata the
 * leash API builds, run against the deployed LykiaAccountFactory and the
 * LykiaAccount implementation behind it. Nothing is signed by an owner or
 * broadcast.
 *
 * No account has been created from the mainnet factory yet, so each run
 * creates the owner's account inside the simulation (the factory's own
 * createAccount, the address it predicts), funds it, and then runs the
 * leash's transactions in order in one Multicall3From batch from the owner:
 *
 *   A. root leash: createSession (as POST /v1/leashes builds it) -> an agent
 *      transfer inside the caps -> one above the per-call cap (reverts) ->
 *      revokeSession (as POST /v1/leashes/:id/revoke builds it) -> the
 *      session's state after revocation -> a transfer after revocation.
 *   B. sub-agent leash: a parent session, then createSubSession (as the API
 *      builds it for a parent agent's session) sent by the parent key, the
 *      same checks, and revocation by the owner.
 *
 * In B the parent session's key is Multicall3 (0xcA11…): a contract that
 * calls with itself as msg.sender, so the sub-session call reaches the
 * account from the parent key inside the same eth_call. In production the
 * parent key is the parent agent's own address; the calldata is the same.
 * The API reads the parent's session on chain before it builds a
 * sub-session; here that one read is answered with the session batch B
 * creates, since it exists only inside the simulation.
 * Agent transfers are agentTransferWithSig, signed by a fresh session key.
 *
 * Run: npm run prove:leash -w @lykia/api    (LEASH_EVIDENCE=path writes the JSON)
 */
import { writeFileSync } from "node:fs";
import { contractAddress, lykiaContracts, type Address, type LeashBudget } from "@lykia/core";
import { decodeErrorResult, decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi, keccak256, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config.js";
import { closeContext, createContext } from "../context.js";
import { MemoryStore } from "../store/memory.js";
import { systemClock } from "../clock.js";
import { MULTICALL3_FROM_ABI } from "../engine/abis.js";
import { agentServices } from "../agents/index.js";
import { buildSessionTx } from "../agents/onchain.js";
import { ACCOUNT_ABI, ACCOUNT_ERRORS, sessionIdOf } from "../leash/chain.js";
import { leashService } from "../leash/service.js";
import { leashes } from "../leash/store.js";

const OWNER = (process.env.PROVE_OWNER ?? "0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb").toLowerCase() as Address;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const MULTICALL3 = contractAddress("multicall3", "mainnet") as Address;
const USDC = contractAddress("usdc", "mainnet") as Address;
const FACTORY = lykiaContracts.deployedAddress("mainnet", "LykiaAccountFactory") as Address;
const BUDGET: LeashBudget = { perStepUsd: "25", perDayUsd: "50", totalUsd: "100" };
const MC3_ABI = parseAbi(["struct Call3 { address target; bool allowFailure; bytes callData; }", "struct Result { bool success; bytes returnData; }", "function aggregate3(Call3[] calls) payable returns (Result[] returnData)"]);

const config = loadConfig({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/DATABASE_URL|POSTGRES_URL/u.test(k))), NODE_ENV: "development", LYKIA_MODE: "mainnet", LYKIA_LOG_LEVEL: "silent" });
const ctx = createContext(config, { store: new MemoryStore(systemClock) });
const client = ctx.chains.client("mainnet");

interface Step {
  readonly label: string;
  readonly to: Address;
  readonly data: Hex;
  readonly expect: "ok" | RegExp;
  /** How to read the return data. */
  readonly read?: (data: Hex) => string;
}

function reason(data: Hex): string {
  try {
    const e = decodeErrorResult({ abi: ACCOUNT_ERRORS, data });
    return `${e.errorName}(${(e.args ?? []).map(String).join(", ")})`;
  } catch {
    try {
      const e = decodeErrorResult({ abi: parseAbi(["error Error(string)"]), data });
      return `Error(${String(e.args?.[0])})`;
    } catch {
      return data.slice(0, 74);
    }
  }
}

async function batch(name: string, steps: readonly Step[]) {
  const data = encodeFunctionData({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", args: [steps.map((s) => ({ target: s.to, allowFailure: true, callData: s.data }))] });
  const block = await client.getBlockNumber();
  const balance = await client.getBalance({ address: OWNER, blockNumber: block });
  const raw = await client.call({ account: OWNER, to: contractAddress("multicall3From", "mainnet") as Address, data, blockNumber: block, stateOverride: [{ address: OWNER, balance: balance + 1_000n * 10n ** 18n }] });
  const results = decodeFunctionResult({ abi: MULTICALL3_FROM_ABI, functionName: "aggregate3", data: raw.data as Hex }) as readonly { success: boolean; returnData: Hex }[];
  const rows = steps.map((s, i) => {
    const r = results[i]!;
    const outcome = r.success ? (s.read ? s.read(r.returnData) : "ok") : `reverted: ${reason(r.returnData)}`;
    const pass = s.expect === "ok" ? r.success : !r.success && s.expect.test(outcome);
    return { call: s.label, to: s.to, selector: s.data.slice(0, 10), outcome, expected: s.expect === "ok" ? "success" : `revert ${s.expect.source}`, pass };
  });
  for (const row of rows) process.stdout.write(`${row.pass ? "PASS" : "FAIL"}  ${name} · ${row.call}: ${row.outcome}\n`);
  return { name, block: block.toString(), method: "eth_call (Multicall3From.aggregate3 from the owner; state override: the owner's native USDC balance only)", rpc: config.networks["arc-mainnet"].rpcUrls[0], rows };
}

async function main() {
  const s = leashService(ctx);
  const pack = agentServices(ctx).pack;
  const out: unknown[] = [];

  /* ------------------------------------------------ A. root leash */
  const agentA = privateKeyToAccount(generatePrivateKey());
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const created = await s.create({ via: "session", developer: OWNER }, { owner: OWNER, environment: "mainnet", agent: { name: "Invoice bot", signer: agentA.address }, template: "pay-invoices", budget: BUDGET, expiresAt, recipients: [PAYEE], publicBaseUrl: "https://api.lykiaai.com" });
  const account = created.session.account;
  const [accountTx, sessionTx] = created.transactions.length === 2 ? created.transactions : [null, created.transactions[0]!];
  if (!sessionTx) throw new Error("no session transaction");
  const nonceA = BigInt(created.leash.session!.nonceAtCreation) + 1n;
  const idA = sessionIdOf(account, agentA.address, nonceA);
  // The revoke transaction exactly as POST /v1/leashes/:id/revoke builds it once the session is bound.
  await leashes(ctx).put(created.leash.id, { ...(await s.get(created.leash.id)), status: "active", session: { ...created.leash.session!, sessionId: idA } });
  const revokedA = await s.revoke(await s.get(created.leash.id));
  if (!revokedA.transaction) throw new Error("no revoke transaction");
  const specA = decodeFunctionData({ abi: lykiaContracts.lykiaAccountArtifact.abi, data: sessionTx.data });

  const transfer = (signer: typeof agentA, sessionId: Hex, amount: bigint, nonce: bigint) => async (): Promise<Hex> => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await signer.signTypedData({
      domain: { name: "LykiaAccount", version: "1", chainId: 5042, verifyingContract: account },
      types: { AgentTransfer: [{ name: "sessionId", type: "bytes32" }, { name: "token", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "memoHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "AgentTransfer",
      message: { sessionId, token: USDC, to: PAYEE, amount, memoHash: keccak256("0x"), nonce, deadline },
    });
    return encodeFunctionData({ abi: lykiaContracts.lykiaAccountArtifact.abi, functionName: "agentTransferWithSig", args: [sessionId, USDC, PAYEE, amount, "0x", nonce, deadline, signature] });
  };
  const view = (fn: "isSessionValid" | "spendable" | "getSession", id: Hex): Step => ({
    label: fn === "getSession" ? "getSession (after)" : `${fn}()`,
    to: account,
    data: fn === "spendable" ? encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "spendable", args: [id, USDC] }) : fn === "isSessionValid" ? encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "isSessionValid", args: [id] }) : encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "getSession", args: [id] }),
    expect: "ok",
    read: (d) => {
      if (fn === "getSession") {
        const r = decodeFunctionResult({ abi: ACCOUNT_ABI, functionName: "getSession", data: d }) as { key: Address; revoked: boolean; validUntil: bigint; fenceHash: Hex; depth: number };
        return `key ${r.key}, depth ${r.depth}, revoked ${r.revoked}, validUntil ${r.validUntil}, fenceHash ${r.fenceHash.slice(0, 18)}…`;
      }
      const v = decodeFunctionResult({ abi: ACCOUNT_ABI, functionName: fn, data: d });
      return fn === "spendable" ? `${(v as bigint).toString()} USDC units` : String(v);
    },
  });
  const fund: Step = { label: "fund the account with 200 USDC", to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, 200_000_000n] }), expect: "ok" };
  const create: Step[] = accountTx ? [{ label: "createAccount (the API's first transaction, on the deployed factory)", to: accountTx.to, data: accountTx.data, expect: "ok", read: (d) => `account ${decodeFunctionResult({ abi: lykiaContracts.lykiaAccountFactoryArtifact.abi, functionName: "createAccount", data: d })}` }] : [];

  out.push(
    await batch("A root leash", [
      ...create,
      fund,
      { label: "createSession (the API's session transaction)", to: sessionTx.to, data: sessionTx.data, expect: "ok", read: (d) => `session ${decodeFunctionResult({ abi: lykiaContracts.lykiaAccountArtifact.abi, functionName: "createSession", data: d })}` },
      view("spendable", idA),
      { label: "agentTransferWithSig 20 USDC to the payee (inside the caps)", to: account, data: await transfer(agentA, idA, 20_000_000n, 0n)(), expect: "ok" },
      { label: "agentTransferWithSig 30 USDC (above the 25 USDC per-call cap)", to: account, data: await transfer(agentA, idA, 30_000_000n, 1n)(), expect: /PerCallCapExceeded/u },
      { label: "agentTransferWithSig 25 USDC (inside per-call, 45 of 50 today)", to: account, data: await transfer(agentA, idA, 25_000_000n, 1n)(), expect: "ok" },
      { label: "agentTransferWithSig 10 USDC (over the 50 USDC daily cap)", to: account, data: await transfer(agentA, idA, 10_000_000n, 2n)(), expect: /DailyCapExceeded/u },
      view("spendable", idA),
      { label: "revokeSession (the API's revoke transaction)", to: revokedA.transaction.to, data: revokedA.transaction.data, expect: "ok" },
      view("isSessionValid", idA),
      view("spendable", idA),
      view("getSession", idA),
      { label: "agentTransferWithSig 1 USDC after revocation", to: account, data: await transfer(agentA, idA, 1_000_000n, 2n)(), expect: /SessionInvalid/u },
    ]),
  );

  /* ------------------------------------------------ B. sub-agent leash */
  // A parent Pack agent with an on-chain session whose key is Multicall3 (see the header), then a leash carved from it.
  const parent = await pack.create({ owner: OWNER, environment: "mainnet", name: "Ops desk", role: "custom", signer: MULTICALL3, fence: { schema: "lykia.fence/v1", kinds: { allow: ["transfer"] }, tokens: { allow: ["USDC"], unlisted: "deny" }, recipients: { mode: "allowlist", allow: [PAYEE] }, caps: { perStepUsd: "100", perIntentUsd: "200", dailyUsd: "200" }, scent: { require: "verified" }, signers: ["agent"] } });
  const parentTx = await buildSessionTx(ctx, { agent: parent, parent: null, account, key: MULTICALL3, validDays: 30, maxCalls: 100, calls: [] }, "mainnet");
  const nonceParent = 1n;
  const parentId = sessionIdOf(account, MULTICALL3, nonceParent);
  await pack.bindSession(parent.id, { account, sessionId: parentId });
  const agentB = privateKeyToAccount(generatePrivateKey());
  // The API checks the parent's session on chain before building a sub-session. In this simulation the
  // parent session only exists inside batch B, so that one read answers with the session batch B creates.
  const read = client.readContract.bind(client);
  (client as { readContract: typeof client.readContract }).readContract = (async (args: Parameters<typeof client.readContract>[0]) => {
    if (args.functionName === "getSession" && String(args.args?.[0]).toLowerCase() === parentId.toLowerCase()) {
      return { key: MULTICALL3, parent: `0x${"0".repeat(64)}`, validUntil: parentTx.spec.validUntil, epoch: 0n, maxCalls: parentTx.spec.maxCalls, callsUsed: 0, depth: 0, revoked: false, fenceHash: parentTx.spec.fenceHash };
    }
    return read(args);
  }) as typeof client.readContract;
  const sub = await s.create({ via: "session", developer: OWNER }, { owner: OWNER, environment: "mainnet", parentAgentId: parent.id, name: "Pup payer", signer: agentB.address, template: "pay-invoices", budget: BUDGET, expiresAt, recipients: [PAYEE], maxCalls: 50, publicBaseUrl: "https://api.lykiaai.com" });
  const subTx = sub.transactions[sub.transactions.length - 1]!;
  const decodedSub = decodeFunctionData({ abi: lykiaContracts.lykiaAccountArtifact.abi, data: subTx.data });
  if (decodedSub.functionName !== "createSubSession") throw new Error(`expected createSubSession, got ${decodedSub.functionName}`);
  const idB = sessionIdOf(account, agentB.address, nonceParent + 1n);
  await leashes(ctx).put(sub.leash.id, { ...(await s.get(sub.leash.id)), status: "active", session: { ...sub.leash.session!, sessionId: idB } });
  const revokedB = await s.revoke(await s.get(sub.leash.id));
  if (!revokedB.transaction) throw new Error("no revoke transaction");
  const viaParent = (data: Hex): Hex => encodeFunctionData({ abi: MC3_ABI, functionName: "aggregate3", args: [[{ target: account, allowFailure: false, callData: data }]] });

  out.push(
    await batch("B sub-agent leash", [
      ...create,
      fund,
      { label: "createSession for the parent agent (key = Multicall3)", to: account, data: parentTx.transaction.data, expect: "ok" },
      { label: `createSubSession (the API's transaction, from ${subTx.from}, the parent key)`, to: MULTICALL3, data: viaParent(subTx.data), expect: "ok" },
      view("getSession", idB),
      view("spendable", idB),
      { label: "agentTransferWithSig 20 USDC to the payee (inside the caps)", to: account, data: await transfer(agentB, idB, 20_000_000n, 0n)(), expect: "ok" },
      { label: "agentTransferWithSig 30 USDC (above the 25 USDC per-call cap)", to: account, data: await transfer(agentB, idB, 30_000_000n, 1n)(), expect: /PerCallCapExceeded/u },
      { label: "revokeSession of the sub-session (the API's revoke transaction, from the owner)", to: revokedB.transaction.to, data: revokedB.transaction.data, expect: "ok" },
      view("isSessionValid", idB),
      view("spendable", idB),
      { label: "agentTransferWithSig 1 USDC after revocation", to: account, data: await transfer(agentB, idB, 1_000_000n, 1n)(), expect: /SessionInvalid/u },
    ]),
  );

  const evidence = {
    at: new Date().toISOString(),
    network: "Arc mainnet (chain 5042)",
    factory: FACTORY,
    owner: OWNER,
    account,
    accountExisted: accountTx === null,
    budget: BUDGET,
    sessionSpecRoot: JSON.parse(JSON.stringify(specA.args, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))),
    sessions: { root: idA, parent: parentId, sub: idB },
    keys: { root: agentA.address, sub: agentB.address, parent: MULTICALL3 },
    batches: out,
  };
  if (process.env.LEASH_EVIDENCE) writeFileSync(process.env.LEASH_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  const failed = (out as { rows: { pass: boolean }[] }[]).flatMap((b) => b.rows).filter((r) => !r.pass).length;
  process.stdout.write(`\n${failed === 0 ? "All calls behaved as expected." : `${failed} call(s) did not behave as expected.`}\n`);
  await closeContext(ctx);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await closeContext(ctx).catch(() => undefined);
  process.exit(1);
});
