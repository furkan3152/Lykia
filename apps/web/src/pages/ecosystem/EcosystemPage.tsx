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

const FILTERS = [
  ["all", "EVERY PROTOCOL"],
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
  const snippet = `<div data-lykia-ecosystem data-limit="6"></div>
<script async src="${typeof window !== "undefined" ? window.location.origin : ""}/embed/routed-by-lykia.js"
        data-api="${api}"></script>`;

  return (
    <div>
      <header className="m-head m-wrap">
        <span className="m-kick">{"THE MINT · HARBOUR · ECOSYSTEM"}</span>
        <h1 className="m-title">
          The protocols on Arc, mapped, <em>the routable ones one route away.</em>
        </h1>
        <p className="m-sub">{POSITIONING}</p>
        <CoverageLine data={q.data} className="m-kick eco-coverage" />
        <p className="m-small" style={{ marginTop: 10 }}>
          {"The full list of who builds on Arc lives in the official "}
          <a href={ARC_ECOSYSTEM_DIRECTORY} target="_blank" rel="noreferrer noopener">{"Arc ecosystem directory"}</a>
          {". The registry maps everything known on Arc: tokens, bridges, oracles, infrastructure and protocols without an adapter. Only the venues with an executable adapter are routable; each card says which it is and links to its Arc entry."}
        </p>
      </header>

      <section className="m-wrap">
        <EcosystemStats data={q.data} />
        {q.isError ? <p className="m-note" style={{ marginTop: 12 }}>{"The API did not answer; this page fills in when it does. Try again in a minute."}</p> : null}
      </section>

      <section className="m-wrap" style={{ marginTop: 32 }}>
        <CircleQuay data={q.data} />
      </section>

      <MeanderBand className="mt-12" />

      <section className="m-wrap" style={{ marginTop: 32 }} aria-labelledby="eco-stalls">
        <div className="m-center">
          <span className="m-kick">{"PROTOCOLS ON ARC"}</span>
          <h2 id="eco-stalls" className="m-h2" style={{ marginTop: 8 }}>{"Routable, read-only or mapped"}</h2>
          <dl className="eco-legend m-small">
            <div><dt>{"ROUTABLE"}</dt><dd>{COVERAGE_MEANING.routes}</dd></div>
            <div><dt>{"READ-ONLY"}</dt><dd>{COVERAGE_MEANING.reads}</dd></div>
            <div><dt>{"MAPPED"}</dt><dd>{COVERAGE_MEANING.lists}</dd></div>
          </dl>
          <p className="m-small m-muted" style={{ marginTop: 8 }}>{"Each card links to the protocol's official Arc ecosystem entry where one exists. Circle's own rails (USDC transfers, Gateway) are on the quay above."}</p>
        </div>
        <div className="eco-filters" role="group" aria-label="Filter protocols">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" className="m-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        <PartnerStalls data={data} />
        <p className="m-kick m-center" style={{ marginTop: 14 }}>{q.data?.sources.tvlAt ? `TVL · ${q.data.sources.tvl} · ${q.data.sources.tvlAt.slice(0, 16).replace("T", " ")} UTC` : "TVL · DEFILLAMA"}</p>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }}>
        <div className="m-grid-2">
          <Card title={"Your protocol here"} kicker={"INTEGRATE IN AN AFTERNOON"} footer={<Link to="/mint/reference#integrate" className="m-btn m-btn--sea">{"INTEGRATE YOUR PROTOCOL"}</Link>}>
            <p className="m-small">{"Send the addresses and the evidence, add one typed adapter, and every Lykia user and agent can reach you, inside their Fence. Free developer keys for Arc builders."}</p>
          </Card>
          <Card title={"Routed by Lykia"} kicker={"EMBED THE DIRECTORY"}>
            <p className="m-small">{"Show the Arc ecosystem, live, on your own site. The data is public and open to every origin."}</p>
            <pre className="m-code eco-embed">{snippet}</pre>
          </Card>
        </div>
      </section>
    </div>
  );
}
