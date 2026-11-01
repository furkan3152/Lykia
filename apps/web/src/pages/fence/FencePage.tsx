import { CCTP_DESTINATIONS, CONFIRM_TRIGGERS, evaluateFence, FENCE_TEMPLATES, fenceHash, loosenedRules, STEP_KINDS, TOKENS, validateFence, WEEKDAYS, type FenceTemplateKey, type ScentRequirement } from "@lykia/core";
import React, { useMemo, useState } from "react";

import { VerdictPanel } from "../../features/outrun/OutrunCard";
import { useLang } from "../../lib/i18n";
import { useLykiaStore } from "../../lib/lykiaStore";
import { runCommand } from "../../lib/runCommand";
import { Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { Tag } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { fromFence, toFence, type FenceForm } from "./fenceForm";
import { SCENARIOS, type ScenarioKey } from "./scenarios";

const TEMPLATE_NAMES: Readonly<Record<FenceTemplateKey, { en: string; tr: string; line: { en: string; tr: string } }>> = {
  lamb: { en: "Lamb", tr: "Kuzu", line: { en: "Watch and learn: plans everything, signs nothing.", tr: "İzle ve öğren: her şeyi planlar, hiçbir şey imzalamaz." } },
  shepherd: { en: "Shepherd", tr: "Çoban", line: { en: "The careful default. Agents welcome, strangers not.", tr: "Dikkatli varsayılan. Agent'lar hoş gelir, yabancılar değil." } },
  treasury: { en: "Treasury", tr: "Hazine", line: { en: "A business treasury: stablecoins, named payees, office hours.", tr: "İşletme hazinesi: stablecoin'ler, isimli alıcılar, mesai saatleri." } },
  caravan: { en: "Caravan", tr: "Kervan", line: { en: "An autonomous agent paying for services: small caps.", tr: "Hizmetlere ödeme yapan otonom agent: küçük limitler." } },
};

function Field({ label, hint, children }: { readonly label: string; readonly hint?: string; readonly children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-tag text-[11px] uppercase text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

const INPUT = cx("w-full bg-paper px-2.5 py-2 font-mono text-[13px] text-ink px-frame-thin outline-none", FOCUS_RING);

function Checks<T extends string>({ options, value, onChange, label }: { readonly options: readonly T[]; readonly value: readonly T[]; readonly onChange: (next: T[]) => void; readonly label: (option: T) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== option) : [...value, option])}
            className={cx("px-2 py-1 font-tag text-[11px] uppercase px-frame-thin", on ? "bg-signal text-[#1B1714]" : "bg-paper text-ink-2", FOCUS_RING)}
          >
            {label(option)}
          </button>
        );
      })}
    </div>
  );
}

export default function FencePage() {
  const lang = useLang();
  const saved = useLykiaStore((s) => s.fence);
  const setFence = useLykiaStore((s) => s.setFence);
  const [form, setForm] = useState<FenceForm>(() => fromFence(saved));
  const [scenario, setScenario] = useState<ScenarioKey>("deposit");
  const [signer, setSigner] = useState<"wallet" | "agent">("agent");
  // The playground evaluates at the moment the page opened (schedules read the clock).
  const [openedAt] = useState(() => Date.now());
  const set = <K extends keyof FenceForm>(key: K, value: FenceForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const draft = useMemo(() => toFence(form), [form]);
  const validation = useMemo(() => validateFence(draft), [draft]);
  const hash = validation.ok ? fenceHash(draft) : null;
  const loosened = validation.ok ? loosenedRules(saved, draft) : [];
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const verdict = useMemo(() => {
    if (!validation.ok) return null;
    const s = SCENARIOS.find((x) => x.key === scenario)!;
    return evaluateFence(draft, s.facts(signer, openedAt));
  }, [draft, validation.ok, scenario, signer, openedAt]);
  const whistle = form.mode === "whistle";

  const save = () => {
    if (!validation.ok) return;
    setFence(draft);
    toast.success(lang === "tr" ? "Çit kaydedildi" : "Fence saved", { description: hash ?? undefined, from: "LYKO" });
  };

  return (
    <Page>
      <Section
        level={1}
        tag={lang === "tr" ? "Çit · lykia.fence/v1" : "Fence · lykia.fence/v1"}
        title={lang === "tr" ? "Sürünün etrafına çit çek." : "Put a fence around the flock."}
        lede={
          lang === "tr"
            ? "Circle'ın agent cüzdanları ne kadar harcanacağını sınırlar; Çit bir DeFi hamlesinin akıllıca olup olmadığına karar verir. Bilmediği bir şey olursa reddeder."
            : "Circle's agent wallets cap how much an agent may spend; the Fence decides whether a DeFi move is sane at all. When a fact is missing, it denies."
        }
      >
        <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(Object.keys(FENCE_TEMPLATES) as FenceTemplateKey[]).map((key) => (
                <button key={key} type="button" onClick={() => setForm(fromFence(FENCE_TEMPLATES[key]))} className={cx("flex flex-col gap-1 bg-card p-3 text-left px-frame-thin px-drop px-press", FOCUS_RING)}>
                  <span className="font-display text-lg font-bold text-ink">{lang === "tr" ? TEMPLATE_NAMES[key].tr : TEMPLATE_NAMES[key].en}</span>
                  <span className="text-[12px] leading-snug text-ink-2">{lang === "tr" ? TEMPLATE_NAMES[key].line.tr : TEMPLATE_NAMES[key].line.en}</span>
                </button>
              ))}
            </div>

            <section className={cx("flex flex-col items-center gap-3 p-5 text-center px-frame px-drop", whistle ? "bg-down/10" : "bg-card")}>
              <Lyko mood={whistle ? "resting" : "watching"} size={72} label={null} />
              <p className="font-display text-xl font-bold text-ink">{whistle ? (lang === "tr" ? "Düdük çalındı" : "The whistle is blown") : lang === "tr" ? "Düdük" : "The Whistle"}</p>
              <p className="max-w-[460px] text-[13px] text-ink-2">{lang === "tr" ? "Yeni riski anında durdurur. Borç ödeme, sana çekme ve sana gönderme her zaman geçer." : "Stops every new risk at once. Repaying, withdrawing to you and sending to you always pass."}</p>
              <Button
                size="lg"
                variant={whistle ? "ink" : "danger"}
                onClick={() => {
                  const next = whistle ? "live" : "whistle";
                  set("mode", next);
                  runCommand(next === "whistle" ? "whistle" : "release");
                }}
              >
                {whistle ? "That'll do · " + (lang === "tr" ? "bırak" : "release") : "Lie down · " + (lang === "tr" ? "düdüğü çal" : "blow the whistle")}
              </Button>
            </section>

            <section className="grid grid-cols-1 gap-4 bg-card p-5 px-frame px-drop md:grid-cols-2">
              <Field label={lang === "tr" ? "Ad" : "Label"}>
                <input className={INPUT} value={form.label} onChange={(e) => set("label", e.target.value)} maxLength={64} />
              </Field>
              <Field label={lang === "tr" ? "Mod" : "Mode"}>
                <select className={INPUT} value={form.mode} onChange={(e) => set("mode", e.target.value as FenceForm["mode"])}>
                  <option value="live">live</option>
                  <option value="dry-run">dry-run</option>
                  <option value="whistle">whistle</option>
                </select>
              </Field>
              <Field label={lang === "tr" ? "Adım başı limit (USD)" : "Per-step cap (USD)"} hint={lang === "tr" ? "Boş = limitsiz" : "Empty = no cap"}>
                <input className={INPUT} inputMode="decimal" value={form.perStepUsd} onChange={(e) => set("perStepUsd", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Plan başı limit (USD)" : "Per-intent cap (USD)"}>
                <input className={INPUT} inputMode="decimal" value={form.perIntentUsd} onChange={(e) => set("perIntentUsd", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Günlük limit (USD)" : "Daily cap (USD)"}>
                <input className={INPUT} inputMode="decimal" value={form.dailyUsd} onChange={(e) => set("dailyUsd", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Haftalık limit (USD)" : "Weekly cap (USD)"}>
                <input className={INPUT} inputMode="decimal" value={form.weeklyUsd} onChange={(e) => set("weeklyUsd", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Maks. kayma (bps)" : "Max slippage (bps)"}>
                <input className={INPUT} inputMode="numeric" value={form.maxSlippageBps} onChange={(e) => set("maxSlippageBps", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Maks. adım" : "Max steps"}>
                <input className={INPUT} inputMode="numeric" value={form.maxSteps} onChange={(e) => set("maxSteps", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Min. sağlık faktörü" : "Min health factor"} hint={'"1.5"'}>
                <input className={INPUT} inputMode="decimal" value={form.minHealthFactor} onChange={(e) => set("minHealthFactor", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Kur bandı (bps)" : "FX band (bps)"} hint="StableFX">
                <input className={INPUT} inputMode="numeric" value={form.fxMaxDeviationBps} onChange={(e) => set("fxMaxDeviationBps", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Koku şartı" : "Scent requirement"}>
                <select className={INPUT} value={form.scent} onChange={(e) => set("scent", e.target.value as ScentRequirement)}>
                  <option value="verified">verified</option>
                  <option value="no-red-flags">no-red-flags</option>
                  <option value="off">off</option>
                </select>
              </Field>
              <Field label={lang === "tr" ? "Onay eşiği (USD)" : "Confirm above (USD)"}>
                <input className={INPUT} inputMode="decimal" value={form.confirmAboveUsd} onChange={(e) => set("confirmAboveUsd", e.target.value)} />
              </Field>
            </section>

            <section className="flex flex-col gap-4 bg-card p-5 px-frame px-drop">
              <Field label={lang === "tr" ? "Alıcılar" : "Recipients"}>
                <select className={INPUT} value={form.recipientsMode} onChange={(e) => set("recipientsMode", e.target.value as FenceForm["recipientsMode"])}>
                  <option value="own">{lang === "tr" ? "sadece sahibi" : "owner only"}</option>
                  <option value="allowlist">{lang === "tr" ? "izin listesi" : "allowlist"}</option>
                  <option value="any">{lang === "tr" ? "herkes (onaylı)" : "anyone (with confirm)"}</option>
                </select>
              </Field>
              <Field label={lang === "tr" ? "İzin listesi (her satıra bir adres)" : "Allowlist (one address per line)"}>
                <textarea className={cx(INPUT, "min-h-[72px]")} value={form.recipientsAllow} onChange={(e) => set("recipientsAllow", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Yasaklı adresler" : "Deny list"}>
                <textarea className={cx(INPUT, "min-h-[48px]")} value={form.recipientsDeny} onChange={(e) => set("recipientsDeny", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "İzinli protokoller (virgülle, boş = hepsi)" : "Allowed venues (comma separated, empty = all)"}>
                <input className={INPUT} value={form.venuesAllow} onChange={(e) => set("venuesAllow", e.target.value)} placeholder="cctp, gateway, stablefx" />
              </Field>
              <Field label={lang === "tr" ? "Yasaklı protokoller" : "Denied venues"}>
                <input className={INPUT} value={form.venuesDeny} onChange={(e) => set("venuesDeny", e.target.value)} />
              </Field>
              <Field label={lang === "tr" ? "Token'lar (boş = hepsi)" : "Tokens (empty = all registry tokens)"}>
                <Checks options={TOKENS.map((t) => t.symbol)} value={form.tokensAllow} onChange={(v) => set("tokensAllow", v)} label={(s) => s} />
              </Field>
              <Field label={lang === "tr" ? "Kayıt dışı token'lar" : "Unlisted tokens"}>
                <select className={INPUT} value={form.tokensUnlisted} onChange={(e) => set("tokensUnlisted", e.target.value as "deny" | "allow")}>
                  <option value="deny">deny</option>
                  <option value="allow">{lang === "tr" ? "izin ver (Koku şartıyla)" : "allow (subject to Scent)"}</option>
                </select>
              </Field>
              <Field label={lang === "tr" ? "Adım türleri (boş = hepsi)" : "Step kinds (empty = all)"}>
                <Checks options={STEP_KINDS} value={form.kinds} onChange={(v) => set("kinds", v)} label={(s) => s} />
              </Field>
              <Field label={lang === "tr" ? "Köprü hedefleri (boş = hepsi)" : "Bridge destinations (empty = all)"}>
                <Checks options={CCTP_DESTINATIONS.map((d) => d.key)} value={form.bridges} onChange={(v) => set("bridges", v)} label={(s) => s} />
              </Field>
              <Field label={lang === "tr" ? "İmzacılar" : "Signers"}>
                <Checks options={["wallet", "agent"] as const} value={form.signers} onChange={(v) => set("signers", v)} label={(s) => s} />
              </Field>
              <Field label={lang === "tr" ? "Onay iste" : "Ask to confirm when"}>
                <Checks options={CONFIRM_TRIGGERS} value={form.confirmWhen} onChange={(v) => set("confirmWhen", v)} label={(s) => s} />
              </Field>
              <label className="flex items-center gap-2 text-[14px] text-ink">
                <input type="checkbox" checked={form.scheduleOn} onChange={(e) => set("scheduleOn", e.target.checked)} className="h-4 w-4" />
                {lang === "tr" ? "Saat penceresi" : "Hours window"}
              </label>
              {form.scheduleOn ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Field label={lang === "tr" ? "Saat dilimi" : "Time zone"}>
                    <input className={INPUT} value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
                  </Field>
                  <Field label={lang === "tr" ? "Başlangıç" : "From"}>
                    <input className={INPUT} value={form.from} onChange={(e) => set("from", e.target.value)} />
                  </Field>
                  <Field label={lang === "tr" ? "Bitiş" : "To"}>
                    <input className={INPUT} value={form.to} onChange={(e) => set("to", e.target.value)} />
                  </Field>
                  <div className="md:col-span-3">
                    <Checks options={WEEKDAYS} value={form.days} onChange={(v) => set("days", v)} label={(s) => s} />
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
            <section className="flex flex-col gap-3 bg-card p-4 px-frame px-drop">
              <div className="flex items-center justify-between gap-2">
                <Tag>{validation.ok ? (lang === "tr" ? "GEÇERLİ" : "VALID") : lang === "tr" ? "HATALI" : "INVALID"}</Tag>
                {dirty ? <span className="font-tag text-[11px] uppercase text-warn-ink">{lang === "tr" ? "kaydedilmedi" : "unsaved"}</span> : null}
              </div>
              {hash ? <p className="break-all font-mono text-[11px] text-ink-2" title={lang === "tr" ? "Künye bu hash'i zincirde sabitler" : "A Künye pins this hash on-chain"}>{hash}</p> : null}
              {!validation.ok ? (
                <ul className="flex flex-col gap-1 text-[12px] text-down">
                  {validation.issues.map((issue) => (
                    <li key={`${issue.path}-${issue.message}`}>
                      <span className="font-mono">{issue.path || "(root)"}</span> {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {loosened.length > 0 ? (
                <div className="flex flex-col gap-1 bg-warn/15 p-2">
                  <span className="font-tag text-[11px] uppercase text-warn-ink">{lang === "tr" ? "Gevşetiyor (sahibin cüzdanı gerekir)" : "Loosens (needs the owner's wallet)"}</span>
                  <ul className="list-inside list-disc text-[12px] text-ink-2">
                    {loosened.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex gap-2">
                <Button onClick={save} disabled={!validation.ok || !dirty}>
                  {lang === "tr" ? "Kaydet" : "Save"}
                </Button>
                <Button variant="ghost" onClick={() => setForm(fromFence(saved))} disabled={!dirty}>
                  {lang === "tr" ? "Geri al" : "Revert"}
                </Button>
              </div>
            </section>
            <section className="flex flex-col gap-3 bg-card p-4 px-frame px-drop">
              <p className="font-display text-lg font-bold text-ink">{lang === "tr" ? "Dene" : "Try it"}</p>
              <select className={INPUT} value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioKey)} aria-label="Scenario">
                {SCENARIOS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {lang === "tr" ? s.tr : s.en}
                  </option>
                ))}
              </select>
              <Checks options={["wallet", "agent"] as const} value={[signer]} onChange={(v) => setSigner(v.find((x) => x !== signer) ?? signer)} label={(s) => (s === "agent" ? (lang === "tr" ? "agent imzalar" : "agent signs") : lang === "tr" ? "cüzdan imzalar" : "wallet signs")} />
              {verdict ? <VerdictPanel verdict={verdict} /> : <p className="text-[12px] text-ink-3">{lang === "tr" ? "Önce hataları düzelt." : "Fix the issues first."}</p>}
            </section>
            <details className="bg-card p-4 px-frame-thin">
              <summary className="cursor-pointer font-tag text-[11px] uppercase text-ink-2">JSON</summary>
              <pre className="mt-2 max-h-[320px] overflow-auto font-mono text-[11px] text-ink-2">{JSON.stringify(draft, null, 2)}</pre>
            </details>
          </aside>
        </div>
      </Section>
    </Page>
  );
}
