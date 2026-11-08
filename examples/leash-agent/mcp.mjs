// The same agent over MCP: with a leash key, /v1/mcp offers only the leash's tools.
const API = (process.env.LYKIA_API ?? "https://api.lykiaai.com").replace(/\/$/u, "");
const KEY = process.env.LYKIA_LEASH_KEY;
let id = 0;

export async function rpc(method, params, { fetch: fetchImpl = fetch, api = API, key = KEY } = {}) {
  const response = await fetchImpl(`${api}/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "Lykia-Key": key },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await response.text();
  const json = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data: ")).slice(6));
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!KEY) {
    console.log("Set LYKIA_LEASH_KEY to a leash key.");
  } else {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "leashed-agent", version: "1.0.0" } });
    const { tools } = await rpc("tools/list", {});
    console.log(`This leash offers ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);
    const status = JSON.parse((await rpc("tools/call", { name: "leash_status", arguments: {} })).content[0].text);
    console.log(`${status.agentName}: $${status.usage.day.remainingUsd} left today.`);
    const over = await rpc("tools/call", { name: "leash_plan", arguments: { sentence: "swap 5000 USDC to EURC" } });
    console.log(over.isError ? `Refused: ${over.content[0].text}` : over.content[0].text);
  }
}
