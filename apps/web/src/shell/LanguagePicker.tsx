/**
 * The language picker in the top bar's compact cluster: the current
 * language's short code, and a menu of every language in its own name.
 * The choice is stored in this browser and, when signed in, in the profile;
 * the page then reloads in that language.
 */
import { useEffect, useRef, useState } from "react";

import { apiPut } from "../lib/api";
import { useProfile } from "../lib/profile";
import { useSession } from "../lib/session";
import { chooseLocale, currentLocale, LOCALE_NAMES, LOCALES, t, type Locale } from "../i18n";

const SHORT: Readonly<Record<Locale, string>> = { en: "EN", tr: "TR", es: "ES", "pt-BR": "PT", "zh-CN": "中", fr: "FR" };

export function LanguagePicker() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const signedIn = useSession((s) => Boolean(s.session));
  const profile = useProfile((s) => s.profile);
  const now = currentLocale();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const pick = async (next: Locale) => {
    setOpen(false);
    if (next === now) return;
    // Signed in: the profile keeps the choice for every device (and for Lyko's answers on the server).
    if (signedIn) await apiPut("/v1/profile", { ...profile, language: next }).catch(() => undefined);
    chooseLocale(next);
  };
  return (
    <div ref={ref} className="m-langpick">
      <button type="button" className="m-askbtn m-askbtn--icon m-langpick__btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("shell.languagePicker.label", { language: LOCALE_NAMES[now] })} title={LOCALE_NAMES[now]} onClick={() => setOpen((o) => !o)}>
        <b lang={now}>{SHORT[now]}</b>
      </button>
      {open ? (
        <ul role="menu" className="m-frame m-frame--thin m-langpick__menu">
          {LOCALES.map((l) => (
            <li key={l} role="none">
              <button type="button" role="menuitemradio" aria-checked={l === now} lang={l} className="m-thread" onClick={() => void pick(l)}>
                {LOCALE_NAMES[l]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
