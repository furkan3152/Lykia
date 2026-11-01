/**
 * Layer 2, address protection. Address poisoning works by sending a
 * zero-value (or dust) transfer from an address that starts and ends like
 * one the victim already pays, hoping the victim copies it from history.
 * Wallets usually show only the first and last few characters, so Lykia
 * compares exactly those.
 */
import { sameAddress, type Address } from "../contracts.js";
import type { SecurityFinding } from "./types.js";

function body(address: string): string {
  return address.toLowerCase().replace(/^0x/u, "");
}

/** Matching leading and trailing hex characters of two addresses. */
export function affixMatch(a: string, b: string): { readonly prefix: number; readonly suffix: number } {
  const x = body(a);
  const y = body(b);
  let prefix = 0;
  while (prefix < 40 && x[prefix] === y[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < 40 && x[39 - suffix] === y[39 - suffix]) suffix += 1;
  return { prefix, suffix };
}

export interface Lookalike {
  readonly candidate: Address;
  readonly resembles: Address;
  readonly prefix: number;
  readonly suffix: number;
  /** `strong`: four or more characters at both ends; `weak`: three. */
  readonly strength: "strong" | "weak";
}

/** The known address `candidate` imitates, if any. An exact match is not a look-alike. */
export function findLookalike(candidate: Address, known: readonly Address[]): Lookalike | null {
  let best: Lookalike | null = null;
  for (const k of known) {
    if (sameAddress(k, candidate)) return null;
    const { prefix, suffix } = affixMatch(candidate, k);
    if (prefix < 3 || suffix < 3) continue;
    const strength = prefix >= 4 && suffix >= 4 ? "strong" : "weak";
    if (!best || prefix + suffix > best.prefix + best.suffix) best = { candidate, resembles: k, prefix, suffix, strength };
  }
  return best;
}

export interface RecipientFacts {
  readonly recipient: Address;
  readonly owner: Address;
  /** Saved contacts and recipients the owner paid before. */
  readonly known: readonly Address[];
  /** Senders of zero-value transfers to the owner (poisoning spam). */
  readonly zeroValueSenders: readonly Address[];
  /** null = could not be read. */
  readonly isContract: boolean | null;
  /** USDC/EURC on-chain blocklist; null = could not be read. */
  readonly blocklisted: boolean | null;
  /** Circle Compliance screening result, when configured. */
  readonly screening: "APPROVED" | "DENIED" | "REVIEW" | null;
}

export function recipientFindings(facts: RecipientFacts, stepId?: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const add = (rule: string, severity: SecurityFinding["severity"], message: string) => out.push({ layer: "address", rule: `address.${rule}`, severity, message, address: facts.recipient, ...(stepId ? { stepId } : {}) });
  if (sameAddress(facts.recipient, facts.owner)) return out;
  if (facts.blocklisted === true) add("blocklisted", "block", `${facts.recipient} is on the USDC/EURC blocklist; funds sent there are frozen.`);
  if (facts.screening === "DENIED") add("screening-denied", "block", `${facts.recipient} was denied by Circle Compliance screening.`);
  if (facts.screening === "REVIEW") add("screening-review", "warn", `Circle Compliance flagged ${facts.recipient} for review.`);
  const look = findLookalike(facts.recipient, facts.known);
  if (look) {
    const spam = facts.zeroValueSenders.some((s) => sameAddress(s, facts.recipient));
    add("lookalike", look.strength === "strong" || spam ? "block" : "warn", `${facts.recipient} looks like ${look.resembles} (same first ${look.prefix} and last ${look.suffix} characters)${spam ? " and it sent you a zero-value transfer: a classic poisoning attempt" : ""}.`);
  } else if (facts.zeroValueSenders.some((s) => sameAddress(s, facts.recipient))) {
    add("zero-value-sender", "warn", `${facts.recipient} only appears in your history through a zero-value transfer.`);
  }
  if (!facts.known.some((k) => sameAddress(k, facts.recipient))) add("first-time", "warn", `This is the first payment to ${facts.recipient}. Check the full address with the person you are paying.`);
  if (facts.isContract === true) add("contract-recipient", "warn", `${facts.recipient} is a contract, not a wallet. Make sure it can receive and return funds.`);
  if (facts.blocklisted === null) add("blocklist-unread", "info", "The USDC/EURC blocklist could not be read for this recipient.");
  return out;
}
