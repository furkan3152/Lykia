/**
 * Fence · your spending rules, kept on the server per owner. The rules as
 * plain sentences, Lykia's beta limit set apart from them (what it is, why,
 * that it sits above every Fence and never limits money coming home), the
 * room left today, and one control to change them: the preset (Careful,
 * Balanced or Bold), which is also Your Lyko's risk profile, with a "what
 * changes" preview. Tightening applies at once; loosening is signed by the
 * owner's wallet. Anything finer goes through Ask Lyko. A Fence an older
 * version kept in this browser is proposed once. Safety (approvals, token
 * checks and pauses) closes the tab.
 */
import { fenceHash, fencePresetPreview, fenceSentences, FENCE_PRESET_IDS, FENCE_PRESETS, LYKIA_TERMS, MEANINGS, type BetaCap, type Fence, type FencePresetId } from "@lykia/core";
import type { FoldTrailEntry } from "@lykia/core/api/fold";
import { useState } from "react";

import { Button, LykoFace, Seal, cx, toast } from "../../../mosaic";
import { describeError } from "../../../lib/api";
import { useLykiaStore } from "../../../lib/lykiaStore";
import { legacyDiff, useFenceWrite } from "../../fence/data";
import type { OwnerFenceView } from "../../fence/sync";
import type { FoldOwner } from "../data";
import { SafetySection } from "./SafetySection";
import { BetaCapNote, Hint, Meaning } from "../../help/Help";
import { HeadroomGauge } from "../FoldBar";
import { fenceSuggestions, roomLine, type Headroom } from "../model";

export interface FenceTabProps {
  readonly fence: Fence;
  readonly owner: FoldOwner;
  /** The server's view of the owner's Fence (signed in), with its preset. */
  readonly view: OwnerFenceView | undefined;
  readonly headroom: Headroom;
  /** Lykia's beta limit on this network (mainnet), or null. */
  readonly beta: BetaCap | null;
  readonly verdicts: readonly FoldTrailEntry[];
  readonly onSuggest: (label: string, patch: Record<string, unknown>) => void;
  readonly onAsk: () => void;
  readonly onWhistle: () => void;
  readonly busy: boolean;
  /** Nothing of theirs has run yet: the rules and the beta limit stay; the gauges of zeros and the Whistle wait until something runs. */
  readonly newcomer?: boolean;
}

/** A Fence an older version kept in this browser: proposed once, kept (signed if it loosens) or let go. */
function LegacyFence({ legacy, view }: { readonly legacy: Fence; readonly view: OwnerFenceView }) {
  const write = useFenceWrite();
  const forget = useLykiaStore((s) => s.forgetLegacyFence);
  const diff = legacyDiff(view.fence, legacy);
  if (view.migrated || !diff.differs) return null;
  const keep = async () => {
    try {
      await write.save.mutateAsync({ fence: { ...legacy, mode: legacy.mode === "whistle" ? "live" : (legacy.mode ?? "live") }, migrated: true });
      forget();
      toast.success("Your Fence from before is your Fence now", { description: "It lives on the server, the same everywhere you sign in.", from: "LYKO" });
    } catch (e) {
      toast.error("Not kept", { description: describeError(e), from: "LYKO" });
    }
  };
  const drop = async () => {
    try {
      await write.settled.mutateAsync();
      forget();
    } catch (e) {
      toast.error("No change", { description: describeError(e), from: "LYKO" });
    }
  };
  return (
    <section className="fd-card m-frame m-frame--thin fd-legacy" aria-labelledby="legacy-h">
      <header className="fd-card__head fd-card__head--row">
        <LykoFace mood="watching" scale={2} />
        <div>
          <h3 id="legacy-h">{"This browser kept a Fence from before"}</h3>
          <span className="m-small m-muted">{"Your Fence lives on the server now. Keep the old one, or stay with your preset. Lyko asks once."}</span>
        </div>
      </header>
      {diff.loosens.length > 0 ? (
        <div className="p-preview">
          <b className="m-small">{"Keeping it loosens your Fence; your wallet signs first:"}</b>
          <ul>{diff.loosens.map((l) => <li key={l} data-dir="looser"><span>{l}</span></li>)}</ul>
        </div>
      ) : <p className="m-small">{"Keeping it only tightens your Fence."}</p>}
      <div className="p-fence-actions">
        <Button size="sm" disabled={write.save.isPending} onClick={() => void keep()}>{diff.loosens.length > 0 ? "SIGN AND KEEP IT" : "KEEP IT"}</Button>
        <Button size="sm" tone="ghost" disabled={write.settled.isPending} onClick={() => void drop()}>{`STAY WITH ${view.presetLabel.toUpperCase()}`}</Button>
      </div>
    </section>
  );
}

export function FenceTab({ fence, owner, view, headroom, beta, verdicts, onSuggest, onAsk, onWhistle, busy, newcomer = false }: FenceTabProps) {
  const rules = fenceSentences(fence).filter((s) => s.source === "yours");
  const legacy = useLykiaStore((s) => s.legacyFence);
  const write = useFenceWrite();
  // The preset is the risk profile (one control); custom edits on top show as "custom".
  const current: FencePresetId | null = view ? (view.custom ? null : view.preset) : "balanced";
  const [picked, setPicked] = useState<FencePresetId | null>(null);
  const preview = picked ? fencePresetPreview(fence, picked, beta) : null;
  const whistle = fence.mode === "whistle";
  const refused = verdicts.filter((v) => v.kind === "refused");
  const pickPreset = async (id: FencePresetId) => {
    if (owner.sample || !owner.signedIn) {
      toast.info(owner.sample ? "This is the sample flock" : "Sign in first", { description: "Your Fence is kept on the server for your address; sign in with your wallet to change it.", from: "LYKO" });
      return;
    }
    try {
      const saved = await write.preset.mutateAsync(id);
      setPicked(null);
      toast.success(`Your Fence is ${saved.presetLabel} now`, { description: saved.hash.slice(0, 22), from: "LYKO" });
    } catch (e) {
      toast.error("The Fence did not change", { description: describeError(e), from: "LYKO" });
    }
  };
  const status = whistle ? "Stopped: the Whistle is blown" : fence.mode === "dry-run" ? "Practice mode: nothing can be signed" : "On: every move is checked";
  return (
    <div className="fd-grid2 fd-grid2--fence">
      {legacy && view ? <div className="fd-span2"><LegacyFence legacy={legacy} view={view} /></div> : null}
      <div className="fd-stack">
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="fence-h">
          <header className="fd-card__head fd-card__head--row">
            <div>
              <h3 id="fence-h">{"Your rules"}</h3>
              <span className="m-small m-muted">{view ? (view.custom ? `Your own, built on ${view.presetLabel}` : `${view.presetLabel} preset`) : owner.sample ? "Balanced preset (sample)" : owner.signedIn ? "Reading your Fence…" : "Balanced preset until you sign in"}</span>
            </div>
            <span className={cx("p-fence-status", whistle && "is-stopped")}>{status}</span>
          </header>
          <p className="m-small">{"Lyko checks every move against these before you sign. If one rule says no, nothing moves."}</p>
          <ul className="p-rules">
            {rules.map((r) => (
              <li key={r.rule}>
                <span className="p-src p-src--yours">{"YOUR RULE"}</span>
                <div>
                  <b>{r.rule}</b>
                  <span>{r.text}</span>
                </div>
              </li>
            ))}
          </ul>
          {refused.length === 0 && !newcomer ? <p className="fd-quiet">{"Nothing was refused lately. When a rule says no, the reason shows here."}</p> : null}
          <details className="p-tech">
            <summary className="m-small">{"Technical details"}</summary>
            <p className="m-small m-muted">{"Kept on Lykia's server for your address, the same in Ask Lyko, the Fold and every automation. The same rules are checked before signing, compiled into your Circle wallet policy, and enforced on chain by your Lykia account. Missing facts count as a no."}</p>
            <span className="m-kick num">{fenceHash(fence)}</span>
          </details>
        </section>
        {beta ? (
          <section className="fd-card m-frame m-frame--thin p-betacard" aria-labelledby="beta-h">
            <header className="fd-card__head">
              <h3 id="beta-h">{"Lykia's beta limit"}</h3>
              <span className="p-src p-src--beta">{"NOT YOUR RULE · APPLIES TO EVERYONE"}</span>
            </header>
            <BetaCapNote cap={beta} />
          </section>
        ) : null}
      </div>
      <div className="fd-stack">
        {newcomer ? null : (
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="room-h">
          <header className="fd-card__head">
            <h3 id="room-h">
              {"Room left today"}
              <Hint text={MEANINGS.roomToday} />
            </h3>
          </header>
          <p className="p-room">{roomLine(headroom).replace(/^Room left today: /u, "")}</p>
          <HeadroomGauge h={headroom} large />
        </section>
        )}
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="change-h">
          <header className="fd-card__head">
            <h3 id="change-h">{"Change your rules"}</h3>
            <Meaning>{"One control: the preset is also Your Lyko's risk profile. Stricter applies at once; looser is signed by your wallet."}</Meaning>
          </header>
          <div className="p-presets" role="radiogroup" aria-label="Rule presets">
            {FENCE_PRESET_IDS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={picked === id} className={cx("p-preset", picked === id && "is-on", current === id && "is-current")} onClick={() => setPicked(picked === id ? null : id)}>
                <b>{FENCE_PRESETS[id].label}{current === id ? " · now" : ""}</b>
                <span>{FENCE_PRESETS[id].line}</span>
              </button>
            ))}
          </div>
          {preview ? (
            <div className="p-preview" aria-live="polite">
              <b className="m-small">{preview.summary}</b>
              {preview.changes.length > 0 ? (
                <ul>
                  {preview.changes.map((c) => (
                    <li key={c.what} data-dir={c.direction}>
                      <span>{c.what}</span>
                      <span className="num">{`${c.from} → ${c.to}`}</span>
                      <em>{c.direction === "tighter" ? "stricter" : "looser"}</em>
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.betaNote ? <p className="m-small m-muted">{preview.betaNote}</p> : null}
              {preview.changes.length > 0 ? (
                <Button size="sm" disabled={busy || write.preset.isPending} onClick={() => void pickPreset(preview.preset.id)}>
                  {write.preset.isPending ? "…" : preview.needsWallet ? "SIGN AND SWITCH" : "MAKE IT STRICTER NOW"}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="p-fence-actions">
            <Button size="sm" tone="ghost" onClick={onAsk}>{"CHANGE ONE RULE IN ASK LYKO"}</Button>
          </div>
          <details className="p-adjust">
            <summary className="m-small">{"Adjust one rule"}</summary>
            <div className="fd-suggest">
              {fenceSuggestions(fence).map((s) => (
                <button key={s.label} type="button" className="m-chip" disabled={busy} onClick={() => onSuggest(s.label, s.patch)}>
                  {s.label}
                </button>
              ))}
            </div>
          </details>
        </section>
        {newcomer && !whistle ? null : (
        <section className="fd-card m-frame m-frame--thin" aria-labelledby="whistle-h">
          <header className="fd-card__head">
            <h3 id="whistle-h">{`${LYKIA_TERMS.whistle.word} · ${LYKIA_TERMS.whistle.plain}`}</h3>
          </header>
          <p className="m-small">{LYKIA_TERMS.whistle.line}</p>
          <div className="p-fence-actions">
            <Button size="sm" tone={whistle ? "ochre" : "navy"} onClick={onWhistle}>{whistle ? "RELEASE · LET THINGS RUN AGAIN" : "BLOW THE WHISTLE"}</Button>
          </div>
        </section>
        )}
        {refused.length > 0 ? (
          <section className="fd-card m-frame m-frame--thin" aria-labelledby="why-h">
            <header className="fd-card__head">
              <h3 id="why-h">{"Recently refused, and why"}</h3>
            </header>
            <ul className="fd-why">
              {refused.slice(0, 4).map((v) => (
                <li key={v.id}>
                  <Seal decision="deny" stamp={false} />
                  <div>
                    <b>{v.title}</b>
                    <p className="m-small">{v.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {newcomer ? null : <div className="fd-span2"><SafetySection owner={owner} fence={fence} /></div>}
    </div>
  );
}
