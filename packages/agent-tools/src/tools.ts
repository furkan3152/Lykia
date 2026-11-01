/**
 * Lykia's agent tools as plain JSON Schema: one definition per tool, with
 * the HTTP call that runs it. Framework adapters (Vercel AI SDK,
 * LangChainJS, OpenAI function calling, Anthropic tool use) are thin
 * wrappers over these. No dependencies.
 */

export interface JsonSchema {
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly (string | number)[];
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
  readonly additionalProperties?: boolean | JsonSchema;
}

export type ToolName = "plan_intent" | "check_fence" | "scent_token" | "quote_route" | "flock" | "spawn_agent" | "standing_order" | "place_order" | "x402_buy";

export interface HttpCall {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: Record<string, unknown>;
}

export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: JsonSchema & { readonly type: "object" };
  /** Whether the tool can move money once a human signs what it returns. Read-only tools never can. */
  readonly effect: "read" | "plan";
  /** Builds the API call from validated arguments. */
  readonly call: (args: Record<string, unknown>, defaults: ToolDefaults) => HttpCall;
}

export interface ToolDefaults {
  readonly environment?: "mainnet" | "testnet";
  readonly owner?: string;
}

const ADDRESS: JsonSchema = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "An EVM address (0x…)." };
const ENV: JsonSchema = { type: "string", enum: ["mainnet", "testnet"], description: "Arc network. Defaults to the executor's environment." };
const AMOUNT: JsonSchema = { type: "string", pattern: "^\\d{1,12}(?:\\.\\d{1,18})?$", description: "A decimal amount as a string, e.g. \"25\" or \"0.5\"." };
const TOKEN: JsonSchema = { type: "string", maxLength: 12, description: "A token symbol on Arc: USDC, EURC or cirBTC." };

function env(args: Record<string, unknown>, d: ToolDefaults): Record<string, unknown> {
  const e = args.environment ?? d.environment;
  return e ? { environment: e } : {};
}

function owner(args: Record<string, unknown>, d: ToolDefaults): string {
  const o = (args.owner as string | undefined) ?? d.owner;
  if (!o) throw new ToolInputError("owner is required (pass it, or set a default owner on the executor).");
  return o;
}

function q(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)] as [string, string]);
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries).toString()}`;
}

export class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

export const LYKIA_TOOLS: readonly ToolDefinition[] = Object.freeze<ToolDefinition[]>([
  {
    name: "plan_intent",
    effect: "plan",
    description:
      "Plan a money move on Arc from a plain sentence (\"send 25 USDC to 0x…\", \"swap 100 USDC to EURC\", \"put 500 USDC to work\"). Returns the steps, fees and the Fence verdict (allow, confirm or deny). Nothing is signed: the owner's wallet signs each step later. Use dryRun to preview without storing.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", maxLength: 500, description: "What to do, in one sentence." }, owner: ADDRESS, environment: ENV, dryRun: { type: "boolean", description: "Preview only; nothing is stored." } },
      required: ["text"],
      additionalProperties: false,
    },
    call: (a, d) => ({ method: "POST", path: "/v1/intents", body: { owner: owner(a, d), text: a.text, ...env(a, d), ...(a.dryRun ? { dryRun: true } : {}) } }),
  },
  {
    name: "check_fence",
    effect: "read",
    description:
      "Check whether a move would pass the owner's Fence (caps, venues, recipients, schedule, Scent) without planning it for real. Give a sentence to dry-run it, or Fence facts to evaluate directly. Returns the decision and one reason per rule.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", maxLength: 500, description: "The move to check, as a sentence." }, owner: ADDRESS, facts: { type: "object", description: "Fence facts (advanced); when present, text is ignored." }, fence: { type: "object", description: "A lykia.fence/v1 document; default: the owner's." }, environment: ENV },
      additionalProperties: false,
    },
    call: (a, d) => (a.facts ? { method: "POST", path: "/v1/fence/evaluate", body: { facts: a.facts, ...(a.fence ? { fence: a.fence } : {}) } } : { method: "POST", path: "/v1/intents", body: { owner: owner(a, d), text: a.text, dryRun: true, ...env(a, d), ...(a.fence ? { fence: a.fence } : {}) } }),
  },
  {
    name: "scent_token",
    effect: "read",
    description: "What can be proven about a token on Arc before touching it: registry listing, bytecode, proxy, privileges, owner, a transfer simulation. Never says \"safe\"; reports red flags and what could not be checked.",
    parameters: { type: "object", properties: { token: ADDRESS, environment: ENV }, required: ["token"], additionalProperties: false },
    call: (a, d) => ({ method: "GET", path: `/v1/scent/${encodeURIComponent(String(a.token))}${q(env(a, d))}` }),
  },
  {
    name: "quote_route",
    effect: "read",
    description: "Quote every executable venue on Arc for a swap, an earn deposit or a borrow, and say which one the engine would pick and why.",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: ["swap", "earn", "borrow"] }, from: TOKEN, to: TOKEN, token: TOKEN, amount: AMOUNT, account: ADDRESS, maxRisk: { type: "string", enum: ["low", "medium", "high"] }, environment: ENV },
      required: ["kind"],
      additionalProperties: false,
    },
    call: (a, d) => {
      const { environment: _e, ...rest } = a;
      return { method: "POST", path: "/v1/quote", body: { ...rest, ...env(a, d) } };
    },
  },
  {
    name: "flock",
    effect: "read",
    description: "Everything an address holds on Arc in one balance sheet: tokens, vault positions, the Gateway balance, debts and USD values (unpriced items are marked, never counted as zero).",
    parameters: { type: "object", properties: { address: ADDRESS, environment: ENV }, additionalProperties: false },
    call: (a, d) => ({ method: "GET", path: `/v1/flock/${encodeURIComponent((a.address as string | undefined) ?? owner(a, d))}${q(env(a, d))}` }),
  },
  {
    name: "spawn_agent",
    effect: "plan",
    description: "Create an agent in the owner's Pack, or a sub-agent under a parent. A sub-agent's Fence must sit inside its parent's and its caps come out of the parent's budget. Needs a key with the agents scope or the owner's session.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", maxLength: 48 }, role: { type: "string", enum: ["orchestrator", "treasurer", "payroll", "fx-hedger", "yield-keeper", "bill-payer", "sentinel", "researcher", "custom"], description: "The agent's role." }, mission: { type: "string", maxLength: 400 }, parentId: { type: "string", description: "Spawn under this agent." }, owner: ADDRESS, fence: { type: "object" }, environment: ENV },
      required: ["name", "role"],
      additionalProperties: false,
    },
    call: (a, d) =>
      a.parentId
        ? { method: "POST", path: `/v1/pack/${encodeURIComponent(String(a.parentId))}/spawn`, body: { name: a.name, role: a.role, ...(a.mission ? { mission: a.mission } : {}), ...(a.fence ? { fence: a.fence } : {}) } }
        : { method: "POST", path: "/v1/pack", body: { owner: owner(a, d), name: a.name, role: a.role, ...(a.mission ? { mission: a.mission } : {}), ...(a.fence ? { fence: a.fence } : {}), ...env(a, d) } },
  },
  {
    name: "standing_order",
    effect: "plan",
    description: "Arm a standing order from a sentence with a condition or a schedule (\"every Friday send 50 USDC to 0x…\", \"if EURC drops below 1.05 buy 200\"). Each firing is planned and checked against the Fence; it never signs by itself.",
    parameters: { type: "object", properties: { text: { type: "string", maxLength: 500 }, owner: ADDRESS, timezone: { type: "string", maxLength: 64 }, environment: ENV }, required: ["text"], additionalProperties: false },
    call: (a, d) => ({ method: "POST", path: "/v1/standing", body: { owner: owner(a, d), text: a.text, ...(a.timezone ? { timezone: a.timezone } : {}), ...env(a, d) } }),
  },
  {
    name: "place_order",
    effect: "plan",
    description: "Draft a conditional order (limit, stop-loss, take-profit, DCA or TWAP) for the keeper. Returns the order and the typed data the owner signs; the order is only live after that signature is submitted.",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: ["limit", "stop-loss", "take-profit", "dca", "twap"] }, sell: TOKEN, buy: TOKEN, amount: AMOUNT, triggerPrice: { ...AMOUNT, description: "The price that triggers a limit, stop-loss or take-profit." }, triggerAbove: { type: "boolean" }, executions: { type: "number", minimum: 1, maximum: 1000 }, intervalSeconds: { type: "number", minimum: 60 }, owner: ADDRESS, environment: ENV },
      required: ["kind", "sell", "buy", "amount"],
      additionalProperties: false,
    },
    call: (a, d) => {
      const { environment: _e, owner: _o, ...rest } = a;
      return { method: "POST", path: "/v1/orders/draft", body: { owner: owner(a, d), ...rest, ...env(a, d) } };
    },
  },
  {
    name: "x402_buy",
    effect: "plan",
    description: "Prepare a pay-per-call purchase from an x402 service that takes USDC on Arc. Checks the price and payee against the Fence and returns the EIP-3009 authorization to sign; nothing is paid until it is signed.",
    parameters: { type: "object", properties: { resource: { type: "string", maxLength: 500, description: "The service URL." }, method: { type: "string", enum: ["GET", "POST"] }, owner: ADDRESS, environment: ENV }, required: ["resource"], additionalProperties: false },
    call: (a, d) => ({ method: "POST", path: "/v1/circle/x402/prepare", body: { resource: a.resource, owner: owner(a, d), ...(a.method ? { method: a.method } : {}), ...env(a, d) } }),
  },
]);

export function toolByName(name: string): ToolDefinition | undefined {
  return LYKIA_TOOLS.find((t) => t.name === name);
}

/** A small JSON-Schema check: required fields, types, enums, patterns, unknown keys. Enough for model output. */
export function validateArgs(tool: ToolDefinition, input: unknown): string[] {
  const issues: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return ["Arguments must be an object."];
  const args = input as Record<string, unknown>;
  const props = tool.parameters.properties ?? {};
  for (const key of tool.parameters.required ?? []) if (args[key] === undefined || args[key] === null || args[key] === "") issues.push(`${key} is required.`);
  for (const [key, value] of Object.entries(args)) {
    const schema = props[key];
    if (!schema) {
      if (tool.parameters.additionalProperties === false) issues.push(`${key} is not a parameter of ${tool.name}.`);
      continue;
    }
    if (value === undefined || value === null) continue;
    const type = Array.isArray(value) ? "array" : typeof value;
    if (schema.type && schema.type !== type && !(schema.type === "number" && type === "number")) issues.push(`${key} must be a ${schema.type}.`);
    if (schema.enum && !schema.enum.includes(value as string)) issues.push(`${key} must be one of ${schema.enum.join(", ")}.`);
    if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern, "u").test(value)) issues.push(`${key} has the wrong format.`);
    if (schema.maxLength !== undefined && typeof value === "string" && value.length > schema.maxLength) issues.push(`${key} is too long.`);
    if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) issues.push(`${key} is below ${schema.minimum}.`);
    if (schema.maximum !== undefined && typeof value === "number" && value > schema.maximum) issues.push(`${key} is above ${schema.maximum}.`);
  }
  return issues;
}
