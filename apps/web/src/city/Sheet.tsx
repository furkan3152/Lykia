/**
 * A sheet: slides up from the bottom on phones (within thumb reach, above
 * the safe area) and opens as a centred stone panel on wider screens.
 * Escape, the scrim and the grab handle close it; focus moves into it.
 */
import { useEffect, useRef } from "react";
import { t } from "../i18n";

export function Sheet({ open, onClose, title, children, className }: { readonly open: boolean; readonly onClose: () => void; readonly title: string; readonly children: React.ReactNode; readonly className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ct-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`ct-sheet m-frame${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <button type="button" className="ct-sheet__grab" aria-label={t("city.sheet.close")} onClick={onClose} />
        <header className="ct-sheet__head">
          <h2>{title}</h2>
          <button type="button" className="ct-sheet__x" aria-label={t("city.sheet.close")} onClick={onClose}>{"×"}</button>
        </header>
        <div className="ct-sheet__body">{children}</div>
      </div>
    </div>
  );
}
