// An agent loop with Lykia's tools. The model is a stand-in (`scriptedModel`)
// so the example runs offline and in CI; swap in any real model:
//
//   import { generateText, jsonSchema } from "ai";
//   const { text } = await generateText({ model, tools: aiSdkTools(lykia, { jsonSchema }), maxSteps: 5, prompt });
//
// The loop below is what the AI SDK does for you: ask the model, run the
// tool calls it makes, feed the results back, stop when it answers.
import { aiSdkTools, createLykiaExecutor } from "@lykia/agent-tools";

/** A scripted model: checks the token, then plans the swap only if Scent found no red flags. */
export function scriptedModel() {
  return async ({ messages }) => {
    const results = messages.filter((m) => m.role === "tool");
    if (results.length === 0) return { toolCalls: [{ id: "c1", name: "scent_token", args: { token: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" } }] };
    const scent = JSON.parse(results[0].content);
    if (results.length === 1) {
      if (!scent.ok || !["verified", "no-red-flags"].includes(scent.data.level)) return { text: `I would not touch that token: ${scent.ok ? scent.data.level : scent.error.message}.` };
      return { toolCalls: [{ id: "c2", name: "plan_intent", args: { text: "swap 100 USDC to EURC", dryRun: true } }] };
    }
    const plan = JSON.parse(results[1].content);
    if (!plan.ok) return { text: `Planning failed: ${plan.error.message}` };
    return { text: `EURC checks out (${scent.data.level}). Plan: ${plan.data.steps.join("; ")}. Fees: ${plan.data.fees.join(", ") || "none"}. Fence: ${plan.data.decision}. ${plan.data.next}` };
  };
}

/** Runs the model until it answers, executing tool calls through the Lykia tools. */
export async function runAgent({ model, tools, prompt, maxSteps = 5 }) {
  const messages = [{ role: "user", content: prompt }];
  for (let step = 0; step < maxSteps; step++) {
    const reply = await model({ messages, tools: Object.keys(tools) });
    if (reply.text !== undefined) return { text: reply.text, messages };
    for (const call of reply.toolCalls) {
      const result = await tools[call.name].execute(call.args);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(result) });
    }
  }
  return { text: "Stopped after the step limit.", messages };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const lykia = createLykiaExecutor({
    baseUrl: process.env.LYKIA_API ?? "https://api.lykiaai.com",
    ...(process.env.LYKIA_SECRET_KEY ? { apiKey: process.env.LYKIA_SECRET_KEY } : {}),
    owner: process.env.LYKIA_OWNER ?? "0x82916bee18fcef517b26c72d7cb5f13694e1db41",
    environment: "mainnet",
  });
  const tools = aiSdkTools(lykia, { jsonSchema: (schema) => schema });
  const { text } = await runAgent({ model: scriptedModel(), tools, prompt: "Is EURC safe to hold? If so, plan a 100 USDC swap into it." });
  console.log(text);
}
