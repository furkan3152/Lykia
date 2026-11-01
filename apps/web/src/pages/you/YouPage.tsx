/**
 * You: personalization. Everything is kept locally and synced to
 * /v1/profile when signed in. Lyko's look previews live on the medallion,
 * the sprites and a small bay, and repaints the whole app on save.
 */
import type { VenuesResponse } from "@lykia/core/api/intents";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useUiStore } from "../../app/state/uiStore";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { useSiwe } from "../../features/session/useSiwe";
import { apiGet, apiPut } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLang, useLangStore } from "../../lib/i18n";
import { availabilityOf } from "../../lib/optional";
import { DEFAULT_PROFILE, moveWidget, sanitizeProfile, useProfile, type Profile, type Widget } from "../../lib/profile";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, Field, Input, LykoFace, Medallion, PageHead, Select, Sprite, Tag, Toggle, toast } from "../../mosaic";
import { useLook } from "../../mosaic/look";
import { bay, BAY_H, BAY_W } from "../../mosaic/scenes";
import { COATS, COLLAR_COLOURS, LYKO_SIT, LYKO_TROT, type CoatVariant } from "../../mosaic/sprites";

const WIDGET_NAMES: Record<Widget, { en: string; tr: string }> = {
  flock: { en: "Flock", tr: "Sürü" },
  insights: { en: "Lyko noticed", tr: "Lyko'nun gözü" },
  outruns: { en: "Outruns", tr: "Outrun'lar" },
  pack: { en: "Pack", tr: "Yavrular" },
  pulse: { en: "Arc pulse", tr: "Arc nabzı" },
  standing: { en: "Standing orders", tr: "Kalıcı emirler" },
};

export default function YouPage() {
  const lang = useLang();
  const setLang = useLangStore((s) => s.setLang);
  const setMode = useUiStore((s) => s.setMode);
  const environment = useEnvironment();
  const stored = useProfile((s) => s.profile);
  const synced = useProfile((s) => s.synced);
  const setStored = useProfile((s) => s.set);
  const setLook = useLook((s) => s.setLook);
  const siwe = useSiwe();
  const lit = useLamp();
  const [p, setP] = useState<Profile>(stored);
  const [drag, setDrag] = useState<Widget | null>(null);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const venues = useQuery({ queryKey: ["venues", environment], queryFn: ({ signal }) => apiGet<VenuesResponse>("/v1/venues", { query: { environment }, signal }) });
  const remote = useQuery({ queryKey: ["profile", siwe.session?.address], enabled: siwe.signedIn, retry: false, queryFn: ({ signal }) => apiGet<unknown>("/v1/profile", { signal }) });

  useEffect(() => {
    if (remote.data) setStored(sanitizeProfile(remote.data), "synced");
  }, [remote.data, setStored]);

  const save = async () => {
    setStored(p, "local");
    setLook(p.look);
    if (p.language !== "auto") setLang(p.language);
    setMode(p.network);
    if (siwe.signedIn) {
      try {
        await apiPut("/v1/profile", p);
        setStored(p, "synced");
        toast.success(lang === "tr" ? "Profil eşitlendi" : "Profile synced", { from: "LYKO" });
        return;
      } catch (e) {
        setStored(p, availabilityOf(e) === "soon" ? "soon" : "local");
      }
    }
    toast.success(lang === "tr" ? "Bu cihaza kaydedildi" : "Saved on this device", { from: "LYKO" });
  };

  const venueIds = (venues.data?.venues ?? []).filter((v) => v.live).map((v) => v.id);
  const toggleIn = (k: "favoriteVenues" | "blockedVenues", id: string) => set(k, p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id]);
  const lookPal = (() => {
    const coat = COATS[p.look.coat];
    return { ...coat, r: p.look.collar };
  })();

  return (
    <div>
      <PageHead kicker={lang === "tr" ? "SEN · KİŞİSELLEŞTİR" : "YOU · MAKE IT YOURS"} title={lang === "tr" ? <>Lyko <em>senin</em> köpeğin.</> : <>Lyko is <em>your</em> dog.</>} sub={lang === "tr" ? "Dil, para birimi, risk, venue'lar, Lyko'nun sesi ve görünüşü. Bu cihazda saklanır; giriş yaptıysan hesabına eşitlenir." : "Language, currency, risk, venues, Lyko's voice and look. Kept on this device, synced to your account when you are signed in."} mood="happy">
        <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 16 }}>
          <Tag tone={synced === "synced" ? "ok" : synced === "soon" ? "ochre" : "ghost"}>{synced === "synced" ? "SYNCED" : synced === "soon" ? "SYNC COMING SOON · SAVED HERE" : "SAVED ON THIS DEVICE"}</Tag>
          {!siwe.signedIn ? <Button size="sm" tone="sea" onClick={() => void siwe.signIn()}>{lang === "tr" ? "EŞİTLEMEK İÇİN GİRİŞ" : "SIGN IN TO SYNC"}</Button> : null}
        </div>
      </PageHead>

      <section className="m-wrap" style={{ marginTop: 28 }}>
        <Card title={lang === "tr" ? "Lyko'nun görünüşü" : "Lyko's look"} kicker={lang === "tr" ? "TASMA · POST · KÜNYE YAZISI · CANLI ÖNİZLEME" : "COLLAR · COAT · TAG TEXT · LIVE PREVIEW"}>
          <div className="m-grid-2 m-grid-2--r" style={{ alignItems: "center" }}>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label={lang === "tr" ? "Tasma" : "Collar"}>
                <div className="flex gap-2 flex-wrap">
                  {COLLAR_COLOURS.map((c) => (
                    <button key={c} type="button" aria-label={c} aria-pressed={p.look.collar === c} onClick={() => set("look", { ...p.look, collar: c })} style={{ width: 34, height: 34, border: 0, cursor: "pointer", background: c, boxShadow: p.look.collar === c ? "0 0 0 3px var(--cream), 0 0 0 6px var(--navy)" : "inset 0 0 0 2px rgba(0,0,0,.2)" }} />
                  ))}
                </div>
              </Field>
              <Field label={lang === "tr" ? "Post" : "Coat"}>
                <Toggle light label="Coat" value={p.look.coat} onChange={(coat: CoatVariant) => set("look", { ...p.look, coat })} options={[{ value: "cream", label: "CREAM" }, { value: "fawn", label: "FAWN" }, { value: "white", label: "WHITE" }, { value: "sable", label: "SABLE" }]} />
              </Field>
              <Field label={lang === "tr" ? "Künye yazısı" : "Name tag"} hint={lang === "tr" ? "Madalyonun halkasında görünür (12 harf)." : "Shown on the medallion ring (12 letters)."}>
                <Input maxLength={12} value={p.look.tag} onChange={(e) => set("look", { ...p.look, tag: e.target.value.toUpperCase() })} />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" tone="ghost" onClick={() => set("look", DEFAULT_PROFILE.look)}>{lang === "tr" ? "VARSAYILAN" : "DEFAULT"}</Button>
                <Button size="sm" onClick={() => void save()}>{lang === "tr" ? "UYGULA" : "APPLY EVERYWHERE"}</Button>
              </div>
            </div>
            <div className="m-center" style={{ display: "grid", gap: 12, justifyItems: "center" }}>
              <div className="flex gap-4 items-end">
                <Sprite rows={LYKO_SIT} palette={{ ...lookPreviewBase(), ...lookPal }} scale={4} label="Lyko preview, sitting" />
                <Sprite rows={LYKO_TROT} palette={{ ...lookPreviewBase(), ...lookPal }} scale={3} label="Lyko preview, trotting" />
              </div>
              <p className="m-kick">{lang === "tr" ? "KAYDETMEDEN ÖNCE ÖNİZLEME" : "PREVIEW BEFORE YOU APPLY"} · {p.look.tag || "LYKO"}</p>
            </div>
          </div>
        </Card>
      </section>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        <div className="m-grid-3">
          <Card title={lang === "tr" ? "Dil ve görünüm" : "Language & display"} kicker="LANGUAGE · CURRENCY · NETWORK · THEME">
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={lang === "tr" ? "Dil" : "Language"}><Toggle light label="Language" value={p.language} onChange={(v) => set("language", v)} options={[{ value: "auto", label: "AUTO" }, { value: "en", label: "EN" }, { value: "tr", label: "TR" }]} /></Field>
              <Field label={lang === "tr" ? "Para birimi" : "Display currency"} hint={p.currency === "TRY" ? (lang === "tr" ? "TRY kuru kaynağı yoksa USD gösterilir." : "Without a TRY rate source, USD is shown.") : undefined}><Toggle light label="Currency" value={p.currency} onChange={(v) => set("currency", v)} options={[{ value: "USD", label: "USD" }, { value: "EUR", label: "EUR" }, { value: "TRY", label: "TRY" }]} /></Field>
              <Field label={lang === "tr" ? "Varsayılan ağ" : "Default network"}><Toggle light label="Network" value={p.network} onChange={(v) => set("network", v)} options={[{ value: "mainnet", label: "MAINNET" }, { value: "testnet", label: "TESTNET" }]} /></Field>
              <Field label={lang === "tr" ? "Tema" : "Theme"}><Toggle light label="Theme" value={p.theme} onChange={(v) => set("theme", v)} options={[{ value: "day", label: "DAY" }, { value: "night", label: "NIGHT" }, { value: "auto", label: "AUTO" }]} /></Field>
            </div>
          </Card>
          <Card title={lang === "tr" ? "Risk ve onay" : "Risk & confirmations"} kicker="APPETITE · SLIPPAGE · CONFIRM">
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={lang === "tr" ? "Risk iştahı" : "Risk appetite"}><Toggle light label="Risk" value={p.risk} onChange={(v) => set("risk", v)} options={[{ value: "low", label: "LOW" }, { value: "medium", label: "MEDIUM" }, { value: "high", label: "HIGH" }]} /></Field>
              <Field label={lang === "tr" ? "Varsayılan kayma (bps)" : "Default slippage (bps)"}><Input inputMode="numeric" value={String(p.slippageBps)} onChange={(e) => set("slippageBps", Math.max(0, Math.min(1000, Number(e.target.value.replace(/\D/gu, "")) || 0)))} /></Field>
              <Field label={lang === "tr" ? "Onay stili" : "Confirmation style"}>
                <Select value={p.confirm} onChange={(e) => set("confirm", e.target.value as Profile["confirm"])}>
                  <option value="every-step">{lang === "tr" ? "Her adımda" : "Every step"}</option>
                  <option value="above-cap">{lang === "tr" ? "Limitin üstünde" : "Above my confirm cap"}</option>
                  <option value="never">{lang === "tr" ? "Çit ne derse" : "Whatever the Fence says"}</option>
                </Select>
              </Field>
              <label className="flex gap-2 items-center m-small"><input type="checkbox" checked={p.explainLikeNew} onChange={(e) => set("explainLikeNew", e.target.checked)} />{lang === "tr" ? "Yeni başlayana anlatır gibi açıkla" : "Explain like I'm new"}</label>
            </div>
          </Card>
          <Card title={lang === "tr" ? "Lyko'nun sesi" : "Lyko's voice"} kicker="PERSONA · VERBOSITY">
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={lang === "tr" ? "Ton" : "Tone"}>
                <Select value={p.tone} onChange={(e) => set("tone", e.target.value as Profile["tone"])}>
                  <option value="friendly">{lang === "tr" ? "Samimi" : "Friendly"}</option>
                  <option value="concise">{lang === "tr" ? "Kısa ve net" : "Concise"}</option>
                  <option value="formal">{lang === "tr" ? "Resmî" : "Formal"}</option>
                  <option value="playful">{lang === "tr" ? "Oyuncu" : "Playful"}</option>
                </Select>
              </Field>
              <Field label={lang === "tr" ? "Ayrıntı" : "Verbosity"}><Toggle light label="Verbosity" value={p.verbosity} onChange={(v) => set("verbosity", v)} options={[{ value: "short", label: "SHORT" }, { value: "normal", label: "NORMAL" }, { value: "detailed", label: "DETAILED" }]} /></Field>
              <div className="m-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <LykoFace mood={p.tone === "playful" ? "happy" : p.tone === "formal" ? "watching" : "proud"} scale={1.5} />
                <span className="m-small">{{ friendly: lang === "tr" ? "Merhaba! Sürünü saydım, her şey yolunda." : "Hi! I counted your flock; all good.", concise: lang === "tr" ? "Sürü tamam. 2 öneri." : "Flock OK. 2 suggestions.", formal: lang === "tr" ? "Portföyünüz incelendi; iki öneri sunuyorum." : "Your holdings were reviewed; two recommendations follow.", playful: lang === "tr" ? "Hav! Kurt yok, ot bol!" : "Woof! No wolves, plenty of grass!" }[p.tone]}</span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        <div className="m-grid-2">
          <Card title={lang === "tr" ? "Venue tercihleri" : "Venues"} kicker={lang === "tr" ? "SEVDİKLERİN ★ · ENGELLEDİKLERİN ⦸" : "FAVOURITES ★ · BLOCKED ⦸"}>
            {venueIds.length === 0 ? <p className="m-small m-muted m-center">{venues.isLoading ? "…" : lang === "tr" ? "Venue listesi okunamadı." : "Could not read the venue list."}</p> : (
              <div className="flex gap-2 flex-wrap">
                {venueIds.map((id) => {
                  const fav = p.favoriteVenues.includes(id);
                  const blocked = p.blockedVenues.includes(id);
                  return (
                    <span key={id} className="m-chip" style={{ display: "inline-flex", gap: 6, alignItems: "center", boxShadow: fav ? "inset 0 0 0 2px var(--ok)" : blocked ? "inset 0 0 0 2px var(--bad)" : undefined }}>
                      {id}
                      <button type="button" aria-label={`favourite ${id}`} className="m-small" style={{ border: 0, background: "none", cursor: "pointer", color: fav ? "var(--ok)" : "var(--ink-3)" }} onClick={() => toggleIn("favoriteVenues", id)}>★</button>
                      <button type="button" aria-label={`block ${id}`} className="m-small" style={{ border: 0, background: "none", cursor: "pointer", color: blocked ? "var(--bad)" : "var(--ink-3)" }} onClick={() => toggleIn("blockedVenues", id)}>⦸</button>
                    </span>
                  );
                })}
              </div>
            )}
          </Card>
          <Card title={lang === "tr" ? "Sessiz saatler ve bildirimler" : "Quiet hours & notifications"} kicker="QUIET HOURS · WEBHOOK · TELEGRAM">
            <div style={{ display: "grid", gap: 10 }}>
              <label className="flex gap-2 items-center m-small"><input type="checkbox" checked={p.quietHours.on} onChange={(e) => set("quietHours", { ...p.quietHours, on: e.target.checked })} />{lang === "tr" ? "Sessiz saatlerde Lyko sadece acil durumda yazar" : "During quiet hours Lyko only speaks up for emergencies"}</label>
              {p.quietHours.on ? <div className="flex gap-2"><Input value={p.quietHours.from} onChange={(e) => set("quietHours", { ...p.quietHours, from: e.target.value })} /><Input value={p.quietHours.to} onChange={(e) => set("quietHours", { ...p.quietHours, to: e.target.value })} /></div> : null}
              <Field label="Webhook"><Input placeholder="https://…" value={p.notify.webhook} onChange={(e) => set("notify", { ...p.notify, webhook: e.target.value })} /></Field>
              <Field label="Telegram"><Input placeholder="@handle" value={p.notify.telegram} onChange={(e) => set("notify", { ...p.notify, telegram: e.target.value })} /></Field>
            </div>
          </Card>
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        <Card title={lang === "tr" ? "Pano sırası" : "Dashboard order"} kicker={lang === "tr" ? "SÜRÜKLE BIRAK" : "DRAG TO REORDER"}>
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {p.widgets.map((w, i) => (
              <li key={w} draggable onDragStart={() => setDrag(w)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag) set("widgets", moveWidget(p.widgets, drag, i)); setDrag(null); }} className="m-frame m-frame--thin" style={{ padding: "10px 12px", cursor: "grab", display: "flex", justifyContent: "space-between", opacity: drag === w ? 0.5 : 1 }}>
                <span><b className="num" style={{ color: "var(--terra)" }}>{i + 1}</b> {WIDGET_NAMES[w][lang]}</span>
                <span className="flex gap-1">
                  <button type="button" aria-label="Move up" className="m-small" style={{ border: 0, background: "none", cursor: "pointer" }} onClick={() => set("widgets", moveWidget(p.widgets, w, i - 1))}>▲</button>
                  <button type="button" aria-label="Move down" className="m-small" style={{ border: 0, background: "none", cursor: "pointer" }} onClick={() => set("widgets", moveWidget(p.widgets, w, i + 1))}>▼</button>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        <SceneFrame
          build={(t) => bay({ pens: [{ label: "a", apy: 5 }, { label: "b", apy: 6 }, { label: "c", apy: 4 }], flock: ["USDC", "EURC", "USDC", "cirBTC"], wolves: 0, lit, night: p.theme === "night" }, t)}
          width={BAY_W}
          height={BAY_H}
          tile={4}
          dataKey={`${p.theme}-${lit}-${p.look.collar}-${p.look.coat}`}
          label="Preview of your bay"
          night={p.theme === "night"}
          labels={[{ x: 50, y: 4, text: p.look.tag || "LYKO" }]}
        />
        <div className="flex justify-center items-center gap-3" style={{ marginTop: 20 }}>
          <Medallion size={96} />
          <Button size="lg" onClick={() => void save()}>{lang === "tr" ? "KAYDET" : "SAVE"}</Button>
          <Button size="lg" tone="ghost" onClick={() => setP(stored)}>{lang === "tr" ? "GERİ AL" : "REVERT"}</Button>
        </div>
      </section>
    </div>
  );
}

/** A fresh copy of the base palette so the preview never paints the live one. */
function lookPreviewBase(): Record<string, string> {
  return { ...previewBase };
}
const previewBase: Record<string, string> = { k: "#1E1A22", m: "#2B2220", M: "#4E3E36", a: "#E3A13A", n: "#0E0B0A", R: "#7E2C1B", s: "#E9EEF1", g: "#F4CB4E", G: "#B88A1E", t: "#E9737E", w: "#FFFFFF" };
