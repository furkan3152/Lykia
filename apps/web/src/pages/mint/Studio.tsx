/** The live playground: tweak the brand, modules and assistant name; see the widget and the code for each path. */
import { PROJECT_MODULES, type ProjectModule } from "@lykia/core";
import { LykiaChat, LykiaProvider, Scent, Send, Swap, Earn, Bridge, Fence, Flock, Pack } from "@lykia/widget";
import { LykiaTransport } from "@lykia/sdk";
import { useMemo, useState } from "react";

import { API_BASE } from "../../lib/env";
import { Card, Field, Input, Select, Tabs, Tag } from "../../mosaic";
import { DEFAULT_STUDIO, embedSnippet, hooksSnippet, projectPatch, widgetSnippet, type StudioConfig } from "./snippets";

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
        <Card title="Your brand" kicker="LIVE · TESTNET PREVIEW">
          <div className="m-grid-2" style={{ gap: 10 }}>
            <Field label="Assistant name"><Input value={c.assistantName} maxLength={32} onChange={(e) => set("assistantName", e.target.value || "Lyko")} /></Field>
            <Field label="Scheme">
              <Select value={c.scheme} onChange={(e) => set("scheme", e.target.value as StudioConfig["scheme"])}><option value="auto">auto</option><option value="light">light</option><option value="dark">dark</option></Select>
            </Field>
            <Field label="Primary"><Input type="color" value={c.primary} onChange={(e) => set("primary", e.target.value)} aria-label="Primary colour" /></Field>
            <Field label="Accent"><Input type="color" value={c.accent} onChange={(e) => set("accent", e.target.value)} aria-label="Accent colour" /></Field>
            <Field label={`Corner radius · ${c.radius}px`}><Input type="range" min={0} max={24} value={c.radius} onChange={(e) => set("radius", Number(e.target.value))} /></Field>
            <Field label="Mosaic background">
              <Select value={c.mosaic ? "on" : "off"} onChange={(e) => set("mosaic", e.target.value === "on")}><option value="on">on</option><option value="off">off</option></Select>
            </Field>
          </div>
          <p className="m-small m-muted" style={{ marginTop: 10 }}>Modules</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Modules">
            {PROJECT_MODULES.map((m) => (
              <button key={m} type="button" className={`m-btn ${c.modules.includes(m) ? "m-btn--sea" : "m-btn--ghost"}`} style={{ padding: "4px 10px", fontSize: 12 }} aria-pressed={c.modules.includes(m)} onClick={() => toggle(m)}>{m}</button>
            ))}
          </div>
        </Card>
        <Card title="The code" kicker="COPY INTO YOUR APP">
          <Tabs label="Integration path" value={path} onChange={setPath} tabs={[{ id: "widget", label: "REACT" }, { id: "embed", label: "HTML" }, { id: "hooks", label: "HOOKS" }, { id: "project", label: "PROJECT" }]} />
          <pre className="m-code" style={{ marginTop: 10, maxHeight: 360, overflow: "auto" }}>{code}</pre>
          <div className="flex gap-2" style={{ marginTop: 8 }}>
            <button type="button" className="m-btn m-btn--ghost" onClick={() => void navigator.clipboard?.writeText(code)}>COPY</button>
            {path === "project" ? <Tag tone="ghost">PATCH /v1/projects/:id</Tag> : null}
          </div>
        </Card>
      </div>
      <div style={{ display: "grid", gap: 12, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }} aria-label="Preview">
        <LykiaProvider transport={transport} brand={brand} modules={c.modules} assistantName={c.assistantName} environment="testnet">
          {shown.length === 0 ? <p className="m-small m-muted">Turn on a module to preview it.</p> : shown.map((m) => <div key={m}>{PREVIEW[m]?.()}</div>)}
        </LykiaProvider>
      </div>
    </div>
  );
}
