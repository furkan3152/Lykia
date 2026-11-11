/** "Add an assistant to your Arc app in 3 steps", once per integration path. */
import { useState } from "react";

import { API_BASE } from "../../lib/env";
import { Card, LeashMark, Tabs } from "../../mosaic";

const LEASH_DOCS = "https://github.com/furkan3152/Lykia/blob/main/docs/leash.md";
import { DEFAULT_STUDIO, agentSnippet, embedSnippet, hooksSnippet, leashCurlSnippet, leashPythonSnippet, leashTsSnippet, mcpSnippet, sdkSnippet, widgetSnippet } from "./snippets";
import { t } from "../../i18n";

type PathId = "widget" | "embed" | "hooks" | "agents" | "mcp" | "sdk";

interface Step {
  readonly title: string;
  readonly body: string;
  readonly code?: string;
}

function steps(path: PathId): readonly Step[] {
  const project: Step = { title: t("forge.quickstarts.createAProject"), body: t("forge.quickstarts.signInOnArcOpenProjects") };
  const apiOrigin = new URL(API_BASE).origin;
  switch (path) {
    case "widget":
      return [project, { title: t("forge.quickstarts.installTheWidget"), body: t("forge.quickstarts.react18OrNewerNoOther"), code: "npm install @lykia/widget" }, { title: t("forge.quickstarts.dropItIn"), body: t("forge.quickstarts.componentsFollowYourBrandAndModules"), code: widgetSnippet(DEFAULT_STUDIO) }];
    case "embed":
      return [project, { title: t("forge.quickstarts.addOneScriptTag"), body: t("forge.quickstarts.worksWithAnyStackPlainHtml"), code: '<script type="module" src="https://unpkg.com/@lykia/embed"></script>' }, { title: t("forge.quickstarts.placeTheElements"), body: t("forge.quickstarts.eachElementIsASandboxedFrame"), code: embedSnippet(DEFAULT_STUDIO) }];
    case "hooks":
      return [project, { title: t("forge.quickstarts.installTheWidget"), body: t("forge.quickstarts.useTheHooksAndBringYour"), code: "npm install @lykia/widget" }, { title: t("forge.quickstarts.buildYourOwnUi"), body: t("forge.quickstarts.uselykiaplanUselykiachatUsefenceUsescent"), code: hooksSnippet(DEFAULT_STUDIO) }];
    case "agents":
      return [{ title: t("forge.quickstarts.getASecretKey"), body: t("forge.quickstarts.agentsRunOnYourServerCreate") }, { title: t("forge.quickstarts.installTheTools"), body: t("forge.quickstarts.jsonSchemaToolsWithAdaptersFor"), code: "npm install @lykia/agent-tools" }, { title: t("forge.quickstarts.giveThemToYourModel"), body: t("forge.quickstarts.everyPlanComesBackWithIts"), code: agentSnippet() }];
    case "mcp":
      return [{ title: t("forge.quickstarts.getASecretKey"), body: t("forge.quickstarts.createASecretKeyInKeys") }, { title: t("forge.quickstarts.addTheServer"), body: t("forge.quickstarts.anyMcpClientIdeAssistantsDesktop"), code: mcpSnippet(apiOrigin) }, { title: t("forge.quickstarts.ask"), body: t("forge.quickstarts.checkThisTokenThenPlanA") }];
    case "sdk":
      return [{ title: t("forge.quickstarts.getAKey"), body: t("forge.quickstarts.aSecretKeyOnAServer") }, { title: t("forge.quickstarts.installTheSdk"), body: t("forge.quickstarts.importTheWholeClientOrOnly"), code: "npm install @lykia/sdk" }, { title: t("forge.quickstarts.planAndFollow"), body: t("forge.quickstarts.typedEventsPlanCreatedStepSigned"), code: sdkSnippet(DEFAULT_STUDIO) }];
  }
}

export function Quickstarts() {
  const [path, setPath] = useState<PathId>("widget");
  return (
    <Card title={t("forge.quickstarts.addAnAssistantToYourArc")} kicker={t("forge.quickstarts.pickAPath")}>
      <Tabs label={t("forge.quickstarts.integrationPath")} value={path} onChange={setPath} tabs={[{ id: "widget", label: t("forge.quickstarts.reactWidget") }, { id: "embed", label: t("forge.quickstarts.htmlEmbed") }, { id: "hooks", label: t("forge.quickstarts.headlessHooks") }, { id: "agents", label: t("forge.quickstarts.agentTools") }, { id: "mcp", label: "MCP" }, { id: "sdk", label: "SDK" }]} />
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

type LeashLang = "curl" | "ts" | "python";

/** "Leash an agent": the owner makes a leash, the agent plans inside it with its own key. */
export function LeashQuickstart() {
  const [lang, setLang] = useState<LeashLang>("curl");
  const apiOrigin = new URL(API_BASE).origin;
  const code = lang === "curl" ? leashCurlSnippet(apiOrigin) : lang === "ts" ? leashTsSnippet() : leashPythonSnippet();
  return (
    <Card title={t("forge.quickstarts.leashAnAgent")} kicker={t("forge.quickstarts.aBudgetItCannotExceed")}>
      <div className="forge-leash">
        <span className="forge-leash__mark" aria-hidden="true"><LeashMark scale={3} /></span>
        <ol className="forge-leash__steps">
          <li><b>{t("forge.quickstarts.n1TheOwnerMakesALeash")}</b>{t("forge.quickstarts.perStepPerDayAndTotal")}</li>
          <li><b>{t("forge.quickstarts.n2TheAgentPlansWithIts")}</b>{t("forge.quickstarts.insideOneTransactionForItsOwn")}</li>
          <li><b>{t("forge.quickstarts.n3RevokeAtAnyTime")}</b>{t("forge.quickstarts.theKeyStopsAtTheApi")}</li>
        </ol>
      </div>
      <Tabs label={t("forge.quickstarts.language")} value={lang} onChange={setLang} tabs={[{ id: "curl", label: "CURL" }, { id: "ts", label: "TYPESCRIPT" }, { id: "python", label: "PYTHON" }]} />
      <pre className="m-code" style={{ marginTop: 10, fontSize: 12, overflowX: "auto" }}>{code}</pre>
      <p className="m-small" style={{ marginTop: 10 }}>
        {t("forge.quickstarts.theChainHoldsTheTokenCaps")}
        <a href={LEASH_DOCS} target="_blank" rel="noreferrer">{t("forge.quickstarts.readWhatEachSideEnforces")}</a>
        {". CLI: "}<code>{t("forge.quickstarts.lykiaLeashCreateTemplateTradeSmall")}</code>
      </p>
    </Card>
  );
}
