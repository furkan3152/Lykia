/**
 * The harbour: Circle's products as the quay every stall stands on, and the
 * Arc protocols as partner stalls along it, each with its live status from
 * the API. Text only: no partner logos.
 */
import { Card, Stat, Tag } from "../../mosaic";
import { circleState, COVERAGE_MEANING, coverageSummary, LYKIA_ROLE, usdShort, type EcosystemView } from "./model";
import { intlLocale, t as msg } from "../../i18n";

export function CircleQuay({ data, compact = false }: { readonly data: EcosystemView | undefined; readonly compact?: boolean }) {
  const products = data?.circle ?? [];
  const shown = compact ? products.filter((p) => p.state === "live" || p.state === "configured").slice(0, 8) : products;
  return (
    <Card title={msg("ecosystem.harbour.circleSRails")} kicker={msg("ecosystem.harbour.theQuayEveryStallStandsOn")} tone="sea">
      <p className="m-small">{msg("ecosystem.harbour.usdcIsArcSGasAnd")}</p>
      <ul className={compact ? "eco-quay eco-quay--compact" : "eco-quay"} aria-label={msg("ecosystem.harbour.circleProductsOnArc")}>
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
    <ul className="eco-stalls" aria-label={msg("ecosystem.harbour.arcProtocols")}>
      {data === undefined ? Array.from({ length: limit ?? 9 }, (_, i) => <li key={i} className="m-skel" style={{ height: 120 }} />) : null}
      {shown.map((p) => {
        const role = LYKIA_ROLE[p.lykia];
        return (
          <li key={p.id} className="m-frame m-frame--thin eco-stall">
            <div className="eco-stall__head">
              <b>{p.name}</b>
              <span title={COVERAGE_MEANING[p.lykia]}><Tag tone={role.tone}>{role.label}</Tag></span>
            </div>
            <span className="m-kick">{`${p.category} · ${p.status === "verified" ? msg("ecosystem.harbour.verifiedOnArc") : "ANNOUNCED"}${p.lykia === "routes" && p.verbs.some((v) => v !== "approve") ? ` · ${p.verbs.filter((v) => v !== "approve").join(", ").toUpperCase()}` : ""}`}</span>
            <p className="m-small m-muted eco-stall__sum">{p.summary}</p>
            <div className="eco-stall__foot m-small">
              <span>{`TVL ${usdShort(p.tvlUsd)}`}</span>
              <span>{p.routed.steps > 0 ? msg("ecosystem.harbour.routed", { value: Number(p.routed.usd).toLocaleString(intlLocale()) }) : p.lykia === "routes" ? msg("ecosystem.harbour.readyToRoute") : ""}</span>
            </div>
            {p.arcEcosystem ? (
              <a className="m-small eco-stall__arc" href={p.arcEcosystem} target="_blank" rel="noreferrer noopener">
                {msg("ecosystem.harbour.arcEcosystemEntry")}
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
  const readOnly = t ? (t.readOnly ?? t.verified - t.routable) : null;
  return (
    <div className="m-grid-4 eco-stats">
      <Stat label={msg("ecosystem.harbour.routableToday")} value={t ? String(t.routable) : "…"} hint={t && (t.routableVia ?? 0) > 0 ? msg("ecosystem.harbour.protocolsLykiaCanRouteThroughPlus", { routableVia: t.routableVia }) : msg("ecosystem.harbour.protocolsLykiaCanRouteThrough")} />
      <Stat label={msg("ecosystem.harbour.mappedOnArc")} value={t ? String(t.protocols) : "…"} hint={t ? msg("ecosystem.harbour.readOnlyMappedOnly", { readOnly, value: t.mapped ?? t.protocols - t.verified }) : undefined} />
      <Stat label={msg("ecosystem.harbour.tvlOnArc")} value={t ? usdShort(t.tvlUsd) : "…"} hint={data?.sources.tvl ?? "DefiLlama"} />
      <Stat label={msg("ecosystem.harbour.valueRouted")} value={t ? `$${Number(t.routed.usd).toLocaleString(intlLocale())}` : "…"} hint={t ? msg("ecosystem.harbour.settledSteps", { steps: t.routed.steps }) : undefined} />
    </div>
  );
}

/** One honest line: what Lykia routes through today and what it has mapped. */
export function CoverageLine({ data, className }: { readonly data: EcosystemView | undefined; readonly className?: string }) {
  const line = coverageSummary(data?.totals);
  return <p className={className ?? "m-kick eco-coverage"} data-testid="coverage-line">{line ?? "…"}</p>;
}
