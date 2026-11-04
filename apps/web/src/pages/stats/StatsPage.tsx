/**
 * /stats: public traction numbers from GET /v1/stats, for grant
 * applications and anyone curious. Aggregates only, every number with its
 * source; a number that could not be read shows as "n/a", never as zero.
 */
import { useQuery } from "@tanstack/react-query";

import { Link } from "../../app/routes/Link";
import { apiGet } from "../../lib/api";
import { Card, MeanderBand, Stat, Tag } from "../../mosaic";

interface StatsView {
  readonly environment: "mainnet" | "testnet";
  readonly onchain: { readonly contracts: readonly { readonly name: string; readonly address: string }[]; readonly accountsCreated: number | null; readonly memoSteps: number; readonly verdictsIndexed: number | null };
  readonly routed: { readonly intents: number; readonly steps: number; readonly usd: string; readonly window: string };
  readonly platform: { readonly developerKeys: number | null; readonly integrators: number | null; readonly agents: number | null; readonly capped: boolean };
  readonly ecosystem: { readonly protocols: number; readonly verified: number; readonly routable: number };
  readonly circle: { readonly productsUsed: readonly string[] };
  readonly sources: Readonly<Record<string, string>>;
  readonly at: string;
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v.toLocaleString("en-US"));

export default function StatsPage() {
  const q = useQuery({ queryKey: ["stats", "mainnet"], queryFn: ({ signal }) => apiGet<StatsView>("/v1/stats", { query: { environment: "mainnet" }, signal, timeoutMs: 20_000 }), staleTime: 60_000, retry: 1 });
  const s = q.data;
  return (
    <div>
      <header className="m-head m-wrap">
        <span className="m-kick">{"THE MINT · LEDGER · STATS"}</span>
        <h1 className="m-title">
          Lykia, in <em>numbers.</em>
        </h1>
        <p className="m-sub">{"Public, aggregate and sourced: on-chain counts on Arc mainnet, value routed, the platform and the ecosystem. No personal data."}</p>
      </header>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        {q.isError ? <p className="m-note">{"The API did not answer; the numbers fill in when it does."}</p> : null}
        <div className="m-grid-4">
          <Stat label="ACCOUNTS CREATED" value={s ? n(s.onchain.accountsCreated) : "…"} hint="LykiaAccount factory" />
          <Stat label="SETTLED STEPS" value={s ? n(s.onchain.memoSteps) : "…"} hint="each with an Arc Memo" />
          <Stat label="VALUE ROUTED" value={s ? `$${Number(s.routed.usd).toLocaleString("en-US")}` : "…"} hint={s ? `${s.routed.intents} plans` : undefined} />
          <Stat label="ROUTABLE PROTOCOLS" value={s ? n(s.ecosystem.routable) : "…"} hint={s ? `${s.ecosystem.protocols} in the registry` : undefined} />
        </div>
        <div className="m-grid-4" style={{ marginTop: 12 }}>
          <Stat label="DEVELOPER KEYS" value={s ? n(s.platform.developerKeys) : "…"} />
          <Stat label="INTEGRATORS" value={s ? n(s.platform.integrators) : "…"} hint="projects embedding Lykia" />
          <Stat label="AGENTS" value={s ? n(s.platform.agents) : "…"} hint="registered agents" />
          <Stat label="VERDICTS INDEXED" value={s ? n(s.onchain.verdictsIndexed) : "…"} hint="Fence verdicts" />
        </div>
      </section>

      <MeanderBand className="mt-12" />

      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <Card title={"Contracts on Arc"} kicker={"VERIFIED WITH ETH_GETCODE"}>
            {s && s.onchain.contracts.length === 0 ? <p className="m-small m-muted">{"No deployments recorded on this API yet."}</p> : null}
            <ul className="m-small" style={{ display: "grid", gap: 6 }}>
              {(s?.onchain.contracts ?? []).map((c) => (
                <li key={c.address} style={{ overflowWrap: "anywhere" }}>
                  <b>{c.name}</b> <span className="mono">{c.address}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={"Circle products used"} kicker={"POWERED BY CIRCLE"}>
            <div className="flex flex-wrap gap-2">
              {(s?.circle.productsUsed ?? []).map((p) => <Tag key={p} tone="sea">{p}</Tag>)}
            </div>
            <p className="m-small m-muted" style={{ marginTop: 10 }}>
              {"How each one is used: "}
              <Link to="/ecosystem">{"the ecosystem page"}</Link>
              {"."}
            </p>
          </Card>
        </div>
        <div style={{ marginTop: 16 }} />
        <Card title={"Sources"} kicker={s ? `UPDATED ${s.at.slice(0, 16).replace("T", " ")} UTC` : "…"}>
          <ul className="m-small" style={{ display: "grid", gap: 6 }}>
            {Object.entries(s?.sources ?? {}).map(([k, v]) => (
              <li key={k}><b className="mono">{k}</b>{` · ${v}`}</li>
            ))}
          </ul>
          <p className="m-small m-muted" style={{ marginTop: 8 }}>{"JSON for anyone: GET /v1/stats (CORS-open, cached five minutes)."}</p>
        </Card>
      </section>
    </div>
  );
}
