/**
 * Lykia's own router on Arc (LykiaRouter, deployed by the owner). It runs a
 * multi-step swap atomically on allowlisted venues, checks every step's
 * minimum and sweeps everything back to the recipient in the same
 * transaction. Lykia uses it for split swaps (one quote across two pools):
 * both legs succeed or neither does.
 *
 * The venue allowlist is read on chain. Venues that are not allowlisted
 * yet do not fail a plan: the legs run as separate steps and the owner
 * console lists the unsigned `setVenue` calls the owner can sign.
 *
 * The router's integrator fee is capped at 0.5% on chain, so Lykia's 1%
 * fee is not taken there: it stays a plain transfer in the same batch.
 */
import { lykiaContracts, type Address, type ArcEnvironment, type UnsignedTransaction } from "@lykia/core";
import { encodeFunctionData, keccak256, toBytes, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";
import type { RawCall } from "./calls.js";
import { metarouter } from "./venues/aerodrome.js";
import { aerodromeCalls } from "./venues/aerodrome.js";
import { uniswapCalls, v3Contracts } from "./venues/uniswap.js";

const ROUTER_ABI = lykiaContracts.lykiaRouterArtifact.abi;
const CACHE_MS = 60_000;

/** Swap adapters whose calldata takes an explicit recipient, so the router can receive the output. */
export const ROUTER_LEG_ADAPTERS: ReadonlySet<string> = new Set(["swap", "swap-aerodrome"]);

export interface RouterLeg {
  readonly adapter: "swap" | "swap-aerodrome";
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: string;
  readonly minOut: string;
  /** Uniswap v3 fee tier. */
  readonly fee?: string;
  /** Aerodrome: pool and Metarouter. */
  readonly pool?: string;
  readonly router?: string;
  readonly label: string;
}

export function lykiaRouterAddress(environment: ArcEnvironment): Address | null {
  return lykiaContracts.deployedAddress(environment, "LykiaRouter");
}

/** The venue contract a leg calls (what the router must allowlist). */
function legVenue(leg: Pick<RouterLeg, "adapter" | "router">, environment: ArcEnvironment): Address | null {
  if (leg.adapter === "swap") return v3Contracts(environment)?.router ?? null;
  return (leg.router as Address | undefined) ?? metarouter(environment);
}

/** Venues Lykia would route through LykiaRouter, per environment. */
function routerVenues(environment: ArcEnvironment): { venue: string; label: string; address: Address }[] {
  const out: { venue: string; label: string; address: Address }[] = [];
  const v3 = v3Contracts(environment)?.router;
  if (v3) out.push({ venue: "uniswap-v3", label: "Uniswap v3 SwapRouter02", address: v3 });
  const aero = metarouter(environment);
  if (aero) out.push({ venue: "aerodrome-slipstream", label: "Aerodrome Metarouter", address: aero });
  return out;
}

export interface RouterStatus {
  readonly address: Address | null;
  readonly owner: Address | null;
  readonly paused: boolean | null;
  readonly venues: readonly { venue: string; label: string; address: Address; allowed: boolean | null }[];
  /** Unsigned owner calls that allowlist the venues still missing. */
  readonly adminCalls: readonly UnsignedTransaction[];
}

const cache = new Map<string, { at: number; allowed: boolean }>();

async function venueAllowed(chains: ArcChains, environment: ArcEnvironment, venue: Address): Promise<boolean | null> {
  const router = lykiaRouterAddress(environment);
  if (!router) return null;
  const key = `${environment}:${venue.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.allowed;
  try {
    const allowed = (await chains.client(environment).readContract({ address: router, abi: ROUTER_ABI, functionName: "venueAllowed", args: [venue] })) as boolean;
    cache.set(key, { at: Date.now(), allowed });
    return allowed;
  } catch {
    return null;
  }
}

export async function routerStatus(chains: ArcChains, environment: ArcEnvironment): Promise<RouterStatus> {
  const address = lykiaRouterAddress(environment);
  if (!address) return { address: null, owner: null, paused: null, venues: [], adminCalls: [] };
  const client = chains.client(environment);
  const read = async <T>(functionName: "owner" | "paused"): Promise<T | null> => {
    try {
      return (await client.readContract({ address, abi: ROUTER_ABI, functionName })) as T;
    } catch {
      return null;
    }
  };
  const [owner, paused] = await Promise.all([read<Address>("owner"), read<boolean>("paused")]);
  const venues = await Promise.all(routerVenues(environment).map(async (v) => ({ ...v, allowed: await venueAllowed(chains, environment, v.address) })));
  const chainId = environment === "mainnet" ? 5042 : 5042002;
  const adminCalls = venues
    .filter((v) => v.allowed === false)
    .map((v): UnsignedTransaction => ({
      chainId,
      from: (owner ?? "0x0000000000000000000000000000000000000000") as Address,
      to: address,
      data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "setVenue", args: [v.address, true] }),
      value: "0",
      label: `Allowlist ${v.label} on LykiaRouter`,
    }));
  return { address, owner, paused, venues, adminCalls };
}

/** True when every leg's venue is allowlisted on the deployed router (unknown counts as no). */
export async function legsAllowlisted(chains: ArcChains, environment: ArcEnvironment, legs: readonly Pick<RouterLeg, "adapter" | "router">[]): Promise<{ ok: boolean; missing: string[] }> {
  if (!lykiaRouterAddress(environment)) return { ok: false, missing: ["LykiaRouter (not deployed)"] };
  const missing: string[] = [];
  for (const leg of legs) {
    const venue = legVenue(leg, environment);
    if (!venue || (await venueAllowed(chains, environment, venue)) !== true) missing.push(leg.adapter === "swap" ? "Uniswap v3 SwapRouter02" : "Aerodrome Metarouter");
  }
  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

/** One `LykiaRouter.run` call executing every leg, output swept to `recipient`. */
export function routerRunCall(environment: ArcEnvironment, intentId: string, recipient: Address, legs: readonly RouterLeg[], deadline: bigint, label: string): RawCall {
  const router = lykiaRouterAddress(environment);
  if (!router) throw new Error("LykiaRouter is not deployed on this environment.");
  if (legs.length === 0) throw new Error("A router run needs at least one leg.");
  const tokenIn = legs[0]!.tokenIn;
  const total = legs.reduce((sum, l) => sum + BigInt(l.amountIn), 0n);
  const minFinal = legs.reduce((sum, l) => sum + BigInt(l.minOut), 0n);
  const steps = legs.map((leg) => {
    const amountIn = BigInt(leg.amountIn);
    const minOut = BigInt(leg.minOut);
    const call =
      leg.adapter === "swap"
        ? uniswapCalls.v3Single(legVenue(leg, environment) as Address, leg.tokenIn, leg.tokenOut, Number(leg.fee), router, amountIn, minOut, leg.label)
        : aerodromeCalls.swapExactIn(legVenue(leg, environment) as Address, leg.pool as Address, leg.tokenIn, amountIn, minOut, router, deadline, leg.label);
    return { venue: call.to, tokenIn: leg.tokenIn, amountIn, tokenOut: leg.tokenOut, minOut, data: call.data };
  });
  const intent = {
    intentId: keccak256(toBytes(intentId)) as Hex,
    tokenIn,
    amountIn: total,
    steps,
    recipient,
    minFinalOut: minFinal,
    integrator: "0x0000000000000000000000000000000000000000" as Address,
    feeBps: 0,
  };
  return { to: router, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "run", args: [intent] }), label };
}
