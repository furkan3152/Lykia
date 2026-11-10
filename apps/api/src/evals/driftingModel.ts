/**
 * A scripted model that drifts the way a live model did on api.lykiaai.com,
 * so the model path can be tested without a model key:
 *
 *   - it asks the owner through ask_owner and writes no text of its own;
 *   - it plans with plan_intent, then quotes the plan's fee (which the plan's
 *     cost card shows), an invented net figure (which nothing shows) and a
 *     reference price with eight decimals;
 *   - it reads the Fence and quotes its limits;
 *   - for the sample address it says "your wallet holds", "not your money",
 *     "connect your wallet", "your account" and "your EURC watch" in one answer.
 *
 * Used by the offline suite (cases with `model: "drifting"`) and by
 * `LYKIA_EVAL_MODEL=drifting npm run eval:serve`. It reads only the
 * request it is given: nothing here touches a network.
 */
import type { LlmClient, LlmMessage, LlmRequest, LlmResponse } from "../agents/llm.js";

let n = 0;
const toolUse = (name: string, input: unknown) => ({ type: "tool_use" as const, id: `drift_${++n}`, name, input, caller: undefined }) as never;
const say = (text: string) => ({ type: "text" as const, text, citations: null }) as never;
const reply = (content: unknown[], stop: LlmResponse["stop_reason"]): LlmResponse => ({ content: content as LlmResponse["content"], stop_reason: stop });

/** The owner's words of this turn: the last plain-text user message, without the [lykia-state] line. */
function ownerWords(messages: readonly LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && typeof m.content === "string") return m.content.replace(/^\[lykia-state\][^\n]*\n\n/u, "").split("\n\n(The owner wrote")[0]!.trim();
  }
  return "";
}

/** What the tools returned since the owner's message, as text. */
function toolResults(messages: readonly LlmMessage[]): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && typeof m.content === "string") break;
    if (m.role === "user" && Array.isArray(m.content)) for (const b of m.content) if ((b as { type?: string }).type === "tool_result") out.push(String((b as { content?: unknown }).content ?? ""));
  }
  return out;
}

function feeFrom(results: readonly string[]): string | null {
  for (const r of results) {
    const m = /"fee":"(\d+(?:\.\d+)?) ([A-Za-z]+)"/u.exec(r);
    if (m) return `${m[1]} ${m[2]}`;
  }
  return null;
}

export function driftingModel(): LlmClient & { readonly calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    model: "drifting-script",
    calls,
    async turn(request) {
      calls.push(request);
      const last = request.messages[request.messages.length - 1];
      // The guard's one retry: it lists the figures that may be said. Answer with the first of them, or none.
      if (last && last.role === "user" && typeof last.content === "string" && last.content.startsWith("Rewrite your last answer")) {
        // Like a model that follows the instruction: its last answer again, without the sentences whose figures are not allowed.
        const allowed = new Set((/The only figures you may state are: (.+?)\. Do not/u.exec(last.content)?.[1] ?? "").split(", ").map((x) => String(Number(x))));
        const before = [...request.messages].reverse().find((m) => m.role === "assistant" && typeof m.content === "string")?.content as string | undefined;
        const kept = (before ?? "").split("\n").map((line) => line.split(/(?<=\.)\s+/u).filter((sentence) => [...sentence.matchAll(/\d[\d,]*(?:\.\d+)?/gu)].every((m) => allowed.has(String(Number(m[0].replace(/,/gu, "")))))).join(" ")).join("\n");
        return reply([say(kept.trim() || "The plan is on the card.\n\n**Next:** review it.")], "end_turn");
      }
      const words = ownerWords(request.messages);
      const results = toolResults(request.messages);
      const has = (name: string) => request.tools.some((t) => t.name === name);
      if (results.length === 0) {
        if (/\b(?:fence|rules|limits?)\b/iu.test(words) && has("fence")) return reply([toolUse("fence", {})], "tool_use");
        if (/\d/u.test(words) && /\b(?:send|pay|convert|swap|bridge|deposit|put|borrow|repay|withdraw|rebalance|buy|sell)\b/iu.test(words) && has("plan_intent")) return reply([toolUse("plan_intent", { sentence: words })], "tool_use");
        if (/\?\s*$/u.test(words) && has("positions")) return reply([toolUse("positions", {})], "tool_use");
        // A vague request to earn: the live model asked with a balance only its own read had seen, in the question and an option.
        if (/\bsome money\b/iu.test(words) && has("ask_owner")) return reply([toolUse("ask_owner", { question: "How much USDC should go to work? The wallet holds 187.28 USDC.", options: ["All 187.28 USDC", "Half of it", "Pick an amount"] })], "tool_use");
        // Nothing to go on: ask, and write nothing (what the live model did on vague requests).
        if (has("ask_owner")) return reply([toolUse("ask_owner", { question: "What should I do with it?", options: ["Put it to work", "Keep it in the wallet"] })], "tool_use");
        return reply([say("I need one more detail.")], "end_turn");
      }
      const all = results.join(" ");
      if (/"protocolFee"/u.test(all)) {
        return reply([say("Your Fence is Balanced: at most $1000 a step, $2500 a plan and $5000 a day, and I ask above $500.\n\n**Next:** say which preset you want.")], "end_turn");
      }
      if (/"steps"/u.test(all) && /"decision"/u.test(all)) {
        const fee = feeFrom(results);
        return reply([say(`Ready as a proposal: the plan is on the card.${fee ? ` The Lykia fee is ${fee}.` : ""} That nets about 12,345.67 USDC over 90 days. EURC is $1.11923186 right now.\n\n- **Wallet:** your wallet holds the funds, not your money if no wallet is connected\n\n**Next:** connect your wallet to sign it; it saves to your account.`)], "end_turn");
      }
      return reply([say("Your wallet holds what the card shows. This is a dry run on the sample address, not your money. Your EURC watch is not saved. Connecting your wallet lets me save it to your account, and your Fence stays as it is.\n\n**Next:** connect your wallet.")], "end_turn");
    },
  };
}
