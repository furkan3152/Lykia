/** The header's avatar menu: You, Memory, Circle, Pastures, Owner and the theme, with Lyko in your colours. */
import { useEffect, useRef, useState } from "react";

import { Link } from "../app/routes/Link";
import { useUiStore } from "../app/state/uiStore";
import { useProfile } from "../lib/profile";
import { LykoFace, Toggle } from "../mosaic";

export function YouMenu() {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const profile = useProfile((s) => s.profile);
  const setProfile = useProfile((s) => s.set);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
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
  const links: [string, string][] = [
    ["/app/you", "YOU"],
    ["/app/memory", "MEMORY"],
    ["/app/circle", "CIRCLE"],
    ["/app/pastures", "PASTURES"],
    ["/owner", "OWNER"],
  ];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="m-askbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ padding: "0 8px" }} aria-label="Your menu">
        <LykoFace mood="happy" scale={1} label="You" />
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div role="menu" className="m-frame m-frame--thin" style={{ position: "absolute", right: 0, top: 44, zIndex: 60, width: 240, padding: 12, display: "grid", gap: 8, animation: "m-tile-in 260ms both" }}>
          {links.map(([href, label]) => (
            <Link key={href} to={href} role="menuitem" className="m-thread" onClick={() => setOpen(false)} style={{ textDecoration: "none", fontFamily: "Silkscreen", fontSize: 12, letterSpacing: "0.1em" }}>
              {label}
            </Link>
          ))}
          <div style={{ borderTop: "2px dashed var(--grout)", paddingTop: 8, display: "grid", gap: 8 }}>
            <Toggle light label="Network" value={mode} onChange={(m) => setMode(m)} options={[{ value: "mainnet", label: "MAINNET" }, { value: "testnet", label: "TESTNET" }]} />
            <Toggle light label="Theme" value={profile.theme} onChange={(theme) => setProfile({ ...profile, theme })} options={[{ value: "day", label: "DAY" }, { value: "night", label: "NIGHT" }, { value: "auto", label: "AUTO" }]} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
