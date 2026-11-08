import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_FENCE, PROTOCOLS } from "@lykia/core";
import { decodeAbiParameters, decodeFunctionData, type Address, type Hex } from "viem";
import { closeContext, createContext, type AppContext } from "../context.js";
import type { PulseFeed } from "../arc/pulse.js";
import { runDeterministicTurn, practiceGap, PREVIEW_ON_MAINNET } from "../agents/deterministic.js";
import { knownSpenders, staleApprovals } from "../agents/insights.js";
import { EXECUTABLE_VENUES, stepKindOf, ADAPTER_VENUE } from "../engine/adapters.js";
import { aerodromeCalls, CL_POOLS, METAROUTER_ABI, metarouter } from "../engine/venues/aerodrome.js";
import { detectRuntime } from "../runtime.js";
import { FakeArc, offlineFetch, testConfig } from "./support.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const OWNER: Address = "0x1111111111111111111111111111111111111111";
const USDC: Address = "0x3600000000000000000000000000000000000000";

describe("Aerodrome Slipstream", () => {
  it("is executable on mainnet and routes as a swap venue", () => {
    assert.ok(EXECUTABLE_VENUES.mainnet.has("aerodrome-slipstream"));
    assert.equal(ADAPTER_VENUE["swap-aerodrome"], "aerodrome-slipstream");
    assert.equal(stepKindOf("swap-aerodrome", true), "fx");
    assert.deepEqual(PROTOCOLS.find((p) => p.id === "aerodrome-slipstream")?.verbs, ["swap", "fx", "approve"]);
    assert.equal(metarouter("mainnet")?.toLowerCase(), "0x0fef9e88a7b76bcdbf451780c6774fe32965ee98");
    assert.ok(CL_POOLS.mainnet.some((p) => p.venue === "synthra" && !p.executable));
  });

  it("encodes Metarouter.execute with one CL_SWAP_EXACT_IN paid by the signer", () => {
    const pool: Address = "0x6F57B4C22155ceF09F17184c954f227FF0493742";
    const call = aerodromeCalls.swapExactIn(metarouter("mainnet")!, pool, USDC, 1_000_000_000n, 890_000_000n, OWNER, 1_900_000_000n, "swap");
    const { functionName, args } = decodeFunctionData({ abi: METAROUTER_ABI, data: call.data });
    assert.equal(functionName, "execute");
    const [commands, inputs, deadline] = args as readonly [Hex, readonly Hex[], bigint];
    assert.equal(commands, "0x00");
    assert.equal(deadline, 1_900_000_000n);
    const [params] = decodeAbiParameters(
      [{ type: "tuple", components: [{ name: "pools", type: "address[]" }, { name: "tokenIn", type: "address" }, { name: "amountIn", type: "tuple", components: [{ name: "mode", type: "uint8" }, { name: "value", type: "uint256" }] }, { name: "payerIsUser", type: "bool" }, { name: "minAmountOut", type: "uint256" }, { name: "recipient", type: "address" }] }],
      inputs[0]!,
    );
    assert.deepEqual(params.pools.map((p: string) => p.toLowerCase()), [pool.toLowerCase()]);
    assert.equal(params.amountIn.mode, 0);
    assert.equal(params.amountIn.value, 1_000_000_000n);
    assert.equal(params.payerIsUser, true);
    assert.equal(params.minAmountOut, 890_000_000n);
    assert.equal(params.recipient.toLowerCase(), OWNER.toLowerCase());
  });
});

describe("stale approvals", () => {
  let ctx: AppContext;
  const arc = new FakeArc();
  before(() => {
    ctx = createContext(testConfig(), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
  });
  after(() => closeContext(ctx));

  it("finds leftover allowances to venue contracts and offers a revoke", async () => {
    const spender = knownSpenders("mainnet").find((s) => s.venue.startsWith("Aerodrome"))!;
    assert.ok(spender, "the Metarouter is a known spender");
    arc.allowances.set(`${USDC}:${OWNER}:${spender.spender}`.toLowerCase(), 2n ** 256n - 1n);
    const found = await staleApprovals(ctx, "mainnet", OWNER);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.kind, "stale-approval");
    assert.equal(found[0]!.severity, "act");
    const tx = found[0]!.transactions![0]!;
    assert.equal(tx.to.toLowerCase(), USDC);
    assert.equal(tx.chainId, 5042);
    assert.match(tx.data, /^0x095ea7b3/u); // approve(spender, 0)
    assert.ok(tx.data.endsWith("0".repeat(64)));
  });
});

describe("testnet route gaps", () => {
  let ctx: AppContext;
  before(() => {
    ctx = createContext(testConfig(), { chains: new FakeArc().asChains(), pulse: idlePulse, fetch: offlineFetch() });
  });
  after(() => closeContext(ctx));

  it("says why in plain words and offers the mainnet dry run", async () => {
    const events: { event: string; data: unknown }[] = [];
    const result = await runDeterministicTurn({ ctx, environment: "testnet", owner: OWNER, fence: DEFAULT_FENCE, pack: [], message: "put half my USDC on the greenest pasture", emit: (event, data) => events.push({ event, data }) });
    assert.match(result.text, /practice venues aren't deployed on Arc testnet/u);
    assert.doesNotMatch(result.text, /details above/u);
    const clarify = events.find((e) => e.event === "clarify")?.data as { question: string; options: string[] };
    assert.ok(clarify, "a clarify event");
    assert.ok(clarify.options[0]!.startsWith(PREVIEW_ON_MAINNET));
    assert.ok(clarify.options[0]!.endsWith("put half my USDC on the greenest pasture"));
    const tool = events.find((e) => e.event === "tool")?.data as { ok: boolean; summary: string };
    assert.equal(tool.ok, false);
    assert.ok(tool.summary.length > 0);
  });

  it("recognises practice-venue gaps", () => {
    assert.equal(practiceGap("No earn venue on Arc testnet yet: the Lykia practice vault is not deployed (Morpho and Aave are mainnet only)."), true);
    assert.equal(practiceGap("The balance is too small for this plan."), false);
  });
});

describe("runtime", () => {
  it("detects Vercel functions", () => {
    assert.equal(detectRuntime({ VERCEL: "1" }), "serverless");
    assert.equal(detectRuntime({}), "server");
  });
});

describe("on-chain session call rules from venues", () => {
  it("derives pinned-output rules from the Fence's venues and skips routers that hide the recipient", async () => {
    const { callRulesFor } = await import("../agents/onchain.js");
    const { toFunctionSelector } = await import("viem");
    const keeper = { fence: { ...DEFAULT_FENCE, kinds: { allow: ["approve", "deposit", "withdraw", "supply"] } } } as never;
    const rules = callRulesFor(keeper, "mainnet");
    const deposit = rules.filter((r) => r.selector === toFunctionSelector("deposit(uint256,address)"));
    assert.ok(deposit.length > 0, "vault deposits");
    assert.ok(deposit.every((r) => r.receiverWords === 0b10 && !r.homeward));
    const withdraw = rules.find((r) => r.selector === toFunctionSelector("withdraw(uint256,address,address)"))!;
    assert.equal(withdraw.receiverWords, 0b110);
    assert.equal(withdraw.homeward, true);
    const supply = rules.find((r) => r.selector === toFunctionSelector("supply(uint256,uint256,address)"))!;
    assert.equal(supply.receiverWords, 0b100);
    assert.ok(!rules.some((r) => r.target.toLowerCase() === metarouter("mainnet")!.toLowerCase()), "no Aerodrome router rule");
    const hedger = { fence: { ...DEFAULT_FENCE, kinds: { allow: ["approve", "fx", "swap"] } } } as never;
    const swaps = callRulesFor(hedger, "mainnet");
    // Uniswap v3 SwapRouter02 and the Archery and Unitflow forks: each takes the recipient at word 3.
    assert.equal(swaps.length, 3);
    assert.ok(swaps.every((r) => r.receiverWords === 0b1000));
    assert.equal(new Set(swaps.map((r) => r.target.toLowerCase())).size, 3);
    assert.equal(callRulesFor({ fence: { ...DEFAULT_FENCE, venues: { allow: ["arc-transfer"] } } } as never, "mainnet").length, 0);
  });
});

describe("ERC-4337 submit", () => {
  it("resolves a userOpHash through the EntryPoint event and checks the prepared calls", async () => {
    const { encodeFunctionData, parseAbi, erc20Abi, pad } = await import("viem");
    const { resolveUserOp, opRunsPrepared, ENTRY_POINTS } = await import("../engine/userop.js");
    const account = "0x00000000000000000000000000000000c1c1e0a1" as Address;
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: ["0x0fef9e88a7b76bcdbf451780c6774fe32965ee98", 5n] });
    // An ERC-7579 style executeBatch carrying the prepared call.
    const callData = encodeFunctionData({ abi: parseAbi(["function executeBatch((address target, uint256 value, bytes data)[] calls)"]), functionName: "executeBatch", args: [[{ target: USDC, value: 0n, data: approve }]] });
    const handleOps = encodeFunctionData({
      abi: parseAbi(["function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)"]),
      functionName: "handleOps",
      args: [[{ sender: account, nonce: 7n, initCode: "0x", callData, accountGasLimits: pad("0x01"), preVerificationGas: 1n, gasFees: pad("0x01"), paymasterAndData: "0x", signature: "0x" }], OWNER],
    });
    const userOpHash = `0x${"ab".repeat(32)}` as Hex;
    const bundle = `0x${"cd".repeat(32)}` as Hex;
    const chains = {
      client: () => ({
        getBlockNumber: async () => 50_000n,
        getLogs: async ({ args, address }: { args: { userOpHash: Hex }; address: readonly string[] }) => {
          assert.deepEqual(address, ENTRY_POINTS);
          return args.userOpHash === userOpHash ? [{ transactionHash: bundle, address: ENTRY_POINTS[0], args: { sender: account, nonce: 7n, success: true } }] : [];
        },
        getTransaction: async () => ({ input: handleOps, to: ENTRY_POINTS[0] }),
      }),
    } as never;
    const op = await resolveUserOp(chains, "mainnet", userOpHash);
    assert.equal(op.transactionHash, bundle);
    assert.equal(op.success, true);
    const prepared = [{ chainId: 5042, from: account, to: USDC, data: approve, value: "0", label: "approve" }];
    assert.equal(opRunsPrepared(op, prepared), true);
    assert.equal(opRunsPrepared(op, [{ ...prepared[0]!, data: approve.replace(/5$/u, "6") as Hex }]), false, "a different amount");
    assert.equal(opRunsPrepared({ ...op, sender: OWNER }, prepared), false, "another sender");
    await assert.rejects(resolveUserOp(chains, "mainnet", `0x${"ee".repeat(32)}` as Hex), /no UserOperationEvent/u);
  });
});
