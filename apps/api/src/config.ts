/**
 * Environment parsing. `loadConfig(env)` validates every variable with zod and
 * returns a frozen, typed Config; a bad value fails at boot with the variable
 * name and the rule it broke (values are never echoed: some are secrets).
 *
 * Everything optional stays optional: without keys the API serves read-only
 * data. RPC overrides are prepended to the public endpoints of the core
 * network registry, so a keyed endpoint is preferred and the public ones stay
 * as fallbacks.
 */
import { createRequire } from "node:module";
import { NETWORKS, type ArcEnvironment, type ArcNetwork, type ArcNetworkKey } from "@lykia/core";
import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./log.js";

export const DEFAULT_PORT = 3002;
export const DEV_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5176", "http://localhost:4176"] as const;
/** Default model for the Lyko agent. */
export const DEFAULT_AGENT_MODEL = "claude-sonnet-5-5";

/** Env var that overrides (prepends to) the RPC endpoints of each EVM network. */
export const RPC_OVERRIDE_ENV: Readonly<Record<ArcNetworkKey, string>> = Object.freeze({
  "arc-mainnet": "ARC_MAINNET_RPC_URL",
  "arc-testnet": "ARC_TESTNET_RPC_URL",
});

export type RuntimeEnv = "development" | "test" | "production";

export interface RateLimitConfig {
  /** Requests per minute per IP on every /v1 route. */
  readonly defaultPerMinute: number;
  /** Extra bucket for expensive routes (aggregations, upstream fan-out). */
  readonly heavyPerMinute: number;
  /** Extra bucket for sign-in and other credential routes. */
  readonly authPerMinute: number;
}

export interface Config {
  readonly env: RuntimeEnv;
  readonly version: string;
  readonly host: string;
  readonly port: number;
  readonly mode: ArcEnvironment;
  /** Exact browser origins allowed by CORS. */
  readonly webOrigins: readonly string[];
  readonly databaseUrl: string | null;
  readonly sessionSecret: string | null;
  readonly agent: {
    readonly anthropicApiKey: string | null;
    readonly model: string;
    /** Upper bound on tool rounds per agent turn (orchestrator and each specialist). */
    readonly maxSteps: number;
    /** Output token budget per model call. */
    readonly maxTokens: number;
  };
  /** Sign-in, developer platform and admin. */
  readonly platform: {
    /** Extra SIWE domains (host[:port]) besides the hosts of webOrigins. */
    readonly siweDomains: readonly string[];
    /** Lower-case addresses that hold the admin role. */
    readonly adminAddresses: readonly string[];
  };
  /** Circle StableFX RFQ credentials (fx steps are not executable without them). */
  readonly stablefxApiKey: string | null;
  /** Circle platform credentials (Wallets, Compliance, StableFX). All optional; keyed features say so when missing. */
  readonly circle: {
    readonly apiKey: string | null;
    readonly entitySecret: string | null;
    readonly walletSetId: string | null;
  };
  readonly telegramBotToken: string | null;
  /** x402: paid routes are disabled unless payTo is set. */
  readonly x402: {
    readonly payTo: `0x${string}` | null;
    /** Price per call in USDC base units (6 decimals). */
    readonly priceUnits: string;
    readonly facilitatorUrl: string | null;
  };
  /** Core networks with RPC overrides prepended to `rpcUrls`. */
  readonly networks: Readonly<Record<ArcNetworkKey, ArcNetwork>>;
  /** Networks whose RPC list was extended from the environment. */
  readonly rpcOverrides: Readonly<Partial<Record<ArcNetworkKey, readonly string[]>>>;
  readonly logLevel: LogLevel;
  /** Express `trust proxy` hop count (0 = use the socket address). */
  readonly trustProxy: number;
  readonly rateLimits: RateLimitConfig;
  readonly build: { readonly commit: string | null };
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const require = createRequire(import.meta.url);

function packageVersion(): string {
  try {
    // src/ (tsx) and dist/ (node) are both one level below apps/api.
    const pkg = require("../package.json") as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** "" and whitespace-only values count as unset (common in .env files). */
const optionalString = z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().optional());

function intInRange(min: number, max: number, fallback: number) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(min).max(max).default(fallback),
  );
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
}

/** One exact origin: https (or loopback http outside production), no path, query or credentials. */
export function parseOrigin(raw: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
  if (url.protocol !== "https:" && !(isLoopbackHttp(url) && !production)) return null;
  // `raw` may carry a trailing slash; the origin never does.
  return url.origin;
}

/** An RPC endpoint: absolute http(s) URL without credentials in the userinfo part. */
export function parseRpcUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.hash) return null;
  return raw.trim();
}

/** Comparison key for an RPC URL (`https://x` and `https://x/` are the same endpoint). */
function rpcKey(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function dedupeUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const key = rpcKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/u;

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(["development", "test", "production"]).default("development"),
  ),
  HOST: optionalString,
  PORT: intInRange(0, 65_535, DEFAULT_PORT),
  LYKIA_MODE: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(["testnet", "mainnet"]).default("testnet"),
  ),
  LYKIA_WEB_ORIGIN: optionalString,
  LYKIA_DATABASE_URL: optionalString,
  LYKIA_SESSION_SECRET: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  LYKIA_AGENT_MODEL: optionalString,
  LYKIA_AGENT_MAX_STEPS: intInRange(1, 20, 6),
  LYKIA_AGENT_MAX_TOKENS: intInRange(256, 32_000, 4_096),
  LYKIA_SIWE_DOMAINS: optionalString,
  LYKIA_ADMIN_ADDRESSES: optionalString,
  ARC_MAINNET_RPC_URL: optionalString,
  ARC_TESTNET_RPC_URL: optionalString,
  STABLEFX_API_KEY: optionalString,
  CIRCLE_API_KEY: optionalString,
  CIRCLE_ENTITY_SECRET: optionalString,
  CIRCLE_WALLET_SET_ID: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  LYKIA_X402_PAY_TO: optionalString,
  LYKIA_X402_PRICE_USDC: optionalString,
  LYKIA_X402_FACILITATOR_URL: optionalString,
  LYKIA_LOG_LEVEL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.enum(LOG_LEVELS).optional(),
  ),
  LYKIA_TRUST_PROXY: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(0).max(3).optional(),
  ),
  LYKIA_RATE_LIMIT_DEFAULT: intInRange(1, 100_000, 600),
  LYKIA_RATE_LIMIT_HEAVY: intInRange(1, 100_000, 60),
  LYKIA_RATE_LIMIT_AUTH: intInRange(1, 100_000, 20),
  LYKIA_BUILD_COMMIT: optionalString,
  RENDER_GIT_COMMIT: optionalString,
});

type ParsedEnv = z.infer<typeof EnvSchema>;

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function withRpcOverrides(overrides: Partial<Record<ArcNetworkKey, readonly string[]>>): Readonly<Record<ArcNetworkKey, ArcNetwork>> {
  const out = {} as Record<ArcNetworkKey, ArcNetwork>;
  for (const [key, network] of Object.entries(NETWORKS) as Array<[ArcNetworkKey, ArcNetwork]>) {
    const extra = overrides[key];
    out[key] = extra && extra.length > 0 ? Object.freeze({ ...network, rpcUrls: dedupeUrls([...extra, ...network.rpcUrls]) }) : network;
  }
  return Object.freeze(out);
}

function commitOf(env: ParsedEnv): string | null {
  for (const raw of [env.RENDER_GIT_COMMIT, env.LYKIA_BUILD_COMMIT]) {
    const value = raw?.toLowerCase();
    if (value && COMMIT_PATTERN.test(value)) return value;
  }
  return null;
}

export function loadConfig(source: Readonly<Record<string, string | undefined>> = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`));
  }
  const env = parsed.data;
  const production = env.NODE_ENV === "production";
  const issues: string[] = [];

  const webOrigins = new Set<string>(production ? [] : DEV_WEB_ORIGINS);
  for (const raw of splitList(env.LYKIA_WEB_ORIGIN)) {
    const origin = parseOrigin(raw, production);
    if (origin) webOrigins.add(origin);
    else issues.push(`LYKIA_WEB_ORIGIN: "${raw.slice(0, 80)}" is not an exact https origin${production ? "" : " (or http://localhost)"}`);
  }

  const rpcOverrides: Partial<Record<ArcNetworkKey, readonly string[]>> = {};
  for (const [key, name] of Object.entries(RPC_OVERRIDE_ENV) as Array<[ArcNetworkKey, string]>) {
    const urls: string[] = [];
    for (const raw of splitList(source[name])) {
      const url = parseRpcUrl(raw);
      // The value may contain an API key: name the variable, never the value.
      if (url) urls.push(url);
      else issues.push(`${name}: entries must be absolute http(s) URLs without credentials`);
    }
    if (urls.length > 0) rpcOverrides[key] = Object.freeze(dedupeUrls(urls));
  }

  if (env.LYKIA_DATABASE_URL && !/^postgres(?:ql)?:\/\//u.test(env.LYKIA_DATABASE_URL)) {
    issues.push("LYKIA_DATABASE_URL: must be a postgres:// or postgresql:// URL");
  }
  if (env.LYKIA_SESSION_SECRET && env.LYKIA_SESSION_SECRET.length < 32) {
    issues.push("LYKIA_SESSION_SECRET: must be at least 32 characters");
  }
  if (env.LYKIA_X402_PAY_TO && !/^0x[0-9a-fA-F]{40}$/u.test(env.LYKIA_X402_PAY_TO)) issues.push("LYKIA_X402_PAY_TO: must be a 0x address");
  if (env.LYKIA_X402_PRICE_USDC && !/^\d{1,6}(?:\.\d{1,6})?$/u.test(env.LYKIA_X402_PRICE_USDC)) issues.push("LYKIA_X402_PRICE_USDC: a USDC amount such as 0.01");
  if (env.LYKIA_X402_FACILITATOR_URL && !/^https:\/\//u.test(env.LYKIA_X402_FACILITATOR_URL)) issues.push("LYKIA_X402_FACILITATOR_URL: must be an https URL");
  const adminAddresses = splitList(env.LYKIA_ADMIN_ADDRESSES).map((a) => a.toLowerCase());
  if (adminAddresses.some((a) => !/^0x[0-9a-f]{40}$/u.test(a))) issues.push("LYKIA_ADMIN_ADDRESSES: comma-separated 0x addresses");
  const siweDomains = splitList(env.LYKIA_SIWE_DOMAINS).map((d) => d.toLowerCase());
  if (siweDomains.some((d) => !/^[a-z0-9.-]+(?::\d{1,5})?$/u.test(d))) issues.push("LYKIA_SIWE_DOMAINS: comma-separated host[:port] entries");
  if (issues.length > 0) throw new ConfigError(issues);

  const config: Config = {
    env: env.NODE_ENV,
    version: packageVersion(),
    host: env.HOST ?? "0.0.0.0",
    port: env.PORT,
    mode: env.LYKIA_MODE,
    webOrigins: Object.freeze([...webOrigins]),
    databaseUrl: env.LYKIA_DATABASE_URL ?? null,
    sessionSecret: env.LYKIA_SESSION_SECRET ?? null,
    agent: Object.freeze({
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
      model: env.LYKIA_AGENT_MODEL ?? DEFAULT_AGENT_MODEL,
      maxSteps: env.LYKIA_AGENT_MAX_STEPS,
      maxTokens: env.LYKIA_AGENT_MAX_TOKENS,
    }),
    platform: Object.freeze({ siweDomains: Object.freeze(siweDomains), adminAddresses: Object.freeze(adminAddresses) }),
    stablefxApiKey: env.STABLEFX_API_KEY ?? env.CIRCLE_API_KEY ?? null,
    circle: Object.freeze({ apiKey: env.CIRCLE_API_KEY ?? null, entitySecret: env.CIRCLE_ENTITY_SECRET ?? null, walletSetId: env.CIRCLE_WALLET_SET_ID ?? null }),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? null,
    x402: Object.freeze({
      payTo: (env.LYKIA_X402_PAY_TO as `0x${string}` | undefined) ?? null,
      priceUnits: usdcUnits(env.LYKIA_X402_PRICE_USDC ?? "0.01"),
      facilitatorUrl: env.LYKIA_X402_FACILITATOR_URL ?? null,
    }),
    networks: withRpcOverrides(rpcOverrides),
    rpcOverrides: Object.freeze(rpcOverrides),
    logLevel: env.LYKIA_LOG_LEVEL ?? (env.NODE_ENV === "test" ? "warn" : env.NODE_ENV === "production" ? "info" : "debug"),
    trustProxy: env.LYKIA_TRUST_PROXY ?? (production ? 1 : 0),
    rateLimits: Object.freeze({
      defaultPerMinute: env.LYKIA_RATE_LIMIT_DEFAULT,
      heavyPerMinute: env.LYKIA_RATE_LIMIT_HEAVY,
      authPerMinute: env.LYKIA_RATE_LIMIT_AUTH,
    }),
    build: Object.freeze({ commit: commitOf(env) }),
  };
  return Object.freeze(config);
}

/** The Arc network of an environment. */
export function arcNetworkFor(mode: ArcEnvironment): ArcNetworkKey {
  return mode === "testnet" ? "arc-testnet" : "arc-mainnet";
}

function usdcUnits(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")).toString();
}
