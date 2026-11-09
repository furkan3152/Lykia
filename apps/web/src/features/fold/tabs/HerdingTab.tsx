/**
 * Herding · Running. The drafts waiting for your signature first, then one
 * list of everything in motion, whatever engine holds it: automations (with
 * who signs), orders, watches, leashes, Autopilot, plans in progress and
 * payment links. Every row is a tessera strip with four things: what it is
 * in one plain line, its state, what happens next and when, and the one
 * control that fits (Pause, Resume, Stop, Revoke or Cancel). Anything else
 * goes to Ask Lyko ("Change in Ask Lyko"); nothing is created here.
 */
import type { FoldInstruction, FoldProposal, RunningKind } from "@lykia/core/api/fold";
import { useState } from "react";

import { PixelIcon, type PixelIconName } from "../../../city/PixelIcon";
import { Button, EmptyState, Seal, Tag, cx } from "../../../mosaic";
import { ProposalStepper } from "../DraftSheet";
import { controlOf, filterInstructions, HERDING_FILTERS, kindOf, SIGNER_LINE, type HerdingFilter } from "../model";

const SOURCE_LABEL: Readonly<Record<FoldProposal["source"]["kind"], string>> = { insight: "from an insight", automation: "from an automation", chat: "from a chat", fence: "Fence edit", holding: "from a holding" };

/** Each noun's tessera: its pixel icon and its stone colour. */
const KIND_ART: Readonly<Record<RunningKind, { readonly icon: PixelIconName; readonly tone: "sea" | "ochre" | "olive" | "terra" | "navy"; readonly word: string }>> = {
  automation: { icon: "repeat", tone: "sea", word: "Automation" },
  order: { icon: "order", tone: "ochre", word: "Order" },
  watch: { icon: "eye", tone: "olive", word: "Watch" },
  leash: { icon: "leash", tone: "terra", word: "Leash" },
  autopilot: { icon: "pilot", tone: "navy", word: "Autopilot" },
  plan: { icon: "plan", tone: "ochre", word: "Plan" },
  payment: { icon: "coin", tone: "olive", word: "Payment" },
};

const STATE: Readonly<Record<FoldInstruction["status"], { readonly word: string; readonly tone: "ok" | "ghost" | "sea" | "bad" | "ochre" }>> = {
  active: { word: "running", tone: "ok" },
  waiting: { word: "waiting", tone: "sea" },
  paused: { word: "paused", tone: "ghost" },
  done: { word: "done", tone: "ghost" },
  failed: { word: "failed", tone: "bad" },
  cancelled: { word: "cancelled", tone: "ghost" },
};

function when(at: string | null): string | null {
  if (!at) return null;
  return new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The stones above the list: one per noun, filled as many as run. */
function Tally({ list, filter, onPick }: { readonly list: readonly FoldInstruction[]; readonly filter: HerdingFilter; readonly onPick: (f: HerdingFilter) => void }) {
  const kinds = HERDING_FILTERS.filter((f) => f.id !== "all" && f.id !== "paused") as { id: RunningKind; label: string }[];
  return (
    <div className="fd-run__tally" role="tablist" aria-label="Filter what runs">
      <button type="button" role="tab" aria-selected={filter === "all"} className="fd-run__stone" data-tone="navy" onClick={() => onPick("all")}>
        <span className="fd-run__stoneicon" aria-hidden="true"><PixelIcon name="list" size={16} /></span>
        <b className="num">{list.length}</b>
        <span>{"All"}</span>
      </button>
      {kinds.map((k) => {
        const n = filterInstructions(list, k.id).length;
        if (n === 0 && filter !== k.id) return null;
        return (
          <button key={k.id} type="button" role="tab" aria-selected={filter === k.id} className="fd-run__stone" data-tone={KIND_ART[k.id].tone} onClick={() => onPick(k.id)}>
            <span className="fd-run__stoneicon" aria-hidden="true"><PixelIcon name={KIND_ART[k.id].icon} size={16} /></span>
            <b className="num">{n}</b>
            <span>{k.label}</span>
          </button>
        );
      })}
      {filterInstructions(list, "paused").length > 0 || filter === "paused" ? (
        <button type="button" role="tab" aria-selected={filter === "paused"} className="fd-run__stone" data-tone="ghost" onClick={() => onPick("paused")}>
          <span className="fd-run__stoneicon" aria-hidden="true"><PixelIcon name="shield" size={16} /></span>
          <b className="num">{filterInstructions(list, "paused").length}</b>
          <span>{"Paused"}</span>
        </button>
      ) : null}
    </div>
  );
}

export function RunningRow({ i, busy, sample, onControl, onChange }: { readonly i: FoldInstruction; readonly busy: boolean; readonly sample: boolean; readonly onControl: (i: FoldInstruction) => void; readonly onChange: (i: FoldInstruction) => void }) {
  const kind = kindOf(i);
  const art = KIND_ART[kind];
  const control = controlOf(i);
  const state = STATE[i.status];
  const at = when(i.nextRunAt);
  const stop = control && (control.action === "stop" || control.action === "cancel");
  return (
    <li className={cx("fd-run__row", i.status === "paused" && "is-paused")} data-kind={kind} data-tone={art.tone}>
      <span className="fd-run__tile" aria-hidden="true">
        <PixelIcon name={art.icon} size={22} />
      </span>
      <div className="fd-run__what">
        <span className="fd-run__chips">
          <span className="fd-run__kind">{i.sourceLabel || art.word}</span>
          {i.signs ? <span className="fd-run__signs" data-signs={i.signs}>{SIGNER_LINE[i.signs]}</span> : null}
          {i.channels?.map((c) => <span key={c} className="fd-run__chan">{c === "telegram" ? "Telegram" : c}</span>)}
        </span>
        <b className="fd-run__name">{i.name}</b>
        <small className="fd-run__trigger">{i.trigger}</small>
      </div>
      <div className="fd-run__state">
        <Tag tone={state.tone}>{state.word}</Tag>
        {i.nextVerdict && i.nextVerdict.decision !== "unknown" && kind !== "payment" ? <Seal decision={i.nextVerdict.decision} stamp={false} /> : null}
      </div>
      <div className="fd-run__next">
        <span className="fd-run__nextk">{"NEXT"}</span>
        <span className="fd-run__nextline">{i.nextLine ?? i.nextRunLabel}</span>
        <small className="num">{at ? `${i.nextRunLabel} · ${at}` : i.nextRunLabel}</small>
      </div>
      <div className="fd-run__acts">
        {control ? (
          <Button size="sm" tone={stop ? "terra" : control.action === "resume" ? "sea" : "ghost"} disabled={busy || (sample && !control.sign)} onClick={() => onControl(i)} title={control.sign === "revoke-session" ? "The key stops at once; then your wallet ends its session on chain" : control.sign === "order-cancel" ? "One transaction you sign; nothing else moves" : undefined}>
            {busy ? "…" : control.label.toUpperCase()}
          </Button>
        ) : null}
        <button type="button" className="fd-run__ask" onClick={() => onChange(i)}>{"Change in Ask Lyko"}</button>
      </div>
    </li>
  );
}

export function HerdingTab(props: {
  readonly instructions: readonly FoldInstruction[] | undefined;
  readonly waiting: readonly FoldProposal[] | undefined;
  readonly sample: boolean;
  readonly signedIn: boolean;
  readonly initialFilter: HerdingFilter;
  readonly onSignIn: () => void;
  readonly onOpen: (p: FoldProposal) => void;
  readonly onStop: (p: FoldProposal) => void;
  /** The row's one control (Pause, Resume, Stop, Revoke or Cancel). */
  readonly onControl: (i: FoldInstruction) => void;
  /** "Change in Ask Lyko": Ask opens with the row named. */
  readonly onChange: (i: FoldInstruction) => void;
  /** "Ask Lyko": start something new there. */
  readonly onAsk: () => void;
  readonly busyId: string | null;
}) {
  const [filter, setFilter] = useState<HerdingFilter>(props.initialFilter);
  const list = props.instructions ? filterInstructions(props.instructions, filter) : [];
  const locked = !props.signedIn && !props.sample;
  return (
    <div className="fd-stack">
      {/* Calm: the inbox shows only when something waits (or to ask for a sign-in). */}
      {locked || (props.waiting && props.waiting.length > 0) ? (
        <section className="fd-card m-frame m-frame--thin fd-inbox" aria-labelledby="inbox-h">
          <header className="fd-card__head">
            <h3 id="inbox-h">{"Waiting for your signature"}</h3>
            <span className="m-kick">{props.waiting ? `${props.waiting.length} DRAFT${props.waiting.length === 1 ? "" : "S"}` : "…"}</span>
          </header>
          {locked ? (
            <EmptyState mood="watching" title="Drafts are personal">{"Sign in with your wallet to see what Lyko and your automations drafted for you."}<div style={{ marginTop: 10 }}><button type="button" className="m-btn m-btn--sm" onClick={props.onSignIn}>{"SIGN IN"}</button></div></EmptyState>
          ) : (
            <ul className="fd-inbox__list">
              {(props.waiting ?? []).map((p) => (
                <li key={p.id} className="fd-proposal">
                  <div className="fd-proposal__main">
                    <div className="fd-proposal__top">
                      <Tag tone="ghost">{SOURCE_LABEL[p.source.kind]}</Tag>
                      {p.decision !== "unknown" ? <Seal decision={p.decision} stamp={false} /> : null}
                    </div>
                    <b>{p.title}</b>
                    {p.steps.length > 0 ? <span className="m-small m-muted">{p.steps.slice(0, 2).join(" → ")}{p.steps.length > 2 ? " …" : ""}</span> : null}
                    <ProposalStepper p={p} />
                  </div>
                  <div className="fd-proposal__acts">
                    <Button size="sm" onClick={() => props.onOpen(p)}>{p.status === "approved" ? "CONTINUE" : "REVIEW AND SIGN"}</Button>
                    <Button size="sm" tone="ghost" onClick={() => props.onStop(p)} disabled={props.busyId === p.id}>{"STOP"}</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="fd-card m-frame m-frame--thin fd-run" aria-labelledby="run-h">
        <header className="fd-run__head">
          <div>
            <h3 id="run-h">{"Running"}</h3>
            <span className="m-small m-muted">{`${props.sample ? "Sample. " : ""}Everything in motion, one row each. ${props.waiting ? (props.waiting.length === 0 ? "Nothing waits for your signature." : `${props.waiting.length} draft${props.waiting.length === 1 ? " waits" : "s wait"} above.`) : ""}`}</span>
          </div>
          <Button size="sm" tone="terra" onClick={props.onAsk}>{"ASK LYKO"}</Button>
        </header>
        {props.instructions ? <Tally list={props.instructions} filter={filter} onPick={setFilter} /> : null}
        {locked ? (
          <EmptyState mood="watching" title="What runs for you is personal">{"Sign in to see every automation, order, watch, leash and payment link in one list."}</EmptyState>
        ) : !props.instructions ? (
          <div className="m-skel" style={{ height: 220 }} />
        ) : list.length === 0 ? (
          <EmptyState mood="resting" title="Nothing running here">{"Start it in Ask Lyko: \"Every Friday pay the team\", \"Sell cirBTC if it drops 10%\", \"Tell me when EURC passes 1.12\", \"Give my bot $20 a day for a week\"."}</EmptyState>
        ) : (
          <ul className="fd-run__list" aria-label="Running">
            {list.map((i) => (
              <RunningRow key={`${i.source}:${i.id}`} i={i} busy={props.busyId === i.id} sample={props.sample} onControl={props.onControl} onChange={props.onChange} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
