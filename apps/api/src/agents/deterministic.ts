/**
 * Lyko without a model. The deterministic reader turns the sentence into
 * actions; each action goes to the specialist whose job it is (payroll for
 * payments, the FX hedger for conversions, the yield keeper for vaults, the
 * treasurer for bridges, Gateway and credit), each specialist plans its part
 * under its own Fence, and parts from different specialists are merged into
 * one route under the owner's Fence. Same events as the model path, so the
 * deck renders both the same way.
 */
import { LYKO_LINES, type Address, type ArcEnvironment, type Fence, type PackAgent, type PlanAction } from "@lykia/core";
import type { AgentProposal } from "@lykia/core/api/agents";
import type { AppContext } from "../context.js";
import { readWithMemory } from "../personal/reader.js";
import { planActions } from "./engine.js";
import { mergeProposals, specialistFor, type Emit, type SpecialistRole, type TurnResult } from "./orchestrator.js";

export function roleForAction(action: PlanAction): SpecialistRole {
  switch (action.verb) {
    case "send":
      return "payroll";
    case "fx":
    case "swap":
      return "fx-hedger";
    case "earn":
    case "withdraw":
    case "supply":
    case "reserve":
      return "yield-keeper";
    case "rebalance":
      return "fx-hedger";
    default:
      return "treasurer";
  }
}

/** Clarify options that start with this prefix ask the web to switch to mainnet and re-ask the rest. */
export const PREVIEW_ON_MAINNET = "Preview on mainnet: ";

/** A planning failure caused by venues missing on Arc testnet (practice venues not deployed yet). */
export function practiceGap(message: string): boolean {
  return /practice|not deployed|testnet yet|mainnet only/iu.test(message);
}

export interface DeterministicInput {
  readonly ctx: AppContext;
  readonly environment: ArcEnvironment;
  readonly owner: Address | null;
  readonly fence: Fence;
  readonly pack: readonly PackAgent[];
  readonly message: string;
  readonly emit: Emit;
}

export async function runDeterministicTurn(input: DeterministicInput): Promise<TurnResult> {
  const { emit } = input;
  const parsed = await readWithMemory(input.ctx, input.owner, input.message);
  const done = (text: string, proposals: AgentProposal[], stopReason: TurnResult["stopReason"] = "end_turn") => {
    for (const p of proposals) emit("proposal", p);
    emit("text", { text });
    return { text, proposals, stopReason, delegations: 0, modelCalls: 0 };
  };
  if (parsed.command || parsed.easterEgg || parsed.actions.length === 0) {
    if (parsed.clarify.length > 0) emit("clarify", { question: parsed.clarify[0], options: [] });
    return done(parsed.reply, [], parsed.clarify.length > 0 ? "clarify" : "end_turn");
  }
  if (parsed.clarify.length > 0) {
    emit("clarify", { question: parsed.clarify[0], options: [] });
    return done(parsed.reply, [], "clarify");
  }
  if (!input.owner) return done("Connect a wallet so I can plan that.", []);

  // Group consecutive actions by specialist, keeping order.
  const groups: { role: SpecialistRole; actions: PlanAction[] }[] = [];
  for (const action of parsed.actions) {
    const role = roleForAction(action);
    const last = groups[groups.length - 1];
    if (last && last.role === role) last.actions.push(action);
    else groups.push({ role, actions: [action] });
  }

  const proposals: AgentProposal[] = [];
  const failures: string[] = [];
  const planned: { actions: readonly PlanAction[]; proposal: AgentProposal }[] = [];
  for (const group of groups) {
    const specialist = specialistFor(group.role, input.fence, input.pack);
    const part = group.actions.map((a) => a.verb).join(" + ");
    emit("task", { agent: specialist.name, role: specialist.role, task: part });
    const outcome = await planActions(input.ctx, group.actions, input.message, { environment: input.environment, owner: input.owner, fence: specialist.fence, proposedByAgent: groups.length > 1 });
    if (outcome.kind !== "planned") {
      const why = outcome.kind === "refused" ? outcome.message : outcome.reply;
      failures.push(why);
      emit("tool", { agent: specialist.name, name: "plan_intent", ok: false, summary: why });
      continue;
    }
    const { intent } = outcome.result;
    emit("tool", { agent: specialist.name, name: "plan_intent", ok: true, summary: `${intent.verdict.decision}: ${intent.steps.map((s) => s.summary).join(" → ")}` });
    const proposal: AgentProposal = {
      intentId: outcome.result.stored ? intent.id : null,
      title: part,
      steps: intent.steps.map((s) => s.summary),
      decision: intent.verdict.decision,
      reasons: intent.verdict.reasons.filter((r) => r.decision !== "allow").map((r) => r.message),
      warnings: intent.warnings,
      attribution: [{ agent: specialist.name, role: specialist.role, part }],
      rationale: "",
    };
    proposals.push(proposal);
    planned.push({ actions: group.actions, proposal });
  }
  const merged = await mergeProposals(input, planned, input.fence);
  const final = merged ? [merged] : proposals;
  const denied = final.find((p) => p.decision === "deny");
  if (final.length === 0) {
    const reasons = [...new Set(failures)].join(" ");
    const testnetGap = input.environment === "testnet" && failures.some(practiceGap);
    if (testnetGap) {
      const options = [`${PREVIEW_ON_MAINNET}${input.message}`, "Deploy the practice venues from the owner console"];
      emit("clarify", { question: "Arc testnet has no venue for this route yet. Preview it on mainnet as a dry run?", options });
      const text = `The practice venues aren't deployed on Arc testnet yet, so I can't route this here (${reasons}). Switch to mainnet to preview the route as a dry run, or deploy them from the owner console.`;
      return done(text, [], "clarify");
    }
    return done(reasons ? `I could not build that plan: ${reasons}` : "I could not build that plan.", []);
  }
  const text = denied
      ? `The Fence says no: ${denied.reasons.join(" ")}`
      : `${final.map((p) => p.steps.join(" → ")).join(" | ")}. ${LYKO_LINES.herding}`;
  return done(text, final);
}
