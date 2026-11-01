/**
 * The verified token registry. A token is "verified" only when it is listed
 * here; its name, symbol and decimals were read on-chain (2026-11-01) in
 * every environment it is listed for. Circle tokens live in both
 * environments; partner fiat stablecoins are mainnet-only. A stranger reusing one of these names is a
 * look-alike and Scent flags it.
 */
import { ARC_CONTRACTS, sameAddress, type Address, type ArcContractKey } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";

export type Peg = "USD" | "EUR" | "BTC" | "ETH" | "AUD" | "BRL" | "CAD" | "CHF" | "GBP" | "JPY" | "KRW" | "MXN" | "SEK" | "TRY" | "ZAR";

export interface TokenDescriptor {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  /** Arc system / Circle contract key; tokens from other issuers carry `addresses` instead. */
  readonly contract?: ArcContractKey;
  readonly addresses?: Readonly<Partial<Record<ArcEnvironment, Address>>>;
  readonly peg: Peg;
  /** Stablecoins price at their peg; yield tokens and BTC need a price source. */
  readonly pricing: "peg" | "nav" | "market";
  readonly issuer: string;
  readonly tags: readonly ("gas" | "stablecoin" | "fx" | "yield" | "restricted" | "collateral" | "bridged")[];
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
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    contract: "weth",
    peg: "ETH",
    pricing: "market",
    issuer: "Arc canonical bridge",
    tags: ["bridged", "collateral"],
    aliases: ["eth", "ether", "weth", "wrapped ether"],
    evidence: "name() Wrapped Ether, symbol() WETH, decimals() 18 on mainnet (2026-11-01); docs.arc.io contract-addresses",
  },
  {
    symbol: "AUDD",
    name: "AUDD",
    decimals: 6,
    addresses: { mainnet: "0xdec15d98d8c16d9ca2f8cc94ba4b88fe4f259393" },
    peg: "AUD",
    pricing: "peg",
    issuer: "Novatti",
    tags: ["stablecoin", "fx"],
    aliases: ["australian dollar digital", "audd"],
    evidence: "eth_getCode non-empty; name() AUDD, symbol() AUDD, decimals() 6 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "AUDF",
    name: "Forte AUD",
    decimals: 6,
    addresses: { mainnet: "0xd2a530170d71a9cfe1651fb468e2b98f7ed7456b" },
    peg: "AUD",
    pricing: "peg",
    issuer: "Forte Securities Australia",
    tags: ["stablecoin", "fx"],
    aliases: ["forte aud"],
    evidence: "eth_getCode non-empty; name() Forte AUD, symbol() AUDF, decimals() 6 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "BRLA",
    name: "BRLA Token",
    decimals: 18,
    addresses: { mainnet: "0x75700e137c05b2beb2b3a436ccb551652e3d8b11" },
    peg: "BRL",
    pricing: "peg",
    issuer: "Avenia",
    tags: ["stablecoin", "fx"],
    aliases: ["brl", "brazilian real"],
    evidence: "eth_getCode non-empty; name() BRLA Token, symbol() BRLA, decimals() 18 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "CADD",
    name: "CAD Digital",
    decimals: 18,
    addresses: { mainnet: "0x24bf8ae7b8e073d766a3509c25b45a6ad30e9046" },
    peg: "CAD",
    pricing: "peg",
    issuer: "CAD Digital",
    tags: ["stablecoin", "fx"],
    aliases: ["cad digital"],
    evidence: "eth_getCode non-empty; name() CAD Digital, symbol() CADD, decimals() 18 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "CHFAU",
    name: "AllUnity CHF",
    decimals: 6,
    addresses: { mainnet: "0xc6df1b92a6ae61a27059c41e541a91ce8dcb1605" },
    peg: "CHF",
    pricing: "peg",
    issuer: "AllUnity",
    tags: ["stablecoin", "fx"],
    aliases: ["chf", "swiss franc", "franc"],
    evidence: "eth_getCode non-empty; name() AllUnity CHF, symbol() CHFAU, decimals() 6 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "EURAU",
    name: "AllUnity EUR",
    decimals: 6,
    addresses: { mainnet: "0x4933a85b5b5466fbaf179f72d3de273c287ec2c2" },
    peg: "EUR",
    pricing: "peg",
    issuer: "AllUnity",
    tags: ["stablecoin", "fx"],
    aliases: ["allunity eur"],
    evidence: "eth_getCode non-empty; name() AllUnity EUR, symbol() EURAU, decimals() 6 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "GBPA",
    name: "Agant GBP",
    decimals: 6,
    addresses: { mainnet: "0xbbe6aab0ed76e90aea0d1cd978ec231c8adcdf8b" },
    peg: "GBP",
    pricing: "peg",
    issuer: "Agant",
    tags: ["stablecoin", "fx"],
    aliases: ["gbp", "pound", "sterling", "british pound"],
    evidence: "eth_getCode non-empty; name() Agant GBP, symbol() GBPA, decimals() 6 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "JPYC",
    name: "JPY Coin",
    decimals: 18,
    addresses: { mainnet: "0xe7c3d8c9a439fede00d2600032d5db0be71c3c29" },
    peg: "JPY",
    pricing: "peg",
    issuer: "JPYC",
    tags: ["stablecoin", "fx"],
    aliases: ["jpy", "yen", "japanese yen"],
    evidence: "eth_getCode non-empty; name() JPY Coin, symbol() JPYC, decimals() 18 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "KRW1",
    name: "KRW1",
    decimals: 18,
    addresses: { mainnet: "0x303dbb88ba14626c7a927e983b73267c575315f7" },
    peg: "KRW",
    pricing: "peg",
    issuer: "BDACS",
    tags: ["stablecoin", "fx"],
    aliases: ["krw", "korean won"],
    evidence: "eth_getCode non-empty; name() KRW1, symbol() KRW1, decimals() 18 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "MXNB",
    name: "MXNB",
    decimals: 6,
    addresses: { mainnet: "0xf197ffc28c23e0309b5559e7a166f2c6164c80aa" },
    peg: "MXN",
    pricing: "peg",
    issuer: "Juno (Bitso)",
    tags: ["stablecoin", "fx"],
    aliases: ["mxn", "peso", "mexican peso"],
    evidence: "eth_getCode non-empty; name() MXNB, symbol() MXNB, decimals() 6 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "QCAD",
    name: "QCAD",
    decimals: 6,
    addresses: { mainnet: "0xd70c2fa4232e054b373efaea98e4138511c2a309" },
    peg: "CAD",
    pricing: "peg",
    issuer: "Stablecorp",
    tags: ["stablecoin", "fx"],
    aliases: ["cad", "canadian dollar"],
    evidence: "eth_getCode non-empty; name() QCAD, symbol() QCAD, decimals() 6 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "SEKAU",
    name: "AllUnity SEK",
    decimals: 6,
    addresses: { mainnet: "0xf8524b5ab17d5eca2f78abe8377ceffd323b1dc1" },
    peg: "SEK",
    pricing: "peg",
    issuer: "AllUnity",
    tags: ["stablecoin", "fx"],
    aliases: ["sek", "krona", "swedish krona"],
    evidence: "eth_getCode non-empty; name() AllUnity SEK, symbol() SEKAU, decimals() 6 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "TRYB",
    name: "TRYB",
    decimals: 18,
    addresses: { mainnet: "0xfb0705023603dc86325b83d9ff6b0da7921fec17" },
    peg: "TRY",
    pricing: "peg",
    issuer: "BiLira",
    tags: ["stablecoin", "fx"],
    aliases: ["lira", "turkish lira"],
    evidence: "eth_getCode non-empty; name() TRYB, symbol() TRYB, decimals() 18 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
  {
    symbol: "ZARU",
    name: "ZAR Universal",
    decimals: 18,
    addresses: { mainnet: "0xe205b4e7ac03e3f7b2060c3edf2171aa7126c0d5" },
    peg: "ZAR",
    pricing: "peg",
    issuer: "Luno",
    tags: ["stablecoin", "fx"],
    aliases: ["zar", "rand", "south african rand"],
    evidence: "eth_getCode non-empty; name() ZAR Universal, symbol() ZARU, decimals() 18 read on Arc mainnet (2026-11-01). Listed among Arc's launch stablecoins.",
  },
] satisfies TokenDescriptor[]);

export function tokenAddress(token: TokenDescriptor, environment: ArcEnvironment): Address | null {
  if (token.addresses) return token.addresses[environment] ?? null;
  return token.contract ? ARC_CONTRACTS[token.contract].addresses[environment] ?? null : null;
}

/** Registry tokens deployed in `environment`. */
export function tokensFor(environment: ArcEnvironment): TokenDescriptor[] {
  return TOKENS.filter((token) => tokenAddress(token, environment) !== null);
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
  return TOKENS.find((token) => (token.symbol.toLowerCase() === lower || token.aliases.includes(lower)) && tokenAddress(token, environment) !== null) ?? null;
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
