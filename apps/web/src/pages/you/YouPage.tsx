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
import { availabilityOf } from "../../lib/optional";
import { DEFAULT_PROFILE, moveWidget, sanitizeProfile, useProfile, type Profile, type Widget } from "../../lib/profile";
import { useLamp } from "../../lib/pulseStore";
import { displayRate, rateLabel } from "../../lib/rates";
import { Button, Card, Field, Input, LykoFace, Medallion, PageHead, Select, Sprite, Tag, Toggle, toast } from "../../mosaic";
import { useLook } from "../../mosaic/look";
import { bay, BAY_H, BAY_W } from "../../mosaic/scenes";
import { COATS, COLLAR_COLOURS, LYKO_SIT, LYKO_TROT, type CoatVariant } from "../../mosaic/sprites";
import { currentLocale, LOCALE_NAMES, t as msg } from "../../i18n";

const WIDGET_NAMES: Record<Widget, { en: string; }> = {
  flock: { en: msg("you.portfolio"), },
  insights: { en: msg("you.insights"), },
  outruns: { en: msg("you.recentPlans"), },
  pack: { en: msg("you.agents"), },
  pulse: { en: msg("you.arcPulse"), },
  standing: { en: msg("you.standingOrders"), },
};

export default function YouPage() {
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
  const oracles = useQuery({ queryKey: ["oracles"], retry: false, staleTime: 300_000, queryFn: ({ signal }) => apiGet<unknown>("/v1/oracles", { signal }) });
  const tryRate = displayRate(oracles.data, "TRY");
  const venues = useQuery({ queryKey: ["venues", environment], queryFn: ({ signal }) => apiGet<VenuesResponse>("/v1/venues", { query: { environment }, signal }) });
  const remote = useQuery({ queryKey: ["profile", siwe.session?.address], enabled: siwe.signedIn, retry: false, queryFn: ({ signal }) => apiGet<unknown>("/v1/profile", { signal }) });

  useEffect(() => {
    if (remote.data) setStored(sanitizeProfile(remote.data), "synced");
  }, [remote.data, setStored]);

  const save = async () => {
    setStored(p, "local");
    setLook(p.look);
    setMode(p.network);
    if (siwe.signedIn) {
      try {
        await apiPut("/v1/profile", p);
        setStored(p, "synced");
        toast.success(msg("you.profileSynced"), { from: "LYKO" });
        return;
      } catch (e) {
        setStored(p, availabilityOf(e) === "soon" ? "soon" : "local");
      }
    }
    toast.success(msg("you.savedOnThisDevice"), { from: "LYKO" });
  };

  const venueIds = (venues.data?.venues ?? []).filter((v) => v.live).map((v) => v.id);
  const toggleIn = (k: "favoriteVenues" | "blockedVenues", id: string) => set(k, p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id]);
  const lookPal = (() => {
    const coat = COATS[p.look.coat];
    return { ...coat, r: p.look.collar };
  })();

  return (
    <div>
      <PageHead kicker={msg("you.settings")} title={<>{msg("you.makeIt")} <em>{msg("you.yours")}</em></>} sub={msg("you.currencyRiskProtocolsTheAssistantS")} mood="happy">
        <div className="flex justify-center gap-2 flex-wrap" style={{ marginTop: 16 }}>
          <Tag tone={synced === "synced" ? "ok" : synced === "soon" ? "ochre" : "ghost"}>{synced === "synced" ? "SYNCED" : synced === "soon" ? msg("you.syncComingSoonSavedHere") : msg("you.savedOnThisDevice2")}</Tag>
          {!siwe.signedIn ? <Button size="sm" tone="sea" onClick={() => void siwe.signIn()}>{msg("you.signInToSync")}</Button> : null}
        </div>
      </PageHead>

      <section className="m-wrap" style={{ marginTop: 28 }}>
        <Card title={msg("you.lykoSLook")} kicker={msg("you.collarCoatTagTextLivePreview")}>
          <div className="m-grid-2 m-grid-2--r" style={{ alignItems: "center" }}>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label={msg("you.collar")}>
                <div className="flex gap-2 flex-wrap">
                  {COLLAR_COLOURS.map((c) => (
                    <button key={c} type="button" aria-label={c} aria-pressed={p.look.collar === c} onClick={() => set("look", { ...p.look, collar: c })} style={{ width: 34, height: 34, border: 0, cursor: "pointer", background: c, boxShadow: p.look.collar === c ? "0 0 0 3px var(--cream), 0 0 0 6px var(--navy)" : "inset 0 0 0 2px rgba(0,0,0,.2)" }} />
                  ))}
                </div>
              </Field>
              <Field label={msg("you.coat")}>
                <Toggle light label={msg("you.coat")} value={p.look.coat} onChange={(coat: CoatVariant) => set("look", { ...p.look, coat })} options={[{ value: "cream", label: "CREAM" }, { value: "fawn", label: "FAWN" }, { value: "white", label: "WHITE" }, { value: "sable", label: "SABLE" }]} />
              </Field>
              <Field label={msg("you.nameTag")} hint={msg("you.shownOnTheMedallionRing12")}>
                <Input maxLength={12} value={p.look.tag} onChange={(e) => set("look", { ...p.look, tag: e.target.value.toUpperCase() })} />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" tone="ghost" onClick={() => set("look", DEFAULT_PROFILE.look)}>{msg("you.default")}</Button>
                <Button size="sm" onClick={() => void save()}>{msg("you.applyEverywhere")}</Button>
              </div>
            </div>
            <div className="m-center" style={{ display: "grid", gap: 12, justifyItems: "center" }}>
              <div className="flex gap-4 items-end">
                <Sprite rows={LYKO_SIT} palette={{ ...lookPreviewBase(), ...lookPal }} scale={4} label={msg("you.lykoPreviewSitting")} />
                <Sprite rows={LYKO_TROT} palette={{ ...lookPreviewBase(), ...lookPal }} scale={3} label={msg("you.lykoPreviewTrotting")} />
              </div>
              <p className="m-kick">{msg("you.previewBeforeYouApply")} · {p.look.tag || "LYKO"}</p>
            </div>
          </div>
        </Card>
      </section>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        <div className="m-grid-3">
          <Card title={msg("you.languageDisplay")} kicker={msg("you.languageCurrencyNetworkTheme")}>
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={msg("you.lykoRepliesIn")} hint={msg("you.lykoRepliesInYourLanguage")}><span className="m-small" lang={currentLocale()}>{LOCALE_NAMES[currentLocale()]}</span></Field>
              <Field label={msg("you.displayCurrency")} hint={p.currency === "TRY" ? (tryRate ? msg("you.n1Try", { value: tryRate.usd.toFixed(4), rateLabel: rateLabel(tryRate) }) : msg("you.noTryRateRightNowAmounts")) : undefined}><Toggle light label={msg("you.currency")} value={p.currency} onChange={(v) => set("currency", v)} options={[{ value: "USD", label: "USD" }, { value: "EUR", label: "EUR" }, { value: "TRY", label: "TRY" }]} /></Field>
              <Field label={msg("you.defaultNetwork")}><Toggle light label={msg("you.network")} value={p.network} onChange={(v) => set("network", v)} options={[{ value: "mainnet", label: "MAINNET" }, { value: "testnet", label: "TESTNET" }]} /></Field>
              <Field label={msg("you.theme")}><Toggle light label={msg("you.theme")} value={p.theme} onChange={(v) => set("theme", v)} options={[{ value: "day", label: "DAY" }, { value: "night", label: "NIGHT" }]} /></Field>
            </div>
          </Card>
          <Card title={msg("you.riskConfirmations")} kicker={msg("you.appetiteSlippageConfirm")}>
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={msg("you.riskAppetite")}><Toggle light label={msg("you.risk")} value={p.risk} onChange={(v) => set("risk", v)} options={[{ value: "low", label: "LOW" }, { value: "medium", label: "MEDIUM" }, { value: "high", label: "HIGH" }]} /></Field>
              <Field label={msg("you.defaultSlippageBps")}><Input inputMode="numeric" value={String(p.slippageBps)} onChange={(e) => set("slippageBps", Math.max(0, Math.min(1000, Number(e.target.value.replace(/\D/gu, "")) || 0)))} /></Field>
              <Field label={msg("you.confirmationStyle")}>
                <Select value={p.confirm} onChange={(e) => set("confirm", e.target.value as Profile["confirm"])}>
                  <option value="every-step">{msg("you.everyStep")}</option>
                  <option value="above-cap">{msg("you.aboveMyConfirmCap")}</option>
                  <option value="never">{msg("you.whateverTheFenceSays")}</option>
                </Select>
              </Field>
              <label className="flex gap-2 items-center m-small"><input type="checkbox" checked={p.explainLikeNew} onChange={(e) => set("explainLikeNew", e.target.checked)} />{msg("you.explainLikeIMNew")}</label>
            </div>
          </Card>
          <Card title={msg("you.lykoSVoice")} kicker={msg("you.personaVerbosity")}>
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={msg("you.tone")}>
                <Select value={p.tone} onChange={(e) => set("tone", e.target.value as Profile["tone"])}>
                  <option value="friendly">{msg("you.friendly")}</option>
                  <option value="concise">{msg("you.concise")}</option>
                  <option value="formal">{msg("you.formal")}</option>
                  <option value="playful">{msg("you.playful")}</option>
                </Select>
              </Field>
              <Field label={msg("you.verbosity")}><Toggle light label={msg("you.verbosity")} value={p.verbosity} onChange={(v) => set("verbosity", v)} options={[{ value: "short", label: "SHORT" }, { value: "normal", label: "NORMAL" }, { value: "detailed", label: "DETAILED" }]} /></Field>
              <div className="m-note" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <LykoFace mood={p.tone === "playful" ? "happy" : p.tone === "formal" ? "watching" : "proud"} scale={1.5} />
                <span className="m-small">{{ friendly: msg("you.hiICountedYourFlockAll"), concise: msg("you.flockOk2Suggestions"), formal: msg("you.yourHoldingsWereReviewedTwoRecommendatio"), playful: msg("you.woofNoWolvesPlentyOfGrass") }[p.tone]}</span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        <div className="m-grid-2">
          <Card title={msg("you.venues")} kicker={msg("you.favouritesBlocked")}>
            {venueIds.length === 0 ? <p className="m-small m-muted m-center">{venues.isLoading ? "…" : msg("you.couldNotReadTheVenueList")}</p> : (
              <div className="flex gap-2 flex-wrap">
                {venueIds.map((id) => {
                  const fav = p.favoriteVenues.includes(id);
                  const blocked = p.blockedVenues.includes(id);
                  return (
                    <span key={id} className="m-chip" style={{ display: "inline-flex", gap: 6, alignItems: "center", boxShadow: fav ? "inset 0 0 0 2px var(--ok)" : blocked ? "inset 0 0 0 2px var(--bad)" : undefined }}>
                      {id}
                      <button type="button" aria-label={`favourite ${id}`} className="m-small" style={{ border: 0, background: "none", cursor: "pointer", color: fav ? "var(--ok)" : "var(--ink-3)" }} onClick={() => toggleIn("favoriteVenues", id)}>★</button>
                      <button type="button" aria-label={msg("you.blockVenue", { venue: id })} className="m-small" style={{ border: 0, background: "none", cursor: "pointer", color: blocked ? "var(--bad)" : "var(--ink-3)" }} onClick={() => toggleIn("blockedVenues", id)}>⦸</button>
                    </span>
                  );
                })}
              </div>
            )}
          </Card>
          <Card title={msg("you.quietHoursNotifications")} kicker={msg("you.quietHoursWebhookTelegram")}>
            <div style={{ display: "grid", gap: 10 }}>
              <label className="flex gap-2 items-center m-small"><input type="checkbox" checked={p.quietHours.on} onChange={(e) => set("quietHours", { ...p.quietHours, on: e.target.checked })} />{msg("you.duringQuietHoursLykoOnlySpeaks")}</label>
              {p.quietHours.on ? <div className="flex gap-2"><Input value={p.quietHours.from} onChange={(e) => set("quietHours", { ...p.quietHours, from: e.target.value })} /><Input value={p.quietHours.to} onChange={(e) => set("quietHours", { ...p.quietHours, to: e.target.value })} /></div> : null}
              <Field label={msg("you.webhook")}><Input placeholder="https://…" value={p.notify.webhook} onChange={(e) => set("notify", { ...p.notify, webhook: e.target.value })} /></Field>
              <Field label="Telegram"><Input placeholder="@handle" value={p.notify.telegram} onChange={(e) => set("notify", { ...p.notify, telegram: e.target.value })} /></Field>
            </div>
          </Card>
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        <Card title={msg("you.dashboardOrder")} kicker={msg("you.dragToReorder")}>
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {p.widgets.map((w, i) => (
              <li key={w} draggable onDragStart={() => setDrag(w)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag) set("widgets", moveWidget(p.widgets, drag, i)); setDrag(null); }} className="m-frame m-frame--thin" style={{ padding: "10px 12px", cursor: "grab", display: "flex", justifyContent: "space-between", opacity: drag === w ? 0.5 : 1 }}>
                <span><b className="num" style={{ color: "var(--terra)" }}>{i + 1}</b> {WIDGET_NAMES[w].en}</span>
                <span className="flex gap-1">
                  <button type="button" aria-label={msg("you.moveUp")} className="m-small" style={{ border: 0, background: "none", cursor: "pointer" }} onClick={() => set("widgets", moveWidget(p.widgets, w, i - 1))}>▲</button>
                  <button type="button" aria-label={msg("you.moveDown")} className="m-small" style={{ border: 0, background: "none", cursor: "pointer" }} onClick={() => set("widgets", moveWidget(p.widgets, w, i + 1))}>▼</button>
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
          label={msg("you.previewOfYourBay")}
          night={p.theme === "night"}
          labels={[{ x: 50, y: 4, text: p.look.tag || "LYKO" }]}
        />
        <div className="flex justify-center items-center gap-3" style={{ marginTop: 20 }}>
          <Medallion size={96} />
          <Button size="lg" onClick={() => void save()}>{msg("you.save")}</Button>
          <Button size="lg" tone="ghost" onClick={() => setP(stored)}>{msg("you.revert")}</Button>
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
