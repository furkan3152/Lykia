/**
 * Herding · instructions. The drafts waiting for your signature (from
 * automations, insights and chats) first, then one list of every standing
 * instruction with its status, next run, last result and the Fence verdict
 * the next run is expected to get. Pause and resume need no signature;
 * changes go through Ask Lyko.
 */
import type { FoldInstruction, FoldProposal } from "@lykia/core/api/fold";
import { useState } from "react";

import { Button, EmptyState, Seal, Tag, cx } from "../../../mosaic";
import { ProposalStepper } from "../DraftSheet";
import { filterInstructions, HERDING_FILTERS, type HerdingFilter } from "../model";

const STATUS_TONE: Readonly<Record<FoldInstruction["status"], "ok" | "ghost" | "sea" | "bad" | "ochre">> = { active: "ok", waiting: "sea", paused: "ghost", done: "ghost", failed: "bad", cancelled: "ghost" };
const SOURCE_LABEL: Readonly<Record<FoldProposal["source"]["kind"], string>> = { insight: "from an insight", automation: "from an automation", chat: "from a chat", fence: "Fence edit", holding: "from a holding" };

function when(at: string | null): string {
  if (!at) return "—";
  const d = new Date(at);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
  readonly onToggle: (i: FoldInstruction) => void;
  /** Watch tasks from Ask Lyko are removed here. */
  readonly onRemove?: (i: FoldInstruction) => void;
  readonly onEdit: (i: FoldInstruction) => void;
  readonly onNew: () => void;
  readonly busyId: string | null;
}) {
  const [filter, setFilter] = useState<HerdingFilter>(props.initialFilter);
  const list = props.instructions ? filterInstructions(props.instructions, filter) : [];
  const locked = !props.signedIn && !props.sample;
  return (
    <div className="fd-stack">
      <section className="fd-card m-frame m-frame--thin fd-inbox" aria-labelledby="inbox-h">
        <header className="fd-card__head">
          <h3 id="inbox-h">{"Waiting for your signature"}</h3>
          <span className="m-kick">{props.waiting ? `${props.waiting.length} DRAFT${props.waiting.length === 1 ? "" : "S"}` : "…"}</span>
        </header>
        {locked ? (
          <EmptyState mood="watching" title="Drafts are personal">{"Sign in with your wallet to see what Lyko and your automations drafted for you."}<div style={{ marginTop: 10 }}><button type="button" className="m-btn m-btn--sm" onClick={props.onSignIn}>{"SIGN IN"}</button></div></EmptyState>
        ) : !props.waiting || props.waiting.length === 0 ? (
          <p className="fd-quiet">{props.sample ? "In your Fold, drafts that automations and insights produce wait here until you sign or stop them." : "Nothing waits for you. When an automation or an insight drafts something, it lands here, not in a log."}</p>
        ) : (
          <ul className="fd-inbox__list">
            {props.waiting.map((p) => (
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

      <section className="fd-card m-frame m-frame--thin" aria-labelledby="herd-h">
        <header className="fd-card__head fd-card__head--row">
          <div>
            <h3 id="herd-h">{"Every standing instruction"}</h3>
            <span className="m-kick">{props.sample ? "SAMPLE · " : ""}{"AUTOMATIONS · ORDERS · BARKS · RECURRING · STANDING"}</span>
          </div>
          <Button size="sm" tone="sea" onClick={props.onNew}>{"+ NEW RULE"}</Button>
        </header>
        <div className="fd-chips" role="tablist" aria-label="Filter instructions">
          {HERDING_FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="m-chip" onClick={() => setFilter(f.id)}>
              {f.label}
              {props.instructions ? <small className="num">{filterInstructions(props.instructions, f.id).length}</small> : null}
            </button>
          ))}
        </div>
        {locked ? (
          <EmptyState mood="watching" title="Your instructions are personal">{"Sign in to see every automation, order, alert and recurring payment in one list."}</EmptyState>
        ) : !props.instructions ? (
          <div className="m-skel" style={{ height: 220 }} />
        ) : list.length === 0 ? (
          <EmptyState mood="resting" title="Nothing herding here">{"Ask Lyko for a rule: \"Every Friday pay the team\", \"Sell cirBTC if it drops 10%\", \"Tell me when EURC passes 1.12\"."}</EmptyState>
        ) : (
          <div className="fd-herd" role="table" aria-label="Instructions">
            <div className="fd-herd__row fd-herd__row--head" role="row">
              <span role="columnheader">{"Instruction"}</span>
              <span role="columnheader">{"Status"}</span>
              <span role="columnheader">{"Next run"}</span>
              <span role="columnheader">{"Last run"}</span>
              <span role="columnheader">{"Next verdict"}</span>
              <span role="columnheader" className="r">{"Actions"}</span>
            </div>
            {list.map((i) => (
              <div key={i.id} className={cx("fd-herd__row", i.status === "paused" && "fd-herd__row--paused")} role="row">
                <span role="cell" className="fd-herd__name">
                  <Tag tone={i.source === "watch" ? "ochre" : "ghost"}>{i.sourceLabel}</Tag>
                  <b>{i.name}</b>
                  <small>{i.trigger}</small>
                </span>
                <span role="cell" data-label="Status"><Tag tone={STATUS_TONE[i.status]}>{i.status}</Tag></span>
                <span role="cell" data-label="Next run"><b className="num">{i.nextRunLabel}</b>{i.nextRunAt ? <small className="num">{when(i.nextRunAt)}</small> : null}</span>
                <span role="cell" data-label="Last run"><span>{i.lastResult ?? "—"}</span>{i.lastRunAt ? <small className="num">{when(i.lastRunAt)}</small> : null}</span>
                <span role="cell" data-label="Fence" className="fd-herd__verdict">
                  {i.nextVerdict && i.nextVerdict.decision !== "unknown" ? <Seal decision={i.nextVerdict.decision} stamp={false} /> : <Tag tone="ghost">{"checked when it runs"}</Tag>}
                  {i.nextVerdict ? <small>{i.nextVerdict.reason}</small> : null}
                </span>
                <span role="cell" className="r fd-herd__acts">
                  {i.controllable && (i.status === "active" || i.status === "paused") ? (
                    <Button size="sm" tone="ghost" disabled={props.busyId === i.id || props.sample} onClick={() => props.onToggle(i)}>{i.status === "paused" ? "RESUME" : "PAUSE"}</Button>
                  ) : null}
                  {i.source === "watch" && props.onRemove ? (
                    <Button size="sm" tone="ghost" disabled={props.busyId === i.id || props.sample} onClick={() => props.onRemove!(i)}>{"REMOVE"}</Button>
                  ) : (
                    <Button size="sm" tone="ghost" onClick={() => props.onEdit(i)}>{"EDIT VIA LYKO"}</Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
