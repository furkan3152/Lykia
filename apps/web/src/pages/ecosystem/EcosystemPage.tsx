/**
 * /ecosystem: the Arc ecosystem Lykia maps. Circle's products are the quay;
 * every registry entry is a stall along it, marked routable (an executable
 * adapter), read-only (verified, readable) or mapped (listed only), with its
 * TVL on Arc and the value Lykia has routed to it. Data from
 * GET /v1/ecosystem, which any site may read and embed.
 */
import { useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { CircleQuay, CoverageLine, EcosystemStats, PartnerStalls } from "../../features/ecosystem/Harbour";
import { ARC_ECOSYSTEM_DIRECTORY, COVERAGE_MEANING, POSITIONING } from "../../features/ecosystem/model";
import { useEcosystem } from "../../features/ecosystem/useEcosystem";
import { API_BASE } from "../../lib/env";
import { Card, MeanderBand } from "../../mosaic";
import { t } from "../../i18n";

const FILTERS = [
  ["all", t("ecosystem.everyProtocol")],
  ["routes", "ROUTABLE"],
  ["reads", "READ-ONLY"],
  ["lists", "MAPPED"],
  ["lending", "LENDING"],
  ["dex", "DEX"],
  ["vault", "VAULTS"],
  ["bridge", "BRIDGES"],
  ["launchpad", "LAUNCHPADS"],
] as const;

type Filter = (typeof FILTERS)[number][0];

export default function EcosystemPage() {
  const q = useEcosystem("mainnet");
  const [filter, setFilter] = useState<Filter>("all");
  const data = useMemo(() => {
    if (!q.data) return undefined;
    const keep = q.data.protocols.filter((p) => (filter === "all" ? true : filter === "routes" || filter === "reads" || filter === "lists" ? p.lykia === filter : p.category === filter));
    return { ...q.data, protocols: keep };
  }, [q.data, filter]);
  const api = API_BASE;
  // i18n-ignore: an embed snippet is code.
  const snippet = `<div data-lykia-ecosystem data-limit="6"></div>
<script async src="${typeof window !== "undefined" ? window.location.origin : ""}/embed/routed-by-lykia.js"
        data-api="${api}"></script>`;

  return (
    <div>
      <header className="m-head m-wrap">
        <span className="m-kick">{t("ecosystem.theForgeHarbourEcosystem")}</span>
        <h1 className="m-title">
          {t("ecosystem.theProtocolsOnArcMapped")} <em>{t("ecosystem.theRoutableOnesOneRouteAway")}</em>
        </h1>
        <p className="m-sub">{POSITIONING}</p>
        <CoverageLine data={q.data} className="m-kick eco-coverage" />
        <p className="m-small" style={{ marginTop: 10 }}>
          {t("ecosystem.theFullListOfWhoBuilds")}
          <a href={ARC_ECOSYSTEM_DIRECTORY} target="_blank" rel="noreferrer noopener">{t("ecosystem.arcEcosystemDirectory")}</a>
          {t("ecosystem.theRegistryMapsEverythingKnownOn")}
        </p>
      </header>

      <section className="m-wrap">
        <EcosystemStats data={q.data} />
        {q.isError ? <p className="m-note" style={{ marginTop: 12 }}>{t("ecosystem.theApiDidNotAnswerThis")}</p> : null}
      </section>

      <section className="m-wrap" style={{ marginTop: 32 }}>
        <CircleQuay data={q.data} />
      </section>

      <MeanderBand className="mt-12" />

      <section className="m-wrap" style={{ marginTop: 32 }} aria-labelledby="eco-stalls">
        <div className="m-center">
          <span className="m-kick">{t("ecosystem.protocolsOnArc")}</span>
          <h2 id="eco-stalls" className="m-h2" style={{ marginTop: 8 }}>{t("ecosystem.routableReadOnlyOrMapped")}</h2>
          <dl className="eco-legend m-small">
            <div><dt>{t("ecosystem.routable")}</dt><dd>{COVERAGE_MEANING.routes}</dd></div>
            <div><dt>{t("ecosystem.readOnly")}</dt><dd>{COVERAGE_MEANING.reads}</dd></div>
            <div><dt>{t("ecosystem.mapped")}</dt><dd>{COVERAGE_MEANING.lists}</dd></div>
          </dl>
          <p className="m-small m-muted" style={{ marginTop: 8 }}>{t("ecosystem.eachCardLinksToTheProtocol")}</p>
        </div>
        <div className="eco-filters" role="group" aria-label={t("ecosystem.filterProtocols")}>
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" className="m-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <PartnerStalls data={data} />
        <p className="m-kick m-center" style={{ marginTop: 14 }}>{q.data?.sources.tvlAt ? `TVL · ${q.data.sources.tvl} · ${q.data.sources.tvlAt.slice(0, 16).replace("T", " ")} UTC` : t("ecosystem.tvlDefillama")}</p>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }}>
        <div className="m-grid-2">
          <Card title={t("ecosystem.yourProtocolHere")} kicker={t("ecosystem.integrateInAnAfternoon")} footer={<Link to="/forge/reference#integrate" className="m-btn m-btn--sea">{t("ecosystem.integrateYourProtocol")}</Link>}>
            <p className="m-small">{t("ecosystem.sendTheAddressesAndTheEvidence")}</p>
          </Card>
          <Card title={t("ecosystem.routedByLykia")} kicker={t("ecosystem.embedTheDirectory")}>
            <p className="m-small">{t("ecosystem.showTheArcEcosystemLiveOn")}</p>
            <pre className="m-code eco-embed">{snippet}</pre>
          </Card>
        </div>
      </section>
    </div>
  );
}
