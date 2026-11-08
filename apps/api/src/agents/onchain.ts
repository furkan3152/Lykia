/**
 * Binding a Pack agent to a LykiaAccount session on Arc.
 *
 * A root agent gets `createSession(spec)` on the owner's LykiaAccount,
 * signed by the owner. A sub-agent of an agent that already holds a session
 * gets `createSubSession(parentId, spec)`, signed by the parent's session
 * key; the contract itself refuses a sub-session that is not inside its
 * parent. The spec mirrors the agent's Fence: per-call and daily caps per
 * token (USD caps converted with the Chainlink reference price, stablecoins
 * only when priced), a lifetime budget, the payee allowlist, an expiry and
 * the Fence hash. The server only builds the unsigned call.
 */
import { contractAddress, getToken, lykiaContracts, tokenAddress, usdMicros, venueFamily, type Address, type ArcEnvironment, type PackAgent } from "@lykia/core";
import type { UnsignedTransaction } from "@lykia/core";
import { encodeFunctionData, keccak256, toBytes, toFunctionSelector, zeroAddress, type Hex } from "viem";
import { morphoVaults, vaultVenue } from "../flock/flock.js";
import { aaveSpokes } from "../engine/venues/aave.js";
import { v3Contracts } from "../engine/venues/uniswap.js";
import type { AppContext } from "../context.js";
import { services } from "../services.js";


const SPEC_COMPONENTS = [
  { name: "key", type: "address" },
  { name: "validUntil", type: "uint64" },
  { name: "maxCalls", type: "uint32" },
  { name: "fenceHash", type: "bytes32" },
  { name: "tokens", type: "tuple[]", components: [{ name: "token", type: "address" }, { name: "perCall", type: "uint128" }, { name: "daily", type: "uint128" }, { name: "budget", type: "uint128" }] },
  { name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "selector", type: "bytes4" }, { name: "receiverWords", type: "uint32" }, { name: "homeward", type: "bool" }] },
  { name: "recipients", type: "address[]" },
] as const;

export const SESSION_ABI = [
  { type: "function", name: "createSession", stateMutability: "nonpayable", inputs: [{ name: "spec", type: "tuple", components: SPEC_COMPONENTS }], outputs: [{ name: "id", type: "bytes32" }] },
  { type: "function", name: "createSubSession", stateMutability: "nonpayable", inputs: [{ name: "parentId", type: "bytes32" }, { name: "spec", type: "tuple", components: SPEC_COMPONENTS }], outputs: [{ name: "id", type: "bytes32" }] },
] as const;

export interface CallRule {
  readonly target: Address;
  readonly selector: Hex;
  readonly receiverWords: number;
  readonly homeward: boolean;
}

export interface SessionSpec {
  readonly key: Address;
  readonly validUntil: bigint;
  readonly maxCalls: number;
  readonly fenceHash: Hex;
  readonly tokens: readonly { token: Address; perCall: bigint; daily: bigint; budget: bigint }[];
  readonly calls: readonly CallRule[];
  readonly recipients: readonly Address[];
}

export interface SessionSpecInput {
  readonly agent: PackAgent;
  readonly key: Address;
  readonly validDays: number;
  readonly maxCalls: number;
  readonly calls?: readonly CallRule[];
  /** USD per token unit, from the price service (null = unpriced: token left out). */
  readonly usdPerUnit: Readonly<Record<string, number | null>>;
  readonly now: number;
}

/** USD micro-dollars -> token base units at a reference price, rounded down. */
function usdToUnits(usd: string, decimals: number, usdPerToken: number): bigint {
  const micros = usdMicros(usd);
  const priceMicros = BigInt(Math.round(usdPerToken * 1_000_000));
  if (priceMicros <= 0n) return 0n;
  return (micros * 10n ** BigInt(decimals)) / priceMicros;
}

export function sessionSpecOf(input: SessionSpecInput): SessionSpec {
  const fence = input.agent.fence;
  const perCallUsd = fence.caps?.perStepUsd ?? fence.caps?.perIntentUsd ?? "0";
  const dailyUsd = fence.caps?.dailyUsd ?? fence.caps?.weeklyUsd ?? perCallUsd;
  const budgetUsd = fence.caps?.weeklyUsd ? (usdMicros(fence.caps.weeklyUsd) * BigInt(Math.ceil(input.validDays / 7))).toString() : (usdMicros(dailyUsd) * BigInt(input.validDays)).toString();
  const budgetText = `${BigInt(budgetUsd) / 1_000_000n}.${(BigInt(budgetUsd) % 1_000_000n).toString().padStart(6, "0")}`;
  const symbols = fence.tokens?.allow ?? ["USDC", "EURC"];
  const tokens = symbols
    .map((s) => getToken(s))
    .filter((t): t is NonNullable<typeof t> => t !== null && t.tags.includes("stablecoin"))
    .flatMap((t) => {
      const price = input.usdPerUnit[t.symbol];
      const address = tokenAddress(t, input.agent.environment);
      if (!price || !address) return [];
      return [{ token: address, perCall: usdToUnits(perCallUsd, t.decimals, price), daily: usdToUnits(dailyUsd, t.decimals, price), budget: usdToUnits(budgetText, t.decimals, price) }];
    });
  const hex = input.agent.fenceHash.replace(/^sha256:/u, "");
  return {
    key: input.key,
    validUntil: BigInt(Math.floor(input.now / 1000) + input.validDays * 86_400),
    maxCalls: input.maxCalls,
    fenceHash: `0x${hex}` as Hex,
    tokens,
    calls: input.calls ?? [],
    recipients: fence.recipients?.mode === "own" ? [] : [...(fence.recipients?.allow ?? [])],
  };
}

export function sessionCalldata(spec: SessionSpec, parentSessionId?: Hex): Hex {
  const tuple = { ...spec, tokens: [...spec.tokens], calls: [...spec.calls], recipients: [...spec.recipients] };
  return parentSessionId
    ? encodeFunctionData({ abi: SESSION_ABI, functionName: "createSubSession", args: [parentSessionId, tuple] })
    : encodeFunctionData({ abi: SESSION_ABI, functionName: "createSession", args: [tuple] });
}

/**
 * Call rules derived from the venues an agent's Fence allows, for calls
 * whose output argument sits at a fixed ABI word so the account can pin it
 * to itself (receiverWords): ERC-4626 vaults, Aave V4 Spokes and Uniswap v3
 * exactInputSingle. Routers whose recipient lives inside dynamic bytes
 * (Uniswap v4's UniversalRouter, the Aerodrome Metarouter) are never
 * derived: the account could not check where the output goes.
 */
export function callRulesFor(agent: Pick<PackAgent, "fence">, environment: ArcEnvironment): CallRule[] {
  const kinds = new Set(agent.fence.kinds?.allow ?? ["deposit", "withdraw", "supply", "swap", "fx"]);
  const allowVenue = (id: string) => !(agent.fence.venues?.deny ?? []).includes(id) && (agent.fence.venues?.allow ? agent.fence.venues.allow.includes(id) : true);
  const rules: CallRule[] = [];
  const add = (target: string | undefined, signature: string, words: readonly number[], homeward = false) => {
    if (!target) return;
    rules.push({ target: target as Address, selector: toFunctionSelector(signature) as Hex, receiverWords: words.reduce((m, w) => m | (1 << w), 0), homeward });
  };
  // A curator's vault answers to the curator and to morpho-vaults: a deny on either drops it, an allow on either keeps it.
  const allowFamily = (ids: readonly string[]) => !ids.some((id) => (agent.fence.venues?.deny ?? []).includes(id)) && (agent.fence.venues?.allow ? ids.some((id) => agent.fence.venues!.allow!.includes(id)) : true);
  for (const v of morphoVaults(environment)) {
    if (!allowFamily(venueFamily(vaultVenue(v)))) continue;
    if (kinds.has("deposit")) add(v.address, "deposit(uint256,address)", [1]);
    if (kinds.has("withdraw")) {
      add(v.address, "withdraw(uint256,address,address)", [1, 2], true);
      add(v.address, "redeem(uint256,address,address)", [1, 2], true);
    }
  }
  if (allowVenue("aave-v4")) {
    for (const spoke of aaveSpokes(environment)) {
      if (kinds.has("supply")) add(spoke.address, "supply(uint256,uint256,address)", [2]);
      if (kinds.has("withdraw")) add(spoke.address, "withdraw(uint256,uint256,address)", [2], true);
      if (kinds.has("repay")) add(spoke.address, "repay(uint256,uint256,address)", [2], true);
    }
  }
  if (allowVenue("uniswap-v3") && (kinds.has("swap") || kinds.has("fx"))) {
    add(v3Contracts(environment)?.router, "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))", [3]);
  }
  return rules;
}

export interface SessionTxInput {
  readonly agent: PackAgent;
  readonly parent: PackAgent | null;
  readonly account: Address;
  readonly key: Address;
  readonly validDays: number;
  readonly maxCalls: number;
  readonly calls?: readonly CallRule[];
}

export async function buildSessionTx(ctx: AppContext, input: SessionTxInput, environment: ArcEnvironment): Promise<{ spec: SessionSpec; transaction: UnsignedTransaction; note: string }> {
  const prices = await services(ctx).prices.prices(["USDC", "EURC"]);
  const usdPerUnit: Record<string, number | null> = {};
  for (const [symbol, quote] of Object.entries(prices)) usdPerUnit[symbol] = quote?.usd ? Number(quote.usd) : null;
  const calls = input.calls ?? callRulesFor(input.agent, environment);
  const base = sessionSpecOf({ agent: input.agent, key: input.key, validDays: input.validDays, maxCalls: input.maxCalls, calls, usdPerUnit, now: ctx.clock.now() });
  // Lykia's fee is an agentTransfer to the fee recipient: it must be an allowed payee of the session.
  const feeTo = ctx.config.fee.bps > 0 ? ctx.config.fee.recipient : null;
  const spec: SessionSpec = feeTo && !base.recipients.some((r) => r.toLowerCase() === feeTo) ? { ...base, recipients: [...base.recipients, feeTo] } : base;
  const parentSession = input.parent?.session?.sessionId as Hex | undefined;
  const sub = Boolean(input.parent && parentSession);
  const from = (sub ? input.parent?.signer : input.agent.owner) as Address | undefined;
  if (!from) throw new Error("The parent agent has a session but no signer address.");
  const transaction: UnsignedTransaction = {
    chainId: environment === "mainnet" ? 5042 : 5042002,
    from,
    to: input.account,
    data: sessionCalldata(spec, sub ? parentSession : undefined),
    value: "0",
    label: sub ? `Create a sub-session for ${input.agent.name} under ${input.parent?.name}` : `Create a session for ${input.agent.name}`,
  };
  const left = ["USDC", "EURC"].filter((s) => (input.agent.fence.tokens?.allow ?? ["USDC", "EURC"]).includes(s) && !spec.tokens.some((t) => t.token.toLowerCase() === tokenAddress(getToken(s)!, environment)?.toLowerCase()));
  const note = [
    sub ? "Signed by the parent agent's session key; the account refuses a sub-session outside its parent." : "Signed by the owner's wallet on their LykiaAccount.",
    left.length > 0 ? `${left.join(", ")} left out: no reference price.` : "",
    spec.calls.length === 0 ? "No contract call rules: the session can make agentTransfer payments only, until call rules are added." : input.calls ? "" : `${spec.calls.length} call rule(s) derived from the Fence's venues, each pinning its output argument to the account. Routers that hide the recipient inside bytes (Uniswap v4, Aerodrome) are not included.`,
  ].filter(Boolean).join(" ");
  return { spec, transaction, note };
}

/** One account per owner and environment: the salt is fixed, the guardian is optional. */
export const ACCOUNT_SALT: Hex = keccak256(toBytes("lykia.account/v1"));

export interface LykiaAccountInfo {
  readonly factory: Address;
  readonly address: Address;
  readonly deployed: boolean;
  readonly guardian: Address;
  /** The unsigned createAccount call, when the account does not exist yet (anyone may send it; the owner is baked in). */
  readonly transaction: UnsignedTransaction | null;
}

/**
 * The owner's LykiaAccount on the deployed factory: its CREATE2 address (read
 * from the factory's predictAccount) and, until it exists, the createAccount
 * call to send. Native USDC spends are charged to the USDC face.
 */
export async function lykiaAccountFor(ctx: AppContext, owner: Address, environment: ArcEnvironment, guardian: Address = zeroAddress): Promise<LykiaAccountInfo | null> {
  const factory = lykiaContracts.deployedAddress(environment, "LykiaAccountFactory");
  if (!factory) return null;
  const abi = lykiaContracts.lykiaAccountFactoryArtifact.abi;
  const usdc = contractAddress("usdc", environment) as Address;
  const client = ctx.chains.client(environment);
  const address = (await client.readContract({ address: factory, abi, functionName: "predictAccount", args: [owner, ACCOUNT_SALT, guardian, usdc] })) as Address;
  const code = await client.getCode({ address });
  const deployed = code !== undefined && code !== "0x";
  return {
    factory,
    address,
    deployed,
    guardian,
    transaction: deployed
      ? null
      : {
          chainId: environment === "mainnet" ? 5042 : 5042002,
          from: owner,
          to: factory,
          data: encodeFunctionData({ abi, functionName: "createAccount", args: [owner, ACCOUNT_SALT, guardian, usdc] }),
          value: "0",
          label: `Create your LykiaAccount at ${address}`,
        },
  };
}
