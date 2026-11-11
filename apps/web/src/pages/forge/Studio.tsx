/** The live playground: tweak the brand, modules and assistant name; see the widget and the code for each path. */
import { PROJECT_MODULES, type ProjectModule } from "@lykia/core";
import { LykiaChat, LykiaProvider, Scent, Send, Swap, Earn, Bridge, Fence, Flock, Pack } from "@lykia/widget";
import { LykiaTransport } from "@lykia/sdk";
import { useMemo, useState } from "react";

import { API_BASE } from "../../lib/env";
import { Card, Field, Input, Select, Tabs, Tag } from "../../mosaic";
import { DEFAULT_STUDIO, embedSnippet, hooksSnippet, projectPatch, widgetSnippet, type StudioConfig } from "./snippets";
import { t } from "../../i18n";

type Path = "widget" | "embed" | "hooks" | "project";

const PREVIEW: Partial<Record<ProjectModule, () => React.ReactElement>> = {
  chat: () => <LykiaChat />,
  send: () => <Send />,
  swap: () => <Swap />,
  earn: () => <Earn />,
  bridge: () => <Bridge />,
  fence: () => <Fence />,
  scent: () => <Scent />,
  flock: () => <Flock />,
  pack: () => <Pack />,
};

export function Studio({ initial }: { readonly initial?: Partial<StudioConfig> }) {
  const [c, setC] = useState<StudioConfig>({ ...DEFAULT_STUDIO, ...initial });
  const [path, setPath] = useState<Path>("widget");
  const transport = useMemo(() => new LykiaTransport({ baseUrl: new URL(API_BASE).origin, environment: "testnet" }), []);
  const set = <K extends keyof StudioConfig>(key: K, value: StudioConfig[K]) => setC((prev) => ({ ...prev, [key]: value }));
  const toggle = (m: ProjectModule) => set("modules", c.modules.includes(m) ? c.modules.filter((x) => x !== m) : [...c.modules, m]);
  const code = path === "widget" ? widgetSnippet(c) : path === "embed" ? embedSnippet(c) : path === "hooks" ? hooksSnippet(c) : JSON.stringify(projectPatch(c), null, 2);
  const brand = { colors: { primary: c.primary, accent: c.accent }, scheme: c.scheme, radius: c.radius, mosaic: c.mosaic, mascot: c.assistantName === "Lyko" ? ("lyko" as const) : ("custom" as const), assistant: { name: c.assistantName } };
  const shown = c.modules.filter((m) => PREVIEW[m]).slice(0, 3);
  return (
    <div className="m-grid-2" style={{ alignItems: "start" }}>
      <div style={{ display: "grid", gap: 16, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Card title={t("forge.studio.yourBrand")} kicker={t("forge.studio.liveTestnetPreview")}>
          <div className="m-grid-2" style={{ gap: 10 }}>
            <Field label={t("forge.studio.assistantName")}><Input value={c.assistantName} maxLength={32} onChange={(e) => set("assistantName", e.target.value || "Lyko")} /></Field>
            <Field label={t("forge.studio.scheme")}>
              <Select value={c.scheme} onChange={(e) => set("scheme", e.target.value as StudioConfig["scheme"])}><option value="auto">{t("forge.studio.auto")}</option><option value="light">{t("forge.studio.light")}</option><option value="dark">{t("forge.studio.dark")}</option></Select>
            </Field>
            <Field label={t("forge.studio.primary")}><Input type="color" value={c.primary} onChange={(e) => set("primary", e.target.value)} aria-label={t("forge.studio.primaryColour")} /></Field>
            <Field label={t("forge.studio.accent")}><Input type="color" value={c.accent} onChange={(e) => set("accent", e.target.value)} aria-label={t("forge.studio.accentColour")} /></Field>
            <Field label={t("forge.studio.cornerRadiusPx", { radius: c.radius })}><Input type="range" min={0} max={24} value={c.radius} onChange={(e) => set("radius", Number(e.target.value))} /></Field>
            <Field label={t("forge.studio.mosaicBackground")}>
              <Select value={c.mosaic ? "on" : "off"} onChange={(e) => set("mosaic", e.target.value === "on")}><option value="on">on</option><option value="off">{t("forge.studio.off")}</option></Select>
            </Field>
          </div>
          <p className="m-small m-muted" style={{ marginTop: 10 }}>{t("forge.studio.modules")}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("forge.studio.modules")}>
            {PROJECT_MODULES.map((m) => (
              <button key={m} type="button" className={`m-btn ${c.modules.includes(m) ? "m-btn--sea" : "m-btn--ghost"}`} style={{ padding: "4px 10px", fontSize: 12 }} aria-pressed={c.modules.includes(m)} onClick={() => toggle(m)}>{m}</button>
            ))}
          </div>
        </Card>
        <Card title={t("forge.studio.theCode")} kicker={t("forge.studio.copyIntoYourApp")}>
          <Tabs label={t("forge.studio.integrationPath")} value={path} onChange={setPath} tabs={[{ id: "widget", label: "REACT" }, { id: "embed", label: "HTML" }, { id: "hooks", label: "HOOKS" }, { id: "project", label: "PROJECT" }]} />
          <pre className="m-code" style={{ marginTop: 10, maxHeight: 360, overflow: "auto" }}>{code}</pre>
          <div className="flex gap-2" style={{ marginTop: 8 }}>
            <button type="button" className="m-btn m-btn--ghost" onClick={() => void navigator.clipboard?.writeText(code)}>{t("forge.studio.copy")}</button>
            {path === "project" ? <Tag tone="ghost">{t("forge.studio.patchV1ProjectsId")}</Tag> : null}
          </div>
        </Card>
      </div>
      <div style={{ display: "grid", gap: 12, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }} aria-label={t("forge.studio.preview")}>
        <LykiaProvider transport={transport} brand={brand} modules={c.modules} assistantName={c.assistantName} environment="testnet">
          {shown.length === 0 ? <p className="m-small m-muted">{t("forge.studio.turnOnAModuleToPreview")}</p> : shown.map((m) => <div key={m}>{PREVIEW[m]?.()}</div>)}
        </LykiaProvider>
      </div>
    </div>
  );
}
