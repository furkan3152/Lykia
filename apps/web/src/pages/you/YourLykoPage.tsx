/**
 * Your Lyko: how Lyko decides and speaks for you, and what it remembers.
 * Preferences (risk profile, liquidity floor, target mix, gas floor, which
 * insights to show and how to be told, and the Fold's own layout) live on
 * the server beside your memory; each one says what it changes. Lyko always
 * replies in English and understands any language, so there is no language
 * setting. Voice and look, and Memory, are the other two tabs.
 */
import { DEFAULT_FOLD_PREFERENCES, FOLD_CARDS, FOLD_INSIGHT_KINDS, FOLD_INSIGHT_NAMES, FOLD_TABS, foldPreferenceEffects, type FoldCard, type FoldInsightKind, type FoldPreferences, type FoldRisk, type FoldTab } from "@lykia/core";
import React, { useEffect, useMemo, useState } from "react";

import { navigate } from "../../app/routes/history";
import { useSearchParam } from "../../app/routes/useRoute";
import { usePreferences, useSavePreferences } from "../../features/fold/data";
import { FOLD_TAB_META } from "../../features/fold/model";
import { useSiwe } from "../../features/session/useSiwe";
import { describeError } from "../../lib/api";
import { Button, LykoFace, Tag, cx, toast } from "../../mosaic";

const VoiceAndLook = React.lazy(() => import("./YouPage"));
const Memory = React.lazy(() => import("../memory/MemoryPage"));

type Section = "preferences" | "voice" | "memory";
const SECTIONS: readonly { id: Section; label: string; sub: string }[] = [
  { id: "preferences", label: "Preferences", sub: "how Lyko decides" },
  { id: "voice", label: "Voice and look", sub: "how Lyko speaks" },
  { id: "memory", label: "Memory", sub: "what Lyko remembers" },
];

const RISKS: readonly { id: FoldRisk; title: string; line: string; mood: "resting" | "watching" | "proud" }[] = [
  { id: "careful", title: "Careful", line: "The lowest-risk venues, verified tokens only, 0.3% slippage.", mood: "resting" },
  { id: "balanced", title: "Balanced", line: "Established venues and up to 1% slippage.", mood: "watching" },
  { id: "bold", title: "Bold", line: "Higher yields allowed, up to 3% slippage. The Fence still decides.", mood: "proud" },
];

const CARD_NAMES: Readonly<Record<FoldCard, string>> = { networth: "Net worth", allocation: "Allocation strip", headroom: "Fence headroom", counts: "Counts and buttons" };

function Effect({ text }: { readonly text: string | undefined }) {
  return text ? <p className="yl-effect"><span aria-hidden="true">›</span> {text}</p> : null;
}

function move<T>(list: readonly T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function Preferences() {
  const siwe = useSiwe();
  const owner = { signedIn: siwe.signedIn, address: siwe.address ?? null };
  const remote = usePreferences(owner);
  const save = useSavePreferences(owner.address);
  const [draft, setDraft] = useState<FoldPreferences>(DEFAULT_FOLD_PREFERENCES);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt the server's copy until the owner edits
    if (!dirty) setDraft(remote.preferences);
  }, [remote.preferences, dirty]);
  const set = <K extends keyof FoldPreferences>(k: K, v: FoldPreferences[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };
  const effects = useMemo(() => Object.fromEntries(foldPreferenceEffects(draft).map((e) => [e.key, e.text])), [draft]);
  const mix = draft.targetMix;
  const setMix = (k: "usdcPct" | "eurcPct", v: number) => {
    const other = k === "usdcPct" ? mix.eurcPct : mix.usdcPct;
    const clamped = Math.max(0, Math.min(100 - other, v));
    set("targetMix", { ...mix, [k]: clamped, earningPct: 100 - other - clamped });
  };
  const hidden = new Set(draft.insights.hidden);
  const toggleInsight = (k: FoldInsightKind) => set("insights", { ...draft.insights, hidden: hidden.has(k) ? draft.insights.hidden.filter((x) => x !== k) : [...draft.insights.hidden, k] });
  const allTabs: FoldTab[] = [...draft.layout.tabs, ...FOLD_TABS.filter((t) => !draft.layout.tabs.includes(t))];
  const allCards: FoldCard[] = [...draft.layout.cards, ...FOLD_CARDS.filter((c) => !draft.layout.cards.includes(c))];

  const submit = async () => {
    if (!siwe.signedIn) return void siwe.signIn();
    try {
      const { updatedAt: _u, schema: _s, ...patch } = draft;
      await save.mutateAsync(patch);
      setDirty(false);
      toast.success("Lyko knows", { description: "Saved to your account. The Fold and Ask Lyko use it now.", from: "LYKO" });
    } catch (e) {
      toast.error("Not saved", { description: describeError(e), from: "LYKO" });
    }
  };

  return (
    <div className="yl-prefs">
      {!siwe.signedIn ? (
        <div className="fd-samplebar" role="note">
          <LykoFace mood="watching" scale={1} />
          <span>{"Try the settings here; sign in (one message, no transaction) to save them to your account, where the Fold and Ask Lyko read them."}</span>
          <Button size="sm" onClick={() => void siwe.signIn()} disabled={!siwe.address || siwe.busy}>{siwe.address ? "SIGN IN" : "CONNECT FIRST"}</Button>
        </div>
      ) : null}
      <div className="yl-grid">
        <section className="fd-card m-frame m-frame--thin yl-span2" aria-labelledby="risk-h">
          <header className="fd-card__head"><h3 id="risk-h">{"Risk profile"}</h3><span className="m-kick">{"PICKS YOUR DEFAULT FENCE AND THE ROUTING CEILING"}</span></header>
          <div className="yl-risks" role="radiogroup" aria-label="Risk profile">
            {RISKS.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={draft.risk === r.id} className={cx("yl-risk", draft.risk === r.id && "yl-risk--on")} onClick={() => set("risk", r.id)}>
                <LykoFace mood={r.mood} scale={2} />
                <b>{r.title}</b>
                <span className="m-small">{r.line}</span>
              </button>
            ))}
          </div>
          <Effect text={effects.risk} />
        </section>

        <section className="fd-card m-frame m-frame--thin" aria-labelledby="floor-h">
          <header className="fd-card__head"><h3 id="floor-h">{"Liquidity floor"}</h3><span className="m-kick">{"USDC THAT STAYS IN THE WALLET"}</span></header>
          <label className="yl-money"><span>$</span><input inputMode="decimal" value={draft.liquidityFloorUsd} onChange={(e) => set("liquidityFloorUsd", e.target.value.replace(/[^0-9.]/gu, "").slice(0, 12))} aria-label="Liquidity floor in USD" /></label>
          <div className="flex gap-2 flex-wrap">{["250", "500", "1200", "5000"].map((v) => <button key={v} type="button" className="m-chip yl-chip" onClick={() => set("liquidityFloorUsd", v)}>{`$${Number(v).toLocaleString("en-US")}`}</button>)}</div>
          <Effect text={effects.liquidityFloorUsd} />
        </section>

        <section className="fd-card m-frame m-frame--thin" aria-labelledby="gas-h">
          <header className="fd-card__head"><h3 id="gas-h">{"Gas floor"}</h3><span className="m-kick">{"ARC PAYS GAS IN USDC"}</span></header>
          <label className="yl-money"><input inputMode="decimal" value={draft.gasFloorUsdc} onChange={(e) => set("gasFloorUsdc", e.target.value.replace(/[^0-9.]/gu, "").slice(0, 8))} aria-label="Gas floor in USDC" /><span>USDC</span></label>
          <div className="flex gap-2 flex-wrap">{["0.1", "0.5", "2"].map((v) => <button key={v} type="button" className="m-chip yl-chip" onClick={() => set("gasFloorUsdc", v)}>{`${v} USDC`}</button>)}</div>
          <Effect text={effects.gasFloorUsdc} />
        </section>

        <section className="fd-card m-frame m-frame--thin yl-span2" aria-labelledby="mix-h">
          <header className="fd-card__head"><h3 id="mix-h">{"Target mix"}</h3><span className="m-kick">{"USDC · EURC · EARNING, WITH A BAND"}</span></header>
          <div className="yl-mixbar" role="img" aria-label={`USDC ${mix.usdcPct}%, EURC ${mix.eurcPct}%, earning ${mix.earningPct}%`}>
            <i style={{ flexGrow: mix.usdcPct, background: "var(--sea)" }}><span>{`USDC ${mix.usdcPct}%`}</span></i>
            <i style={{ flexGrow: mix.eurcPct, background: "var(--ochre)" }}><span>{`EURC ${mix.eurcPct}%`}</span></i>
            <i style={{ flexGrow: mix.earningPct, background: "var(--olive)" }}><span>{`Earning ${mix.earningPct}%`}</span></i>
          </div>
          <div className="fd-sliders">
            <label className="fd-slider"><span>{"USDC"}</span><input type="range" min={0} max={100} value={mix.usdcPct} onChange={(e) => setMix("usdcPct", Number(e.target.value))} /><b className="num">{mix.usdcPct}%</b></label>
            <label className="fd-slider"><span>{"EURC"}</span><input type="range" min={0} max={100} value={mix.eurcPct} onChange={(e) => setMix("eurcPct", Number(e.target.value))} /><b className="num">{mix.eurcPct}%</b></label>
            <label className="fd-slider"><span>{"Band"}</span><input type="range" min={1} max={50} value={mix.bandPct} onChange={(e) => set("targetMix", { ...mix, bandPct: Number(e.target.value) })} /><b className="num">{`± ${mix.bandPct}`}</b></label>
          </div>
          <p className="m-small m-muted">{"Earning takes what USDC and EURC leave, so the three always add up to 100."}</p>
          <Effect text={effects.targetMix} />
        </section>

        <section className="fd-card m-frame m-frame--thin yl-span2" aria-labelledby="ins-h">
          <header className="fd-card__head fd-card__head--row">
            <div><h3 id="ins-h">{"What Lyko watches for"}</h3><span className="m-kick">{"INSIGHTS AND HOW YOU HEAR ABOUT THEM"}</span></div>
            <div className="yl-seg" role="radiogroup" aria-label="Notify">
              {(["inbox", "webhook", "telegram"] as const).map((n) => <button key={n} type="button" role="radio" aria-checked={draft.insights.notify === n} onClick={() => set("insights", { ...draft.insights, notify: n })}>{n}</button>)}
            </div>
          </header>
          <ul className="yl-checks">
            {FOLD_INSIGHT_KINDS.map((k) => (
              <li key={k}>
                <label>
                  <input type="checkbox" checked={!hidden.has(k)} onChange={() => toggleInsight(k)} />
                  <span>{FOLD_INSIGHT_NAMES[k]}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="yl-seg" role="radiogroup" aria-label="How often">
            {(["live", "daily", "weekly"] as const).map((c) => <button key={c} type="button" role="radio" aria-checked={draft.insights.cadence === c} onClick={() => set("insights", { ...draft.insights, cadence: c })}>{c === "live" ? "as it happens" : c === "daily" ? "once a day" : "once a week"}</button>)}
          </div>
          <Effect text={effects.insights} />
        </section>

        <section className="fd-card m-frame m-frame--thin yl-span3" aria-labelledby="layout-h">
          <header className="fd-card__head"><h3 id="layout-h">{"Your Fold"}</h3><span className="m-kick">{"TABS AND BAR CARDS: SHOW, HIDE, ORDER"}</span></header>
          <div className="yl-orders">
          <ol className="yl-order">
            {allTabs.map((t) => {
              const on = draft.layout.tabs.includes(t);
              const i = draft.layout.tabs.indexOf(t);
              return (
                <li key={t} data-on={on}>
                  <label><input type="checkbox" checked={on} disabled={on && draft.layout.tabs.length === 1} onChange={() => set("layout", { ...draft.layout, tabs: on ? draft.layout.tabs.filter((x) => x !== t) : [...draft.layout.tabs, t] })} /><span>{`${FOLD_TAB_META[t].label} · ${FOLD_TAB_META[t].sub}`}</span></label>
                  <span className="yl-order__btns">
                    <button type="button" aria-label={`Move ${FOLD_TAB_META[t].label} up`} disabled={!on || i === 0} onClick={() => set("layout", { ...draft.layout, tabs: move(draft.layout.tabs, i, -1) })}>{"▲"}</button>
                    <button type="button" aria-label={`Move ${FOLD_TAB_META[t].label} down`} disabled={!on || i === draft.layout.tabs.length - 1} onClick={() => set("layout", { ...draft.layout, tabs: move(draft.layout.tabs, i, 1) })}>{"▼"}</button>
                  </span>
                </li>
              );
            })}
          </ol>
          <ol className="yl-order">
            {allCards.map((c) => {
              const on = draft.layout.cards.includes(c);
              return (
                <li key={c} data-on={on}>
                  <label><input type="checkbox" checked={on} onChange={() => set("layout", { ...draft.layout, cards: on ? draft.layout.cards.filter((x) => x !== c) : [...draft.layout.cards, c] })} /><span>{CARD_NAMES[c]}</span></label>
                </li>
              );
            })}
          </ol>
          </div>
          <Effect text={effects.layout} />
        </section>
      </div>
      <div className="yl-save">
        <Tag tone={dirty ? "ochre" : siwe.signedIn ? "ok" : "ghost"}>{dirty ? "UNSAVED CHANGES" : siwe.signedIn ? "SAVED TO YOUR ACCOUNT" : "NOT SIGNED IN"}</Tag>
        <Button tone="ghost" onClick={() => { setDraft(DEFAULT_FOLD_PREFERENCES); setDirty(true); }}>{"DEFAULTS"}</Button>
        <Button onClick={() => void submit()} disabled={save.isPending || (siwe.signedIn && !dirty)}>{siwe.signedIn ? (save.isPending ? "SAVING…" : "SAVE") : "SIGN IN TO SAVE"}</Button>
      </div>
    </div>
  );
}

export default function YourLykoPage() {
  const param = useSearchParam("tab");
  const section: Section = SECTIONS.some((s) => s.id === param) ? (param as Section) : "preferences";
  return (
    <div className="yl">
      <header className="yl-head m-wrap m-wrap--wide">
        <LykoFace mood="happy" scale={3} />
        <div>
          <span className="m-kick">{"YOUR LYKO"}</span>
          <h1>{"How Lyko decides, speaks and remembers for you"}</h1>
          <p>{"Everything here is a preference: your Fence still has the last word, and a preference can only make it stricter."}</p>
        </div>
      </header>
      <nav className="m-wrap m-wrap--wide yl-tabs" role="tablist" aria-label="Your Lyko">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className="fd-tab" onClick={() => navigate(`/app/you${s.id === "preferences" ? "" : `?tab=${s.id}`}`, { replace: true })}>
            <span className="fd-tab__l">{s.label}</span>
            <span className="fd-tab__s">{s.sub}</span>
          </button>
        ))}
      </nav>
      <div className={cx("yl-body", section !== "preferences" && "yl-embed")}>
        {section === "preferences" ? (
          <div className="m-wrap m-wrap--wide"><Preferences /></div>
        ) : (
          <React.Suspense fallback={<div className="m-wrap"><div className="m-skel" style={{ height: 320 }} /></div>}>
            {section === "voice" ? <VoiceAndLook /> : <Memory />}
          </React.Suspense>
        )}
      </div>
    </div>
  );
}
