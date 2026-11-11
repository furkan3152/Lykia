/**
 * ⌘K: search and ask. One line can be a page, a token address, an agent id,
 * or a question (which morphs into the Ask conversation). Sheepdog commands
 * and hidden words still work; they are tucked away so they never compete
 * with the core tasks.
 */
import { COMMANDS, type CommandWord } from "@lykia/core";
import { useEffect, useRef, useState } from "react";

import { konamiStep, resolveInput } from "../lib/commands";
import { Frame, LykoFace, toast } from "../mosaic";
import { navigate } from "../app/routes/history";
import { AREAS } from "./nav";
import { handleLine, usePalette } from "./palette";
import { t } from "../i18n";

export function CommandPalette() {
  const isOpen = usePalette((s) => s.isOpen);
  const close = usePalette((s) => s.close);
  const open = usePalette((s) => s.open);
  const wagTail = usePalette((s) => s.wagTail);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let konami = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
        return;
      }
      if (!typing && e.key === "/") {
        e.preventDefault();
        open();
        return;
      }
      if (!typing) {
        const step = konamiStep(konami, e.key);
        konami = step.progress;
        if (step.done) {
          wagTail();
          toast.success(t("shell.commandPalette.lykoWagsHisTail"), { from: "LYKO" });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, wagTail]);

  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => ref.current?.focus());
  }, [isOpen]);

  if (!isOpen) return null;
  const submit = () => {
    const line = text.trim();
    if (!line) return;
    close();
    setText("");
    handleLine(line);
  };
  const r = resolveInput(text);
  return (
    <div className="m-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()} style={{ placeItems: "start center", paddingTop: "14vh" }}>
      <Frame className="m-modal vt-composer" role="dialog" aria-modal="true" aria-label={t("shell.commandPalette.searchOrAsk")}>
        <div className="m-composer">
          <LykoFace mood={r.kind === "command" ? "alert" : "watching"} scale={1.6} />
          <div style={{ flex: 1 }}>
            <span className="m-composer__meta">{t("shell.commandPalette.askPasteATokenAddressOr")}</span>
            <textarea
              ref={ref}
              rows={1}
              value={text}
              placeholder={t("shell.commandPalette.put100UsdcInTheBest")}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <button type="button" className="m-btn" onClick={submit}>
            {r.kind === "sentence" ? ("ASK") : "GO"}
          </button>
        </div>
        <div style={{ padding: "8px 14px 14px", borderTop: "2px dashed var(--grout)" }}>
          <p className="m-kick" style={{ marginBottom: 6 }}>{r.kind === "command" ? r.meaning : t("shell.commandPalette.jumpTo")}</p>
          <div className="m-chips" style={{ justifyContent: "flex-start", marginTop: 0 }}>
            {AREAS.flatMap((a) => a.sections).map((sec) => (
              <button
                key={sec.id}
                type="button"
                className="m-chip"
                onClick={() => {
                  close();
                  navigate(sec.href);
                }}
              >
                {sec.label.toLowerCase() === sec.sub.toLowerCase() ? sec.label : `${sec.label} · ${sec.sub}`}
              </button>
            ))}
          </div>
          <details className="mt-2">
            <summary className="m-small m-muted" style={{ cursor: "pointer" }}>{t("shell.commandPalette.sheepdogCommands")}</summary>
            <div className="m-chips" style={{ justifyContent: "flex-start", marginTop: 6 }}>
              {(Object.keys(COMMANDS) as CommandWord[]).map((w) => (
                <button key={w} type="button" className="m-chip" title={COMMANDS[w].meaning} onClick={() => setText(w)}>
                  {w}
                </button>
              ))}
            </div>
          </details>
        </div>
      </Frame>
    </div>
  );
}
