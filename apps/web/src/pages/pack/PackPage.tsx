/**
 * The Pack: Lyko's kennel. Agents and their pups (sub-agents) with collar
 * colours by role, budgets as bones, spawn-a-pup with Fence inheritance,
 * cascading revoke, and the on-chain LykiaAccount session.
 */
import { PACK_ROLES, ROLE_TEMPLATES, type PackRole } from "@lykia/core";
import type { PackAgentView, SessionTxResponse, SpawnRejected } from "@lykia/core/api/agents";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, useSendTransaction } from "wagmi";

import { navigate } from "../../app/routes/history";
import { useRouteParam } from "../../app/routes/useRoute";
import { groupViolations, validateWizard, wizardFence, type WizardInput } from "../../features/pack/wizard";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { useSiwe } from "../../features/session/useSiwe";
import { ApiError, apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLang } from "../../lib/i18n";
import { useLykiaStore } from "../../lib/lykiaStore";
import { availabilityOf } from "../../lib/optional";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, EmptyState, Field, Input, Modal, PageHead, PupIcon, Select, Skeleton, toast } from "../../mosaic";
import { kennel, KENNEL_H, KENNEL_W } from "../../mosaic/scenes";

const ROLE_LABEL = (role: PackRole, lang: "en" | "tr") => (role === "custom" || role === "orchestrator" ? (role === "custom" ? (lang === "tr" ? "Özel" : "Custom") : "Lyko") : ROLE_TEMPLATES[role].title[lang]);

function Bones({ used, cap }: { used: number; cap: number | null }) {
  const n = 10;
  const filled = cap && cap > 0 ? Math.min(n, Math.round((used / cap) * n)) : 0;
  return (
    <span className="m-bones" aria-label={cap ? `$${used} of $${cap}` : "no cap"}>
      {Array.from({ length: n }, (_, i) => <i key={i} data-f={i < filled} />)}
    </span>
  );
}

const SAMPLE_PUPS = (["treasurer", "payroll", "fx-hedger", "sentinel", "yield-keeper", "bill-payer"] as const).map((role) => ({ role, status: "active", depth: 1 }));

const EMPTY_WIZ: WizardInput = { name: "", role: "treasurer", perIntentUsd: "", dailyUsd: "", weeklyUsd: "", mission: "" };

export default function PackPage() {
  const lang = useLang();
  const environment = useEnvironment();
  const { address } = useAccount();
  const siwe = useSiwe();
  const lit = useLamp();
  const night = useLykiaStore((s) => s.fence.mode === "whistle");
  const selectedId = useRouteParam("id") ?? null;
  const qc = useQueryClient();
  const { sendTransactionAsync } = useSendTransaction();
  const [wizard, setWizard] = useState<{ parent: PackAgentView | null } | null>(null);
  const [form, setForm] = useState<WizardInput>(EMPTY_WIZ);
  const [violations, setViolations] = useState<Record<string, string[]>>({});
  const [account, setAccount] = useState("");

  const tree = useQuery({
    queryKey: ["pack", address, environment],
    enabled: Boolean(address),
    queryFn: ({ signal }) => apiGet<{ agents: PackAgentView[] }>("/v1/pack", { query: { owner: address, environment }, signal }),
  });
  const agents = tree.data?.agents ?? [];
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0] ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["pack"] });

  const create = useMutation({
    mutationFn: async () => {
      const issues = validateWizard(form, wizard?.parent?.budget.free);
      if (issues.length) throw new Error(issues.map((i) => i.message).join(" "));
      const fence = wizardFence(form);
      const body = { name: form.name.trim(), role: form.role, ...(fence ? { fence } : {}), ...(form.mission ? { mission: form.mission } : {}) };
      return wizard?.parent ? apiPost<PackAgentView>(`/v1/pack/${wizard.parent.id}/spawn`, body) : apiPost<PackAgentView>("/v1/pack", { owner: address, environment, ...body });
    },
    onSuccess: (agent) => {
      toast.success(lang === "tr" ? "Yeni yavru sürüde" : "A new pup joined the pack", { description: agent.name, from: "LYKO" });
      setWizard(null);
      setForm(EMPTY_WIZ);
      setViolations({});
      void refresh();
      navigate(`/app/pack/${agent.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details && typeof e.details === "object" && "violations" in (e.details as object)) setViolations(groupViolations((e.details as unknown as SpawnRejected).violations));
      else toast.error(lang === "tr" ? "Yavru eklenemedi" : "Could not spawn", { description: describeError(e), from: "LYKO" });
    },
  });

  const act = async (path: string, done: string) => {
    try {
      await apiPost(path, {});
      toast.success(done, { from: "LYKO" });
      void refresh();
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };

  const bindSession = async () => {
    if (!selected) return;
    try {
      const r = await apiPost<SessionTxResponse>(`/v1/pack/${selected.id}/session-tx`, { account, validDays: 30 });
      if (!r.transaction) return toast.info(r.note, { from: "LYKO" });
      const hash = await sendTransactionAsync({ to: r.transaction.to, data: r.transaction.data, value: BigInt(r.transaction.value), chainId: r.transaction.chainId });
      toast.success(lang === "tr" ? "Oturum işlemi gönderildi" : "Session transaction sent", { description: hash, from: "LYKO" });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };

  const provision = async (agentId: string) => {
    try {
      const r = await apiPost<{ address?: string; walletId?: string; note?: string }>("/v1/circle/agent-wallets", { owner: address, environment, agentId });
      toast.success(lang === "tr" ? "Agent cüzdanı hazır" : "Agent wallet ready", { description: r.address ?? r.note ?? r.walletId, from: "LYKO" });
      void refresh();
    } catch (e) {
      toast.error(availabilityOf(e) === "soon" ? (lang === "tr" ? "Circle agent cüzdanları yakında" : "Circle agent wallets are coming soon") : availabilityOf(e) === "needs-key" ? (lang === "tr" ? "Sunucuda Circle anahtarı gerekli" : "The server needs a Circle key") : describeError(e), { from: "LYKO" });
    }
  };

  const depthOf = (a: PackAgentView) => a.depth;
  const ordered = [...agents].sort((a, b) => (a.parentId === b.parentId ? a.createdAt.localeCompare(b.createdAt) : depthOf(a) - depthOf(b)));

  return (
    <div>
      <PageHead kicker={lang === "tr" ? "SÜRÜ KÖPEKLERİ · ALT AGENT'LAR" : "THE PACK · SUB-AGENTS"} title={lang === "tr" ? <>Lyko'nun <em>yavruları.</em></> : <>Lyko's <em>pups.</em></>} sub={lang === "tr" ? "Her agent'ın bir rolü ve bir Çit'i var. Yavrunun Çit'i ebeveyninin içinde kalır, bütçesi ebeveynden dilimlenir; ebeveyni iptal edersen yavruları da düşer." : "Every agent has a role and a Fence. A pup's Fence stays inside its parent's, its budget is carved from the parent's, and revoking a parent revokes its pups."} mood="proud" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame
          build={(t) => kennel({ pups: agents.length ? agents.filter((a) => a.role !== "orchestrator").map((a) => ({ role: a.role, status: a.status, depth: a.depth })) : SAMPLE_PUPS, lit, night }, t)}
          width={KENNEL_W}
          height={KENNEL_H}
          dataKey={`${agents.map((a) => a.id + a.status).join()}-${lit}-${night}`}
          assembleKey="kennel"
          night={night}
          label="The kennel: Lyko and his pups, collars coloured by role"
          labels={[{ x: 50, y: 6, text: agents.length ? (lang === "tr" ? `${agents.length} AGENT · ${environment.toUpperCase()}` : `${agents.length} AGENTS · ${environment.toUpperCase()}`) : lang === "tr" ? "ÖRNEK SÜRÜ · CÜZDAN BAĞLA" : "SAMPLE PACK · CONNECT TO SEE YOURS", tone: agents.length ? undefined : "ghost" }]}
        />
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {!address ? (
          <Card title={lang === "tr" ? "Önce cüzdan" : "Wallet first"}><EmptyState mood="sleeping" title={lang === "tr" ? "Kulübe kapalı" : "The kennel is closed"}>{lang === "tr" ? "Sürünü görmek için cüzdan bağla." : "Connect a wallet to see your pack."}</EmptyState></Card>
        ) : (
          <div className="m-grid-2 m-grid-2--r">
            <Card title={lang === "tr" ? "Ağaç" : "The tree"} kicker={siwe.signedIn ? (lang === "tr" ? "GİRİŞ YAPILDI · DEĞİŞTİREBİLİRSİN" : "SIGNED IN · YOU CAN CHANGE IT") : lang === "tr" ? "DEĞİŞİKLİK İÇİN GİRİŞ YAP" : "SIGN IN TO CHANGE IT"} footer={siwe.signedIn ? <Button tone="sea" onClick={() => setWizard({ parent: null })}>{lang === "tr" ? "+ KÖK AGENT" : "+ ROOT AGENT"}</Button> : <Button onClick={() => void siwe.signIn()} disabled={siwe.busy}>{lang === "tr" ? "ARC İLE GİRİŞ" : "SIGN IN ON ARC"}</Button>}>
              {tree.isLoading ? <Skeleton h={180} /> : agents.length === 0 ? <EmptyState mood="happy" title={lang === "tr" ? "Henüz yavru yok" : "No pups yet"}>{lang === "tr" ? "İlk agent'ını bir rolle başlat: hazinedar, maaş, FX, getiri, fatura, sentinel ya da araştırmacı." : "Start your first agent with a role: treasurer, payroll, FX hedger, yield keeper, bill payer, sentinel or researcher."}</EmptyState> : (
                <div>
                  {ordered.map((a) => (
                    <button key={a.id} type="button" className="m-thread" aria-current={selected?.id === a.id} style={{ paddingLeft: 10 + a.depth * 22, display: "flex", gap: 10, alignItems: "center", opacity: a.status === "revoked" ? 0.45 : 1 }} onClick={() => navigate(`/app/pack/${a.id}`)}>
                      <PupIcon role={a.role} scale={2} />
                      <span style={{ flex: 1 }}>
                        <b>{a.name}</b>
                        <small>{ROLE_LABEL(a.role, lang)} · {a.status}</small>
                      </span>
                      <Bones used={Number(a.budget.spent.dayUsd)} cap={a.budget.caps.dailyUsd ? Number(a.budget.caps.dailyUsd) : null} />
                    </button>
                  ))}
                </div>
              )}
            </Card>
            <Card title={selected ? selected.name : lang === "tr" ? "Bir agent seç" : "Pick an agent"} kicker={selected ? `${ROLE_LABEL(selected.role, lang).toUpperCase()} · ${selected.status.toUpperCase()} · DEPTH ${selected.depth}` : ""}>
              {selected ? (
                <div style={{ display: "grid", gap: 14 }}>
                  <dl className="m-kv">
                    <dt>Fence</dt><dd>{selected.fence.label ?? "custom"} · {selected.fenceHash.slice(0, 18)}…</dd>
                    <dt>{lang === "tr" ? "Günlük" : "Daily"}</dt><dd>${selected.budget.spent.dayUsd} / {selected.budget.caps.dailyUsd ? `$${selected.budget.caps.dailyUsd}` : "—"}</dd>
                    <dt>{lang === "tr" ? "Haftalık" : "Weekly"}</dt><dd>${selected.budget.spent.weekUsd} / {selected.budget.caps.weeklyUsd ? `$${selected.budget.caps.weeklyUsd}` : "—"}</dd>
                    <dt>{lang === "tr" ? "Boşta" : "Free to carve"}</dt><dd>{selected.budget.free.dailyUsd ? `$${selected.budget.free.dailyUsd}/day` : "—"}</dd>
                    <dt>{lang === "tr" ? "Yetenekler" : "Capabilities"}</dt><dd>{selected.capabilities.join(", ")}</dd>
                    <dt>{lang === "tr" ? "Oturum" : "Session"}</dt><dd>{selected.session ? `${selected.session.account.slice(0, 8)}… · ${selected.session.sessionId.slice(0, 10)}…` : lang === "tr" ? "zincirde yok" : "not on chain"}</dd>
                  </dl>
                  {selected.mission ? <p className="m-note">{selected.mission}</p> : null}
                  {siwe.signedIn && selected.status !== "revoked" ? (
                    <div className="flex gap-2 flex-wrap justify-center">
                      {selected.capabilities.includes("spawn") || selected.depth < 3 ? <Button tone="sea" size="sm" onClick={() => setWizard({ parent: selected })}>{lang === "tr" ? "YAVRU EKLE" : "SPAWN A PUP"}</Button> : null}
                      <Button tone="ghost" size="sm" onClick={() => void act(`/v1/pack/${selected.id}/${selected.status === "paused" ? "resume" : "pause"}`, selected.status === "paused" ? "Resumed" : "Paused")}>{selected.status === "paused" ? (lang === "tr" ? "DEVAM" : "RESUME") : lang === "tr" ? "DURAKLAT" : "PAUSE"}</Button>
                      <Button tone="navy" size="sm" onClick={() => { if (window.confirm(lang === "tr" ? "Bu agent ve tüm yavruları iptal edilsin mi?" : "Revoke this agent and every pup under it?")) void act(`/v1/pack/${selected.id}/revoke`, lang === "tr" ? "İptal edildi (yavrularıyla)" : "Revoked, with its pups"); }}>{lang === "tr" ? "İPTAL" : "REVOKE"}</Button>
                      <Button tone="ochre" size="sm" onClick={() => navigate(`/app/kunye${selected.agentId ? `/${selected.agentId}` : ""}`)}>KÜNYE</Button>
                      <Button tone="sea" size="sm" onClick={() => void provision(selected.id)}>{lang === "tr" ? "CIRCLE CÜZDANI" : "CIRCLE WALLET"}</Button>
                    </div>
                  ) : null}
                  {siwe.signedIn && selected.status === "active" ? (
                    <form className="m-frame m-frame--thin" style={{ padding: 12, display: "grid", gap: 8 }} onSubmit={(e) => { e.preventDefault(); void bindSession(); }}>
                      <span className="m-kick">{lang === "tr" ? "ZİNCİRE BAĞLA · LYKIAACCOUNT OTURUMU" : "BIND ON CHAIN · LYKIAACCOUNT SESSION"}</span>
                      <Input placeholder={lang === "tr" ? "LykiaAccount adresin 0x…" : "Your LykiaAccount 0x…"} value={account} onChange={(e) => setAccount(e.target.value)} />
                      <Button type="submit" size="sm" disabled={!/^0x[0-9a-fA-F]{40}$/u.test(account)}>{lang === "tr" ? "OTURUM İŞLEMİNİ İMZALA" : "SIGN THE SESSION TX"}</Button>
                    </form>
                  ) : null}
                </div>
              ) : <EmptyState title={lang === "tr" ? "Sol taraftan seç" : "Choose on the left"} />}
            </Card>
          </div>
        )}
      </section>
      <Modal open={wizard !== null} onClose={() => setWizard(null)} title={wizard?.parent ? (lang === "tr" ? `${wizard.parent.name} için yavru` : `A pup for ${wizard.parent.name}`) : lang === "tr" ? "Kök agent" : "A root agent"}>
        <form style={{ display: "grid", gap: 12 }} onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label={lang === "tr" ? "Ad" : "Name"} error={validateWizard(form).find((i) => i.field === "name" && form.name)?.message ?? violations.name?.join(" ")}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Payroll" />
          </Field>
          <Field label={lang === "tr" ? "Rol" : "Role"} hint={form.role !== "custom" && form.role !== "orchestrator" ? ROLE_TEMPLATES[form.role].summary : undefined}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as PackRole })}>
              {PACK_ROLES.filter((r) => r !== "orchestrator").map((r) => <option key={r} value={r}>{ROLE_LABEL(r, lang)}</option>)}
            </Select>
          </Field>
          <div className="m-grid-3" style={{ gap: 10 }}>
            {(["perIntentUsd", "dailyUsd", "weeklyUsd"] as const).map((k) => (
              <Field key={k} label={k === "perIntentUsd" ? (lang === "tr" ? "İşlem başı $" : "Per intent $") : k === "dailyUsd" ? (lang === "tr" ? "Günlük $" : "Daily $") : lang === "tr" ? "Haftalık $" : "Weekly $"} error={validateWizard(form, wizard?.parent?.budget.free).find((i) => i.field === k)?.message ?? violations[k]?.join(" ")} hint={wizard?.parent?.budget.free[k] ? `free $${wizard.parent.budget.free[k]}` : undefined}>
                <Input inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder="—" />
              </Field>
            ))}
          </div>
          <Field label={lang === "tr" ? "Görev" : "Mission"}>
            <textarea className="m-textarea" value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })} placeholder={lang === "tr" ? "Her cuma 6 kişiye maaş öde." : "Pay six people every Friday."} />
          </Field>
          {Object.entries(violations).filter(([k]) => !["name", "perIntentUsd", "dailyUsd", "weeklyUsd"].includes(k)).map(([k, v]) => <p key={k} className="m-note m-note--bad"><b className="mono">{k}</b> {v.join(" ")}</p>)}
          <div className="flex justify-center gap-2">
            <Button tone="ghost" onClick={() => setWizard(null)}>{lang === "tr" ? "VAZGEÇ" : "CANCEL"}</Button>
            <Button type="submit" tone="sea" disabled={create.isPending}>{lang === "tr" ? "YAVRUYU EKLE" : "SPAWN IT"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
