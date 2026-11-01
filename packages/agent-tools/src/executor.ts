/**
 * Runs a tool call against the Lykia API. Never throws for API or input
 * errors: the model gets `{ ok: false, error }` and can recover. Results are
 * plain JSON, trimmed to what a model needs.
 */
import { ToolInputError, toolByName, validateArgs, type ToolDefaults, type ToolName } from "./tools.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ExecutorOptions extends ToolDefaults {
  /** API origin (default https://lykia-api-akdogan1.vercel.app). */
  readonly baseUrl?: string;
  /** A secret key on a server; a publishable key in a browser. */
  readonly apiKey?: string;
  /** An owner session token, for tools that act for the owner (spawn_agent). */
  readonly session?: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  /** Only these tools may run (default: all). */
  readonly allow?: readonly ToolName[];
}

export type ToolResult = { readonly ok: true; readonly tool: ToolName; readonly data: unknown } | { readonly ok: false; readonly tool: string; readonly error: { readonly code: string; readonly message: string } };

export interface LykiaToolExecutor {
  readonly options: ExecutorOptions;
  execute(name: string, args: unknown): Promise<ToolResult>;
}

/** Keeps a plan's answer short for a model: decision, reasons, steps, fees, the intent id. */
export function summarizeForModel(tool: string, data: unknown): unknown {
  if ((tool === "plan_intent" || tool === "check_fence") && data && typeof data === "object" && "intent" in data) {
    const d = data as { intent: { id: string; steps: { id: string; summary: string; fee?: { amount: string; symbol: string; decimals: number } }[]; verdict: { decision: string; signable: boolean; reasons: { rule: string; message: string }[] } }; outrun?: { fees?: string[]; fold?: string[] }; stored?: boolean; notes?: string[] };
    return {
      intentId: d.stored === false ? null : d.intent.id,
      decision: d.intent.verdict.decision,
      signable: d.intent.verdict.signable,
      reasons: d.intent.verdict.reasons.map((r) => r.message),
      steps: d.intent.steps.map((s) => s.summary),
      fees: d.outrun?.fees ?? [],
      fold: d.outrun?.fold ?? [],
      ...(d.notes ? { notes: d.notes } : {}),
      next: d.intent.verdict.signable ? "Show the plan to the owner; their wallet signs each step." : "Explain the reasons to the owner; this plan cannot be signed as is.",
    };
  }
  return data;
}

export function createLykiaExecutor(options: ExecutorOptions = {}): LykiaToolExecutor {
  const baseUrl = (options.baseUrl ?? "https://lykia-api-akdogan1.vercel.app").replace(/\/+$/u, "");
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    options,
    async execute(name, args) {
      const tool = toolByName(name);
      if (!tool || (options.allow && !options.allow.includes(tool.name))) return { ok: false, tool: name, error: { code: "UNKNOWN_TOOL", message: `There is no Lykia tool called ${name}.` } };
      const parsed = typeof args === "string" ? safeJson(args) : (args ?? {});
      const issues = validateArgs(tool, parsed);
      if (issues.length > 0) return { ok: false, tool: name, error: { code: "INVALID_ARGUMENTS", message: issues.join(" ") } };
      let call;
      try {
        call = tool.call(parsed as Record<string, unknown>, options);
      } catch (error) {
        if (error instanceof ToolInputError) return { ok: false, tool: name, error: { code: "INVALID_ARGUMENTS", message: error.message } };
        throw error;
      }
      try {
        const response = await fetchImpl(`${baseUrl}${call.path}`, {
          method: call.method,
          headers: {
            accept: "application/json",
            ...(call.body ? { "content-type": "application/json" } : {}),
            ...(options.apiKey ? { "Lykia-Key": options.apiKey } : {}),
            ...(options.session ? { "Lykia-Session": options.session } : {}),
          },
          ...(call.body ? { body: JSON.stringify(call.body) } : {}),
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        const text = await response.text();
        const body = text ? safeJson(text) : null;
        if (!response.ok) {
          const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
          return { ok: false, tool: name, error: { code: err?.code ?? `HTTP_${response.status}`, message: err?.message ?? `Lykia answered ${response.status}.` } };
        }
        return { ok: true, tool: tool.name, data: summarizeForModel(tool.name, body) };
      } catch (error) {
        return { ok: false, tool: name, error: { code: "NETWORK_ERROR", message: error instanceof Error ? error.message : String(error) } };
      }
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2_000) };
  }
}
