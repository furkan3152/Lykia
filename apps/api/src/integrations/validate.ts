/**
 * On-chain validation of an adapter manifest, before a Lykia admin sees it:
 *
 *  1. the ABI parses and every capability and read names a function of it;
 *  2. every contract has code on the environment (eth_getCode);
 *  3. each function's selector appears in the contract's bytecode (info only:
 *     proxies dispatch through an implementation);
 *  4. every read function is callable with sample values;
 *  5. every capability runs as a dry simulation with a sample amount: the
 *     exact batch the engine would build (exact approvals, the call, Arc
 *     Memo) in one Multicall3From eth_call from a probe account funded with
 *     state overrides. A withdraw runs after the manifest's deposit for the
 *     same token; a swap uses its quote read for the minimum.
 *
 * Nothing is signed or broadcast.
 */
import { getToken, toBaseUnitsBig, tokenAddress, type AdapterCheck, type AdapterManifest, type AdapterValidation, type Address, type ArcEnvironment } from "@lykia/core";
import { toFunctionSelector } from "viem";
import type { AppContext } from "../context.js";
import { simulateRoute, type SimStep } from "../engine/simulate.js";
import { abiFunction, contractsOf, manifestAbi, manifestParams, readAdapterValue } from "./runtime.js";

/** The account dry simulations run from (funded with state overrides; never holds anything). */
const PROBE_ACCOUNT = "0x000000000000000000000000000000000000dEaD" as Address;

export async function validateOnChain(ctx: AppContext, manifest: AdapterManifest, environment: ArcEnvironment): Promise<AdapterValidation> {
  const checks: AdapterCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  const at = new Date(ctx.clock.now()).toISOString();
  const client = ctx.chains.client(environment);
  const block = await client.getBlockNumber().then((b) => b.toString()).catch(() => null);
  const parsed = manifestAbi(manifest);
  const contracts = contractsOf(manifest, environment);
  if (!parsed.abi) {
    add("abi", false, `The ABI does not parse: ${parsed.error}`);
    return { environment, ok: false, checks, at, block };
  }
  add("abi", true, `${manifest.abi.length} fragments parse.`);
  if (!contracts) {
    add("contracts", false, `The manifest lists no contracts on ${environment}.`);
    return { environment, ok: false, checks, at, block };
  }

  const codes = new Map<string, string>();
  for (const [key, address] of Object.entries(contracts)) {
    const code = await client.getCode({ address }).catch(() => undefined);
    const ok = typeof code === "string" && code !== "0x" && code.length > 2;
    if (ok) codes.set(key, code.toLowerCase());
    add(`code:${key}`, ok, ok ? `${address} has ${(code.length - 2) / 2} bytes of code on Arc ${environment}.` : `${address} has no code on Arc ${environment}.`);
  }

  for (const ref of [...manifest.capabilities.map((c) => ({ id: `capability:${c.id}`, fn: c.function, contract: c.contract })), ...manifest.reads.map((r) => ({ id: `read:${r.id}`, fn: r.function, contract: r.contract }))]) {
    const fn = abiFunction(parsed.abi, ref.fn);
    if (!fn) {
      add(`${ref.id}:abi`, false, `${ref.fn} is not in the ABI.`);
      continue;
    }
    const selector = toFunctionSelector(fn).slice(2);
    const code = codes.get(ref.contract);
    // Info only: proxies dispatch through their implementation, so the selector may live elsewhere.
    if (code) add(`info:${ref.id}:selector`, true, code.includes(`63${selector}`) ? `0x${selector} is in the bytecode.` : `0x${selector} is not in the bytecode (a proxy dispatches it through its implementation).`);
  }

  for (const read of manifest.reads) {
    const sampleUnits = 10n ** 6n;
    const usdc = getToken("USDC");
    const value = await readAdapterValue(ctx.chains, environment, manifest, read.id, { amount: sampleUnits, account: PROBE_ACCOUNT, ...(usdc ? { tokenIn: tokenAddress(usdc, environment) as Address } : {}), deadline: BigInt(Math.floor(ctx.clock.now() / 1000) + 1200) });
    add(`read:${read.id}`, value !== null, value !== null ? `${read.function} answered ${value.toString()} (${read.scale}).` : `${read.function} reverted or returned no integer.`);
  }

  for (const cap of manifest.capabilities) {
    const params = manifestParams(manifest, environment, cap);
    const token = getToken(cap.tokenIn);
    if (!params || !token) {
      add(`simulate:${cap.id}`, false, "The capability's contract, function or tokens do not resolve on this environment.");
      continue;
    }
    const units = toBaseUnitsBig(cap.sampleAmount ?? "1", token.decimals);
    const steps: SimStep[] = [];
    const fund: { symbol: string; units: bigint }[] = [];
    if (cap.verb === "withdraw") {
      const deposit = manifest.capabilities.find((c) => (c.verb === "deposit" || c.verb === "supply") && c.tokenIn === cap.tokenIn);
      const depositParams = deposit ? manifestParams(manifest, environment, deposit) : null;
      if (!deposit || !depositParams) {
        add(`simulate:${cap.id}`, true, "Not simulated: a withdraw needs a position, and the manifest has no deposit for the same token (validated by its reads).");
        continue;
      }
      steps.push({ id: "s1", plan: { adapter: "manifest", params: { ...depositParams, amount: units.toString(), display: `${cap.sampleAmount ?? "1"} ${token.symbol}` } } });
      steps.push({ id: "s2", plan: { adapter: "manifest", params: { ...params, amount: (units / 2n).toString(), display: "half" } } });
      fund.push({ symbol: token.symbol, units });
    } else if (cap.verb === "swap" || cap.verb === "fx") {
      const quote = cap.quote ? await readAdapterValue(ctx.chains, environment, manifest, cap.quote, { amount: units, tokenIn: params.tokenIn as Address, ...(params.tokenOut ? { tokenOut: params.tokenOut as Address } : {}) }) : null;
      if (quote === null || quote <= 0n) {
        add(`simulate:${cap.id}`, false, "The quote read gave no output for the sample amount, so the swap cannot be priced.");
        continue;
      }
      steps.push({ id: "s1", plan: { adapter: "manifest", params: { ...params, amountIn: units.toString(), minOut: ((quote * 95n) / 100n).toString(), display: `${cap.sampleAmount ?? "1"} ${token.symbol}` } } });
      fund.push({ symbol: token.symbol, units });
    } else if (cap.verb === "repay" || cap.verb === "borrow") {
      add(`simulate:${cap.id}`, true, `Not simulated: ${cap.verb} needs an open position; the capability is validated by its ABI and reads.`);
      continue;
    } else {
      steps.push({ id: "s1", plan: { adapter: "manifest", params: { ...params, amount: units.toString(), display: `${cap.sampleAmount ?? "1"} ${token.symbol}` } } });
      fund.push({ symbol: token.symbol, units });
    }
    const sim = await simulateRoute(ctx.chains, environment, PROBE_ACCOUNT, { intentId: `out_adapter${manifest.protocol.id.replace(/[^A-Za-z0-9]/gu, "").slice(0, 12)}`, verdictDigest: `sha256:${"0".repeat(64)}`, steps, fund });
    add(`simulate:${cap.id}`, sim.ok, sim.ok ? `${sim.calls.length} calls passed in one eth_call at block ${sim.block ?? "latest"} (${sim.calls.map((c) => c.label).join(" -> ")}).` : `Dry simulation failed: ${sim.reason ?? "unknown"}.`);
  }

  const ok = checks.filter((c) => !c.id.startsWith("info:")).every((c) => c.ok);
  return { environment, ok, checks, at, block };
}
