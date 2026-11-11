/**
 * How the agents reach the intent engine. Agents never build transactions:
 * they hand a sentence or typed actions to the same planner the deck uses,
 * under the Fence of the agent that asks, and get back a stored intent (or
 * a dry run) with the Fence's verdict.
 */
import { englishOf } from "../i18n/context.js";
import { bridgeRefusal, type Address, type ArcEnvironment, type Fence, type Finding, type PlanAction } from "@lykia/core";
import { LykiaHttpError } from "../http/errors.js";
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import type { AppContext } from "../context.js";
import { readWithMemory } from "../personal/reader.js";
import { getProfile } from "../personal/profile.js";
import { services } from "../services.js";

export interface PlanRequest {
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly fence: Fence;
  readonly proposedByAgent: boolean;
  readonly signer?: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
  /** Digest of the compiled program (lykia.program/v1) the actions came from; pinned in the Fence facts. */
  readonly program?: `sha256:${string}`;
}

export type PlanOutcome =
  | { readonly kind: "planned"; readonly result: CreateIntentResponse; readonly actions: readonly PlanAction[] }
  | { readonly kind: "clarify"; readonly questions: readonly string[]; readonly reply: string }
  | { readonly kind: "refused"; readonly message: string; readonly findings?: readonly Finding[] };

export async function planSentence(ctx: AppContext, sentence: string, request: PlanRequest): Promise<PlanOutcome> {
  const parsed = await readWithMemory(ctx, request.owner, sentence);
  if (parsed.clarify.length > 0 || parsed.actions.length === 0) return { kind: "clarify", questions: parsed.clarify.length > 0 ? parsed.clarify : [parsed.reply], reply: parsed.reply };
  return planActions(ctx, parsed.actions, sentence, request);
}

/** Engine default slippage for swaps without an explicit one. */
const ENGINE_DEFAULT_SLIPPAGE_BPS = 50;
/** The placeholder owner chat plans for when no wallet is connected; its plans are always dry runs. */
const SAMPLE_OWNER = "0x000000000000000000000000000000000000dead";

/**
 * Shapes actions to the asking agent's Fence before planning, so a careful
 * specialist plans a route its own Fence can pass: a conversion without an
 * explicit slippage uses the Fence's ceiling when that is tighter than the
 * engine default.
 */
function fitToFence(actions: readonly PlanAction[], fence: Fence): PlanAction[] {
  const ceiling = fence.limits?.maxSlippageBps;
  return actions.map((a) => {
    if (ceiling === undefined || ceiling >= ENGINE_DEFAULT_SLIPPAGE_BPS) return a;
    if (a.verb === "fx") return { verb: "swap", from: a.from, to: a.to, amount: a.amount, slippageBps: ceiling };
    if (a.verb === "swap" && a.slippageBps === undefined) return { ...a, slippageBps: ceiling };
    return a;
  });
}

export async function planActions(ctx: AppContext, rawActions: readonly PlanAction[], source: string, request: PlanRequest): Promise<PlanOutcome> {
  const actions = fitToFence(rawActions, request.fence);
  const preferences = await getProfile(ctx, request.owner).then((p) => ({ favorites: p.venues.favorites, blocked: p.venues.blocked, maxRisk: p.risk })).catch(() => ({}));
  const create = (dryRun: boolean) =>
    services(ctx).intents.create({
      environment: request.environment,
      owner: request.owner,
      actions,
      source,
      fence: request.fence,
      ...(request.signer ? { signer: request.signer } : {}),
      ...(request.agent ? { agent: request.agent } : {}),
      ...(dryRun ? { dryRun: true } : {}),
      ...(request.proposedByAgent ? { proposedByAgent: true } : {}),
      ...(request.program ? { program: request.program } : {}),
      preferences,
    });
  const dry = request.fence.mode === "dry-run" || request.owner.toLowerCase() === SAMPLE_OWNER;
  try {
    return { kind: "planned", result: await create(dry), actions };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The planner refused.";
    // Short of funds: plan it as a dry run anyway, so preflight can say exactly what is missing and what fits.
    if (error instanceof LykiaHttpError && error.code === "INSUFFICIENT_BALANCE" && !dry) {
      const preview = await create(true).catch(() => null);
      if (preview && (preview.intent.preflight ?? []).some((f) => f.severity === "block")) return { kind: "planned", result: preview, actions };
    }
    if (error instanceof LykiaHttpError && error.code === "NO_ROUTE" && /CCTP destination|token account as the mint recipient|in CCTP fees/iu.test(englishOf(message))) return { kind: "refused", message, findings: [bridgeRefusal(request.environment, message)] };
    return { kind: "refused", message };
  }
}

/** The proposal's preflight: what will go wrong before it is signed. */
export function preflightOf(intent: { readonly preflight?: readonly Finding[] }): { preflight?: readonly Finding[] } {
  return intent.preflight && intent.preflight.length > 0 ? { preflight: intent.preflight } : {};
}
