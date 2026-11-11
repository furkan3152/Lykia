/**
 * One message of the conversation, shared by Ask Lyko and Lyko on watch in
 * the Fold: Lyko's avatar with its state, the "Lyko at work" trail, the
 * answer in readable type (verdict first), then the cards that fit the
 * situation, drawn from typed data.
 */
import { Link } from "../../app/routes/Link";
import { cx } from "../../mosaic/cx";
import { SampleContext, useChatActions } from "./actions";
import { SampleCard } from "./controlCards";
import { herdFromDrafts } from "./cardModel";
import { BlockCard, ChoiceCard, HerdedCard, PlanCard, TroubleCard } from "./cards";
import { clarifyLabel } from "./clarify";
import { Markdown } from "./Markdown";
import { displayText } from "./richText";
import { failureReasons, handoffLine, type ChatMessage } from "./model";
import { useAsk } from "./store";
import { ProgramCard } from "./ProgramCard";
import { LykoAvatar, Trail } from "./Trail";
import { avatarState, elapsedOf, trailSteps } from "./workTrail";

export function UserMessage({ text, morph = false, compact = false }: { readonly text: string; readonly morph?: boolean; readonly compact?: boolean }) {
  return (
    <div className={cx("m-msg m-msg--user", compact && "m-msg--compact")}>
      <div className={cx("m-bubble m-bubble--me", morph && "vt-first")}>{text}</div>
    </div>
  );
}

export interface AssistantMessageProps {
  readonly m: ChatMessage;
  /** The Fold's narrow panel: smaller avatar, plans summarised. */
  readonly compact?: boolean;
  /** Clarify chips act here (Ask Lyko); without it they are not shown. */
  readonly onChoose?: (option: string) => void;
}

export function AssistantMessage({ m, compact = false, onChoose }: AssistantMessageProps) {
  const { environment } = useChatActions();
  const steps = trailSteps(m);
  const state = avatarState(m);
  const text = displayText(m.text);
  const reasons = m.streaming ? [] : failureReasons(m);
  const herded = (m.blocks ?? []).some((b) => b.kind === "herded");
  // No wallet connected: the sample card comes first, before any figure, and the cards below stop saying "your".
  const sample = (m.blocks ?? []).find((b) => b.kind === "sample");
  // Beside a plan, the plan card says what it costs and the review modal asks for the Fence's confirmation:
  // the separate "confirm first" gate and cost cards would only repeat it. A refusal keeps its gate card.
  const planned = m.proposals.length > 0 && !compact;
  const cards = (m.blocks ?? []).filter((b) => b.kind !== "sample" && !(planned && ((b.kind === "fence" && b.decision !== "deny") || (b.kind === "facts" && b.title.startsWith("What this plan costs")))));
  // Lyko asked a question: it is the only thing to do until it is answered.
  const asking = Boolean(m.clarify && m.clarify.options.length > 0 && onChoose);
  const drafts = m.drafts ?? [];
  const threadId = useAsk((st) => st.convo.threadId);
  return (
    <div className={cx("m-msg m-msg--lyko", compact && "m-msg--compact")} data-state={state}>
      <div className="m-msg__who">
        <LykoAvatar state={state} size={compact ? 32 : 40} />
      </div>
      <div className="m-answer">
        {m.instruction ? <span className="m-msg__handoff">{handoffLine(m.instruction)}</span> : null}
        <Trail steps={steps} streaming={m.streaming} elapsedMs={elapsedOf(m)} notes={(m.notes ?? []).filter((n) => n.trim() !== m.text.trim())} compact={compact} />
        {sample && sample.kind === "sample" ? <SampleCard block={sample} /> : null}
        {text ? (
          <div className={cx("m-bubble m-bubble--lyko", m.streaming && "m-caret")}>
            <Markdown text={text} environment={environment} lead />
          </div>
        ) : m.streaming ? (
          <div className="m-bubble m-bubble--lyko m-bubble--wait">
            <span className="m-wait">{steps.length === 0 ? "Lyko is picking up the scent…" : "Lyko is working on it…"}</span>
          </div>
        ) : null}
        {reasons.length > 0 ? (
          <div className="m-note m-note--bad" role="status">
            <b>Why:</b>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {m.error ? <TroubleCard message={m.error} /> : null}
        <SampleContext.Provider value={Boolean(sample)}>
          {cards.map((b, i) => (
            <BlockCard key={`${b.kind}${i}`} block={b} />
          ))}
        </SampleContext.Provider>
        {!herded && drafts.length > 0 ? <HerdedCard items={herdFromDrafts(drafts)} /> : null}
        {m.program && !compact ? <ProgramCard view={m.program} /> : null}
        {asking && m.clarify && onChoose ? <ChoiceCard question={m.clarify.question} options={m.clarify.options} label={clarifyLabel} onChoose={onChoose} /> : null}
        {compact && (m.program || m.proposals.length > 0) ? (
          // Lyko on watch does not sign: it hands the plan to Ask Lyko, in the same thread, and says so.
          <div className="m-handoff" role="status">
            <p className="m-answer__more">{`Handed to Ask Lyko: ${m.proposals.length || 1} plan${m.proposals.length > 1 ? "s" : ""} drafted in this same thread, ready to review and sign.`}</p>
            <Link to={threadId ? `/app/ask/${encodeURIComponent(threadId)}` : "/app"} className="m-btn m-btn--sm">{"REVIEW AND SIGN IN ASK ›"}</Link>
          </div>
        ) : (
          m.proposals.length > 0 ? <PlanCard proposals={m.proposals} waiting={asking} /> : null
        )}
        {!asking && m.clarify && onChoose ? <ChoiceCard question={m.clarify.question} options={m.clarify.options} label={clarifyLabel} onChoose={onChoose} /> : null}
      </div>
    </div>
  );
}
