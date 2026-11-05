/**
 * The harbour: Circle's products as the quay every stall stands on, and the
 * Arc protocols as partner stalls along it, each with its live status from
 * the API. Text only: no partner logos.
 */
import { Card, Stat, Tag } from "../../mosaic";
import { circleState, LYKIA_ROLE, usdShort, type EcosystemView } from "./model";

export function CircleQuay({ data, compact = false }: { readonly data: EcosystemView | undefined; readonly compact?: boolean }) {
  const products = data?.circle ?? [];
  const shown = compact ? products.filter((p) => p.state === "live" || p.state === "configured").slice(0, 8) : products;
  return (
    <Card title={"Powered by Circle"} kicker={"THE QUAY EVERY STALL STANDS ON"} tone="sea">
      <p className="m-small">{"USDC is Arc's gas and its unit of account. CCTP, Gateway, StableFX and Circle's agent stack move the value; Lykia runs on them and sends more traffic their way."}</p>
      <ul className={compact ? "eco-quay eco-quay--compact" : "eco-quay"} aria-label="Circle products on Arc">
        {shown.length === 0 ? <li className="m-skel" style={{ height: 40 }} /> : null}
        {shown.map((p) => {
          const s = circleState(p.state);
          return (
            <li key={p.id} className="eco-quay__stone">
              <b>{p.name}</b>
              <Tag tone={s.tone}>{s.label}</Tag>
              {!compact ? <p className="m-small m-muted">{p.lykia}</p> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function PartnerStalls({ data, limit, filter = "all" }: { readonly data: EcosystemView | undefined; readonly limit?: number; readonly filter?: "all" | "verified" }) {
  const rows = (data?.protocols ?? []).filter((p) => p.category !== "circle" && (filter === "all" || p.status === "verified"));
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <ul className="eco-stalls" aria-label="Arc protocols">
      {data === undefined ? Array.from({ length: limit ?? 9 }, (_, i) => <li key={i} className="m-skel" style={{ height: 120 }} />) : null}
      {shown.map((p) => {
        const role = LYKIA_ROLE[p.lykia];
        return (
          <li key={p.id} className="m-frame m-frame--thin eco-stall">
            <div className="eco-stall__head">
              <b>{p.name}</b>
              <Tag tone={role.tone}>{role.label}</Tag>
            </div>
            <span className="m-kick">{`${p.category} · ${p.status === "verified" ? "VERIFIED ON ARC" : "ANNOUNCED"}`}</span>
            <p className="m-small m-muted eco-stall__sum">{p.summary}</p>
            <div className="eco-stall__foot m-small">
              <span>{`TVL ${usdShort(p.tvlUsd)}`}</span>
              <span>{p.routed.steps > 0 ? `ROUTED $${Number(p.routed.usd).toLocaleString("en-US")}` : p.lykia === "routes" ? "READY TO ROUTE" : ""}</span>
            </div>
            {p.arcEcosystem ? (
              <a className="m-small eco-stall__arc" href={p.arcEcosystem} target="_blank" rel="noreferrer noopener">
                {"Arc ecosystem entry ↗"}
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function EcosystemStats({ data }: { readonly data: EcosystemView | undefined }) {
  const t = data?.totals;
  return (
    <div className="m-grid-4 eco-stats">
      <Stat label="ARC PROTOCOLS" value={t ? String(t.protocols) : "…"} hint={t ? `${t.verified} verified on chain` : undefined} />
      <Stat label="ROUTABLE ON LYKIA" value={t ? String(t.routable) : "…"} hint="executable venues" />
      <Stat label="TVL ON ARC" value={t ? usdShort(t.tvlUsd) : "…"} hint={data?.sources.tvl ?? "DefiLlama"} />
      <Stat label="VALUE ROUTED" value={t ? `$${Number(t.routed.usd).toLocaleString("en-US")}` : "…"} hint={t ? `${t.routed.steps} settled steps` : undefined} />
    </div>
  );
}
