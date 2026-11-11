/**
 * The Forge · developer portal. A builder's journey in seven stones:
 *
 *   Strike         create a project (a city) in steps, plus the quickstarts
 *   Workshop       the live playground: brand, modules, preview and code
 *   Your cities    projects, their League listing, origins, browser keys, usage
 *   Keys           secret keys and your integrator fee
 *   Usage & logs   plan usage and request logs
 *   Webhooks       endpoints, deliveries and replays
 *   Reference      API reference, SDKs, MCP, the sentence parser, Circle, Arc tools, protocol integration
 *
 * Each stone has its own URL (/forge/:section). The old /build tabs and
 * hashes still land in the right place (app/routes/aliases.ts).
 */
import { HowItWorks } from "../../features/help/Help";
import { coverageLine, type Project } from "@lykia/core";
import { useEffect, useState } from "react";

import { navigate } from "../../app/routes/history";
import { Link } from "../../app/routes/Link";
import { forgeSectionFor } from "../../app/routes/aliases";
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
import { LeashQuickstart, Quickstarts } from "./Quickstarts";
import { Strike } from "./Strike";
import { Studio } from "./Studio";
import { Usage } from "./Usage";
import { Webhooks } from "./Webhooks";
import type { StudioConfig } from "./snippets";
import { intlLocale, t as msg } from "../../i18n";

export type ForgeSection = "strike" | "workshop" | "cities" | "keys" | "usage" | "webhooks" | "reference";

const FORGE_SECTIONS: readonly { readonly id: ForgeSection; readonly label: string; readonly sub: string }[] = [
  { id: "strike", label: msg("forge.strike"), sub: "quickstart" },
  { id: "workshop", label: msg("forge.workshop"), sub: "playground" },
  { id: "cities", label: msg("forge.yourCities"), sub: "projects" },
  { id: "keys", label: msg("forge.keys"), sub: msg("forge.andYourFee") },
  { id: "usage", label: msg("forge.usageLogs"), sub: "requests" },
  { id: "webhooks", label: msg("forge.webhooks"), sub: "events" },
  { id: "reference", label: msg("forge.reference"), sub: "API, SDK, MCP" },
];

const SDK = `import { Lykia } from "@lykia/sdk";

const lykia = new Lykia({ apiKey: process.env.LYKIA_API_KEY });
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

function isSection(value: string | undefined): value is ForgeSection {
  return FORGE_SECTIONS.some((s) => s.id === value);
}

/** The Forge keeps its developer depth; each of its own words gets one plain line. */
const FORGE_WORDS: readonly (readonly [string, string])[] = [
  [msg("forge.city"), msg("forge.yourProjectYourAppSBrand")],
  [msg("forge.fenceCaps"), msg("forge.spendingLimitsForYourUsersMoves")],
  [msg("forge.key"), msg("forge.aSecretYourServerSendsWith")],
  [msg("forge.webhook"), msg("forge.aMessageLykiaSendsToYour")],
  ["MCP", msg("forge.aStandardWayForAiTools")],
  ["Leash", msg("forge.aBudgetAnOutsideBotCannot")],
];

export default function ForgePage() {
  const { params, location } = useRoute();
  const raw = params.section;
  const section: ForgeSection = isSection(raw) ? raw : "strike";
  const siwe = useSiwe();
  const enabled = siwe.signedIn;
  const [studio, setStudio] = useState<Partial<StudioConfig> | undefined>(undefined);

  // Old tab names and hashes (/forge/projects, /forge#keys) land on their stone.
  useEffect(() => {
    if (raw && !isSection(raw)) {
      const to = forgeSectionFor(raw);
      navigate(`/forge/${to ?? "strike"}${location.hash}`, { replace: true });
    } else if (!raw && location.hash) {
      const to = forgeSectionFor(location.hash);
      if (to) navigate(`/forge/${to}${to === location.hash.slice(1) ? "" : location.hash}`, { replace: true });
    }
  }, [raw, location.hash]);

  const preview = (p: Project) => {
    setStudio({ projectId: p.id, assistantName: p.brand.assistant?.name ?? "Lyko", modules: p.modules, ...(p.brand.colors?.primary ? { primary: p.brand.colors.primary } : {}), ...(p.brand.colors?.accent ? { accent: p.brand.colors.accent } : {}), ...(p.brand.scheme ? { scheme: p.brand.scheme } : {}), ...(p.brand.radius !== undefined ? { radius: p.brand.radius } : {}), mosaic: p.brand.mosaic ?? true });
    navigate("/forge/workshop");
  };
  const index = FORGE_SECTIONS.findIndex((s) => s.id === section);

  return (
    <div>
      <PageHead kicker={msg("forge.theForgeDeveloperPortal")} title={<>{msg("forge.strikeACity")} <em>{msg("forge.shipItAnywhere")}</em></>} sub={msg("forge.lykiaSRoutingFenceChecksAnd")} mood="happy">
        <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 18 }}>
          {siwe.signedIn ? <Tag tone="ok">{msg("forge.signedIn")} {siwe.session?.roles.join(", ").toUpperCase()}</Tag> : <Button onClick={() => void siwe.signIn()} disabled={siwe.busy}>{msg("forge.signInWithYourWallet")}</Button>}
        </div>
        <p className="m-small m-muted m-center" style={{ marginTop: 8 }}>{msg("forge.oneSignedMessageSiweNoTransaction")}</p>
      </PageHead>

      <section className="m-wrap forge-words" aria-labelledby="forge-words">
        <div className="forge-words__head">
          <h2 id="forge-words" className="m-kick">{msg("forge.wordsOnThisPage")}</h2>
          <HowItWorks area="forge" />
        </div>
        <dl>
          {FORGE_WORDS.map(([w, m]) => (
            <div key={w}><dt>{w}</dt><dd>{m}</dd></div>
          ))}
        </dl>
      </section>

      <section className="m-wrap forge-rails" aria-labelledby="forge-rails">
        <h2 id="forge-rails" className="m-kick">{msg("forge.onTopOfCircleSRails")}</h2>
        <p className="m-small">{msg("forge.circleGivesYourAppUsdcCctp")}</p>
        <Link to="/#usdc-circle" className="m-small forge-rails__link">{msg("forge.whereUsdcAndCircleSitIn")}</Link>
      </section>

      <nav className="m-wrap forge-rail" aria-label={msg("forge.theForge")}>
        <ol>
          {FORGE_SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a
                href={`/forge/${s.id}`}
                className={cx("forge-rail__stone", i < index && "is-past")}
                aria-current={s.id === section ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/forge/${s.id}`);
                }}
              >
                <span className="forge-rail__n" aria-hidden="true">{i + 1}</span>
                <span className="forge-rail__l">{s.label}</span>
                <span className="forge-rail__s">{s.sub}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section className="m-wrap forge-section" key={section} style={{ marginTop: 22 }} aria-label={FORGE_SECTIONS[index]?.label}>
        {section === "strike" ? (
          <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Strike onPreview={preview} />
            <div className="m-grid-4">
              {[[msg("forge.widget"), msg("forge.widgetLine")], [msg("forge.embed"), msg("forge.embedLine")], [msg("forge.agentTools"), msg("forge.agentToolsLine")], ["MCP + REST", "/v1/mcp · /v1 · x402 · webhooks"]].map(([t, d]) => (
                <div key={t} className="m-frame m-card m-center"><h3 style={{ fontSize: 20 }}>{t}</h3><p className="m-small m-muted">{d}</p></div>
              ))}
            </div>
            <Quickstarts />
            <LeashQuickstart />
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
      toast.success(msg("forge.saved"), { from: "LYKO" });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  return (
    <div className="m-grid-2" style={{ alignItems: "start" }}>
      <FeesCard />
      <Card title={msg("forge.integratorFee")} kicker={msg("forge.max50Bps")} footer={<Button disabled={!enabled} onClick={() => void save()}>{msg("forge.save")}</Button>}>
        <div className="m-grid-2" style={{ gap: 10 }}><Field label={msg("forge.bps")}><Input value={fee} onChange={(e) => setFee(e.target.value)} /></Field><Field label={msg("forge.recipient")}><Input value={feeTo} placeholder="0x…" onChange={(e) => setFeeTo(e.target.value)} /></Field></div>
        <p className="m-small m-muted" style={{ marginTop: 8 }}>{msg("forge.yourIntegratorFeeIsOnTop")}</p>
      </Card>
    </div>
  );
}

function Reference({ hash }: { readonly hash: string }) {
  const initial: RefTab = hash === "#integrate" ? "integrate" : hash === "#mcp" ? "mcp" : hash === "#sdk" ? "sdk" : hash === "#parser" ? "parser" : hash === "#circle" ? "circle" : hash === "#arc" ? "arc" : "api";
  const [tab, setTab] = useState<RefTab>(initial);
  const [play, setPlay] = useState(msg("forge.putHalfMyUsdcToWork"));
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
      <Tabs label={msg("forge.reference")} value={tab} onChange={setTab} tabs={[{ id: "api", label: "API" }, { id: "sdk", label: "SDK" }, { id: "mcp", label: "MCP" }, { id: "parser", label: "PARSER" }, { id: "integrate", label: "INTEGRATE" }, { id: "circle", label: "CIRCLE" }, { id: "arc", label: msg("forge.arcTools") }]} />
      {tab === "api" ? (
        <ApiReference />
      ) : tab === "sdk" ? (
        <Card title="@lykia/sdk" kicker={msg("forge.typedRetriesSseWebhookVerify")}><pre className="m-code">{SDK}</pre></Card>
      ) : tab === "mcp" ? (
        <Card title="MCP" kicker={msg("forge.streamableHttpReadPropose")}>
          <pre className="m-code">{JSON.stringify({ mcpServers: { lykia: { url: apiUrl("/v1/mcp"), headers: { "Lykia-Key": "lk_live_…" } } } }, null, 2)}</pre>
          <p className="m-small m-muted" style={{ marginTop: 8 }}>{msg("forge.toolsLykiaPlanLykiaScentLykia")}</p>
          <p className="m-small m-muted">{msg("forge.plansReturnedByLykiaPlanCarry")}</p>
        </Card>
      ) : tab === "parser" ? (
        <Card title={msg("forge.sentenceParser")} kicker="POST /v1/language/parse" footer={<Button onClick={() => void runPlay()}>{msg("forge.run")}</Button>}>
          <Field label={msg("forge.sentence")}><Input value={play} onChange={(e) => setPlay(e.target.value)} /></Field>
          {playOut ? <pre className="m-code" style={{ marginTop: 10, maxHeight: 320 }}>{playOut}</pre> : null}
        </Card>
      ) : tab === "integrate" ? (
        <IntegrateSection />
      ) : tab === "circle" ? (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div className="m-frame m-card">
            <span className="m-kick">{msg("forge.builtOnArcNetworkOnCircle")}</span>
            <p className="m-small" style={{ marginTop: 6 }}>{msg("forge.circleMovesTheValueUsdcCctp")}</p>
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
      <span className="m-kick">{msg("forge.integrateYourProtocol")}</span>
      <h2 id="integrate-title" className="m-h2" style={{ marginTop: 6, fontSize: 26 }}>{msg("forge.reachEveryLykiaUserAndAgent")}</h2>
      <p className="m-small" style={{ marginTop: 6 }}>{`${eco.data ? `${coverageLine(eco.data.totals)}. ` : ""}${msg("forge.listingIsFree")}`}</p>
      <div className="m-grid-3" style={{ marginTop: 14 }}>
        <div>
          <b>{msg("forge.n1RegistryEntry")}</b>
          <ul className="m-small" style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>{msg("forge.contractAddressesPerNetworkFromYour")}</li>
            <li>{msg("forge.ethGetcodeIsNonEmptyFor")}</li>
            <li>{msg("forge.anEthCallSimulationOfYour")}</li>
            <li>{msg("forge.categorySummaryAndWebsite")}</li>
          </ul>
        </div>
        <div style={{ minWidth: 0 }}>
          <b>{msg("forge.n2OneTypedAdapter")}</b>
          <pre className="m-code" style={{ marginTop: 6, fontSize: 11 }}>{ADAPTER}</pre>
        </div>
        <div>
          <b>{msg("forge.n3WhatYouGet")}</b>
          <ul className="m-small" style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>{msg("forge.routingFromAskLykoTheSdk")}</li>
            <li>{msg("forge.aStallInTheHarbourWith")}</li>
            <li>{msg("forge.freeDeveloperKeysMinDay", { perMinute: free.perMinute, value: free.perDay.toLocaleString(intlLocale()) })}</li>
            <li>{msg("forge.everyMoveCheckedByTheUser")}</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 14 }}>
        <a className="m-btn m-btn--sea" href="https://github.com/furkan3152/Lykia/blob/HEAD/docs/integrate-your-protocol.md" target="_blank" rel="noopener noreferrer">{msg("forge.readTheGuide")}</a>
        <a className="m-btn m-btn--ghost" href={apiUrl("/.well-known/x402")} target="_blank" rel="noopener noreferrer">{msg("forge.x402Manifest")}</a>
        <a className="m-btn m-btn--ghost" href={apiUrl("/v1/openapi.json")} target="_blank" rel="noopener noreferrer">{"OPENAPI"}</a>
      </div>
    </section>
  );
}
