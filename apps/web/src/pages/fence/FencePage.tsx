/**
 * The Fence editor. Post height is a cap, gates are allowed venues, a wolf
 * waits outside when strangers are refused, and the Whistle turns the
 * scene to night. Validation, hash and loosening warnings run in the
 * browser with @lykia/core: the same code the API runs.
 */
import { DEFAULT_FENCE, FENCE_TEMPLATES, fenceHash, loosenedRules, validateFence, WEEKDAYS, type FenceMode, type FenceTemplateKey, type RecipientMode, type ScentRequirement, type Weekday } from "@lykia/core";
import { useMemo, useState } from "react";

import { fenceToForm, formToFence, type FenceForm } from "../../features/fence/form";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { useLang } from "../../lib/i18n";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useLamp } from "../../lib/pulseStore";
import { runCommand } from "../../lib/runCommand";
import { Button, Card, Field, Input, PageHead, Select, Tag, Toggle, toast } from "../../mosaic";
import { fenceScene, FENCE_H, FENCE_W } from "../../mosaic/scenes";

const TEMPLATE_NAMES: Record<FenceTemplateKey, { en: string; tr: string }> = { lamb: { en: "Lamb", tr: "Kuzu" }, shepherd: { en: "Shepherd", tr: "Çoban" }, treasury: { en: "Treasury", tr: "Hazine" }, caravan: { en: "Caravan", tr: "Kervan" } };

export default function FencePage() {
  const lang = useLang();
  const saved = useLykiaStore((s) => s.fence);
  const setFence = useLykiaStore((s) => s.setFence);
  const lit = useLamp();
  const [form, setForm] = useState<FenceForm>(() => fenceToForm(saved));
  const set = <K extends keyof FenceForm>(k: K, v: FenceForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const draft = useMemo(() => formToFence(form, saved), [form, saved]);
  const validation = validateFence(draft);
  const hash = validation.ok ? fenceHash(draft) : null;
  const loosened = validation.ok ? loosenedRules(saved, draft) : [];
  const whistle = form.mode === "whistle";
  const caps = [
    { label: "STEP", usd: form.perStepUsd ? Number(form.perStepUsd) : null },
    { label: "INTENT", usd: form.perIntentUsd ? Number(form.perIntentUsd) : null },
    { label: "DAY", usd: form.dailyUsd ? Number(form.dailyUsd) : null },
    { label: "WEEK", usd: form.weeklyUsd ? Number(form.weeklyUsd) : null },
  ];
  const gates = form.venues.split(/[\s,]+/u).filter(Boolean).length;
  const issueFor = (path: string) => (validation.ok ? null : validation.issues.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message ?? null);

  const save = () => {
    if (!validation.ok) return;
    setFence(draft);
    toast.success(lang === "tr" ? "Çit kaydedildi" : "Fence saved", { description: hash ?? undefined, from: "LYKO" });
  };

  return (
    <div>
      <PageHead kicker={lang === "tr" ? "ÇİT · AGENT'LARIN KURALLARI" : "THE FENCE · RULES AROUND YOUR AGENTS"} title={lang === "tr" ? <>Çitini <em>kur.</em></> : <>Build your <em>fence.</em></>} sub={lang === "tr" ? "Direk boyu limittir, kapılar izinli venue'lar. Bilgi eksikse Çit reddeder; Düdük yeni riski durdurur, eve dönüş her zaman geçer." : "Post height is a cap, gates are allowed venues. Missing facts deny; the Whistle stops new risk while moves home always pass."} mood={whistle ? "resting" : "watching"}>
        <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 18 }}>
          {(Object.keys(FENCE_TEMPLATES) as FenceTemplateKey[]).map((k) => (
            <Button key={k} tone="ghost" size="sm" onClick={() => setForm(fenceToForm(FENCE_TEMPLATES[k]))}>
              {TEMPLATE_NAMES[k][lang]}
            </Button>
          ))}
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame
          build={(t) => fenceScene({ caps, gates, whistle, strangers: form.recipients === "any", lit }, t)}
          width={FENCE_W}
          height={FENCE_H}
          dataKey={JSON.stringify([caps, gates, whistle, form.recipients, lit])}
          assembleKey="fence"
          night={whistle}
          label="The fence: post heights are your caps, gates are allowed venues"
          labels={[...caps.map((c, i) => ({ x: 13 + (i / 3) * 68, y: 88, text: `${c.label} ${c.usd === null ? "—" : `$${c.usd.toLocaleString("en-US")}`}`, tone: "ochre" as const })), { x: 50, y: 4, text: whistle ? (lang === "tr" ? "DÜDÜK ÇALINDI" : "WHISTLE BLOWN") : `${(form.label || "CUSTOM").toUpperCase()} · ${form.mode.toUpperCase()}`, tone: whistle ? ("wolf" as const) : undefined }]}
        />
        <div className="flex justify-center gap-3 flex-wrap" style={{ marginTop: 16 }}>
          <Button tone={whistle ? "ochre" : "navy"} size="lg" onClick={() => { runCommand(whistle ? "release" : "whistle"); setForm((f) => ({ ...f, mode: whistle ? "live" : "whistle" })); }}>
            {whistle ? (lang === "tr" ? "THAT'LL DO · DÜDÜĞÜ BIRAK" : "THAT'LL DO · RELEASE") : lang === "tr" ? "LIE DOWN · DÜDÜĞÜ ÇAL" : "LIE DOWN · BLOW THE WHISTLE"}
          </Button>
        </div>
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-3">
          <Card title={lang === "tr" ? "Limitler" : "Caps"} kicker="USD · EMPTY = NO RULE">
            <div style={{ display: "grid", gap: 10 }}>
              {(["perStepUsd", "perIntentUsd", "dailyUsd", "weeklyUsd", "confirmAboveUsd"] as const).map((k) => (
                <Field key={k} label={{ perStepUsd: lang === "tr" ? "Adım başı" : "Per step", perIntentUsd: lang === "tr" ? "Plan başı" : "Per intent", dailyUsd: lang === "tr" ? "Günlük" : "Per day", weeklyUsd: lang === "tr" ? "Haftalık" : "Per week", confirmAboveUsd: lang === "tr" ? "Şunun üstünde onay" : "Confirm above" }[k]} error={issueFor(k === "confirmAboveUsd" ? "confirm.aboveUsd" : `caps.${k}`)}>
                  <Input inputMode="decimal" value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder="—" />
                </Field>
              ))}
            </div>
          </Card>
          <Card title={lang === "tr" ? "Risk" : "Risk"} kicker="SLIPPAGE · HEALTH · FX · SCENT">
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={lang === "tr" ? "Maks. kayma (bps)" : "Max slippage (bps)"} error={issueFor("limits.maxSlippageBps")}><Input inputMode="numeric" value={form.maxSlippageBps} onChange={(e) => set("maxSlippageBps", e.target.value)} /></Field>
              <Field label={lang === "tr" ? "Min. sağlık faktörü" : "Min health factor"} error={issueFor("lending.minHealthFactor")}><Input inputMode="decimal" value={form.minHealthFactor} onChange={(e) => set("minHealthFactor", e.target.value)} placeholder="1.5" /></Field>
              <Field label={lang === "tr" ? "FX bandı (bps)" : "FX band (bps)"} error={issueFor("fx.maxDeviationBps")}><Input inputMode="numeric" value={form.fxBandBps} onChange={(e) => set("fxBandBps", e.target.value)} /></Field>
              <Field label="Scent">
                <Select value={form.scent} onChange={(e) => set("scent", e.target.value as ScentRequirement)}>
                  <option value="verified">verified only</option>
                  <option value="no-red-flags">no red flags</option>
                  <option value="off">off</option>
                </Select>
              </Field>
              <Field label={lang === "tr" ? "Kayıt dışı token" : "Unlisted tokens"}>
                <Toggle light label="Unlisted" value={form.unlisted} onChange={(v) => set("unlisted", v)} options={[{ value: "deny", label: "DENY" }, { value: "allow", label: "ALLOW" }]} />
              </Field>
            </div>
          </Card>
          <Card title={lang === "tr" ? "Kim, nereye, ne zaman" : "Who, where, when"} kicker="RECIPIENTS · VENUES · HOURS">
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={lang === "tr" ? "Mod" : "Mode"}>
                <Toggle light label="Mode" value={form.mode} onChange={(v: FenceMode) => set("mode", v)} options={[{ value: "live", label: "LIVE" }, { value: "dry-run", label: "DRY RUN" }, { value: "whistle", label: "WHISTLE" }]} />
              </Field>
              <Field label={lang === "tr" ? "Alıcılar" : "Recipients"}>
                <Toggle light label="Recipients" value={form.recipients} onChange={(v: RecipientMode) => set("recipients", v)} options={[{ value: "own", label: "OWN" }, { value: "allowlist", label: "ALLOWLIST" }, { value: "any", label: "ANY" }]} />
              </Field>
              {form.recipients !== "own" ? <Field label="Allowlist" error={issueFor("recipients.allow")}><textarea className="m-textarea" value={form.allowlist} onChange={(e) => set("allowlist", e.target.value)} placeholder="0x… one per line" /></Field> : null}
              <Field label={lang === "tr" ? "İzinli venue'lar (kapılar)" : "Allowed venues (gates)"} hint="morpho-vaults, uniswap-v3, cctp…" error={issueFor("venues")}><Input value={form.venues} onChange={(e) => set("venues", e.target.value)} /></Field>
              <Field label={lang === "tr" ? "İmzacılar" : "Signers"}>
                <div className="flex gap-3">
                  {(["wallet", "agent"] as const).map((s) => (
                    <label key={s} className="flex gap-1 items-center m-small"><input type="checkbox" checked={form.signers.includes(s)} onChange={(e) => set("signers", e.target.checked ? [...form.signers, s] : form.signers.filter((x) => x !== s))} />{s}</label>
                  ))}
                </div>
              </Field>
              <label className="flex gap-2 items-center m-small"><input type="checkbox" checked={form.scheduleOn} onChange={(e) => set("scheduleOn", e.target.checked)} />{lang === "tr" ? "Mesai saatleri" : "Office hours"}</label>
              {form.scheduleOn ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div className="flex gap-1 flex-wrap">{WEEKDAYS.map((d: Weekday) => <button key={d} type="button" className="m-chip" style={form.days.includes(d) ? { boxShadow: "inset 0 0 0 2px var(--navy)", background: "#fff" } : undefined} onClick={() => set("days", form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d])}>{d}</button>)}</div>
                  <div className="flex gap-2"><Input value={form.from} onChange={(e) => set("from", e.target.value)} /><Input value={form.to} onChange={(e) => set("to", e.target.value)} /></div>
                  <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
                </div>
              ) : null}
            </div>
          </Card>
        </div>
        <div className="m-frame m-card" style={{ marginTop: 24, display: "grid", gap: 10, justifyItems: "center", textAlign: "center" }}>
          {validation.ok ? <Tag tone="ok">VALID · {hash?.slice(0, 22)}…</Tag> : <Tag tone="bad">{validation.issues.length} {lang === "tr" ? "SORUN" : "ISSUES"}</Tag>}
          {!validation.ok ? validation.issues.slice(0, 4).map((i) => <p key={i.path} className="m-note m-note--bad"><b className="mono">{i.path}</b> {i.message}</p>) : null}
          {loosened.length > 0 ? (
            <div className="m-note" style={{ textAlign: "left" }}>
              <b>{lang === "tr" ? "Bu değişiklikler çiti gevşetir (sadece sahip imzalar):" : "These edits loosen the Fence (only the owner may sign them):"}</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{loosened.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button tone="ghost" onClick={() => setForm(fenceToForm(DEFAULT_FENCE))}>{lang === "tr" ? "VARSAYILAN" : "DEFAULT"}</Button>
            <Button onClick={save} disabled={!validation.ok}>{lang === "tr" ? "ÇİTİ KAYDET" : "SAVE THE FENCE"}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
