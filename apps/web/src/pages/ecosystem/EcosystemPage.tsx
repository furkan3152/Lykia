/**
 * /ecosystem: the Arc ecosystem Lykia brings together. Circle's products are
 * the quay; every Arc protocol is a stall along it, with what Lykia does
 * with it, its TVL on Arc and the value Lykia has routed to it. Data from
 * GET /v1/ecosystem, which any site may read and embed.
 */
import { useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { CircleQuay, EcosystemStats, PartnerStalls } from "../../features/ecosystem/Harbour";
import { ARC_ECOSYSTEM_DIRECTORY, POSITIONING } from "../../features/ecosystem/model";
import { useEcosystem } from "../../features/ecosystem/useEcosystem";
import { API_BASE } from "../../lib/env";
import { Card, MeanderBand } from "../../mosaic";

const FILTERS = [
  ["all", "EVERY PROTOCOL"],
  ["routes", "ROUTABLE ON LYKIA"],
  ["verified", "VERIFIED ON ARC"],
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
    const keep = q.data.protocols.filter((p) => (filter === "all" ? true : filter === "routes" ? p.lykia === "routes" : filter === "verified" ? p.status === "verified" : p.category === filter));
    return { ...q.data, protocols: keep };
  }, [q.data, filter]);
  const api = API_BASE;
  const snippet = `<div data-lykia-ecosystem data-limit="6"></div>
<script async src="${typeof window !== "undefined" ? window.location.origin : ""}/embed/routed-by-lykia.js"
        data-api="${api}"></script>`;

  return (
    <div>
      <header className="m-head m-wrap">
        <span className="m-kick">{"BUILT ON ARC NETWORK · POWERED BY CIRCLE"}</span>
        <h1 className="m-title">
          Lykia brings the <em>Arc ecosystem</em> together.
        </h1>
        <p className="m-sub">{POSITIONING}</p>
        <p className="m-small" style={{ marginTop: 10 }}>
          {"The full list of who builds on Arc lives in the official "}
          <a href={ARC_ECOSYSTEM_DIRECTORY} target="_blank" rel="noreferrer noopener">{"Arc ecosystem directory"}</a>
          {". This page shows which of those protocols are routable on Lykia, and links each one to its Arc entry."}
        </p>
      </header>

      <section className="m-wrap">
        <EcosystemStats data={q.data} />
        {q.isError ? <p className="m-note" style={{ marginTop: 12 }}>{"The API did not answer; the harbour fills in when it does."}</p> : null}
      </section>

      <section className="m-wrap" style={{ marginTop: 32 }}>
        <CircleQuay data={q.data} />
      </section>

      <MeanderBand className="mt-12" />

      <section className="m-wrap" style={{ marginTop: 32 }} aria-labelledby="eco-stalls">
        <div className="m-center">
          <span className="m-kick">{"EVERY STALL ALONG THE QUAY"}</span>
          <h2 id="eco-stalls" className="m-h2" style={{ marginTop: 8 }}>{"Every Arc protocol, one route away"}</h2>
          <p className="m-small m-muted" style={{ marginTop: 8 }}>{"ROUTABLE ON LYKIA: Lykia plans, checks and executes through it. READ: prices and positions in the Flock. LISTED: in the registry, routable as soon as an adapter lands. Each card links to the protocol's official Arc ecosystem entry where one exists."}</p>
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
          <Card title={"Your protocol here"} kicker={"INTEGRATE IN AN AFTERNOON"} footer={<Link to="/build#integrate" className="m-btn m-btn--sea">{"INTEGRATE YOUR PROTOCOL"}</Link>}>
            <p className="m-small">{"Send the addresses and the evidence, add one typed adapter, and every Lykia user and agent can reach you, inside their Fence. Free developer keys for Arc builders."}</p>
          </Card>
          <Card title={"Routed by Lykia"} kicker={"EMBED THE HARBOUR"}>
            <p className="m-small">{"Show the Arc ecosystem, live, on your own site. The data is public and open to every origin."}</p>
            <pre className="m-code eco-embed">{snippet}</pre>
          </Card>
        </div>
      </section>
    </div>
  );
}
