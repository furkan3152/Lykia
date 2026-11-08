import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateProjectInput } from "@lykia/core";

import { DEFAULT_STUDIO, agentSnippet, embedSnippet, hooksSnippet, mcpSnippet, projectPatch, sdkSnippet, widgetSnippet } from "../snippets";

describe("developer portal snippets", () => {
  const config = { ...DEFAULT_STUDIO, projectId: "prj_abcdefabcdef", assistantName: "Penny", primary: "#0f766e", modules: ["chat", "swap", "orders"] as const };
  it("follow the playground's modules and brand", () => {
    const widget = widgetSnippet(config);
    assert.match(widget, /import \{ LykiaProvider, LykiaChat, Swap \} from "@lykia\/widget"/u);
    assert.match(widget, /project="prj_abcdefabcdef"/u);
    const embed = embedSnippet(config);
    assert.match(embed, /<lykia-assistant project="prj_abcdefabcdef"/u);
    assert.match(embed, /<lykia-swap [^>]*primary="#0f766e"/u);
    assert.ok(!embed.includes("lykia-orders"), "modules without an element are skipped");
    assert.match(hooksSnippet(config), /useLykiaPlan/u);
    assert.match(sdkSnippet(config), /@lykia\/sdk\/intents/u);
    assert.match(agentSnippet(), /aiSdkTools\(lykia, \{ jsonSchema \}\)/u);
    assert.equal(JSON.parse(mcpSnippet("https://api.lykiaai.com")).mcpServers.lykia.url, "https://api.lykiaai.com/v1/mcp");
  });
  it("produce a project patch the API accepts", () => {
    const patch = projectPatch(config);
    assert.deepEqual(validateProjectInput({ name: "x", ...patch }), []);
    assert.equal(patch.brand.mascot, "custom");
    assert.equal(projectPatch({ ...config, assistantName: "Lyko" }).brand.mascot, "lyko");
  });
});
