import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { apiGet } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Button, LykoFace, cx } from "../../mosaic";
import { insertMention, matchContacts, mentionAt, MEMORY_PHRASES, type ContactRef } from "./memoryRefs";
import { composerHint, nextBlank, sendWord } from "./starters";

export interface ComposerProps {
  readonly onSubmit: (text: string) => void;
  readonly busy?: boolean;
  readonly onStop?: () => void;
  readonly autoFocus?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
  /** Shared-element name so the composer morphs between pages. */
  readonly morph?: boolean;
  readonly initial?: string;
  /** Show memory chips ("again", "same as last week", "@") under the composer. */
  readonly memoryChips?: boolean;
  /** Text to drop in (not send): applied whenever its nonce changes. */
  readonly prefill?: { readonly text: string; readonly nonce: number } | null;
  /** The small label above the text box. */
  readonly meta?: string;
  /** The send button's label. */
  readonly sendLabel?: string;
  /** Show what the sentence still lacks (amount, token, destination) under the text box. */
  readonly hints?: boolean;
}

/** Ask Lyko's composer: grows with the text, Enter sends, Shift+Enter breaks a line. */
export function Composer({ onSubmit, busy, onStop, autoFocus, placeholder, className, morph = true, initial = "", memoryChips = false, prefill = null, meta, sendLabel, hints = false }: ComposerProps) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const owner = useSession((st) => st.session?.address ?? null);
  const contacts = useQuery({ queryKey: ["contacts", owner], enabled: Boolean(owner), retry: false, staleTime: 60_000, queryFn: ({ signal }) => apiGet<{ contacts: ContactRef[] }>("/v1/contacts", { query: { owner }, signal }) });
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const mention = mentionAt(text, caret);
  const matches = mention ? matchContacts(contacts.data?.contacts ?? [], mention.query) : [];
  const choose = (name: string) => {
    if (!mention) return;
    const r = insertMention(text, mention.start, caret, name);
    setText(r.text);
    setCaret(r.caret);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(r.caret, r.caret);
    });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [text]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  /** Selects a blank ("[amount]") so typing replaces it. */
  const selectBlank = (value: string, from: number) => {
    const b = nextBlank(value, from);
    if (!b) return false;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(b.start, b.end);
      setCaret(b.start);
    });
    return true;
  };
  const prefillNonce = prefill?.nonce ?? 0;
  const prefillText = prefill?.text ?? "";
  useEffect(() => {
    if (!prefillNonce) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an outside request to fill the box (a quick tile, ?intent=)
    setText(prefillText);
    setCaret(prefillText.length);
    const b = nextBlank(prefillText);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (b) el.setSelectionRange(b.start, b.end);
      else el.setSelectionRange(prefillText.length, prefillText.length);
    });
  }, [prefillNonce, prefillText]);
  const hint = hints ? composerHint(text) : null;
  const send = () => {
    const line = text.trim();
    if (!line || busy) return;
    // A blank is still open: take the user to it instead of sending "[amount]".
    if (selectBlank(text, 0)) return;
    setText("");
    onSubmit(line);
  };
  return (
    <div className={cx("m-frame m-composer", morph && "vt-composer", className)}>
      <LykoFace mood={busy ? "herding" : text ? "alert" : "watching"} scale={1.8} />
      <div className="m-composer__body">
        <span className="m-composer__meta">{meta ?? "ASK LYKO"}</span>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          aria-label="Ask Lyko"
          placeholder={placeholder ?? ("Keep 5,000 USDC for payroll, put the rest in the best vault…")}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setPick(0);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (matches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setPick((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (matches.length > 0 && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
              e.preventDefault();
              choose(matches[pick]?.name ?? matches[0]!.name);
              return;
            }
            if (e.key === "Tab" && !e.shiftKey && nextBlank(text)) {
              e.preventDefault();
              selectBlank(text, (e.currentTarget.selectionEnd ?? 0));
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {matches.length > 0 ? (
          <ul role="listbox" aria-label="Contacts" className="m-frame m-frame--thin" style={{ position: "absolute", zIndex: 30, marginTop: 4, listStyle: "none", padding: 6, minWidth: 260 }}>
            {matches.map((c, i) => (
              <li key={c.name} role="option" aria-selected={i === pick}>
                <button type="button" className="m-thread" aria-current={i === pick} onMouseDown={(e) => { e.preventDefault(); choose(c.name); }}>
                  @{c.name} <small>{c.address.slice(0, 8)}…{c.address.slice(-4)} · {c.confirmed ? "confirmed" : "unconfirmed"}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {hint ? (
          <p className="m-composer__hint" data-tone={hint.tone} aria-live="polite">
            {hint.text}
          </p>
        ) : null}
        {memoryChips && text.trim() === "" ? (
          <div className="m-memchips" role="group" aria-label="From your history">
            {MEMORY_PHRASES.en.map((phrase) => (
              <button key={phrase} type="button" className="m-chip" onClick={() => { setText((t) => (t ? `${t} ${phrase}` : phrase)); ref.current?.focus(); }}>
                ⟲ {phrase}
              </button>
            ))}
            <button type="button" className="m-chip" onClick={() => { const next = text ? `${text} @` : "@"; setText(next); setCaret(next.length); ref.current?.focus(); }}>
              @ {"contact"}
            </button>
          </div>
        ) : null}
      </div>
      {busy && onStop ? (
        <Button tone="navy" onClick={onStop}>
          {"STOP"}
        </Button>
      ) : text.trim() ? (
        <Button onClick={send} className="m-composer__send">
          {sendLabel ?? sendWord(text)}
        </Button>
      ) : sendLabel ? (
        <Button disabled>{sendLabel}</Button>
      ) : null}
    </div>
  );
}
