/** <LykiaChat>: the assistant (Lyko, or your own name and avatar) in a card. */
import { useState, type FormEvent } from "react";
import { decisionClass } from "./components/plan.js";
import { useLykiaChat } from "./hooks.js";
import { LykiaRoot, ModuleOff, useLykia } from "./provider.js";

export interface LykiaChatProps {
  readonly placeholder?: string;
  readonly className?: string;
  /** Called with each proposal's intent id when the user picks it. */
  readonly onProposal?: (intentId: string) => void;
}

export function LykiaChat(props: LykiaChatProps) {
  const ctx = useLykia();
  const chat = useLykiaChat();
  const [text, setText] = useState("");
  if (!ctx.modules.has("chat")) return <ModuleOff module="chat" />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text;
    setText("");
    void chat.send(value);
  };
  return (
    <LykiaRoot name="chat" {...(props.className ? { className: props.className } : {})}>
      <section className="lk-card" aria-label={`${chat.assistantName} chat`}>
        <h3 className="lk-title">
          {ctx.avatarUrl ? <img className="lk-avatar" src={ctx.avatarUrl} alt="" /> : null}
          {chat.assistantName}
        </h3>
        <div className="lk-chat" role="log" aria-live="polite">
          {chat.messages.length === 0 ? <p className="lk-muted">{ctx.t("assistant.greeting", `Ask ${chat.assistantName} to send, swap, earn or check a token.`)}</p> : null}
          {chat.messages.map((m, i) => (
            <div key={i} className={`lk-msg ${m.role === "user" ? "lk-user" : "lk-assistant"}`}>{m.text}</div>
          ))}
          {chat.proposals.map((p, i) => (
            <div key={`p${i}`} className="lk-card" data-part="proposal">
              <div className="lk-row" style={{ justifyContent: "space-between" }}>
                <strong>{p.title}</strong>
                <span className={`lk-pill ${decisionClass(p.decision)}`}>{p.decision}</span>
              </div>
              <ul className="lk-list">{p.steps.map((s, j) => <li key={j}>{s}</li>)}</ul>
              {p.intentId && props.onProposal ? (
                <button className="lk-btn" type="button" onClick={() => props.onProposal?.(p.intentId as string)}>Review</button>
              ) : null}
            </div>
          ))}
          {chat.pending ? <p className="lk-muted">{chat.assistantName} is thinking…</p> : null}
          {chat.error ? <p className="lk-error" role="alert">{chat.error}</p> : null}
        </div>
        <form className="lk-row" onSubmit={submit}>
          <input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder={props.placeholder ?? ctx.t("chat.placeholder", "Send 25 USDC to 0x…")} style={{ flex: "1 1 200px" }} />
          <button className="lk-btn" type="submit" disabled={chat.pending || text.trim().length === 0}>{ctx.t("chat.send", "Send")}</button>
        </form>
      </section>
    </LykiaRoot>
  );
}
