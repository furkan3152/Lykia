/**
 * Code the developer portal shows: one generator per integration path,
 * fed by the playground's brand, modules and assistant name. Pure, so the
 * snippets are tested like any other output.
 */
import type { ProjectBrand, ProjectModule } from "@lykia/core";

export interface StudioConfig {
  readonly projectId: string;
  readonly key: string;
  readonly assistantName: string;
  readonly primary: string;
  readonly accent: string;
  readonly scheme: "light" | "dark" | "auto";
  readonly radius: number;
  readonly mosaic: boolean;
  readonly modules: readonly ProjectModule[];
}

export const DEFAULT_STUDIO: StudioConfig = {
  projectId: "prj_yourproject1",
  key: "lk_pk_…",
  assistantName: "Lyko",
  primary: "#1e8fa3",
  accent: "#d9a441",
  scheme: "auto",
  radius: 12,
  mosaic: true,
  modules: ["chat", "send", "swap", "scent", "flock"],
};

const COMPONENT: Partial<Record<ProjectModule, string>> = { chat: "LykiaChat", send: "Send", swap: "Swap", earn: "Earn", bridge: "Bridge", fence: "Fence", scent: "Scent", flock: "Flock", pack: "Pack" };
const ELEMENT: Partial<Record<ProjectModule, string>> = { chat: "lykia-assistant", send: "lykia-send", swap: "lykia-swap", earn: "lykia-earn", bridge: "lykia-bridge", fence: "lykia-fence", scent: "lykia-scent", flock: "lykia-flock", pack: "lykia-pack" };

const attr = (value: string) => value.replace(/[&"<>]/gu, "");

/** The project fields the playground edits, as a PATCH /v1/projects/:id body. */
export function projectPatch(c: StudioConfig): { readonly brand: ProjectBrand; readonly modules: readonly ProjectModule[] } {
  return {
    brand: { colors: { primary: c.primary, accent: c.accent }, scheme: c.scheme, radius: c.radius, mosaic: c.mosaic, mascot: c.assistantName === "Lyko" ? "lyko" : "custom", ...(c.assistantName === "Lyko" ? {} : { assistant: { name: c.assistantName } }) },
    modules: c.modules,
  };
}

export function widgetSnippet(c: StudioConfig): string {
  const parts = c.modules.map((m) => COMPONENT[m]).filter((x): x is string => Boolean(x));
  const imports = ["LykiaProvider", ...parts].join(", ");
  return `// npm install @lykia/widget
import { ${imports} } from "@lykia/widget";

export function Wallet() {
  // Brand, modules and the assistant name come from your project.
  // Pass walletClient, provider or wagmiConfig to sign with your own wallet.
  return (
    <LykiaProvider project="${c.projectId}" apiKey="${c.key}">
${parts.map((p) => `      <${p} />`).join("\n")}
    </LykiaProvider>
  );
}`;
}

export function embedSnippet(c: StudioConfig): string {
  const tags = c.modules.map((m) => ELEMENT[m]).filter((x): x is string => Boolean(x));
  const look = [`primary="${attr(c.primary)}"`, `accent="${attr(c.accent)}"`, `scheme="${c.scheme}"`, `radius="${c.radius}"`, `mosaic="${c.mosaic ? "on" : "off"}"`].join(" ");
  return `<script type="module" src="https://unpkg.com/@lykia/embed"></script>

${tags.map((t) => `<${t} project="${c.projectId}" key="${c.key}" ${look}></${t}>`).join("\n")}

<script>
  document.addEventListener("lykia:settled", (e) => console.log("settled", e.detail));
</script>`;
}

export function hooksSnippet(c: StudioConfig): string {
  return `import { LykiaProvider, useLykiaPlan } from "@lykia/widget";

function PayButton({ to }: { to: \`0x\${string}\` }) {
  const plan = useLykiaPlan();
  return (
    <button onClick={async () => { await plan.plan({ text: \`send 25 USDC to \${to}\` }); await plan.run(); }}>
      {plan.status === "signing" ? "Signing…" : "Pay 25 USDC"}
    </button>
  );
}

export const App = () => (
  <LykiaProvider project="${c.projectId}" apiKey="${c.key}">
    <PayButton to="0x…" />
  </LykiaProvider>
);`;
}

export function agentSnippet(): string {
  return `// npm install @lykia/agent-tools ai
import { generateText, jsonSchema } from "ai";
import { aiSdkTools, createLykiaExecutor } from "@lykia/agent-tools";

const lykia = createLykiaExecutor({ apiKey: process.env.LYKIA_SECRET_KEY, owner: userAddress, environment: "mainnet" });

const { text } = await generateText({
  model, // any AI SDK model
  tools: aiSdkTools(lykia, { jsonSchema }),
  prompt: "Check the token 0x… and, if it is clean, plan a swap of 100 USDC into it.",
});
// Plans come back with their Fence verdict; the user's wallet signs each step.`;
}

export function mcpSnippet(apiOrigin: string): string {
  return JSON.stringify({ mcpServers: { lykia: { type: "http", url: `${apiOrigin}/v1/mcp`, headers: { "Lykia-Key": "lk_sk_…" } } } }, null, 2);
}

export function sdkSnippet(c: StudioConfig): string {
  return `import { createTransport } from "@lykia/sdk";
import { intentsApi } from "@lykia/sdk/intents";

const t = createTransport({ apiKey: process.env.LYKIA_SECRET_KEY, project: "${c.projectId}" });
t.on("plan-created", (e) => console.log(e.intentId, e.decision));
const plan = await intentsApi(t).create({ owner, text: "put half my USDC to work" });`;
}

/* ------------------------------------------------------------ leash */

const LEASH_BODY = { agent: { name: "Invoice bot", signer: "0xAGENT_SESSION_KEY_ADDRESS" }, template: "pay-invoices", budget: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" }, expiresAt: "2026-11-15T00:00:00Z", recipients: ["0xPAYEE"] };

/** POST /v1/leashes with curl, then the agent's first plan with its leash key. */
export function leashCurlSnippet(apiOrigin: string): string {
  return `# The owner: one call makes the leash (a key with the agents scope, or a Lykia-Session)
curl -s ${apiOrigin}/v1/leashes \\
  -H "Lykia-Key: $LYKIA_SECRET_KEY" -H "content-type: application/json" \\
  -d '${JSON.stringify(LEASH_BODY)}'
# -> transactions (sign once), apiKey.secret (shown once), mcp

# The agent: plan inside the leash with its leash key
curl -s ${apiOrigin}/v1/leashes/lsh_…/plan \\
  -H "Lykia-Key: $LYKIA_LEASH_KEY" -H "content-type: application/json" \\
  -d '{"text":"pay 12 USDC to 0xPAYEE"}'
# outside it: 422 LEASH_DENIED with reasons[].code and remaining`;
}

export function leashTsSnippet(): string {
  return `import { Lykia, LykiaError } from "@lykia/sdk";

const owner = new Lykia({ apiKey: process.env.LYKIA_SECRET_KEY });
const { leash, transactions, apiKey, mcp } = await owner.leashes.create({
  agent: { name: "Invoice bot", signer: agentAddress },
  template: "pay-invoices",
  budget: { perStepUsd: "20", perDayUsd: "20", totalUsd: "140" },
  expiresAt, recipients: [payee],
});
// Sign \`transactions\` once from the owner's wallet; hand apiKey.secret to the agent.

const agent = new Lykia({ apiKey: apiKey.secret });
try {
  const plan = await agent.leashes.plan(leash.id, { text: "pay 12 USDC to " + payee });
  const hash = await agentWallet.sendTransaction(plan.prepared.transaction);
  await agent.leashes.submit(leash.id, { intentId: plan.intent.id, stepId: "s1", hash });
} catch (e) {
  if (e instanceof LykiaError && e.code === "LEASH_DENIED") console.log(e.details.reasons, e.details.remaining);
}`;
}

export function leashPythonSnippet(): string {
  return `from lykia import Lykia, LykiaError

owner = Lykia(os.environ["LYKIA_SECRET_KEY"], base_url="https://api.lykiaai.com")
created = owner.leashes.create(
    agent={"name": "Invoice bot", "signer": agent_address},
    template="pay-invoices",
    budget={"perStepUsd": "20", "perDayUsd": "20", "totalUsd": "140"},
    expires_at=expires_at, recipients=[payee],
)

agent = Lykia(created["apiKey"]["secret"], base_url="https://api.lykiaai.com")
try:
    plan = agent.leashes.plan(created["leash"]["id"], f"pay 12 USDC to {payee}")
except LykiaError as e:
    if e.code == "LEASH_DENIED":
        print(e.details["reasons"], e.details["remaining"])`;
}
