/**
 * Layer 2, the contract part of address protection: what bytecode says
 * about a contract before anyone sends it money. Opcodes are read by
 * walking the code (PUSH data is skipped, so a 0xff inside a constant is
 * not mistaken for SELFDESTRUCT).
 */
import type { SecurityFinding } from "./types.js";

export interface BytecodeTraits {
  readonly hasCode: boolean;
  readonly size: number;
  readonly selfdestruct: boolean;
  readonly delegatecall: boolean;
  /** EIP-1167 minimal proxy. */
  readonly minimalProxy: boolean;
  /** EIP-7702 delegated EOA (`0xef0100` + address). */
  readonly delegatedEoa: boolean;
}

export function bytecodeTraits(code: string | null | undefined): BytecodeTraits {
  const hex = (code ?? "0x").toLowerCase().replace(/^0x/u, "");
  if (hex.length === 0) return { hasCode: false, size: 0, selfdestruct: false, delegatecall: false, minimalProxy: false, delegatedEoa: false };
  const delegatedEoa = hex.startsWith("ef0100") && hex.length === 46;
  let selfdestruct = false;
  let delegatecall = false;
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    if (op === 0xff) selfdestruct = true;
    else if (op === 0xf4) delegatecall = true;
    else if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2;
  }
  const minimalProxy = /^363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3$/u.test(hex);
  return { hasCode: true, size: hex.length / 2, selfdestruct, delegatecall, minimalProxy, delegatedEoa };
}

export interface ContractFacts {
  readonly traits: BytecodeTraits;
  /** EIP-1967 implementation / admin slots, when non-zero. */
  readonly implementation: string | null;
  readonly admin: string | null;
  /** Seconds since deployment, when known. */
  readonly ageSeconds: number | null;
  /** True when the registry or the explorer lists verified source. */
  readonly verified: boolean | null;
  /** The address is a registry venue or an Arc system contract. */
  readonly listed: boolean;
}

export const YOUNG_CONTRACT_SECONDS = 7 * 86_400;

export function contractFindings(address: `0x${string}`, facts: ContractFacts, stepId?: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const add = (rule: string, severity: SecurityFinding["severity"], message: string) => out.push({ layer: "address", rule: `contract.${rule}`, severity, message, address, ...(stepId ? { stepId } : {}) });
  const { traits } = facts;
  if (!traits.hasCode) return out;
  // Listed contracts were reviewed when they joined the registry; their traits are informational.
  const sev = (s: SecurityFinding["severity"]) => (facts.listed ? "info" : s);
  if (traits.selfdestruct) add("selfdestruct", sev("warn"), "The code contains SELFDESTRUCT.");
  if (traits.delegatecall && !facts.implementation && !traits.minimalProxy) add("delegatecall", sev("warn"), "The code can DELEGATECALL into other code it chooses.");
  if (facts.implementation) add("proxy", sev("warn"), `Upgradeable proxy: the logic lives at ${facts.implementation}${facts.admin ? ` and ${facts.admin} can replace it` : ""}.`);
  if (facts.verified === false) add("unverified", sev("warn"), "The source code is not verified.");
  if (facts.ageSeconds !== null && facts.ageSeconds < YOUNG_CONTRACT_SECONDS) add("young", sev("warn"), `Deployed ${Math.max(1, Math.round(facts.ageSeconds / 3600))} hour(s) ago.`);
  return out;
}
