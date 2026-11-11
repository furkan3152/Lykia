/**
 * /stats: public traction numbers from GET /v1/stats, for grant
 * applications and anyone curious. Aggregates only, every number with its
 * source; a number that could not be read shows as "n/a", never as zero.
 */
import { useQuery } from "@tanstack/react-query";

import { Link } from "../../app/routes/Link";
import { apiGet } from "../../lib/api";
import { Card, MeanderBand, Stat, Tag } from "../../mosaic";
import { intlLocale, t } from "../../i18n";

interface StatsView {
  readonly environment: "mainnet" | "testnet";
  readonly onchain: { readonly contracts: readonly { readonly name: string; readonly address: string }[]; readonly accountsCreated: number | null; readonly memoSteps: number; readonly verdictsIndexed: number | null };
  readonly routed: { readonly intents: number; readonly steps: number; readonly usd: string; readonly window: string };
  readonly platform: { readonly developerKeys: number | null; readonly integrators: number | null; readonly agents: number | null; readonly capped: boolean };
  readonly ecosystem: { readonly protocols: number; readonly verified: number; readonly routable: number };
  readonly circle: { readonly integrated: readonly string[]; readonly basis?: string };
  readonly sources: Readonly<Record<string, string>>;
  readonly at: string;
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v.toLocaleString(intlLocale()));

export default function StatsPage() {
  const q = useQuery({ queryKey: ["stats", "mainnet"], queryFn: ({ signal }) => apiGet<StatsView>("/v1/stats", { query: { environment: "mainnet" }, signal, timeoutMs: 20_000 }), staleTime: 60_000, retry: 1 });
  const s = q.data;
  return (
    <div>
      <header className="m-head m-wrap">
        <span className="m-kick">{t("stats.theForgeLedgerStats")}</span>
        <h1 className="m-title">
          {t("stats.lykiaIn")} <em>{t("stats.numbers")}</em>
        </h1>
        <p className="m-sub">{t("stats.publicAggregateAndSourcedOnChain")}</p>
      </header>

      <section className="m-wrap" style={{ marginTop: 24 }}>
        {q.isError ? <p className="m-note">{t("stats.theApiDidNotAnswerThe")}</p> : null}
        <div className="m-grid-4">
          <Stat label={t("stats.accountsCreated")} value={s ? n(s.onchain.accountsCreated) : "…"} hint={t("stats.lykiaaccountFactory")} />
          <Stat label={t("stats.settledSteps")} value={s ? n(s.onchain.memoSteps) : "…"} hint={t("stats.eachWithAnArcMemo")} />
          <Stat label={t("stats.valueRouted")} value={s ? `$${Number(s.routed.usd).toLocaleString(intlLocale())}` : "…"} hint={s ? `${s.routed.intents} plans` : undefined} />
          <Stat label={t("stats.routableVenues")} value={s ? n(s.ecosystem.routable) : "…"} hint={s ? t("stats.protocolsMappedOnArc", { protocols: s.ecosystem.protocols }) : undefined} />
        </div>
        <div className="m-grid-4" style={{ marginTop: 12 }}>
          <Stat label={t("stats.developerKeys")} value={s ? n(s.platform.developerKeys) : "…"} />
          <Stat label={t("stats.integrators")} value={s ? n(s.platform.integrators) : "…"} hint={t("stats.projectsEmbeddingLykia")} />
          <Stat label={t("stats.agents")} value={s ? n(s.platform.agents) : "…"} hint={t("stats.registeredAgents")} />
          <Stat label={t("stats.verdictsIndexed")} value={s ? n(s.onchain.verdictsIndexed) : "…"} hint={t("stats.fenceVerdicts")} />
        </div>
      </section>

      <MeanderBand className="mt-12" />

      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <Card title={t("stats.contractsOnArc")} kicker={t("stats.verifiedWithEthGetcode")}>
            {s && s.onchain.contracts.length === 0 ? <p className="m-small m-muted">{t("stats.noDeploymentsRecordedOnThisApi")}</p> : null}
            <ul className="m-small" style={{ display: "grid", gap: 6 }}>
              {(s?.onchain.contracts ?? []).map((c) => (
                <li key={c.address} style={{ overflowWrap: "anywhere" }}>
                  <b>{c.name}</b> <span className="mono">{c.address}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t("stats.circleProductsIntegrated")} kicker={t("stats.circleSRails")}>
            <div className="flex flex-wrap gap-2">
              {(s?.circle.integrated ?? []).map((p) => <Tag key={p} tone="sea">{p}</Tag>)}
            </div>
            <p className="m-small m-muted" style={{ marginTop: 10 }}>
              {t("stats.howEachOneIsUsed")}
              <Link to="/ecosystem">{t("stats.theEcosystemPage")}</Link>
              {"."}
            </p>
          </Card>
        </div>
        <div style={{ marginTop: 16 }} />
        <Card title={t("stats.sources")} kicker={s ? t("stats.updatedUtc", { value: s.at.slice(0, 16).replace("T", " ") }) : "…"}>
          <ul className="m-small" style={{ display: "grid", gap: 6 }}>
            {Object.entries(s?.sources ?? {}).map(([k, v]) => (
              <li key={k}><b className="mono">{k}</b>{` · ${v}`}</li>
            ))}
          </ul>
          <p className="m-small m-muted" style={{ marginTop: 8 }}>{t("stats.jsonForAnyoneGetV1Stats")}</p>
        </Card>
      </section>
    </div>
  );
}
