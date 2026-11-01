/**
 * Lyko, the agent. With ANTHROPIC_API_KEY set, Lyko answers with Claude and
 * a small toolset over Lykia's own services (Flock, Scent, plan, Fence).
 * Lyko may only propose plans: proposals are stored intents the owner
 * prepares and signs in their own wallet. Without a key, Lyko falls back
 * to the deterministic reader and plans what it understood.
 */
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_FENCE, evaluateFence, LYKO_LINES, type Address, type ArcEnvironment, type Fence, type FenceFacts, type PlanAction } from "@lykia/core";
import { z } from "zod";
import type { AppContext } from "../context.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody } from "../http/validate.js";
import { readSentence } from "../language/reader.js";
import { services } from "../services.js";
import { environmentOf, environmentSchema, fenceFrom } from "./common.js";
import { factsSchema } from "./fence.js";

export const MAX_TOOL_ROUNDS = 5;

export const SYSTEM_PROMPT = `You are Lyko, the shepherd dog of Lykia, an agent and stablecoin desk built on Arc Network (Circle's L1 where USDC is gas and finality is deterministic).
You keep the flock (the owner's assets and agents) inside the Fence (the owner's rules) and the wolves (scam tokens, rug pulls, exploits) outside.
Rules you never break:
- You never sign or move funds. You propose plans with the plan_intent tool; the owner reviews and signs in their own wallet.
- Every number you state comes from a tool result. If you do not have it, say so.
- Run scent before suggesting any token outside USDC, EURC, USYC and cirBTC.
- If the Fence denies a plan, explain the reason; do not look for ways around it.
Be short and warm. Answer in the user's language (Turkish or English).`;

interface ChatProposal {
  readonly intentId: string | null;
  readonly summary: readonly string[];
  readonly decision: string;
  readonly reasons: readonly string[];
}

export const TOOLS: Anthropic.Tool[] = [
  { name: "flock", description: "Read the owner's balance sheet on Arc (wallet tokens, Morpho vaults, Gateway balance, USD values).", input_schema: { type: "object", properties: {}, required: [] } },
  { name: "scent", description: "Inspect a token by address: registry, proxy, privileged functions, owner, transfer simulation. Returns a level and the wolves found.", input_schema: { type: "object", properties: { token: { type: "string", description: "0x token address" } }, required: ["token"] } },
  {
    name: "plan_intent",
    description: "Propose a plan from a plain sentence (English or Turkish), e.g. 'deposit 100 USDC into Morpho' or 'send 20 USDC to 0x... for invoice 12'. Returns the steps and the Fence verdict. The owner signs later.",
    input_schema: { type: "object", properties: { sentence: { type: "string" } }, required: ["sentence"] },
  },
  { name: "venues", description: "List the venues on Arc and which ones Lykia can execute.", input_schema: { type: "object", properties: {}, required: [] } },
];

async function runTool(ctx: AppContext, name: string, input: Record<string, unknown>, c: { environment: ArcEnvironment; owner: Address | null; fence: Fence; proposals: ChatProposal[]; byAgent: boolean }): Promise<unknown> {
  const s = services(ctx);
  switch (name) {
    case "flock":
      if (!c.owner) return { error: "No owner address was given." };
      return s.flock.snapshot(c.environment, c.owner);
    case "scent":
      if (typeof input.token !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(input.token)) return { error: "token must be a 0x address." };
      return s.scent.sniff(c.environment, input.token as Address);
    case "plan_intent": {
      if (!c.owner) return { error: "No owner address was given." };
      const parsed = readSentence(String(input.sentence ?? ""));
      if (parsed.clarify.length > 0 || parsed.actions.length === 0) return { clarify: parsed.clarify, reply: parsed.reply };
      const result = await s.intents.create({ environment: c.environment, owner: c.owner, actions: parsed.actions, source: String(input.sentence), fence: c.fence, ...(c.byAgent ? { proposedByAgent: true } : {}) });
      const proposal: ChatProposal = { intentId: result.intent.id, summary: result.intent.steps.map((st) => st.summary), decision: result.intent.verdict.decision, reasons: result.intent.verdict.reasons.map((r) => r.message) };
      c.proposals.push(proposal);
      return { ...proposal, warnings: result.intent.warnings };
    }
    case "venues": {
      const { protocolsFor } = await import("@lykia/core");
      const { EXECUTABLE_VENUES } = await import("../engine/adapters.js");
      return protocolsFor(c.environment).map((p) => ({ id: p.id, name: p.name, category: p.category, executable: EXECUTABLE_VENUES[c.environment].has(p.id) }));
    }
    default:
      return { error: `Unknown tool ${name}.` };
  }
}

export const agentModule: ApiModule = {
  name: "agent",
  register(router, ctx) {
    router.post("/agent/chat", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(
        req,
        z.object({
          messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4_000) })).min(1).max(30),
          owner: evmAddress.optional(),
          environment: environmentSchema.optional(),
          fence: z.unknown().optional(),
        }),
      );
      const environment = environmentOf(ctx, body.environment);
      const fence = fenceFrom(body.fence) ?? DEFAULT_FENCE;
      const owner = (body.owner as Address | undefined) ?? null;
      const proposals: ChatProposal[] = [];
      const last = body.messages[body.messages.length - 1]?.content ?? "";

      if (!ctx.config.agent.anthropicApiKey) {
        const parsed = readSentence(last);
        let reply = parsed.reply;
        if (parsed.actions.length > 0 && parsed.clarify.length === 0 && owner) {
          try {
            await runTool(ctx, "plan_intent", { sentence: last }, { environment, owner, fence, proposals, byAgent: false });
            const p = proposals[0];
            reply = p ? `${p.summary.join(" → ")}. ${p.decision === "deny" ? `The Fence says no: ${p.reasons.join(" ")}` : LYKO_LINES.herding[parsed.lang]}` : reply;
          } catch (error) {
            reply = error instanceof Error ? error.message : reply;
          }
        } else if (parsed.actions.length > 0 && !owner) reply = parsed.lang === "tr" ? "Planlamak için bir cüzdan adresi lazım." : "Connect a wallet so I can plan that.";
        res.json({ mode: "reader", reply, lang: parsed.lang, command: parsed.command, easterEgg: parsed.easterEgg, clarify: parsed.clarify, proposals });
        return;
      }

      const client = new Anthropic({ apiKey: ctx.config.agent.anthropicApiKey });
      const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({ role: m.role, content: m.content }));
      const toolCalls: { name: string; input: unknown }[] = [];
      const system = `${SYSTEM_PROMPT}\nEnvironment: Arc ${environment}. Owner: ${owner ?? "not connected"}. Fence: ${fence.label ?? "custom"} (${fence.mode ?? "live"}).`;
      let reply = "";
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await client.messages.create({ model: ctx.config.agent.model, max_tokens: 1_024, system, messages, tools: TOOLS });
        const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
        if (response.stop_reason !== "tool_use") {
          reply = text;
          break;
        }
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          toolCalls.push({ name: block.name, input: block.input });
          let output: unknown;
          try {
            output = await runTool(ctx, block.name, (block.input ?? {}) as Record<string, unknown>, { environment, owner, fence, proposals, byAgent: true });
          } catch (error) {
            output = { error: error instanceof Error ? error.message : "Tool failed." };
          }
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output).slice(0, 20_000) });
        }
        messages.push({ role: "user", content: results });
        reply = text;
      }
      res.json({ mode: "llm", reply, proposals, toolCalls });
    });

    // A quick verdict for an agent's own facts (agents call this before acting).
    router.post("/agent/check", (req, res) => {
      const body = parseBody(req, z.object({ fence: z.unknown().optional(), facts: factsSchema }));
      const fence = fenceFrom(body.fence) ?? DEFAULT_FENCE;
      res.json(evaluateFence(fence, { ...body.facts, now: body.facts.now ?? ctx.clock.now() } as FenceFacts));
    });
  },
};

export type { PlanAction };
