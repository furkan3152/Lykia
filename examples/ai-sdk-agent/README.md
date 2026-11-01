# AI SDK agent with Lykia's tools

An agent that checks a token with Scent and, only if it is clean, plans a
swap, then reports the steps, the fees and the Fence verdict. Nothing is
signed: plans come back for the user's wallet.

```bash
npm install @lykia/agent-tools ai
```

```js
import { generateText, jsonSchema } from "ai";
import { aiSdkTools, createLykiaExecutor } from "@lykia/agent-tools";

const lykia = createLykiaExecutor({ apiKey: process.env.LYKIA_SECRET_KEY, owner: userAddress, environment: "mainnet" });
const { text } = await generateText({ model, tools: aiSdkTools(lykia, { jsonSchema }), maxSteps: 5, prompt });
```

`agent.mjs` runs the same loop with a scripted model so it works offline:

```bash
node examples/ai-sdk-agent/agent.mjs           # against the live API (read-only, dry run)
node --test examples/ai-sdk-agent/test         # offline, mocked API
```

Other frameworks use the same tools: `langchainTools(lykia, { tool })`,
`openaiTools()` with `runOpenAiToolCall`, `anthropicTools()` with
`runAnthropicToolUse`. MCP clients need no code: `lykiaMcpServer()`.
