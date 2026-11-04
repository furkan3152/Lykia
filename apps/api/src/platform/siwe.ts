/**
 * Sign-In with Ethereum (EIP-4361) on Arc.
 *
 * `issueNonce` stores a single-use nonce for 10 minutes. `verifySiwe`
 * checks the message parses, the domain is one of Lykia's (web origin hosts
 * and LYKIA_SIWE_DOMAINS), the URI sits on that domain, the chain is Arc
 * (5042 or 5042002) or a common wallet chain, the time fields hold, the
 * nonce is consumed exactly once, and the signature recovers the address
 * (EOA) or the address's contract accepts it on Arc (ERC-1271, for
 * LykiaAccount and other smart accounts).
 */
import { NETWORKS, resolveNetwork } from "@lykia/core";
import type { SiweNonceResponse } from "@lykia/core/api/platform";
import { verifyMessage, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";

export const NONCE_TTL_MS = 10 * 60_000;
export const SIWE_STATEMENT = "Sign in to Lykia. This proves you control this address; it moves no funds and costs no gas.";
const EXTRA_CHAIN_IDS = [1, 8453, 42161] as const;

export function siweChainIds(): number[] {
  return [...new Set<number>([...Object.values(NETWORKS).map((n) => n.chainId), ...EXTRA_CHAIN_IDS])].sort((a, b) => a - b);
}

export function siweDomains(ctx: AppContext): { readonly domains: readonly string[]; readonly origins: readonly string[] } {
  const origins = new Set<string>(ctx.config.webOrigins);
  const domains = new Set<string>(ctx.config.platform.siweDomains);
  for (const origin of ctx.config.webOrigins) domains.add(new URL(origin).host);
  for (const domain of ctx.config.platform.siweDomains) origins.add(`https://${domain}`);
  if (domains.size === 0) domains.add("localhost");
  return { domains: [...domains], origins: [...origins] };
}

const fail = (code: string, message: string) => new LykiaHttpError(code, 401, message);

/** A League city's own host (<label>.<root domain>, https only): sign-in there names that host, so wallets show the page the user is on. */
export function cityHost(ctx: AppContext, host: string): boolean {
  const root = ctx.config.platform.rootDomain;
  if (!root) return false;
  const h = host.toLowerCase();
  if (h === root || h === `www.${root}`) return true;
  if (!h.endsWith(`.${root}`)) return false;
  return /^[a-z][a-z0-9-]{1,22}[a-z0-9]$/u.test(h.slice(0, -(root.length + 1)));
}

function urlOrNull(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export async function issueNonce(ctx: AppContext, input: { readonly address?: string; readonly chainId?: number; readonly origin?: string }): Promise<SiweNonceResponse> {
  const nonce = generateSiweNonce();
  const now = ctx.clock.now();
  await ctx.store.collection("siwe_nonces").put(nonce, { issuedAt: now }, { ttlMs: NONCE_TTL_MS });
  const { domains, origins } = siweDomains(ctx);
  const from = urlOrNull(input.origin);
  const city = from && from.protocol === "https:" && cityHost(ctx, from.host) ? from : null;
  const domain = city?.host ?? domains[0] ?? "localhost";
  const uri = city?.origin ?? origins.find((o) => new URL(o).host === domain) ?? origins[0] ?? `https://${domain}`;
  const chainIds = siweChainIds();
  const message =
    input.address && input.chainId && chainIds.includes(input.chainId)
      ? createSiweMessage({ address: input.address as Hex, chainId: input.chainId, domain, nonce, uri, version: "1", statement: SIWE_STATEMENT, issuedAt: new Date(now), expirationTime: new Date(now + NONCE_TTL_MS) })
      : null;
  return { nonce, expiresAt: new Date(now + NONCE_TTL_MS).toISOString(), domain, uri, chainIds, statement: SIWE_STATEMENT, message };
}

export interface VerifiedSiwe {
  readonly address: string;
  readonly chainId: number;
}

export async function verifySiwe(ctx: AppContext, message: string, signature: string): Promise<VerifiedSiwe> {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    throw fail("SIWE_INVALID", "The message is not an EIP-4361 sign-in message.");
  }
  if (!parsed.address || !parsed.domain || !parsed.nonce || !parsed.uri || !parsed.chainId || parsed.version !== "1") throw fail("SIWE_INVALID", "The message is not a complete EIP-4361 sign-in message.");
  const { domains, origins } = siweDomains(ctx);
  if (!domains.includes(parsed.domain.toLowerCase()) && !cityHost(ctx, parsed.domain)) throw fail("SIWE_DOMAIN", `This message is for ${parsed.domain}, not for Lykia.`);
  let uri: URL;
  try {
    uri = new URL(parsed.uri);
  } catch {
    throw fail("SIWE_INVALID", "The message URI is not a URL.");
  }
  if (!origins.includes(uri.origin) && uri.host !== parsed.domain) throw fail("SIWE_DOMAIN", "The message URI is not on the signing domain.");
  if (!siweChainIds().includes(parsed.chainId)) throw fail("SIWE_CHAIN", `Chain ${parsed.chainId} is not one Lykia signs in on.`);
  const now = ctx.clock.now();
  if (parsed.expirationTime && parsed.expirationTime.getTime() <= now) throw fail("SIWE_EXPIRED", "The sign-in message expired. Request a new nonce.");
  if (parsed.notBefore && parsed.notBefore.getTime() > now) throw fail("SIWE_NOT_YET_VALID", "The sign-in message is not valid yet.");
  if (parsed.issuedAt && (parsed.issuedAt.getTime() > now + 60_000 || parsed.issuedAt.getTime() < now - NONCE_TTL_MS)) throw fail("SIWE_STALE", "The message's issuedAt is outside the nonce lifetime.");
  if (!/^0x[0-9a-fA-F]+$/u.test(signature)) throw fail("SIWE_SIGNATURE", "The signature is not hex.");
  if (!(await ctx.store.collection("siwe_nonces").delete(parsed.nonce))) throw fail("SIWE_NONCE", "This nonce is unknown, expired or already used. Request a new one.");
  const address = parsed.address.toLowerCase() as Hex;
  let valid = await verifyMessage({ address, message, signature: signature as Hex }).catch(() => false);
  if (!valid) {
    const network = resolveNetwork(parsed.chainId);
    if (network) {
      try {
        // Smart accounts through Arc RPC. viem's public-client verifyMessage covers ERC-1271 for
        // deployed accounts (LykiaAccount, Circle Modular Wallets) and ERC-6492 for counterfactual
        // ones: a passkey account that is not deployed yet signs with a 6492 wrapper (factory +
        // init code + inner signature, magic suffix 0x6492…6492), which is checked by simulating the
        // deployment with the universal validator in a single eth_call. Nothing is deployed.
        valid = await ctx.chains.client(network.environment).verifyMessage({ address, message, signature: signature as Hex });
      } catch {
        valid = false;
      }
    }
  }
  if (!valid) throw fail("SIWE_SIGNATURE", "The signature does not match the message's address.");
  return { address, chainId: parsed.chainId };
}
