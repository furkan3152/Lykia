/** Project management: white-label settings, origin proofs, browser keys and usage. */
import { MAX_INTEGRATOR_FEE_BPS, PROJECT_MODULES, type Project, type ProjectModule } from "@lykia/core";
import type { ApiKeyView, CreatedApiKey } from "@lykia/core/api/platform";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiDelete, apiFetch, apiGet, apiPost, describeError } from "../../lib/api";
import { Button, Card, EmptyState, Field, Input, Select, Skeleton, Tag, toast } from "../../mosaic";

interface Challenge {
  readonly origin: string;
  readonly dns: { readonly name: string; readonly value: string };
  readonly wellKnown: { readonly url: string; readonly body: string };
}

interface Usage {
  readonly today: { readonly requests: number; readonly plans: number };
  readonly last7Days: readonly { readonly day: string; readonly requests: number; readonly plans: number }[];
}

const fail = (e: unknown) => toast.error(describeError(e), { from: "LYKO" });

export function Projects({ enabled, onPreview }: { readonly enabled: boolean; readonly onPreview: (p: Project) => void }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["projects"], enabled, queryFn: ({ signal }) => apiGet<{ projects: Project[] }>("/v1/projects", { signal }) });
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const create = useMutation({
    mutationFn: () => apiPost<Project>("/v1/projects", { name, origins: origin ? [origin] : [] }),
    onSuccess: (p) => {
      setSelected(p.id);
      setName("");
      setOrigin("");
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: fail,
  });
  const projects = list.data?.projects ?? [];
  const current = projects.find((p) => p.id === selected) ?? projects[0] ?? null;
  if (!enabled) return <EmptyState title="Sign in first">Projects belong to your developer wallet.</EmptyState>;
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="m-grid-2" style={{ alignItems: "start" }}>
        <Card title="Projects" kicker="WHITE-LABEL LYKIA">
          {list.isLoading ? <Skeleton h={80} /> : projects.length === 0 ? <p className="m-small m-muted">No projects yet. A project carries your brand, origins, modules, Fence caps and app fee.</p> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {projects.map((p) => (
                <li key={p.id} className="m-row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className={`m-btn ${current?.id === p.id ? "m-btn--sea" : "m-btn--ghost"}`} onClick={() => setSelected(p.id)}>{p.name}</button>
                  <span className="num m-small">{p.id}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="New project" kicker="NAME · FIRST ORIGIN" footer={<Button disabled={!name || create.isPending} onClick={() => create.mutate()}>CREATE</Button>}>
          <div style={{ display: "grid", gap: 10 }}>
            <Field label="Name"><Input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Acme Pay" /></Field>
            <Field label="Origin" hint="Exact origin, https (http://localhost is fine for development)."><Input value={origin} onChange={(e) => setOrigin(e.target.value.trim())} placeholder="https://app.example.com" /></Field>
          </div>
        </Card>
      </div>
      {current ? <ProjectEditor key={current.id} project={current} onPreview={onPreview} /> : null}
    </div>
  );
}

function ProjectEditor({ project, onPreview }: { readonly project: Project; readonly onPreview: (p: Project) => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({
    name: project.name,
    network: project.network,
    modules: project.modules as readonly ProjectModule[],
    feeBps: String(project.fee.bps),
    feeTo: project.fee.recipient ?? "",
    perStep: project.fence.caps.perStepUsd ?? "",
    daily: project.fence.caps.dailyUsd ?? "",
    template: project.fence.template,
    webhookUrl: project.webhookUrl ?? "",
    prompt: project.prompt,
    assistant: project.brand.assistant?.name ?? "",
    origins: project.origins.map((o) => o.origin).join("\n"),
  });
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [key, setKey] = useState<CreatedApiKey | null>(null);
  const keys = useQuery({ queryKey: ["project-keys", project.id], queryFn: ({ signal }) => apiGet<{ keys: ApiKeyView[] }>(`/v1/projects/${project.id}/keys`, { signal }) });
  const usage = useQuery({ queryKey: ["project-usage", project.id], queryFn: ({ signal }) => apiGet<Usage>(`/v1/projects/${project.id}/usage`, { signal }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["projects"] });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<Project>(`/v1/projects/${project.id}`, {
        method: "PATCH",
        body: {
          name: draft.name,
          network: draft.network,
          modules: draft.modules,
          fee: { bps: Number(draft.feeBps) || 0, recipient: draft.feeTo || null },
          fence: { template: draft.template, caps: { ...(draft.perStep ? { perStepUsd: draft.perStep } : {}), ...(draft.daily ? { dailyUsd: draft.daily } : {}) } },
          webhookUrl: draft.webhookUrl || null,
          prompt: draft.prompt,
          origins: draft.origins.split(/\s+/u).filter(Boolean),
          brand: { ...project.brand, ...(draft.assistant ? { mascot: "custom", assistant: { ...(project.brand.assistant ?? {}), name: draft.assistant } } : { mascot: project.brand.mascot === "custom" ? "lyko" : project.brand.mascot }) },
        },
      }),
    onSuccess: () => {
      toast.success("Project saved", { from: "LYKO" });
      refresh();
    },
    onError: fail,
  });
  const ask = async (origin: string) => {
    try {
      setChallenge(await apiPost<Challenge>(`/v1/projects/${project.id}/origins/challenge`, { origin }));
    } catch (e) {
      fail(e);
    }
  };
  const verify = async (origin: string, method: "dns" | "well-known") => {
    try {
      await apiPost(`/v1/projects/${project.id}/origins/verify`, { origin, method });
      toast.success(`${origin} verified`, { from: "LYKO" });
      setChallenge(null);
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const issue = async () => {
    try {
      setKey(await apiPost<CreatedApiKey>(`/v1/projects/${project.id}/keys`, { label: "browser" }));
      void qc.invalidateQueries({ queryKey: ["project-keys", project.id] });
    } catch (e) {
      fail(e);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${project.name}? Its browser keys stop working at once.`)) return;
    try {
      await apiDelete(`/v1/projects/${project.id}`);
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const toggle = (m: ProjectModule) => setDraft((d) => ({ ...d, modules: d.modules.includes(m) ? d.modules.filter((x) => x !== m) : [...d.modules, m] }));
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="m-grid-2" style={{ alignItems: "start" }}>
        <Card title={project.name} kicker={project.id} footer={<div className="flex flex-wrap gap-2"><Button disabled={save.isPending} onClick={() => save.mutate()}>SAVE</Button><Button tone="sea" onClick={() => onPreview(project)}>OPEN IN PLAYGROUND</Button><Button tone="ghost" onClick={() => void remove()}>DELETE</Button></div>}>
          <div className="m-grid-2" style={{ gap: 10 }}>
            <Field label="Name"><Input value={draft.name} maxLength={64} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Network"><Select value={draft.network} onChange={(e) => setDraft({ ...draft, network: e.target.value as Project["network"] })}><option value="testnet">testnet</option><option value="mainnet">mainnet</option></Select></Field>
            <Field label="Assistant name" hint="Empty keeps Lyko."><Input value={draft.assistant} maxLength={32} onChange={(e) => setDraft({ ...draft, assistant: e.target.value })} /></Field>
            <Field label="Default Fence"><Select value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value as Project["fence"]["template"] })}>{["lamb", "shepherd", "treasury", "caravan"].map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
            <Field label="Hard cap per step (USD)" hint="Only ever tightens a user's Fence."><Input value={draft.perStep} inputMode="decimal" onChange={(e) => setDraft({ ...draft, perStep: e.target.value.trim() })} placeholder="No cap" /></Field>
            <Field label="Hard cap per day (USD)"><Input value={draft.daily} inputMode="decimal" onChange={(e) => setDraft({ ...draft, daily: e.target.value.trim() })} placeholder="No cap" /></Field>
            <Field label={`App fee (bps, max ${MAX_INTEGRATOR_FEE_BPS})`} hint="On top of Lykia's fee, paid to your address in the same transaction."><Input value={draft.feeBps} inputMode="numeric" onChange={(e) => setDraft({ ...draft, feeBps: e.target.value.trim() })} /></Field>
            <Field label="Fee recipient"><Input value={draft.feeTo} placeholder="0x…" onChange={(e) => setDraft({ ...draft, feeTo: e.target.value.trim() })} /></Field>
            <Field label="Webhook URL"><Input value={draft.webhookUrl} placeholder="https://example.com/lykia" onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value.trim() })} /></Field>
          </div>
          <p className="m-small m-muted" style={{ marginTop: 10 }}>Modules</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Modules">
            {PROJECT_MODULES.map((m) => <button key={m} type="button" className={`m-btn ${draft.modules.includes(m) ? "m-btn--sea" : "m-btn--ghost"}`} style={{ padding: "4px 10px", fontSize: 12 }} aria-pressed={draft.modules.includes(m)} onClick={() => toggle(m)}>{m}</button>)}
          </div>
          <Field label="Assistant context" hint="Tone and facts about your app. Lines that try to change the assistant's rules, the Fence or confirmations are removed.">
            <textarea className="m-textarea" rows={3} maxLength={1200} value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} style={{ width: "100%" }} />
          </Field>
        </Card>
        <div style={{ display: "grid", gap: 16, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <Card title="Origins" kicker="DNS TXT · /.well-known">
            <Field label="Origins (one per line)"><textarea className="m-textarea" rows={3} value={draft.origins} onChange={(e) => setDraft({ ...draft, origins: e.target.value })} style={{ width: "100%" }} /></Field>
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 6 }}>
              {project.origins.map((o) => (
                <li key={o.origin} className="m-row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span className="num m-small" style={{ overflowWrap: "anywhere" }}>{o.origin}</span>
                  {o.verified ? <Tag tone="ok">VERIFIED · {o.method?.toUpperCase()}</Tag> : <Button size="sm" tone="sea" onClick={() => void ask(o.origin)}>PROVE</Button>}
                </li>
              ))}
            </ul>
            {challenge ? (
              <div className="m-note" style={{ marginTop: 10, display: "grid", gap: 6 }}>
                <span className="m-small">Add a TXT record <code className="num">{challenge.dns.name}</code> with <code className="num" style={{ overflowWrap: "anywhere" }}>{challenge.dns.value}</code>, or serve that line at <code className="num" style={{ overflowWrap: "anywhere" }}>{challenge.wellKnown.url}</code>.</span>
                <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void verify(challenge.origin, "dns")}>CHECK DNS</Button><Button size="sm" tone="sea" onClick={() => void verify(challenge.origin, "well-known")}>CHECK FILE</Button></div>
              </div>
            ) : null}
          </Card>
          <Card title="Browser keys" kicker="BOUND TO VERIFIED ORIGINS" footer={<Button disabled={!project.origins.some((o) => o.verified)} onClick={() => void issue()}>ISSUE KEY</Button>}>
            {(keys.data?.keys ?? []).length === 0 ? <p className="m-small m-muted">No keys yet.</p> : (keys.data?.keys ?? []).map((k) => <div key={k.id} className="m-row" style={{ justifyContent: "space-between", gap: 8 }}><span className="num m-small">{k.prefix}</span>{k.revokedAt ? <Tag tone="bad">REVOKED</Tag> : <Tag tone="sea">read · plan</Tag>}</div>)}
            {key ? <div className="m-note" style={{ marginTop: 10 }}><b>Shown once:</b> <code className="num" style={{ overflowWrap: "anywhere" }}>{key.secret}</code></div> : null}
          </Card>
          <Card title="Usage" kicker="TODAY · 7 DAYS">
            {usage.data ? (
              <>
                <p className="m-small">Requests <b className="num">{usage.data.today.requests}</b> · plans <b className="num">{usage.data.today.plans}</b></p>
                <div className="flex gap-1" style={{ alignItems: "flex-end", height: 48, marginTop: 8 }} aria-label="Requests per day">
                  {usage.data.last7Days.map((d) => {
                    const max = Math.max(1, ...usage.data.last7Days.map((x) => x.requests));
                    return <span key={d.day} title={`${d.day}: ${d.requests} requests, ${d.plans} plans`} style={{ flex: 1, height: `${Math.max(4, (d.requests / max) * 48)}px`, background: "var(--sea)" }} />;
                  })}
                </div>
              </>
            ) : <Skeleton h={48} />}
          </Card>
        </div>
      </div>
    </div>
  );
}
