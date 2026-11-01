/**
 * The verified token registry. A token is "verified" only when it is listed
 * here; its name, symbol and decimals were read on-chain (2026-11-01) from
 * both Arc environments. A stranger reusing one of these names is a
 * look-alike and Scent flags it.
 */
import { ARC_CONTRACTS, sameAddress, type Address, type ArcContractKey } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";

export type Peg = "USD" | "EUR" | "BTC";

export interface TokenDescriptor {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly contract: ArcContractKey;
  readonly peg: Peg;
  /** Stablecoins price at their peg; yield tokens and BTC need a price source. */
  readonly pricing: "peg" | "nav" | "market";
  readonly issuer: "Circle";
  readonly tags: readonly ("gas" | "stablecoin" | "fx" | "yield" | "restricted" | "collateral")[];
  readonly aliases: readonly string[];
  readonly evidence: string;
}

export const TOKENS: readonly TokenDescriptor[] = Object.freeze([
  {
    symbol: "USDC",
    name: "USDC",
    decimals: 6,
    contract: "usdc",
    peg: "USD",
    pricing: "peg",
    issuer: "Circle",
    tags: ["gas", "stablecoin"],
    aliases: ["usd", "dollar", "dolar", "usd coin"],
    evidence: "name() USDC, symbol() USDC, decimals() 6 on both environments; native balance uses 18 decimals",
  },
  {
    symbol: "EURC",
    name: "EURC",
    decimals: 6,
    contract: "eurc",
    peg: "EUR",
    pricing: "peg",
    issuer: "Circle",
    tags: ["stablecoin", "fx"],
    aliases: ["eur", "euro", "avro"],
    evidence: "name() EURC, symbol() EURC, decimals() 6 on both environments",
  },
  {
    symbol: "USYC",
    name: "US Yield Coin",
    decimals: 6,
    contract: "usyc",
    peg: "USD",
    pricing: "nav",
    issuer: "Circle",
    tags: ["yield", "restricted"],
    aliases: ["us yield coin"],
    evidence: "name() US Yield Coin, symbol() USYC, decimals() 6 on both environments",
  },
  {
    symbol: "cirBTC",
    name: "Circle Wrapped Bitcoin",
    decimals: 8,
    contract: "cirbtc",
    peg: "BTC",
    pricing: "market",
    issuer: "Circle",
    tags: ["collateral"],
    aliases: ["btc", "bitcoin", "cirbtc", "wbtc"],
    evidence: "name() Circle Wrapped Bitcoin, symbol() cirBTC, decimals() 8 on both environments",
  },
] satisfies TokenDescriptor[]);

export function tokenAddress(token: TokenDescriptor, environment: ArcEnvironment): Address | null {
  return ARC_CONTRACTS[token.contract].addresses[environment] ?? null;
}

export function getToken(symbol: string): TokenDescriptor | null {
  return TOKENS.find((token) => token.symbol.toLowerCase() === symbol.trim().toLowerCase()) ?? null;
}

export function tokenByAddress(environment: ArcEnvironment, address: string): TokenDescriptor | null {
  return TOKENS.find((token) => {
    const own = tokenAddress(token, environment);
    return own !== null && sameAddress(own, address);
  }) ?? null;
}

/** Symbol, alias or address -> registry token. */
export function findToken(environment: ArcEnvironment, symbolOrAddress: string): TokenDescriptor | null {
  const wanted = symbolOrAddress.trim();
  if (/^0x[0-9a-fA-F]{40}$/u.test(wanted)) return tokenByAddress(environment, wanted);
  const lower = wanted.toLowerCase();
  return TOKENS.find((token) => token.symbol.toLowerCase() === lower || token.aliases.includes(lower)) ?? null;
}

/* ------------------------------------------------------------- look-alikes */

const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I", "Ј": "J", "К": "K", "М": "M", "О": "O", "Р": "P", "Ѕ": "S", "Т": "T", "Х": "X", "У": "Y",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  "₮": "T", "0": "O", "1": "I", "€": "E", "$": "S",
});

/** Upper-case, NFKC, confusables folded, non-alphanumerics removed: "UЅDC" and "usdc" both fold to "USDC". */
export function foldTokenName(value: string): string {
  let out = "";
  for (const char of value.normalize("NFKC").toUpperCase()) {
    const folded = CONFUSABLES[char] ?? char;
    if (/[A-Z0-9]/u.test(folded)) out += folded;
  }
  return out;
}

export type TokenTrust =
  | { readonly status: "verified"; readonly token: TokenDescriptor }
  | { readonly status: "lookalike"; readonly lookalikeOf: TokenDescriptor; readonly warning: string }
  | { readonly status: "unverified"; readonly warning: string };

/**
 * Registry tokens are verified; an unknown address whose symbol or name
 * folds to a registry token's is a look-alike (a wolf in USDC's coat);
 * everything else is unverified, never "safe".
 */
export function assessToken(input: { readonly environment: ArcEnvironment; readonly address: string; readonly symbol?: string; readonly name?: string }): TokenTrust {
  const listed = tokenByAddress(input.environment, input.address);
  if (listed) return { status: "verified", token: listed };
  const names = [input.symbol, input.name].filter((v): v is string => typeof v === "string" && v.trim().length > 0).map(foldTokenName);
  const lookalikeOf = names.length === 0
    ? undefined
    : TOKENS.find((token) => {
        const own = [token.symbol, token.name, ...token.aliases].map(foldTokenName);
        return names.some((name) => name.length > 0 && own.includes(name));
      });
  if (lookalikeOf) {
    return {
      status: "lookalike",
      lookalikeOf,
      warning: `This token calls itself ${input.symbol ?? input.name} but it is not ${lookalikeOf.symbol} (${tokenAddress(lookalikeOf, input.environment)}). A wolf in ${lookalikeOf.symbol}'s coat: check the address.`,
    };
  }
  return { status: "unverified", warning: "Not in Lykia's verified token list. Lyko has not met this one yet: check the address before trading it." };
}
