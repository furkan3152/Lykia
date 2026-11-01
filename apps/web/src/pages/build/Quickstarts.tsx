/** "Add AI to your Arc app in 3 steps", once per integration path. */
import { useState } from "react";

import { API_BASE } from "../../lib/env";
import { Card, Tabs } from "../../mosaic";
import { DEFAULT_STUDIO, agentSnippet, embedSnippet, hooksSnippet, mcpSnippet, sdkSnippet, widgetSnippet } from "./snippets";

type PathId = "widget" | "embed" | "hooks" | "agents" | "mcp" | "sdk";

interface Step {
  readonly title: string;
  readonly body: string;
  readonly code?: string;
}

function steps(path: PathId): readonly Step[] {
  const project: Step = { title: "Create a project", body: "Sign in on Arc, open Projects, add your site's origin and prove it with a DNS TXT record or a /.well-known file. Then issue a browser key. Your brand, modules, Fence caps and app fee live in the project." };
  const apiOrigin = new URL(API_BASE).origin;
  switch (path) {
    case "widget":
      return [project, { title: "Install the widget", body: "React 18 or newer. No other dependency.", code: "npm install @lykia/widget" }, { title: "Drop it in", body: "Components follow your brand and modules. Pass your wallet (viem WalletClient, EIP-1193 provider or wagmi config) or let it find an injected one.", code: widgetSnippet(DEFAULT_STUDIO) }];
    case "embed":
      return [project, { title: "Add one script tag", body: "Works with any stack: plain HTML, Vue, Svelte, WordPress.", code: '<script type="module" src="https://unpkg.com/@lykia/embed"></script>' }, { title: "Place the elements", body: "Each element is a sandboxed frame that resizes to its content and fires lykia:* DOM events.", code: embedSnippet(DEFAULT_STUDIO) }];
    case "hooks":
      return [project, { title: "Install the widget", body: "Use the hooks and bring your own markup.", code: "npm install @lykia/widget" }, { title: "Build your own UI", body: "useLykiaPlan, useLykiaChat, useFence, useScent, useFlock, usePack and useOutrun.", code: hooksSnippet(DEFAULT_STUDIO) }];
    case "agents":
      return [{ title: "Get a secret key", body: "Agents run on your server: create a secret key in Keys. Never ship it to a browser." }, { title: "Install the tools", body: "JSON Schema tools with adapters for the Vercel AI SDK, LangChainJS, OpenAI and Anthropic. No dependencies.", code: "npm install @lykia/agent-tools" }, { title: "Give them to your model", body: "Every plan comes back with its Fence verdict. The user's wallet signs.", code: agentSnippet() }];
    case "mcp":
      return [{ title: "Get a secret key", body: "Create a secret key in Keys." }, { title: "Add the server", body: "Claude Code, the Claude Agent SDK, Cursor and any MCP client. No code.", code: mcpSnippet(apiOrigin) }, { title: "Ask", body: "\"Check this token, then plan a 100 USDC swap if it is clean.\" The tools read and propose; nothing signs on the server." }];
    case "sdk":
      return [{ title: "Get a key", body: "A secret key on a server, a browser key in a page." }, { title: "Install the SDK", body: "Import the whole client or only the parts you use.", code: "npm install @lykia/sdk" }, { title: "Plan and follow", body: "Typed events: plan-created, step-signed, settled.", code: sdkSnippet(DEFAULT_STUDIO) }];
  }
}

export function Quickstarts() {
  const [path, setPath] = useState<PathId>("widget");
  return (
    <Card title="Add AI to your Arc app in 3 steps" kicker="PICK A PATH">
      <Tabs label="Integration path" value={path} onChange={setPath} tabs={[{ id: "widget", label: "REACT WIDGET" }, { id: "embed", label: "HTML EMBED" }, { id: "hooks", label: "HEADLESS HOOKS" }, { id: "agents", label: "AGENT TOOLS" }, { id: "mcp", label: "MCP" }, { id: "sdk", label: "SDK" }]} />
      <ol style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "grid", gap: 14 }}>
        {steps(path).map((s, i) => (
          <li key={s.title} style={{ minWidth: 0 }}>
            <b>{`${i + 1}. ${s.title}`}</b>
            <p className="m-small" style={{ marginTop: 4 }}>{s.body}</p>
            {s.code ? <pre className="m-code" style={{ marginTop: 6, fontSize: 12, overflowX: "auto" }}>{s.code}</pre> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
