import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { apiGet } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Button, LykoFace, cx } from "../../mosaic";
import { insertMention, matchContacts, mentionAt, MEMORY_PHRASES, type ContactRef } from "./memoryRefs";

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
}

/** Ask Lyko's composer: grows with the text, Enter sends, Shift+Enter breaks a line. */
export function Composer({ onSubmit, busy, onStop, autoFocus, placeholder, className, morph = true, initial = "", memoryChips = false }: ComposerProps) {
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
  const send = () => {
    const line = text.trim();
    if (!line || busy) return;
    setText("");
    onSubmit(line);
  };
  return (
    <div className={cx("m-frame m-composer", morph && "vt-composer", className)}>
      <LykoFace mood={busy ? "herding" : text ? "alert" : "watching"} scale={1.8} />
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <span className="m-composer__meta">{"ASK LYKO · TYPE IN ENGLISH OR TURKISH"}</span>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          aria-label="Ask Lyko"
          placeholder={placeholder ?? ("Keep 5,000 USDC for payroll, put the rest on the greenest pasture…")}
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
        {memoryChips ? (
          <div className="m-memchips">
            {MEMORY_PHRASES.en.map((phrase) => (
              <button key={phrase} type="button" className="m-chip" style={{ fontSize: 12, padding: "3px 8px" }} onClick={() => { setText((t) => (t ? `${t} ${phrase}` : phrase)); ref.current?.focus(); }}>
                ⟲ {phrase}
              </button>
            ))}
            <button type="button" className="m-chip" style={{ fontSize: 12, padding: "3px 8px" }} onClick={() => { const next = text ? `${text} @` : "@"; setText(next); setCaret(next.length); ref.current?.focus(); }}>
              @ {"contact"}
            </button>
          </div>
        ) : null}
      </div>
      {busy && onStop ? (
        <Button tone="navy" onClick={onStop}>
          {"STOP"}
        </Button>
      ) : (
        <Button onClick={send} disabled={!text.trim()}>
          {"HERD IT"}
        </Button>
      )}
    </div>
  );
}
