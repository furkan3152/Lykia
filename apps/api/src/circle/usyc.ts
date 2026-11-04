/**
 * USYC on Arc: subscribe (USDC -> USYC) and redeem (USYC -> USDC) through
 * Circle's Teller contract, for wallets Circle has entitled.
 *
 * USYC is restricted: non-US institutions only, after Circle's onboarding
 * (docs.arc.io/arc/references/contract-addresses#usyc,
 * developers.circle.com/tokenized/usyc/overview). Lykia never assumes
 * eligibility: it reads the Entitlements contract first and refuses
 * (fail-closed) when the wallet may not call the Teller. The Entitlements
 * contract on Arc is a role authority; `canCall(user, teller, selector)` is
 * the check the Teller itself applies (selector read from the deployed
 * implementation, 2026-11-04). Amounts use 6 decimals for both tokens.
 *
 * Nothing here signs: the result is unsigned calls (approve + deposit, or
 * redeem), checked against the Fence first.
 * Teller interface: developers.circle.com/tokenized/usyc/subscribe-and-redeem
 */
import { contractAddress, type Address, type ArcEnvironment } from "@lykia/core";
import { encodeFunctionData, erc20Abi, parseAbi, toFunctionSelector, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";
import { LykiaHttpError } from "../http/errors.js";

export const USYC_TELLER_ABI = parseAbi([
  "function deposit(uint256 _assets, address _receiver) returns (uint256)",
  "function redeem(uint256 _shares, address _receiver, address _account) returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
]);
export const USYC_ENTITLEMENTS_ABI = parseAbi(["function canCall(address user, address target, bytes4 functionSig) view returns (bool)"]);

export const TELLER_DEPOSIT = toFunctionSelector("deposit(uint256,address)");
export const TELLER_REDEEM = toFunctionSelector("redeem(uint256,address,address)");

export const USYC_DOCS = "https://developers.circle.com/tokenized/usyc/overview";

export interface UsycContracts {
  readonly usdc: Address;
  readonly usyc: Address;
  readonly teller: Address;
  readonly entitlements: Address;
}

export function usycContracts(environment: ArcEnvironment): UsycContracts {
  return {
    usdc: contractAddress("usdc", environment) as Address,
    usyc: contractAddress("usyc", environment) as Address,
    teller: contractAddress("usycTeller", environment) as Address,
    entitlements: contractAddress("usycEntitlements", environment) as Address,
  };
}

export interface UsycEligibility {
  readonly address: Address;
  readonly environment: ArcEnvironment;
  /** null = the entitlement read failed (treated as not eligible). */
  readonly subscribe: boolean | null;
  readonly redeem: boolean | null;
  readonly contracts: UsycContracts;
  readonly how: string;
  readonly docs: string;
}

type ReadClient = {
  readContract(args: { address: Address; abi: unknown; functionName: string; args: readonly unknown[] }): Promise<unknown>;
};

/** Reads the Entitlements contract: may this wallet call the Teller's deposit and redeem? */
export async function usycEligibility(chains: ArcChains, environment: ArcEnvironment, address: Address): Promise<UsycEligibility> {
  const c = usycContracts(environment);
  const client = chains.client(environment) as unknown as ReadClient;
  const read = (selector: Hex) =>
    client.readContract({ address: c.entitlements, abi: USYC_ENTITLEMENTS_ABI, functionName: "canCall", args: [address, c.teller, selector] }).then(
      (v) => v === true,
      () => null,
    );
  const [subscribe, redeem] = await Promise.all([read(TELLER_DEPOSIT), read(TELLER_REDEEM)]);
  return {
    address,
    environment,
    subscribe,
    redeem,
    contracts: c,
    how:
      environment === "mainnet"
        ? "USYC is for eligible non-US institutions: complete Circle's USYC onboarding (minimums apply); Circle then entitles the wallet on Arc."
        : "On Arc Testnet, open a Circle Support ticket with the wallet address to be allowlisted (typically 24 to 48 hours).",
    docs: USYC_DOCS,
  };
}

export interface UsycPlan {
  readonly side: "subscribe" | "redeem";
  readonly amountUnits: bigint;
  /** What the Teller says the wallet receives (USYC for subscribe, USDC for redeem), 6 decimals. */
  readonly previewUnits: bigint;
  /** USD moved, for the Fence (USDC in for subscribe, USDC out for redeem). */
  readonly usd: string;
  readonly calls: { to: Address; data: Hex; label: string }[];
  readonly approval: { to: Address; data: Hex; label: string } | null;
}

const display6 = (units: bigint): string => {
  const s = units.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/u, "") || "0";
};

/**
 * The Teller calls for one side, after the entitlement check. Throws 403
 * when the wallet is not entitled (or the read failed): Lykia does not build
 * a USYC call that the Teller would refuse.
 */
export async function planUsyc(chains: ArcChains, input: { environment: ArcEnvironment; owner: Address; side: "subscribe" | "redeem"; amountUnits: bigint }): Promise<{ plan: UsycPlan; eligibility: UsycEligibility }> {
  if (input.amountUnits <= 0n) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send a positive amount.");
  const eligibility = await usycEligibility(chains, input.environment, input.owner);
  const allowed = input.side === "subscribe" ? eligibility.subscribe : eligibility.redeem;
  if (allowed !== true) {
    throw new LykiaHttpError("FORBIDDEN", 403, allowed === null ? "Could not read USYC entitlements on Arc; nothing was built." : `This wallet is not entitled to ${input.side} USYC on Arc. ${eligibility.how}`, { eligibility: { subscribe: eligibility.subscribe, redeem: eligibility.redeem }, docs: USYC_DOCS });
  }
  const c = eligibility.contracts;
  const client = chains.client(input.environment) as unknown as ReadClient;
  const previewFn = input.side === "subscribe" ? "previewDeposit" : "previewRedeem";
  const previewUnits = (await client.readContract({ address: c.teller, abi: USYC_TELLER_ABI, functionName: previewFn, args: [input.amountUnits] }).catch(() => null)) as bigint | null;
  if (typeof previewUnits !== "bigint" || previewUnits <= 0n) throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 502, "The USYC Teller gave no preview; nothing was built.");
  const amount = display6(input.amountUnits);
  if (input.side === "subscribe") {
    return {
      eligibility,
      plan: {
        side: "subscribe",
        amountUnits: input.amountUnits,
        previewUnits,
        usd: amount,
        approval: { to: c.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [c.teller, input.amountUnits] }), label: `Approve ${amount} USDC to the USYC Teller` },
        calls: [{ to: c.teller, data: encodeFunctionData({ abi: USYC_TELLER_ABI, functionName: "deposit", args: [input.amountUnits, input.owner] }), label: `Subscribe ${amount} USDC to USYC (about ${display6(previewUnits)} USYC)` }],
      },
    };
  }
  return {
    eligibility,
    plan: {
      side: "redeem",
      amountUnits: input.amountUnits,
      previewUnits,
      usd: display6(previewUnits),
      approval: null,
      calls: [{ to: c.teller, data: encodeFunctionData({ abi: USYC_TELLER_ABI, functionName: "redeem", args: [input.amountUnits, input.owner, input.owner] }), label: `Redeem ${amount} USYC (about ${display6(previewUnits)} USDC)` }],
    },
  };
}
