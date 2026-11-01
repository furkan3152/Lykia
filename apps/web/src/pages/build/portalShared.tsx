/** Small pieces shared by the developer portal tabs (keys, logs, usage, webhooks, reference). */
import type { ReactNode } from "react";

/** A table that scrolls sideways on narrow screens instead of overflowing the page. */
export function ScrollTable({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%" }}>
      <table className="m-table" style={{ minWidth: 520 }}>{children}</table>
    </div>
  );
}

/** One series of bars (requests per day), single hue, value on hover, with an accessible table behind it. */
export function DayBars({ days, label }: { readonly days: readonly { readonly day: string; readonly requests: number; readonly errors: number }[]; readonly label: string }) {
  const max = Math.max(1, ...days.map((d) => d.requests));
  return (
    <figure style={{ margin: 0 }}>
      <div role="img" aria-label={`${label}: ${days.map((d) => `${d.day} ${d.requests}`).join(", ")}`} style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 140, borderBottom: "2px solid var(--ink-3)", padding: "0 2px" }}>
        {days.map((d) => (
          <div key={d.day} title={`${d.day}: ${d.requests} requests, ${d.errors} errors`} style={{ flex: "1 1 0", minWidth: 4, height: "100%", display: "flex", alignItems: "flex-end", cursor: "default" }}>
            <div style={{ width: "100%", height: `${Math.max(d.requests > 0 ? 2 : 0, (d.requests / max) * 100)}%`, background: "var(--sea)", borderRadius: "4px 4px 0 0" }} />
          </div>
        ))}
      </div>
      <figcaption className="m-small m-muted" style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span>{days[0]?.day ?? ""}</span>
        <span>{`${label} · peak ${max}`}</span>
        <span>{days[days.length - 1]?.day ?? ""}</span>
      </figcaption>
    </figure>
  );
}
