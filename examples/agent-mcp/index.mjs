// An agent that asks Lykia before it moves money, over MCP (JSON-RPC on streamable HTTP).
const API = (process.env.LYKIA_API ?? "https://api.lykiaai.com").replace(/\/$/u, "");
const OWNER = process.env.OWNER ?? "0xada5bb90d0de0bd1b6f3938708f49295a8d1f7cb";
const STRANGER = "0x2222222222222222222222222222222222222222";
const USDC = "0x3600000000000000000000000000000000000000";
let id = 0;
let session;

async function rpc(method, params) {
  const response = await fetch(`${API}/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}), ...(process.env.LYKIA_API_KEY ? { "Lykia-Key": process.env.LYKIA_API_KEY } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  session = response.headers.get("mcp-session-id") ?? session;
  const text = await response.text();
  // Streamable HTTP may answer as JSON or as one SSE message.
  const json = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data: ")).slice(6));
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const tool = async (name, args) => JSON.parse((await rpc("tools/call", { name, arguments: args })).content[0].text);

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lykia-example-agent", version: "1.0.0" } });
const { tools } = await rpc("tools/list", {});
console.log(`Lykia offers ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}\n`);

const send = (to) => ({ environment: "mainnet", owner: OWNER, signer: "agent", spent: { dayUsd: "0", weekUsd: "0" }, steps: [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "25", tokens: [{ symbol: "USDC", address: USDC, listed: true, acquired: false }], recipient: to }] });
for (const [label, to] of [["a stranger", STRANGER], ["the owner", OWNER]]) {
  const verdict = await tool("lykia_fence_evaluate", { facts: send(to) });
  console.log(`Send 25 USDC to ${label}: ${verdict.decision.toUpperCase()}`);
  for (const r of verdict.reasons.filter((r) => r.decision !== "allow")) console.log(`  - ${r.message}`);
}

const plan = await tool("lykia_plan", { sentence: "swap 50 USDC to EURC", owner: OWNER, environment: "mainnet" });
if (plan.intent) {
  console.log(`\nPlan ${plan.intent.id}: ${plan.intent.verdict.decision}`);
  for (const s of plan.intent.steps) console.log(`  ${s.id} ${s.summary}${s.fee ? ` · Lykia fee ${Number(s.fee.amount) / 10 ** s.fee.decimals} ${s.fee.symbol}` : ""}`);
} else {
  console.log("\nPlan:", JSON.stringify(plan).slice(0, 400));
}
