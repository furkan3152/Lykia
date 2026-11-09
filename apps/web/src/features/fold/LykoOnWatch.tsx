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

import { navigate } from "../../app/routes/history";
import { HowItWorks } from "../help/Help";
import { Composer } from "../ask/Composer";
import { SourceStamp } from "../ask/cards";
import { AssistantMessage, UserMessage } from "../ask/Answer";
import { ChatActionsContext, type ChatActions } from "../ask/actions";
import { storedMessage } from "../ask/model";
import { useAsk } from "../ask/store";
import { Markdown } from "../ask/Markdown";
import { apiGet, describeError } from "../../lib/api";
import { Button, LykoFace, LykoTile, Tag, cx, toast } from "../../mosaic";
import { useAnswer, useInstructionControl, useMarkSeen, useSendToAsk, type FoldOwner } from "./data";
import { FOLLOW_UPS, openingLine } from "./model";

const SEVERITY: Readonly<Record<FoldInsight["severity"], { label: string; tone: "bad" | "ochre" | "ghost" }>> = { act: { label: "Act", tone: "bad" }, watch: { label: "Watch", tone: "ochre" }, info: { label: "FYI", tone: "ghost" } };

const SENT_WORD: Readonly<Record<string, string>> = { planned: "planned", signed: "signed", done: "signed", refused: "refused by your Fence", stopped: "stopped", pending: "sent" };

function InsightCard({ insight, onDraft, onAsk, onSend, onOpenThread, busy, sending, sample }: { readonly insight: FoldInsight; readonly onDraft: (i: FoldInsight) => void; readonly onAsk: (i: FoldInsight) => void; readonly onSend: (i: FoldInsight) => void; readonly onOpenThread: (threadId: string | null) => void; readonly busy: boolean; readonly sending: boolean; readonly sample: boolean }) {
  const [why, setWhy] = useState(false);
  const actionable = Boolean(insight.draft?.sentence);
  return (
    <li className={cx("fd-insight", insight.handled && "fd-insight--handled")} data-severity={insight.severity}>
      <div className="fd-insight__top">
        <Tag tone={insight.sent ? "sea" : insight.handled ? "ok" : SEVERITY[insight.severity].tone}>{insight.sent ? `Sent to Ask Lyko · ${SENT_WORD[insight.sent.status] ?? insight.sent.status}` : insight.handled ? "Drafted" : SEVERITY[insight.severity].label}</Tag>
        {insight.origin?.agent === "ask" ? <Tag tone="ochre">From Ask Lyko</Tag> : null}
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
          {why && insight.from ? <SourceStamp from={insight.from} compact /> : null}
        </>
      ) : null}
      <div className="fd-insight__acts">
        {insight.sent ? (
          <Button size="sm" tone="ghost" onClick={() => onOpenThread(insight.sent!.threadId)}>{"OPEN THE PLAN"}</Button>
        ) : (
          <>
            {insight.draft && !insight.handled ? (
              <Button size="sm" disabled={busy || sample} onClick={() => onDraft(insight)} title={sample ? "Connect a wallet to draft for your own flock" : undefined}>
                {insight.draft.label}
              </Button>
            ) : null}
            {actionable && !insight.handled ? (
              <Button size="sm" tone="ghost" disabled={sending || sample} onClick={() => onSend(insight)} title={sample ? "Connect a wallet and sign in to hand this over" : "Ask Lyko plans it step by step on your shared thread"}>{sending ? "SENDING…" : "SEND TO ASK LYKO"}</Button>
            ) : (
              <Button size="sm" tone="ghost" onClick={() => onAsk(insight)}>{"OPEN IN ASK LYKO"}</Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** A chip's answer: every line with the source and the block or time it was read; "unavailable" lines look it. */
function ArtifactBubble({ a }: { readonly a: FoldExplainArtifact }) {
  return (
    <div className="fd-art">
      <b>{a.title}</b>
      <p>{a.summary}</p>
      {a.lines.length > 0 ? (
        <dl>
          {a.lines.slice(0, 6).map((l) => (
            <div key={l.label} data-unavailable={l.value === "unavailable" || undefined}>
              <dt>{l.label}</dt>
              <dd className="num">{l.value}</dd>
              {l.note ? <small className="fd-art__note">{l.note}</small> : null}
              {l.from ? <SourceStamp from={l.from} compact /> : null}
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
  const sendToAsk = useSendToAsk(owner);
  const receive = useAsk((s) => s.receive);
  const [answers, setAnswers] = useState<{ id: number; question: string; artifact: FoldExplainArtifact }[]>([]);
  const [stripOpen, setStripOpen] = useState(false);
  const scroll = useRef<HTMLDivElement | null>(null);

  const insights = p.insights?.insights ?? [];
  const open = insights.filter((i) => !i.handled);
  const watches = (p.instructions ?? []).filter((i) => i.source === "automation" || i.source === "agent" || i.source === "alert" || i.source === "watch");
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
    // Signed in, or the sample: the API answers from the same reads (or the same fixture) the Fold shows, with sources.
    if (owner.signedIn || owner.sample) {
      answer.mutate(
        { question, threadId: convo.threadId, ...(question === "whatif" ? { shocks: { EURC: -5 } } : {}) },
        {
          onSuccess: (r) => {
            if (!owner.sample) adopt(r.threadId, r.question);
            setAnswers((a) => [...a, { id: Date.now(), question: r.question, artifact: r.artifact }]);
          },
          onError: (e) => toast.error("Lyko could not answer", { description: describeError(e), from: "LYKO" }),
        },
      );
      return;
    }
    // Another address, not signed in: the what-if runs on the same shared model here; the rest needs the owner.
    if (question === "whatif" && p.snapshot) {
      const shocks = { ...NO_SHOCK, EURC: -5 };
      const result = applyFoldShocks(p.snapshot.holdings, p.snapshot.health, shocks);
      setAnswers((a) => [...a, { id: Date.now(), question: label, artifact: { kind: "whatif", title: "If EURC drops 5%", summary: describeShock(result, shocks, p.minHealth), lines: [], sources: ["the shared shock model"], at: new Date().toISOString() } }]);
      return;
    }
    setAnswers((a) => [...a, { id: Date.now(), question: label, artifact: { kind: question, title: label, summary: "Sign in as this address (one message, no transaction) and I will answer this from your own records.", lines: [], sources: [], at: new Date().toISOString() } }]);
  };

  // Lyko on watch hands the insight to Ask Lyko: planned on the server as a staged plan, written to the shared thread.
  const handOver = (i: FoldInsight) => {
    sendToAsk.mutate(
      { insightId: i.id, threadId: convo.threadId ?? latestId },
      {
        onSuccess: (r) => {
          adopt(r.threadId, r.instruction.payload.kind === "plan" ? r.instruction.payload.title : i.title);
          receive(r.threadId, { ...storedMessage({ role: "assistant", text: `From Lyko on watch: ${(i.draft?.label ?? i.title).toLowerCase()}. ${r.proposal.intentId ? "Planned step by step; review and sign it here." : "Your Fence refused the plan."}`, at: r.instruction.createdAt, proposals: r.proposal.intentId ? [r.proposal] : [], origin: "fold", instruction: { id: r.instruction.id, from: "watch", to: "ask", kind: "plan", label: i.title } }, `h${Date.now()}`) });
          toast.success(r.instruction.status === "planned" ? "Sent to Ask Lyko · planned" : "Sent to Ask Lyko · refused", { description: r.instruction.status === "planned" ? "Open Ask Lyko to review and sign it step by step." : "Your Fence refused the plan; the reason is in the thread.", from: "LYKO" });
        },
        onError: (e) => toast.error("Not sent", { description: describeError(e), from: "LYKO" }),
      },
    );
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
          <span className="m-kick">{"SUGGESTS · YOU SIGN"}</span>
          <p className="m-small m-muted">{`Reads everything in your Fold (${short}, Arc ${owner.environment}) and tells you what needs you.`}</p>
          <HowItWorks area="lyko" className="fd-lyko__how" />
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
                  <small>{w.source === "watch" ? `From Ask Lyko · ${w.lastResult ?? "not checked yet"}` : w.trigger}</small>
                </span>
                <label className="fd-switch">
                  <input type="checkbox" checked={w.status === "active"} disabled={!owner.signedIn || control.isPending} onChange={() => control.mutate({ id: w.id, action: w.status === "active" ? "pause" : "resume", source: w.source })} aria-label={`${w.status === "active" ? "Pause" : "Resume"} ${w.name}`} />
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
          <div className="fd-bubble">{p.loading && !p.insights ? "Counting the flock…" : <Markdown text={openingLine(insights, owner.sample)} environment={owner.environment} figures />}</div>
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
              <InsightCard key={i.id} insight={i} busy={p.busy} sample={owner.sample || !owner.signedIn} sending={sendToAsk.isPending && sendToAsk.variables?.insightId === i.id} onSend={handOver} onOpenThread={(t) => navigate(t ? `/app/ask/${encodeURIComponent(t)}` : "/app")} onDraft={p.onDraft} onAsk={(x) => p.onOpenInAsk(x.draft?.sentence ?? `Tell me more about this: ${x.title}`, `${x.title}. ${x.explain} ${x.figures.map((f) => `${f.label}: ${f.value}`).join("; ")}`)} />
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
