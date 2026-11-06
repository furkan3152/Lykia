/**
 * The Mint · developer portal. A builder's journey in seven stones:
 *
 *   Strike         create a project (a city) in steps, plus the quickstarts
 *   Workshop       the live playground: brand, modules, preview and code
 *   Your cities    projects, their League listing, origins, browser keys, usage
 *   Keys           secret keys and your integrator fee
 *   Usage & logs   plan usage and request logs
 *   Webhooks       endpoints, deliveries and replays
 *   Reference      API reference, SDKs, MCP, the sentence parser, Circle, Arc tools, protocol integration
 *
 * Each stone has its own URL (/mint/:section). The old /build tabs and
 * hashes still land in the right place (app/routes/aliases.ts).
 */
import { coverageLine, type Project } from "@lykia/core";
import { useEffect, useState } from "react";

import { navigate } from "../../app/routes/history";
import { mintSectionFor } from "../../app/routes/aliases";
import { useRoute } from "../../app/routes/useRoute";
import { CircleMarket } from "../../features/circle/Circle";
import { DevToolsCard } from "../../features/desk/DevTools";
import { useEcosystem } from "../../features/ecosystem/useEcosystem";
import { FeesCard } from "../../features/fees/FeesCard";
import { useSiwe } from "../../features/session/useSiwe";
import { apiPost, apiPut, apiUrl, describeError } from "../../lib/api";
import { Button, Card, Field, Input, PageHead, Tabs, Tag, cx, toast } from "../../mosaic";
import { ApiReference } from "./ApiReference";
import { Keys } from "./Keys";
import { Logs } from "./Logs";
import { Projects } from "./Projects";
import { Quickstarts } from "./Quickstarts";
import { Strike } from "./Strike";
import { Studio } from "./Studio";
import { Usage } from "./Usage";
import { Webhooks } from "./Webhooks";
import type { StudioConfig } from "./snippets";

export type MintSection = "strike" | "workshop" | "cities" | "keys" | "usage" | "webhooks" | "reference";

const MINT_SECTIONS: readonly { readonly id: MintSection; readonly label: string; readonly sub: string }[] = [
  { id: "strike", label: "Strike", sub: "quickstart" },
  { id: "workshop", label: "Workshop", sub: "playground" },
  { id: "cities", label: "Your cities", sub: "projects" },
  { id: "keys", label: "Keys", sub: "and your fee" },
  { id: "usage", label: "Usage & logs", sub: "requests" },
  { id: "webhooks", label: "Webhooks", sub: "events" },
  { id: "reference", label: "Reference", sub: "API, SDK, MCP" },
];

const SDK = `import { Lykia } from "@lykia/sdk";

const lykia = new Lykia({ apiKey: process.env.LYKIA_KEY });
const plan = await lykia.intents.create({
  text: "put half my USDC to work",
  owner, environment: "mainnet",
});
console.log(plan.outrun.fees); // Lykia fee totals, e.g. ["1 USDC"]
for (const step of plan.intent.steps) {
  const { transactions } = await lykia.intents.prepare(plan.intent.id, step.id);
  // sign with viem, then:
  await lykia.intents.submit(plan.intent.id, step.id, { hashes });
}`;

type RefTab = "api" | "sdk" | "mcp" | "parser" | "integrate" | "circle" | "arc";

function isSection(value: string | undefined): value is MintSection {
  return MINT_SECTIONS.some((s) => s.id === value);
}

export default function MintPage() {
  const { params, location } = useRoute();
  const raw = params.section;
  const section: MintSection = isSection(raw) ? raw : "strike";
  const siwe = useSiwe();
  const enabled = siwe.signedIn;
  const [studio, setStudio] = useState<Partial<StudioConfig> | undefined>(undefined);

  // Old tab names and hashes (/mint/projects, /mint#keys) land on their stone.
  useEffect(() => {
    if (raw && !isSection(raw)) {
      const to = mintSectionFor(raw);
      navigate(`/mint/${to ?? "strike"}${location.hash}`, { replace: true });
    } else if (!raw && location.hash) {
      const to = mintSectionFor(location.hash);
      if (to) navigate(`/mint/${to}${to === location.hash.slice(1) ? "" : location.hash}`, { replace: true });
    }
  }, [raw, location.hash]);

  const preview = (p: Project) => {
    setStudio({ projectId: p.id, assistantName: p.brand.assistant?.name ?? "Lyko", modules: p.modules, ...(p.brand.colors?.primary ? { primary: p.brand.colors.primary } : {}), ...(p.brand.colors?.accent ? { accent: p.brand.colors.accent } : {}), ...(p.brand.scheme ? { scheme: p.brand.scheme } : {}), ...(p.brand.radius !== undefined ? { radius: p.brand.radius } : {}), mosaic: p.brand.mosaic ?? true });
    navigate("/mint/workshop");
  };
  const index = MINT_SECTIONS.findIndex((s) => s.id === section);

  return (
    <div>
      <PageHead kicker="THE MINT · DEVELOPER PORTAL" title={<>Strike a city. <em>Ship it anywhere.</em></>} sub="The routing, the Fence checks and the assistant behind Lykia, as a REST API, an MCP server, SDKs and drop-in components. Every app you build is a city: your brand, your modules, your Fence caps, your fee. The server never signs." mood="happy">
        <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 18 }}>
          {siwe.signedIn ? <Tag tone="ok">SIGNED IN · {siwe.session?.roles.join(", ").toUpperCase()}</Tag> : <Button onClick={() => void siwe.signIn()} disabled={siwe.busy}>{"SIGN IN ON ARC (SIWE)"}</Button>}
        </div>
      </PageHead>

      <nav className="m-wrap mint-rail" aria-label="The Mint">
        <ol>
          {MINT_SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a
                href={`/mint/${s.id}`}
                className={cx("mint-rail__stone", i < index && "is-past")}
                aria-current={s.id === section ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/mint/${s.id}`);
                }}
              >
                <span className="mint-rail__n" aria-hidden="true">{i + 1}</span>
                <span className="mint-rail__l">{s.label}</span>
                <span className="mint-rail__s">{s.sub}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section className="m-wrap mint-section" key={section} style={{ marginTop: 22 }} aria-label={MINT_SECTIONS[index]?.label}>
        {section === "strike" ? (
          <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Strike onPreview={preview} />
            <div className="m-grid-4">
              {[["Widget", "@lykia/widget · React components + hooks"], ["Embed", "@lykia/embed · one script tag"], ["Agent tools", "@lykia/agent-tools · AI SDK, LangChain, OpenAI, Claude"], ["MCP + REST", "/v1/mcp · /v1 · x402 · webhooks"]].map(([t, d]) => (
                <div key={t} className="m-frame m-card m-center"><h3 style={{ fontSize: 20 }}>{t}</h3><p className="m-small m-muted">{d}</p></div>
              ))}
            </div>
            <Quickstarts />
          </div>
        ) : section === "workshop" ? (
          <Studio key={studio?.projectId ?? "default"} {...(studio ? { initial: studio } : {})} />
        ) : section === "cities" ? (
          <Projects enabled={enabled} onPreview={preview} />
        ) : section === "keys" ? (
          <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Keys enabled={enabled} />
            <FeeSettings enabled={enabled} />
          </div>
        ) : section === "usage" ? (
          <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Usage enabled={enabled} />
            <Logs enabled={enabled} />
          </div>
        ) : section === "webhooks" ? (
          <Webhooks enabled={enabled} />
        ) : (
          <Reference hash={location.hash} />
        )}
      </section>
    </div>
  );
}

function FeeSettings({ enabled }: { readonly enabled: boolean }) {
  const [fee, setFee] = useState("10");
  const [feeTo, setFeeTo] = useState("");
  const save = async () => {
    try {
      await apiPut("/v1/developers/settings", { integratorFeeBps: Number(fee), feeRecipient: feeTo || null });
      toast.success("Saved", { from: "LYKO" });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  return (
    <div className="m-grid-2" style={{ alignItems: "start" }}>
      <FeesCard />
      <Card title={"Integrator fee"} kicker="MAX 50 BPS" footer={<Button disabled={!enabled} onClick={() => void save()}>SAVE</Button>}>
        <div className="m-grid-2" style={{ gap: 10 }}><Field label="bps"><Input value={fee} onChange={(e) => setFee(e.target.value)} /></Field><Field label="Recipient"><Input value={feeTo} placeholder="0x…" onChange={(e) => setFeeTo(e.target.value)} /></Field></div>
        <p className="m-small m-muted" style={{ marginTop: 8 }}>{"Your integrator fee is on top of Lykia's protocol fee. A city's own app fee is set on the city."}</p>
      </Card>
    </div>
  );
}

function Reference({ hash }: { readonly hash: string }) {
  const initial: RefTab = hash === "#integrate" ? "integrate" : hash === "#mcp" ? "mcp" : hash === "#sdk" ? "sdk" : hash === "#parser" ? "parser" : hash === "#circle" ? "circle" : hash === "#arc" ? "arc" : "api";
  const [tab, setTab] = useState<RefTab>(initial);
  const [play, setPlay] = useState("put half my USDC to work");
  const [playOut, setPlayOut] = useState("");
  const runPlay = async () => {
    try {
      setPlayOut(JSON.stringify(await apiPost<unknown>("/v1/language/parse", { text: play, environment: "mainnet" }), null, 2));
    } catch (e) {
      setPlayOut(describeError(e));
    }
  };
  return (
    <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <Tabs label="Reference" value={tab} onChange={setTab} tabs={[{ id: "api", label: "API" }, { id: "sdk", label: "SDK" }, { id: "mcp", label: "MCP" }, { id: "parser", label: "PARSER" }, { id: "integrate", label: "INTEGRATE" }, { id: "circle", label: "CIRCLE" }, { id: "arc", label: "ARC TOOLS" }]} />
      {tab === "api" ? (
        <ApiReference />
      ) : tab === "sdk" ? (
        <Card title="@lykia/sdk" kicker="TYPED · RETRIES · SSE · WEBHOOK VERIFY"><pre className="m-code">{SDK}</pre></Card>
      ) : tab === "mcp" ? (
        <Card title="MCP" kicker="STREAMABLE HTTP · READ + PROPOSE">
          <pre className="m-code">{JSON.stringify({ mcpServers: { lykia: { url: apiUrl("/v1/mcp"), headers: { "Lykia-Key": "lk_live_…" } } } }, null, 2)}</pre>
          <p className="m-small m-muted" style={{ marginTop: 8 }}>Tools: lykia_plan, lykia_scent, lykia_flock, lykia_fence_evaluate, lykia_venues, lykia_outrun, lykia_pack, lykia_insights, lykia_pack_plan, lykia_fees, lykia_circle_status, lykia_circle_services, lykia_launches, lykia_perps_markets, lykia_orders, lykia_dev_tools.</p>
          <p className="m-small m-muted">{"Plans returned by lykia_plan carry each step's Lykia fee (fee on the step, fees on the outrun); the fee is paid inside the step's own transaction."}</p>
        </Card>
      ) : tab === "parser" ? (
        <Card title="Sentence parser" kicker="POST /v1/language/parse" footer={<Button onClick={() => void runPlay()}>RUN</Button>}>
          <Field label="Sentence"><Input value={play} onChange={(e) => setPlay(e.target.value)} /></Field>
          {playOut ? <pre className="m-code" style={{ marginTop: 10, maxHeight: 320 }}>{playOut}</pre> : null}
        </Card>
      ) : tab === "integrate" ? (
        <IntegrateSection />
      ) : tab === "circle" ? (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div className="m-frame m-card">
            <span className="m-kick">{"BUILT ON ARC NETWORK · POWERED BY CIRCLE"}</span>
            <p className="m-small" style={{ marginTop: 6 }}>{"Circle moves the value: USDC, CCTP, Gateway, StableFX and the agent stack. Lykia maps every Arc protocol, routes through every venue it has an executable adapter for, checks each move against a DeFi-aware Fence and files every verdict as an ERC-8354 policy attestation in the ERC-8004 Validation Registry."}</p>
          </div>
          <CircleMarket compact />
        </div>
      ) : (
        <DevToolsCard />
      )}
    </div>
  );
}

const ADAPTER = `// apps/api/src/engine/venues/yourprotocol.ts
export const yourProtocol: VenueAdapter = {
  id: "your-protocol",              // the registry id
  verbs: ["deposit", "withdraw"],   // what Lykia may route to you
  async quote(request, deps) { /* read your contracts */ },
  calls(step, deps) { /* approve + act, returned unsigned */ },
};`;

/** The integration program for Arc protocols (anchor #integrate). */
function IntegrateSection() {
  const eco = useEcosystem("mainnet");
  const free = eco.data?.builders.freeTier ?? { perMinute: 120, perDay: 20000 };
  return (
    <section id="integrate" className="m-frame m-card" style={{ scrollMarginTop: 96 }} aria-labelledby="integrate-title">
      <span className="m-kick">{"INTEGRATE YOUR PROTOCOL"}</span>
      <h2 id="integrate-title" className="m-h2" style={{ marginTop: 6, fontSize: 26 }}>{"Reach every Lykia user and agent"}</h2>
      <p className="m-small" style={{ marginTop: 6 }}>{`${eco.data ? `${coverageLine(eco.data.totals)}. ` : ""}Listing is free and open to every team building on Arc; an adapter makes a mapped protocol routable.`}</p>
      <div className="m-grid-3" style={{ marginTop: 14 }}>
        <div>
          <b>{"1. Registry entry"}</b>
          <ul className="m-small" style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>{"Contract addresses per network, from your docs"}</li>
            <li>{"eth_getCode is non-empty for every address"}</li>
            <li>{"An eth_call simulation of your main action"}</li>
            <li>{"Category, summary and website"}</li>
          </ul>
        </div>
        <div style={{ minWidth: 0 }}>
          <b>{"2. One typed adapter"}</b>
          <pre className="m-code" style={{ marginTop: 6, fontSize: 11 }}>{ADAPTER}</pre>
        </div>
        <div>
          <b>{"3. What you get"}</b>
          <ul className="m-small" style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>{"Routing from Ask Lyko, the SDK, MCP and x402"}</li>
            <li>{"A stall in the Harbour with TVL and value routed"}</li>
            <li>{`Free developer keys: ${free.perMinute}/min, ${free.perDay.toLocaleString("en-US")}/day`}</li>
            <li>{"Every move checked by the user's Fence first"}</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 14 }}>
        <a className="m-btn m-btn--sea" href="https://github.com/furkan3152/Lykia/blob/HEAD/docs/integrate-your-protocol.md" target="_blank" rel="noopener noreferrer">{"READ THE GUIDE"}</a>
        <a className="m-btn m-btn--ghost" href={apiUrl("/.well-known/x402")} target="_blank" rel="noopener noreferrer">{"x402 MANIFEST"}</a>
        <a className="m-btn m-btn--ghost" href={apiUrl("/v1/openapi.json")} target="_blank" rel="noopener noreferrer">{"OPENAPI"}</a>
      </div>
    </section>
  );
}
