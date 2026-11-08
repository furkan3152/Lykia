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
import { DEFAULT_FEE_BPS, DEFAULT_FEE_RECIPIENT, MAX_FEE_BPS, parseFeeSchedule, type FeeSchedule, NETWORKS, type ArcEnvironment, type ArcNetwork, type ArcNetworkKey } from "@lykia/core";
import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./log.js";

const DEFAULT_PORT = 3002;
const DEV_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174", "http://localhost:5176", "http://localhost:4176"] as const;

/** Env var that overrides (prepends to) the RPC endpoints of each EVM network. */
const RPC_OVERRIDE_ENV: Readonly<Record<ArcNetworkKey, string>> = Object.freeze({
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
  /** Per-IP limit counted in the shared store (all instances) on model and compile routes. */
  readonly sharedPerMinute?: number;
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
    /** Model id for the Lyko agent, from LYKIA_AGENT_MODEL; null keeps the deterministic reader. */
    readonly model: string | null;
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
    /** The domain League cities run under as subdomains (pay.<root>, agents.<root>); null until one is set. */
    readonly rootDomain: string | null;
  };
  /** Circle StableFX RFQ credentials for the /v1/circle/stablefx/* taker endpoints (fx steps in a plan route on chain either way). */
  readonly stablefxApiKey: string | null;
  /** Circle platform credentials (Wallets, Compliance, StableFX). All optional; keyed features say so when missing. */
  readonly circle: {
    readonly apiKey: string | null;
    readonly entitySecret: string | null;
    readonly walletSetId: string | null;
    /** A developer-controlled wallet (the x402 payTo) that signs Circle facilitator seller proofs; null = none. */
    readonly sellerWalletId?: string | null;
    /**
     * Opt-in (LYKIA_CIRCLE_SERVER_WALLETS=true): this server creates Circle
     * developer-controlled wallets for signed-in users and executes payouts
     * from them with the operator's entity secret. Off by default: without it
     * wallet creation and Circle payout execution answer 403.
     */
    readonly serverWallets?: boolean;
  };
  readonly telegramBotToken: string | null;
  /** Lykia's protocol fee, paid on chain in every value-moving step. */
  /** `schedule` (LYKIA_FEE_SCHEDULE) prices kinds individually; null = `bps` everywhere. `plans` are per-plan overrides for API customers. */
  readonly fee: { readonly bps: number; readonly recipient: `0x${string}`; readonly schedule?: FeeSchedule | null; readonly plans?: Readonly<Record<string, FeeSchedule>> };
  /** Mainnet beta cap (USD) that sits above every Fence while the contracts are unaudited; null when switched off. */
  readonly beta: { readonly perStepUsd: string; readonly perDayUsd: string } | null;
  /**
   * Stile, a leash that spends from a Circle Gateway balance (LYKIA_STILE, off by default). `environments`
   * lists where it is switched on; `reference` is the owner's own LykiaStile deployment per environment,
   * the one the end-to-end check ran against. The Gateway option is offered only where both are set.
   */
  readonly stile: { readonly environments: readonly ArcEnvironment[]; readonly reference: Readonly<Partial<Record<ArcEnvironment, `0x${string}`>>> };
  /** x402: paid routes are disabled unless payTo is set. */
  /** ERC-8354 attestations: the address that answers validation requests as Lykia's guard (it signs on its own; the server never does). */
  readonly guardAddress: `0x${string}` | null;
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
  /** Global cap on model calls per UTC day (LYKIA_MODEL_DAILY_CALLS); past it the deterministic reader answers. */
  readonly modelDailyCalls: number;
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
function parseOrigin(raw: string, production: boolean): string | null {
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
function parseRpcUrl(raw: string): string | null {
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
  LYKIA_ROOT_DOMAIN: optionalString,
  LYKIA_DATABASE_URL: optionalString,
  DATABASE_URL: optionalString,
  POSTGRES_URL: optionalString,
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
  ZEROX_API_KEY: optionalString,
  CIRCLE_API_KEY: optionalString,
  CIRCLE_ENTITY_SECRET: optionalString,
  CIRCLE_WALLET_SET_ID: optionalString,
  LYKIA_CIRCLE_SERVER_WALLETS: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  LYKIA_X402_PAY_TO: optionalString,
  LYKIA_GUARD_ADDRESS: optionalString,
  LYKIA_X402_PRICE_USDC: optionalString,
  LYKIA_FEE_BPS: optionalString,
  LYKIA_FEE_SCHEDULE: optionalString,
  LYKIA_FEE_SCHEDULE_PLANS: optionalString,
  CIRCLE_X402_SELLER_WALLET_ID: optionalString,
  LYKIA_BETA_CAP_USD: optionalString,
  LYKIA_STILE: optionalString,
  LYKIA_STILE_REFERENCE_TESTNET: optionalString,
  LYKIA_STILE_REFERENCE_MAINNET: optionalString,
  LYKIA_FEE_RECIPIENT: optionalString,
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
  LYKIA_RATE_LIMIT_SHARED: intInRange(1, 100_000, 20),
  LYKIA_MODEL_DAILY_CALLS: intInRange(0, 10_000_000, 2_000),
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

  // Hosting integrations (Vercel + Neon, Render) expose DATABASE_URL or POSTGRES_URL; LYKIA_DATABASE_URL wins.
  const databaseUrl = env.LYKIA_DATABASE_URL ?? env.DATABASE_URL ?? env.POSTGRES_URL;
  if (databaseUrl && !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    issues.push("LYKIA_DATABASE_URL: must be a postgres:// or postgresql:// URL");
  }
  if (env.LYKIA_SESSION_SECRET && env.LYKIA_SESSION_SECRET.length < 32) {
    issues.push("LYKIA_SESSION_SECRET: must be at least 32 characters");
  }
  if (env.LYKIA_X402_PAY_TO && env.LYKIA_X402_PAY_TO !== "off" && !/^0x[0-9a-fA-F]{40}$/u.test(env.LYKIA_X402_PAY_TO)) issues.push("LYKIA_X402_PAY_TO: must be a 0x address or off");
  if (env.LYKIA_GUARD_ADDRESS && !/^0x[0-9a-fA-F]{40}$/u.test(env.LYKIA_GUARD_ADDRESS)) issues.push("LYKIA_GUARD_ADDRESS: must be a 0x address");
  if (env.LYKIA_BETA_CAP_USD !== undefined && !/^(?:off|\d{1,9}(?:\/\d{1,9})?)$/u.test(env.LYKIA_BETA_CAP_USD)) issues.push("LYKIA_BETA_CAP_USD: 'off', a per-step USD cap such as 1000, or per-step/per-day such as 1000/5000");
  if (env.LYKIA_FEE_BPS !== undefined && !(/^\d{1,3}$/u.test(env.LYKIA_FEE_BPS) && Number(env.LYKIA_FEE_BPS) <= MAX_FEE_BPS)) issues.push(`LYKIA_FEE_BPS: an integer from 0 to ${MAX_FEE_BPS} (100 = 1%)`);
  if (env.LYKIA_FEE_RECIPIENT && !/^0x[0-9a-fA-F]{40}$/u.test(env.LYKIA_FEE_RECIPIENT)) issues.push("LYKIA_FEE_RECIPIENT: must be a 0x address");
  if (env.LYKIA_STILE !== undefined && stileEnvironments(env.LYKIA_STILE) === null) issues.push('LYKIA_STILE: "off", "on", "testnet", "mainnet" or "testnet,mainnet"');
  for (const name of ["LYKIA_STILE_REFERENCE_TESTNET", "LYKIA_STILE_REFERENCE_MAINNET"] as const) if (env[name] && !/^0x[0-9a-fA-F]{40}$/u.test(env[name]!)) issues.push(`${name}: must be a 0x address`);
  if (env.LYKIA_FEE_SCHEDULE !== undefined) {
    const parsed = parseFeeSchedule(env.LYKIA_FEE_SCHEDULE);
    if (!parsed.ok) issues.push(`LYKIA_FEE_SCHEDULE: ${parsed.issue}`);
  }
  if (env.LYKIA_FEE_SCHEDULE_PLANS !== undefined && !planSchedules(env.LYKIA_FEE_SCHEDULE_PLANS)) issues.push('LYKIA_FEE_SCHEDULE_PLANS: a JSON object of plan id -> schedule, e.g. {"scale":{"transfer":0}}');
  if (env.CIRCLE_X402_SELLER_WALLET_ID !== undefined && !/^[0-9a-f-]{36}$/u.test(env.CIRCLE_X402_SELLER_WALLET_ID)) issues.push("CIRCLE_X402_SELLER_WALLET_ID: a Circle wallet id (UUID)");
  if (env.LYKIA_X402_PRICE_USDC && !/^\d{1,6}(?:\.\d{1,6})?$/u.test(env.LYKIA_X402_PRICE_USDC)) issues.push("LYKIA_X402_PRICE_USDC: a USDC amount such as 0.01");
  if (env.LYKIA_X402_FACILITATOR_URL && env.LYKIA_X402_FACILITATOR_URL !== "off" && !/^https:\/\//u.test(env.LYKIA_X402_FACILITATOR_URL)) issues.push("LYKIA_X402_FACILITATOR_URL: must be an https URL or off");
  const adminAddresses = splitList(env.LYKIA_ADMIN_ADDRESSES).map((a) => a.toLowerCase());
  if (adminAddresses.some((a) => !/^0x[0-9a-f]{40}$/u.test(a))) issues.push("LYKIA_ADMIN_ADDRESSES: comma-separated 0x addresses");
  const siweDomains = splitList(env.LYKIA_SIWE_DOMAINS).map((d) => d.toLowerCase());
  if (siweDomains.some((d) => !/^[a-z0-9.-]+(?::\d{1,5})?$/u.test(d))) issues.push("LYKIA_SIWE_DOMAINS: comma-separated host[:port] entries");
  const rootDomain = env.LYKIA_ROOT_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/gu, "") || null;
  if (rootDomain && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/u.test(rootDomain)) issues.push("LYKIA_ROOT_DOMAIN: a bare domain such as lykiaai.com (no scheme, no path)");
  if (issues.length > 0) throw new ConfigError(issues);

  const config: Config = {
    env: env.NODE_ENV,
    version: packageVersion(),
    host: env.HOST ?? "0.0.0.0",
    port: env.PORT,
    mode: env.LYKIA_MODE,
    webOrigins: Object.freeze([...webOrigins]),
    databaseUrl: databaseUrl ?? null,
    sessionSecret: env.LYKIA_SESSION_SECRET ?? null,
    agent: Object.freeze({
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
      model: env.LYKIA_AGENT_MODEL ?? null,
      maxSteps: env.LYKIA_AGENT_MAX_STEPS,
      maxTokens: env.LYKIA_AGENT_MAX_TOKENS,
    }),
    platform: Object.freeze({ siweDomains: Object.freeze(siweDomains), adminAddresses: Object.freeze(adminAddresses), rootDomain }),
    stablefxApiKey: env.STABLEFX_API_KEY ?? env.CIRCLE_API_KEY ?? null,
    circle: Object.freeze({ apiKey: env.CIRCLE_API_KEY ?? null, entitySecret: env.CIRCLE_ENTITY_SECRET ?? null, walletSetId: env.CIRCLE_WALLET_SET_ID ?? null, sellerWalletId: env.CIRCLE_X402_SELLER_WALLET_ID ?? null, serverWallets: env.LYKIA_CIRCLE_SERVER_WALLETS === "true" }),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? null,
    beta: betaCap(env.LYKIA_BETA_CAP_USD),
    stile: Object.freeze({
      environments: Object.freeze(stileEnvironments(env.LYKIA_STILE) ?? []),
      reference: Object.freeze({
        ...(env.LYKIA_STILE_REFERENCE_TESTNET ? { testnet: env.LYKIA_STILE_REFERENCE_TESTNET.toLowerCase() as `0x${string}` } : {}),
        ...(env.LYKIA_STILE_REFERENCE_MAINNET ? { mainnet: env.LYKIA_STILE_REFERENCE_MAINNET.toLowerCase() as `0x${string}` } : {}),
      }),
    }),
    fee: Object.freeze({ bps: env.LYKIA_FEE_BPS !== undefined ? Number(env.LYKIA_FEE_BPS) : DEFAULT_FEE_BPS, recipient: (env.LYKIA_FEE_RECIPIENT ?? DEFAULT_FEE_RECIPIENT).toLowerCase() as `0x${string}`, schedule: feeScheduleOf(env.LYKIA_FEE_SCHEDULE), plans: planSchedules(env.LYKIA_FEE_SCHEDULE_PLANS) ?? {} }),
    guardAddress: (env.LYKIA_GUARD_ADDRESS as `0x${string}` | undefined) ?? null,
    x402: Object.freeze({
      payTo: x402PayTo(env.LYKIA_X402_PAY_TO, env.LYKIA_FEE_RECIPIENT ?? DEFAULT_FEE_RECIPIENT),
      priceUnits: usdcUnits(env.LYKIA_X402_PRICE_USDC ?? "0.01"),
      facilitatorUrl: env.LYKIA_X402_FACILITATOR_URL === "off" ? null : (env.LYKIA_X402_FACILITATOR_URL ?? CIRCLE_X402_FACILITATOR),
    }),
    networks: withRpcOverrides(rpcOverrides),
    rpcOverrides: Object.freeze(rpcOverrides),
    logLevel: env.LYKIA_LOG_LEVEL ?? (env.NODE_ENV === "test" ? "warn" : env.NODE_ENV === "production" ? "info" : "debug"),
    trustProxy: env.LYKIA_TRUST_PROXY ?? (production ? 1 : 0),
    rateLimits: Object.freeze({
      defaultPerMinute: env.LYKIA_RATE_LIMIT_DEFAULT,
      heavyPerMinute: env.LYKIA_RATE_LIMIT_HEAVY,
      authPerMinute: env.LYKIA_RATE_LIMIT_AUTH,
      sharedPerMinute: env.LYKIA_RATE_LIMIT_SHARED,
    }),
    modelDailyCalls: env.LYKIA_MODEL_DAILY_CALLS,
    build: Object.freeze({ commit: commitOf(env) }),
  };
  return Object.freeze(config);
}

function usdcUnits(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")).toString();
}

/** "1000/5000" = per-step/per-day USD; "1000" = per step with a 5x daily cap; "off" disables. Default 1000/5000. */
function betaCap(raw: string | undefined): Config["beta"] {
  if (raw === "off") return null;
  const [step = "1000", day] = (raw ?? "1000/5000").split("/");
  return Object.freeze({ perStepUsd: step, perDayUsd: day ?? String(Number(step) * 5) });
}

/** LYKIA_STILE: unset or "off" = nowhere; "on" = both environments; otherwise a comma list. null = invalid. */
function stileEnvironments(raw: string | undefined): ArcEnvironment[] | null {
  const value = (raw ?? "off").trim().toLowerCase();
  if (value === "off" || value === "") return [];
  if (value === "on") return ["testnet", "mainnet"];
  const list = splitList(value);
  if (list.length === 0 || !list.every((e) => e === "testnet" || e === "mainnet")) return null;
  return [...new Set(list)] as ArcEnvironment[];
}

/** Circle's x402 facilitator (verify, settle, supported). Settlement needs CIRCLE_API_KEY. */
const CIRCLE_X402_FACILITATOR = "https://api.circle.com/v1/facilitator/x402";

/** Paid routes pay the fee recipient unless LYKIA_X402_PAY_TO names another wallet or is "off". */
/** LYKIA_FEE_SCHEDULE parsed (validated in the issues pass); unset = null, so the base fee applies everywhere. */
function feeScheduleOf(raw: string | undefined): FeeSchedule | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = parseFeeSchedule(raw);
  return parsed.ok ? parsed.schedule : null;
}

/** LYKIA_FEE_SCHEDULE_PLANS: { "<plan id>": { "<kind>": bps } }; null when malformed. */
function planSchedules(raw: string | undefined): Record<string, FeeSchedule> | null {
  if (raw === undefined || raw.trim() === "") return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const out: Record<string, FeeSchedule> = {};
    for (const [plan, schedule] of Object.entries(value as Record<string, unknown>)) {
      if (!/^[a-z0-9-]{1,32}$/u.test(plan)) return null;
      const parsed = parseFeeSchedule(schedule);
      if (!parsed.ok) return null;
      out[plan] = parsed.schedule;
    }
    return out;
  } catch {
    return null;
  }
}

function x402PayTo(raw: string | undefined, feeRecipient: string): `0x${string}` | null {
  if (raw === "off") return null;
  return (raw ?? feeRecipient).toLowerCase() as `0x${string}`;
}
