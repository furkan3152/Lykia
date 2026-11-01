import { COMMANDS, EASTER_EGGS, type CommandWord } from "@lykia/core";
import { useMemo, useRef, useState } from "react";

import { resolveInput, type Destination, type Resolution } from "../../lib/commands";
import { useLang } from "../../lib/i18n";
import { runCommand } from "../../lib/runCommand";
import { cssVars } from "../../motion/tokens";
import { useOracleStore } from "../../oracle/oracleStore";
import { Lyko } from "../../pixel/Lyko";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Kbd } from "../../ui/Kbd";
import { ModalLayer } from "../../ui/overlay/ModalLayer";
import { toast } from "../../ui/toast";
import { navigate } from "../routes/history";
import { routeHref } from "../routes/routeTable";

interface Blade {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly run: () => void;
}

const PAGES: ReadonlyArray<{ readonly id: Destination; readonly en: string; readonly tr: string; readonly detail: string }> = [
  { id: "deck", en: "Deck", tr: "Masa", detail: "Say an outcome; get an Outrun" },
  { id: "flock", en: "Flock", tr: "Sürü", detail: "Everything you hold on Arc" },
  { id: "fence", en: "Fence", tr: "Çit", detail: "Rules around your agents, and the Whistle" },
  { id: "scent", en: "Scent", tr: "Koku", detail: "Sniff a token before anyone touches it" },
  { id: "kunye", en: "Künye", tr: "Künye", detail: "Agent licences on ERC-8004" },
  { id: "developers", en: "Developers", tr: "Geliştiriciler", detail: "API, MCP and x402" },
];

function hrefOf(destination: Destination): string {
  return routeHref(destination);
}

function bladesFor(text: string, resolution: Resolution, lang: "en" | "tr", go: (href: string) => void, close: () => void): Blade[] {
  const out: Blade[] = [];
  switch (resolution.kind) {
    case "command":
      out.push({
        id: "command",
        title: `“${resolution.word}”`,
        detail: resolution.meaning,
        run: () => {
          close();
          runCommand(resolution.action);
        },
      });
      break;
    case "egg":
      out.push({
        id: "egg",
        title: lang === "tr" ? "Gizli bir patika…" : "A hidden trail…",
        detail: resolution.line,
        run: () => {
          if (resolution.href) go(resolution.href);
          else {
            close();
            toast.info(resolution.line, { from: "LYKO", id: "egg", duration: 7000 });
          }
        },
      });
      break;
    case "token":
      out.push({ id: "token", title: lang === "tr" ? "Bu token'ı kokla" : "Sniff this token", detail: resolution.address, run: () => go(routeHref("scent", { token: resolution.address })) });
      break;
    case "agent":
      out.push({ id: "agent", title: lang === "tr" ? `Künye #${resolution.agentId}` : `Künye #${resolution.agentId}`, detail: "ERC-8004 identity on Arc", run: () => go(routeHref("kunye", { agentId: resolution.agentId })) });
      break;
    case "page":
      break;
    case "sentence":
      out.push({ id: "plan", title: lang === "tr" ? "Masada planla" : "Plan it on the deck", detail: `“${text.trim()}” · ${lang === "tr" ? "Lyko planlar, sen imzalarsın" : "Lyko plans, you sign"}`, run: () => go(`${routeHref("deck")}?intent=${encodeURIComponent(text.trim())}`) });
      break;
    case "empty":
      break;
  }
  const lower = text.trim().toLowerCase();
  const pages = PAGES.filter((p) => resolution.kind === "empty" || (resolution.kind === "page" && p.id === resolution.destination) || (lower.length > 1 && (p.en.toLowerCase().includes(lower) || p.tr.toLowerCase().includes(lower))));
  for (const p of pages) out.push({ id: `page-${p.id}`, title: lang === "tr" ? p.tr : p.en, detail: p.detail, run: () => go(hrefOf(p.id)) });
  if (resolution.kind === "empty") {
    for (const word of ["come bye", "lie down"] as CommandWord[]) {
      out.push({
        id: `cmd-${word}`,
        title: `“${word}”`,
        detail: COMMANDS[word].meaning,
        run: () => {
          close();
          runCommand(COMMANDS[word].action);
        },
      });
    }
  }
  return out.slice(0, 8);
}

/**
 * ⌘K / Ctrl-K: the whistle box. Type a page, a sheepdog command ("come
 * bye", "lie down", "that'll do"), a token address, "agent 12", or a whole
 * sentence; arrow keys pick, Enter goes. Sentences go to the deck as
 * `/app?intent=`; nothing is signed here.
 */
export function WhistleBox() {
  const open = useOracleStore((state) => state.open);
  const draft = useOracleStore((state) => state.draft);
  const setDraft = useOracleStore((state) => state.setDraft);
  const close = useOracleStore((state) => state.closeOracle);
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const lang = useLang();
  const resolution = useMemo(() => resolveInput(draft), [draft]);
  const blades = useMemo(
    () =>
      bladesFor(
        draft,
        resolution,
        lang,
        (href) => {
          close();
          navigate(href);
        },
        close,
      ),
    [draft, resolution, lang, close],
  );
  const selected = Math.min(active, Math.max(0, blades.length - 1));
  const mood = resolution.kind === "command" ? "alert" : resolution.kind === "egg" ? "proud" : draft.trim() ? "herding" : "watching";

  return (
    <ModalLayer open={open} onClose={close} placement="top" ariaLabel="Whistle box" initialFocusRef={inputRef} panelClassName="w-full max-w-[680px] animate-dialog-in">
      <div className="flex flex-col gap-4 bg-paper p-4 px-frame px-drop-lg sm:p-5">
        <div className="flex items-end gap-3">
          <Lyko mood={mood} size={62} label={null} className="-mb-1 hidden shrink-0 sm:inline-block" />
          <label className="flex min-w-0 flex-1 items-stretch bg-card px-frame-thin">
            <span className="flex items-center bg-ink px-2.5 font-tag text-[11px] uppercase text-paper">{lang === "tr" ? "Düdük" : "Whistle"}</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setActive(0);
              }}
              placeholder={lang === "tr" ? "sürü · come bye · 50 USDC'yi Base'e köprüle" : "flock · come bye · bridge 50 USDC to base"}
              role="combobox"
              aria-expanded="true"
              aria-controls="ly-whistle-list"
              aria-activedescendant={blades[selected] ? `ly-whistle-${blades[selected]!.id}` : undefined}
              aria-label="Command, page or sentence"
              className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((selected + 1) % Math.max(1, blades.length));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((selected - 1 + blades.length) % Math.max(1, blades.length));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  blades[selected]?.run();
                }
              }}
            />
            <span className="flex items-center px-2">
              <Kbd>Esc</Kbd>
            </span>
          </label>
        </div>
        <ul id="ly-whistle-list" role="listbox" aria-label="Destinations" className="flex flex-col gap-3 px-1">
          {blades.map((blade, index) => {
            const on = index === selected;
            return (
              <li key={blade.id} id={`ly-whistle-${blade.id}`} role="option" aria-selected={on}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => blade.run()}
                  className={cx("el-swing flex min-h-[48px] w-full items-center gap-3 px-3 py-1.5 text-left px-frame-thin", on ? "bg-signal text-[#1B1714] px-drop" : "bg-card text-ink", FOCUS_RING)}
                  style={cssVars({ "--el-delay": `${index * 50}ms` })}
                >
                  <span aria-hidden="true" className="w-4 shrink-0 font-tag text-sm">
                    {on ? "▶" : ""}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-display text-[17px] font-bold">{blade.title}</span>
                    <span className="truncate font-mono text-xs opacity-80">{blade.detail}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="text-center font-tag text-[11px] uppercase text-ink-2">
          ↑ ↓ {lang === "tr" ? "seç" : "choose"} · ↵ {lang === "tr" ? "git" : "go"} · {Object.keys(COMMANDS).length} {lang === "tr" ? "çoban komutu" : "shepherd commands"} · {Object.keys(EASTER_EGGS).length > 0 ? (lang === "tr" ? "ve birkaç gizli kelime" : "and a few hidden words") : ""}
        </p>
      </div>
    </ModalLayer>
  );
}
