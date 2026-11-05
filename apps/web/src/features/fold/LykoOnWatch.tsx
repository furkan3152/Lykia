/**
 * Lyko on watch: the portfolio assistant docked beside the Fold. Its first
 * message is synthesised from the server's insights (each with the figures
 * behind a "Why?" and a one-tap draft); its chat is the same server thread
 * as Ask Lyko, so either one can pick up where the other stopped.
 */
import { applyFoldShocks, describeShock, NO_SHOCK, shortAddress } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { FoldExplainArtifact, FoldInsight, FoldInsightsResponse, FoldInstruction, FoldQuestion } from "@lykia/core/api/fold";
import type { ThreadView } from "@lykia/core/api/agents";
import type { ThreadSummaryView } from "@lykia/core/api/fold";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Composer } from "../ask/Composer";
import { AssistantMessage, UserMessage } from "../ask/Answer";
import { ChatActionsContext, type ChatActions } from "../ask/actions";
import { storedMessage } from "../ask/model";
import { useAsk } from "../ask/store";
import { Markdown } from "../ask/Markdown";
import { apiGet, describeError } from "../../lib/api";
import { Button, LykoFace, LykoTile, Tag, cx, toast } from "../../mosaic";
import { useAnswer, useInstructionControl, useMarkSeen, type FoldOwner } from "./data";
import { FOLLOW_UPS, openingLine } from "./model";

const SEVERITY: Readonly<Record<FoldInsight["severity"], { label: string; tone: "bad" | "ochre" | "ghost" }>> = { act: { label: "Act", tone: "bad" }, watch: { label: "Watch", tone: "ochre" }, info: { label: "FYI", tone: "ghost" } };

function InsightCard({ insight, onDraft, onAsk, busy, sample }: { readonly insight: FoldInsight; readonly onDraft: (i: FoldInsight) => void; readonly onAsk: (i: FoldInsight) => void; readonly busy: boolean; readonly sample: boolean }) {
  const [why, setWhy] = useState(false);
  return (
    <li className={cx("fd-insight", insight.handled && "fd-insight--handled")} data-severity={insight.severity}>
      <div className="fd-insight__top">
        <Tag tone={insight.handled ? "ok" : SEVERITY[insight.severity].tone}>{insight.handled ? "Drafted" : SEVERITY[insight.severity].label}</Tag>
        <b>{insight.title}</b>
      </div>
      <p className="fd-insight__text">{insight.explain}</p>
      {insight.figures.length > 0 ? (
        <>
          <button type="button" className="fd-why-btn" aria-expanded={why} onClick={() => setWhy((w) => !w)}>
            {why ? "Hide the figures" : "Why?"}
          </button>
          {why ? (
            <dl className="fd-figures">
              {insight.figures.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd className="num">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : null}
      <div className="fd-insight__acts">
        {insight.draft && !insight.handled ? (
          <Button size="sm" disabled={busy || sample} onClick={() => onDraft(insight)} title={sample ? "Connect a wallet to draft for your own flock" : undefined}>
            {insight.draft.label}
          </Button>
        ) : null}
        <Button size="sm" tone="ghost" onClick={() => onAsk(insight)}>{"OPEN IN ASK LYKO"}</Button>
      </div>
    </li>
  );
}

function ArtifactBubble({ a }: { readonly a: FoldExplainArtifact }) {
  return (
    <div className="fd-art">
      <b>{a.title}</b>
      <p>{a.summary}</p>
      {a.lines.length > 0 ? (
        <dl>
          {a.lines.slice(0, 6).map((l) => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd className="num">{l.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export interface LykoOnWatchProps {
  readonly owner: FoldOwner;
  readonly insights: FoldInsightsResponse | undefined;
  readonly loading: boolean;
  readonly instructions: readonly FoldInstruction[] | undefined;
  readonly snapshot: FlockSnapshot | undefined;
  readonly minHealth: number;
  readonly busy: boolean;
  readonly onDraft: (i: FoldInsight) => void;
  readonly onOpenInAsk: (text: string, context: string) => void;
  readonly variant?: "dock" | "tab";
}

export function LykoOnWatch(p: LykoOnWatchProps) {
  const { owner } = p;
  const convo = useAsk((s) => s.convo);
  const status = useAsk((s) => s.status);
  const send = useAsk((s) => s.send);
  const stop = useAsk((s) => s.stop);
  const adopt = useAsk((s) => s.adopt);
  const answer = useAnswer(owner);
  const seen = useMarkSeen(owner);
  const control = useInstructionControl(owner);
  const [answers, setAnswers] = useState<{ id: number; question: string; artifact: FoldExplainArtifact }[]>([]);
  const [stripOpen, setStripOpen] = useState(false);
  const scroll = useRef<HTMLDivElement | null>(null);

  const insights = p.insights?.insights ?? [];
  const open = insights.filter((i) => !i.handled);
  const watches = (p.instructions ?? []).filter((i) => i.source === "automation" || i.source === "agent" || i.source === "alert");
  const on = watches.filter((w) => w.status === "active").length;
  const recent = convo.messages.slice(-6);

  // One thread with Ask Lyko: with nothing open here yet, pick up the latest shared thread from the server.
  const latest = useQuery({ queryKey: ["me-threads", owner.address, "latest"], enabled: owner.signedIn && !convo.threadId, retry: false, staleTime: 30_000, queryFn: ({ signal }) => apiGet<{ threads: ThreadSummaryView[] }>("/v1/me/threads", { signal }) });
  const latestId = latest.data?.threads[0]?.id ?? null;
  const threadId = convo.threadId ?? latestId;
  const history = useQuery({ queryKey: ["thread", threadId, owner.address], enabled: Boolean(owner.signedIn && threadId && convo.messages.length === 0), retry: false, queryFn: ({ signal }) => apiGet<ThreadView>(`/v1/agent/threads/${encodeURIComponent(threadId!)}`, { query: { owner: owner.address }, signal }) });
  useEffect(() => {
    if (latestId && !convo.threadId) adopt(latestId, latest.data?.threads[0]?.title ?? "Shared thread");
  }, [latestId, convo.threadId, adopt, latest.data]);
  const past = convo.messages.length === 0 ? (history.data?.messages ?? []).slice(-4) : [];

  useEffect(() => {
    const el = scroll.current;
    if (el && (recent.length > 0 || answers.length > 0)) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [recent.length, answers.length]);

  const ask = (question: FoldQuestion, label: string) => {
    if (owner.signedIn) {
      answer.mutate(
        { question, threadId: convo.threadId, ...(question === "whatif" ? { shocks: { EURC: -5 } } : {}) },
        {
          onSuccess: (r) => {
            adopt(r.threadId, r.question);
            setAnswers((a) => [...a, { id: Date.now(), question: r.question, artifact: r.artifact }]);
          },
          onError: (e) => toast.error("Lyko could not answer", { description: describeError(e), from: "LYKO" }),
        },
      );
      return;
    }
    // Signed out or another address: the what-if runs on the same shared model here; the rest needs the owner.
    if (question === "whatif" && p.snapshot) {
      const shocks = { ...NO_SHOCK, EURC: -5 };
      const result = applyFoldShocks(p.snapshot.holdings, p.snapshot.health, shocks);
      setAnswers((a) => [...a, { id: Date.now(), question: label, artifact: { kind: "whatif", title: "If EURC drops 5%", summary: describeShock(result, shocks, p.minHealth), lines: [], sources: ["the shared shock model"], at: new Date().toISOString() } }]);
      return;
    }
    setAnswers((a) => [...a, { id: Date.now(), question: label, artifact: { kind: question, title: label, summary: owner.sample ? "This is the sample flock. Connect a wallet and sign in (one message, no transaction), and I will answer this for your own." : "Sign in as this address (one message, no transaction) and I will answer this from your own records.", lines: [], sources: [], at: new Date().toISOString() } }]);
  };

  const chat = (text: string) => {
    void send(text, { environment: owner.environment, ...(owner.address ? { owner: owner.address as `0x${string}` } : {}), origin: "fold" });
  };

  const short = owner.address ? shortAddress(owner.address) : "a sample flock";
  const actions: ChatActions = {
    environment: owner.environment,
    // Cards here hand a sentence to Ask Lyko, with what Lyko on watch was looking at.
    prefill: (text) => p.onOpenInAsk(text, "From Lyko on watch in the Fold."),
    ask: (text) => chat(text),
  };

  return (
    <ChatActionsContext.Provider value={actions}>
    <aside className={cx("fd-lyko m-frame", p.variant === "tab" && "fd-lyko--tab")} aria-label="Lyko on watch">
      <header className="fd-lyko__head">
        <LykoFace mood={open.some((i) => i.severity === "act") ? "alert" : open.length > 0 ? "watching" : "resting"} scale={2} />
        <div>
          <h2>{"Lyko on watch"}</h2>
          <span className="m-kick">{"PROPOSES · YOU SIGN"}</span>
          <p className="m-small m-muted">{`Watching ${short} on Arc ${owner.environment}`}</p>
        </div>
      </header>

      <div className="fd-lyko__strip">
        <button type="button" className="fd-strip-btn" aria-expanded={stripOpen} onClick={() => setStripOpen((o) => !o)} disabled={watches.length === 0}>
          <span className="fd-strip-btn__dots" aria-hidden="true">{watches.slice(0, 8).map((w) => <i key={w.id} data-on={w.status === "active"} />)}</span>
          {watches.length === 0 ? (owner.sample ? "Watches appear here once you have rules" : owner.signedIn ? "No watches yet" : "Sign in to see your watches") : `${on} of ${watches.length} watches on`}
          {watches.length > 0 ? <span aria-hidden="true">{stripOpen ? "▴" : "▾"}</span> : null}
        </button>
        {stripOpen ? (
          <ul className="fd-watches">
            {watches.map((w) => (
              <li key={w.id}>
                <span>
                  <b>{w.name}</b>
                  <small>{w.trigger}</small>
                </span>
                <label className="fd-switch">
                  <input type="checkbox" checked={w.status === "active"} disabled={!owner.signedIn || control.isPending} onChange={() => control.mutate({ id: w.id, action: w.status === "active" ? "pause" : "resume" })} aria-label={`${w.status === "active" ? "Pause" : "Resume"} ${w.name}`} />
                  <i />
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="fd-lyko__scroll" ref={scroll}>
        {p.insights && p.insights.brief.lines.length > 0 ? (
          <section className="fd-brief" aria-label="New since your last visit">
            <span className="m-kick">{`NEW SINCE ${p.insights.brief.since ? new Date(p.insights.brief.since).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "YOUR LAST VISIT"}`}</span>
            <ul>{p.insights.brief.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            <button type="button" className="fd-why-btn" onClick={() => seen.mutate()}>{"Got it"}</button>
          </section>
        ) : null}

        <div className="fd-msg">
          <LykoTile mood={open.length === 0 ? "resting" : "happy"} size={32} />
          <div className="fd-bubble">{p.loading && !p.insights ? "Counting the flock…" : <Markdown text={openingLine(insights, owner.sample)} environment={owner.environment} />}</div>
        </div>

        {open.length === 0 && !p.loading ? (
          <div className="fd-quietvalley">
            <LykoFace mood="sleeping" scale={3} />
            <b>{"All quiet in the valley"}</b>
            <span className="m-small m-muted">{"Nothing needs you right now. I keep watching."}</span>
          </div>
        ) : (
          <ul className="fd-insights">
            {insights.map((i) => (
              <InsightCard key={i.id} insight={i} busy={p.busy} sample={owner.sample} onDraft={p.onDraft} onAsk={(x) => p.onOpenInAsk(x.draft?.sentence ?? `Tell me more about this: ${x.title}`, `${x.title}. ${x.explain} ${x.figures.map((f) => `${f.label}: ${f.value}`).join("; ")}`)} />
            ))}
          </ul>
        )}

        {past.length > 0 ? <span className="m-kick fd-past">{"EARLIER IN THIS THREAD"}</span> : null}
        {past.map((m, i) =>
          m.role === "user" ? (
            <UserMessage key={`p${i}`} text={m.text} compact />
          ) : (
            <div key={`p${i}`} className="fd-past-msg">
              <AssistantMessage compact m={storedMessage(m, `p${i}`)} />
              <small className="fd-bubble__more">{m.origin === "fold" ? "in the Fold" : "in Ask Lyko"}</small>
            </div>
          ),
        )}
        {answers.map((a) => (
          <div key={a.id} className="fd-turn">
            <div className="fd-msg fd-msg--me"><div className="fd-bubble">{a.question}</div></div>
            <div className="fd-msg"><LykoTile mood="happy" size={32} /><ArtifactBubble a={a.artifact} /></div>
          </div>
        ))}
        {recent.map((m) => (m.role === "user" ? <UserMessage key={m.id} text={m.text} compact /> : <AssistantMessage key={m.id} m={m} compact onChoose={chat} />))}
        {answer.isPending ? <div className="fd-msg"><LykoTile mood="herding" size={32} /><div className="fd-bubble m-caret">{"Reading your records…"}</div></div> : null}
      </div>

      <div className="fd-lyko__foot">
        <div className="fd-chips fd-chips--follow" aria-label="Ask a follow-up">
          {FOLLOW_UPS.map((f) => (
            <button key={f.question} type="button" className="m-chip" disabled={answer.isPending} onClick={() => ask(f.question, f.label)}>
              {f.label}
            </button>
          ))}
        </div>
        <Composer morph={false} onSubmit={chat} busy={status === "streaming"} onStop={stop} placeholder="Ask about your Fold…" meta="SAME THREAD AS ASK LYKO" sendLabel="ASK" className="fd-composer" />
        {convo.threadId ? (
          <button type="button" className="fd-why-btn" onClick={() => p.onOpenInAsk("", "Continued from the Fold.")}>{"Continue in Ask Lyko ›"}</button>
        ) : null}
      </div>
    </aside>
    </ChatActionsContext.Provider>
  );
}
