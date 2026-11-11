/** The header's avatar menu: the account pages, the secondary "More" pages, Letoon for admins, network and theme. */
import { useEffect, useRef, useState } from "react";

import { Link } from "../app/routes/Link";
import { useUiStore } from "../app/state/uiStore";
import { useProfile } from "../lib/profile";
import { LykoFace, Toggle } from "../mosaic";
import { useSession } from "../lib/session";
import { ACCOUNT, ADMIN, MORE } from "./nav";
import { t } from "../i18n";

export function YouMenu() {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);
  const profile = useProfile((s) => s.profile);
  const setProfile = useProfile((s) => s.set);
  // Only a hint for the menu: Letoon and every admin call check the role on the server.
  const admin = useSession((s) => Boolean(s.session?.roles.includes("admin")));
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
  const item = { textDecoration: "none", fontFamily: "Silkscreen", fontSize: 12, letterSpacing: "0.1em" } as const;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="m-askbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ padding: "0 8px" }} aria-label={t("shell.youMenu.settingsAndMore")}>
        <LykoFace mood="happy" scale={1} label={t("shell.youMenu.you")} />
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div role="menu" className="m-frame m-frame--thin" style={{ position: "absolute", right: 0, top: 44, zIndex: 60, width: 240, padding: 12, display: "grid", gap: 8, animation: "m-tile-in 260ms both" }}>
          {ACCOUNT.map((l) => (
            <Link key={l.href} to={l.href} role="menuitem" className="m-thread" onClick={() => setOpen(false)} style={item}>
              {l.label.toUpperCase()}
            </Link>
          ))}
          <span className="m-kick" style={{ marginTop: 4 }}>{t("shell.youMenu.more")}</span>
          {MORE.map((l) => (
            <Link key={l.href} to={l.href} role="menuitem" className="m-thread" title={l.blurb} onClick={() => setOpen(false)} style={item}>
              {l.label.toUpperCase()}
            </Link>
          ))}
          {admin ? (
            <>
              <span className="m-kick" style={{ marginTop: 4 }}>{t("shell.youMenu.team")}</span>
              {ADMIN.map((l) => (
                <Link key={l.href} to={l.href} role="menuitem" className="m-thread" title={l.blurb} onClick={() => setOpen(false)} style={item}>
                  {l.label.toUpperCase()}
                </Link>
              ))}
            </>
          ) : null}
          <div style={{ borderTop: "2px dashed var(--grout)", paddingTop: 8, display: "grid", gap: 8 }}>
            <Toggle light label={t("shell.youMenu.network")} value={mode} onChange={(m) => setMode(m)} options={[{ value: "mainnet", label: "MAINNET" }, { value: "testnet", label: "TESTNET" }]} />
            <Toggle light label={t("shell.youMenu.theme")} value={profile.theme} onChange={(theme) => setProfile({ ...profile, theme })} options={[{ value: "day", label: "DAY" }, { value: "night", label: "NIGHT" }]} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
