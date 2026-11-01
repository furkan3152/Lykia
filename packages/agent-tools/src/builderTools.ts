/**
 * Builder tools: the aggregator, AI routing, contracts, data and security.
 * Opt-in by name, like the business tools (the default LYKIA_TOOLS set does
 * not change). They quote, build and read; a build returns unsigned calls
 * that passed the Fence, a simulation and the security layer. Nothing signs.
 */
import { ToolInputError, type JsonSchema, type ToolDefinition, type ToolDefaults } from "./tools.js";

export type BuilderToolName = "aggregator_quote" | "build_action" | "ai_route" | "simulate_calls" | "decode_calldata" | "token_prices" | "portfolio" | "screen_address" | "explain_tx";

const ADDRESS: JsonSchema = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "An EVM address (0x…)." };
const ENV: JsonSchema = { type: "string", enum: ["mainnet", "testnet"], description: "Arc network. Defaults to the executor's environment." };
const AMOUNT: JsonSchema = { type: "string", pattern: "^(?:all|\\d{1,12}(?:\\.\\d{1,18})?)$", description: "Whole tokens as a decimal string, or \"all\"." };
const TOKEN: JsonSchema = { type: "string", maxLength: 12, description: "A registry token symbol on Arc (USDC, EURC, cirBTC, ...)." };
const KIND: JsonSchema = { type: "string", enum: ["transfer", "swap", "fx", "bridge", "deposit", "withdraw", "supply", "borrow", "repay"], description: "The action." };

function env(args: Record<string, unknown>, d: ToolDefaults): Record<string, unknown> {
  const e = args.environment ?? d.environment;
  return e ? { environment: e } : {};
}

function taker(args: Record<string, unknown>, d: ToolDefaults): string {
  const t = (args.taker as string | undefined) ?? d.owner;
  if (!t) throw new ToolInputError("taker is required (pass it, or set a default owner on the executor).");
  return t;
}

const ACTION_PROPS: Record<string, JsonSchema> = { kind: KIND, taker: ADDRESS, tokenIn: TOKEN, tokenOut: TOKEN, token: TOKEN, amount: AMOUNT, to: ADDRESS, memo: { type: "string", maxLength: 256 }, destination: { type: "string", maxLength: 20, description: "CCTP chain for bridge (base, ethereum, ...)." }, venue: { type: "string", maxLength: 80 }, slippageBps: { type: "number", minimum: 0, maximum: 1000 }, environment: ENV };

function action(a: Record<string, unknown>, d: ToolDefaults): Record<string, unknown> {
  const { environment: _e, taker: _t, ...rest } = a;
  return { ...rest, taker: taker(a, d), ...env(a, d) };
}

export const LYKIA_BUILDER_TOOLS: readonly ToolDefinition[] = Object.freeze<ToolDefinition[]>([
  {
    name: "aggregator_quote",
    effect: "read",
    description: "Best-execution quote on Arc for a swap, fx, transfer, bridge, deposit, withdraw, supply, borrow or repay: the best route across venues, the alternatives, price impact, gas in USDC, Lykia's fee and the Fence verdict, with a quote id to build from.",
    parameters: { type: "object", properties: ACTION_PROPS, required: ["kind"], additionalProperties: false },
    call: (a, d) => ({ method: "POST", path: "/v1/aggregator/quote", body: action(a, d) }),
  },
  {
    name: "build_action",
    effect: "plan",
    description: "Ready-to-sign calls for a quote id (or an action): simulated on Arc and checked by the Fence and the security layer first. The owner's wallet signs what comes back; set confirm only after the owner confirmed.",
    parameters: { type: "object", properties: { quoteId: { type: "string", pattern: "^q_[A-Za-z0-9_-]{8,40}$" }, ...ACTION_PROPS, format: { type: "string", enum: ["transactions", "calls", "eip5792"] }, confirm: { type: "boolean" } }, additionalProperties: false },
    call: (a, d) => {
      if (a.quoteId) return { method: "POST", path: "/v1/aggregator/build", body: { quoteId: a.quoteId, ...(a.format ? { format: a.format } : {}), ...(a.confirm ? { confirm: true } : {}) } };
      return { method: "POST", path: "/v1/aggregator/build", body: action(a, d) };
    },
  },
  {
    name: "ai_route",
    effect: "read",
    description: "Turn a request in any language into plan actions and find the best route across Arc venues, with an explanation. Optional constraints (venue allow/deny lists, risk appetite, max steps) only tighten the Fence.",
    parameters: { type: "object", properties: { text: { type: "string", maxLength: 1000 }, owner: ADDRESS, constraints: { type: "object" }, environment: ENV }, required: ["text"], additionalProperties: false },
    call: (a, d) => ({ method: "POST", path: "/v1/ai/route", body: { text: a.text, owner: (a.owner as string | undefined) ?? taker({}, d), ...(a.constraints ? { constraints: a.constraints } : {}), ...env(a, d) } }),
  },
  {
    name: "simulate_calls",
    effect: "read",
    description: "Simulate a batch of calls from an address on Arc before anyone signs: balance changes, decoded calls and a security verdict (unlimited approvals, unknown contracts, risky recipients).",
    parameters: { type: "object", properties: { from: ADDRESS, calls: { type: "array", items: { type: "object", properties: { to: ADDRESS, data: { type: "string" }, value: { type: "string" } }, required: ["to", "data"], additionalProperties: false } }, environment: ENV }, required: ["from", "calls"], additionalProperties: false },
    call: (a, d) => ({ method: "POST", path: "/v1/contracts/simulate", body: { from: a.from, calls: a.calls, ...env(a, d) } }),
  },
  {
    name: "decode_calldata",
    effect: "read",
    description: "Decode calldata (and optionally logs) into plain English, naming the Arc contracts and tokens involved.",
    parameters: { type: "object", properties: { to: ADDRESS, data: { type: "string" }, environment: ENV }, required: ["data"], additionalProperties: false },
    call: (a, d) => ({ method: "POST", path: "/v1/contracts/decode", body: { data: a.data, ...(a.to ? { to: a.to } : {}), ...env(a, d) } }),
  },
  {
    name: "token_prices",
    effect: "read",
    description: "USD prices of Arc tokens with their source (Chainlink on Arc, fiat pegs, NAV). A token without a feed is unpriced, never zero.",
    parameters: { type: "object", properties: { symbols: { type: "string", maxLength: 200, description: "Comma-separated symbols; empty for all." }, environment: ENV }, additionalProperties: false },
    call: (a, d) => {
      const params = new URLSearchParams(Object.entries({ ...(a.symbols ? { symbols: String(a.symbols) } : {}), ...env(a, d) }).map(([k, v]) => [k, String(v)]));
      return { method: "GET", path: `/v1/data/prices${params.size ? `?${params.toString()}` : ""}` };
    },
  },
  {
    name: "portfolio",
    effect: "read",
    description: "An address's balances and positions across Arc venues (wallet, vaults, lending, Gateway, integrated protocols) in USD, grouped by venue.",
    parameters: { type: "object", properties: { address: ADDRESS, environment: ENV }, additionalProperties: false },
    call: (a, d) => ({ method: "GET", path: `/v1/data/portfolio/${encodeURIComponent((a.address as string | undefined) ?? taker({}, d))}${a.environment ?? d.environment ? `?environment=${String(a.environment ?? d.environment)}` : ""}` }),
  },
  {
    name: "screen_address",
    effect: "read",
    description: "Screen an address before paying it: issuer blocklists, look-alike and poisoning checks, contract traits and Circle Compliance when configured.",
    parameters: { type: "object", properties: { address: ADDRESS, environment: ENV }, required: ["address"], additionalProperties: false },
    call: (a, d) => ({ method: "GET", path: `/v1/security/screen/address/${encodeURIComponent(String(a.address))}${a.environment ?? d.environment ? `?environment=${String(a.environment ?? d.environment)}` : ""}` }),
  },
  {
    name: "explain_tx",
    effect: "read",
    description: "Explain a transaction on Arc in plain English from its hash: who called what, the decoded steps and the events.",
    parameters: { type: "object", properties: { hash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" }, environment: ENV }, required: ["hash"], additionalProperties: false },
    call: (a, d) => ({ method: "POST", path: "/v1/tx/explain", body: { hash: a.hash, ...env(a, d) } }),
  },
]);
