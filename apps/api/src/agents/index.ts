/**
 * Agents and platform service graph, built once per AppContext. The Pack
 * reports spawns and revocations to the webhook dispatcher, settled intents
 * are forwarded to webhooks from the bus, and tests can swap the model
 * client with `setLlmClient`.
 */
import type { AppContext } from "../context.js";
import type { HostResolver } from "../http/netguard.js";
import { WebhookService } from "../platform/webhooks.js";
import type { JsonValue } from "../store/types.js";
import { anthropicClient, type LlmClient } from "./llm.js";
import { PackService } from "./pack.js";

export interface AgentServices {
  readonly pack: PackService;
  readonly webhooks: WebhookService;
  llm(): LlmClient | null;
}

const GRAPH = new WeakMap<AppContext, AgentServices>();
const LLM_OVERRIDE = new WeakMap<AppContext, LlmClient | null>();
const RESOLVER_OVERRIDE = new WeakMap<AppContext, HostResolver>();

/** Tests: script the model (or force the deterministic path with null). */
export function setLlmClient(ctx: AppContext, client: LlmClient | null): void {
  LLM_OVERRIDE.set(ctx, client);
}

/** Tests: resolve webhook hosts without DNS. Call before the first agentServices(ctx). */
export function setWebhookResolver(ctx: AppContext, resolve: HostResolver): void {
  RESOLVER_OVERRIDE.set(ctx, resolve);
}

export function agentServices(ctx: AppContext): AgentServices {
  const existing = GRAPH.get(ctx);
  if (existing) return existing;
  const resolve = RESOLVER_OVERRIDE.get(ctx);
  const webhooks = new WebhookService(ctx, resolve ? { resolve } : {});
  const log = ctx.log.child({ component: "agents" });
  const fire = (event: Parameters<WebhookService["emit"]>[0], owner: string, data: JsonValue) => {
    void webhooks.emit(event, owner, data).catch((error: unknown) => log.warn("webhook emit failed", { event, error: error instanceof Error ? error.message : String(error) }));
  };
  const pack = new PackService(ctx, {
    spawned: (agent) => fire("pack.agent.spawned", agent.owner, { id: agent.id, parentId: agent.parentId, role: agent.role, name: agent.name, fenceHash: agent.fenceHash }),
    revoked: (agents) => {
      for (const a of agents) fire("pack.agent.revoked", a.owner, { id: a.id, parentId: a.parentId, role: a.role });
    },
  });
  const settled = new Set<string>();
  ctx.bus.on("intent.updated", ({ id, intent, outrun }) => {
    // Catalogue events (platform/webhooks.ts): first sight of a plan, prepared and failed steps, Fence denials.
    const environment = intent.environment;
    if (!settled.has(`planned:${id}`)) {
      settled.add(`planned:${id}`);
      fire("intent.planned", intent.owner, { intentId: id, decision: intent.verdict.decision, steps: intent.steps.length, verdictDigest: intent.verdict.digest, environment });
      if (intent.verdict.decision === "deny") fire("security.blocked", intent.owner, { intentId: id, source: "fence", verdictDigest: intent.verdict.digest, environment });
    }
    for (const step of intent.steps) {
      for (const [status, event] of [["awaiting-signature", "step.prepared"], ["failed", "step.failed"]] as const) {
        const seen = `${status}:${id}:${step.id}`;
        if (step.status === status && !settled.has(seen)) {
          settled.add(seen);
          fire(event, intent.owner, { intentId: id, stepId: step.id, kind: step.kind, environment });
        }
      }
    }
    for (const step of intent.steps) {
      const key = `${id}:${step.id}`;
      if (step.status === "settled" && !settled.has(key)) {
        settled.add(key);
        fire("intent.step.settled", intent.owner, { intentId: id, stepId: step.id, kind: step.kind, references: [...(step.references ?? [])] });
      }
    }
    if (outrun.status === "settled" && !settled.has(id)) {
      settled.add(id);
      fire("intent.settled", intent.owner, { intentId: id, fold: [...outrun.fold], verdictDigest: intent.verdict.digest });
    }
    if (settled.size > 10_000) settled.clear();
  });
  const built: AgentServices = {
    pack,
    webhooks,
    llm: () => (LLM_OVERRIDE.has(ctx) ? (LLM_OVERRIDE.get(ctx) ?? null) : anthropicClient(ctx)),
  };
  GRAPH.set(ctx, built);
  return built;
}
