import { useLangStore } from "../../lib/i18n";
import { cx, FOCUS_RING } from "../../ui/cx";

/** EN | TR: Lyko speaks both. */
export function LangToggle({ className }: { readonly className?: string }) {
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "tr" : "en")}
      aria-label={lang === "en" ? "Türkçe'ye geç" : "Switch to English"}
      className={cx("inline-flex h-9 items-stretch bg-card font-tag text-[11px] uppercase px-frame-thin px-drop px-press", FOCUS_RING, className)}
    >
      <span className={cx("flex items-center px-2", lang === "en" ? "bg-signal text-[#1B1714]" : "text-ink-3")}>EN</span>
      <span className={cx("flex items-center px-2", lang === "tr" ? "bg-signal text-[#1B1714]" : "text-ink-3")}>TR</span>
    </button>
  );
}
