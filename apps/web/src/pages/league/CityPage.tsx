/**
 * One city of the League: what it does, how it uses Lykia, whether it is
 * live, and the city itself, a branded instance of Lykia rendered from its
 * project (brand, modules and Fence caps), with the embed code beside it.
 */
import type { ProjectModule } from "@lykia/core";
import { LykiaTransport } from "@lykia/sdk";
import { Bridge, Earn, Fence, Flock, LykiaChat, LykiaProvider, Pack, Scent, Send, Swap } from "@lykia/widget";
import { useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { useRouteParam } from "../../app/routes/useRoute";
import { Coin } from "../../features/league/Coin";
import { CATEGORY_LABEL, MODULE_LABEL, STATE_LABEL, STATE_TONE, STATUS_LABEL, linkable, usageLine } from "../../features/league/model";
import { useCity } from "../../features/league/useLeague";
import { apiUrl } from "../../lib/api";
import { API_BASE } from "../../lib/env";
import { Card, EmptyState, Skeleton, Stat, Tabs, Tag } from "../../mosaic";
import { t } from "../../i18n";

const PREVIEW: Partial<Record<ProjectModule, () => React.ReactElement>> = {
  chat: () => <LykiaChat />,
  send: () => <Send />,
  swap: () => <Swap />,
  earn: () => <Earn />,
  bridge: () => <Bridge />,
  fence: () => <Fence />,
  scent: () => <Scent />,
  flock: () => <Flock />,
  pack: () => <Pack />,
};

export default function CityPage() {
  const slug = useRouteParam("city");
  const city = useCity(slug);
  const shown = useMemo(() => (city.data?.project.modules ?? []).filter((m) => PREVIEW[m]), [city.data]);
  const [module, setModule] = useState<ProjectModule | null>(null);
  const network = city.data?.project.network ?? "mainnet";
  const transport = useMemo(() => new LykiaTransport({ baseUrl: new URL(API_BASE).origin, environment: network }), [network]);

  if (city.isLoading) return <div className="m-wrap" style={{ padding: "40px 0" }}><Skeleton h={420} /></div>;
  if (!city.data) {
    return (
      <div className="m-wrap" style={{ padding: "48px 0" }}>
        <EmptyState mood="alert" title={t("league.cityPage.noSuchCityInTheLeague")}>{t("league.cityPage.itMayHaveBeenDelistedOr")}<Link to="/league">{t("league.cityPage.backToTheLeague")}</Link></EmptyState>
      </div>
    );
  }
  const { league, project, usage } = city.data;
  const caps = project.fence.caps;
  const active = module && shown.includes(module) ? module : shown[0] ?? null;
  // i18n-ignore: an embed snippet is code.
  const embed = `<script type="module" src="https://unpkg.com/@lykia/embed"></script>\n<lykia-assistant project="${project.id}"></lykia-assistant>`;
  return (
    <div>
      <header className={`m-wrap lg-hero lg-hero--${league.state}`}>
        <div className="lg-hero__coin">
          <Coin state={league.state} emblem={league.emblem} codename={league.codename} name={project.name} size={176} />
        </div>
        <div className="lg-hero__text">
          <span className="m-kick">{`${t("league.cityPage.theLeague")} · ${STATUS_LABEL[league.status]}${league.codename ? ` · ${league.codename.toUpperCase()}` : ""}`}</span>
          <h1 className="m-title" style={{ marginTop: 10 }}>{project.name}</h1>
          <p className="m-sub" style={{ marginInline: 0 }}>{league.tagline}</p>
          <div className="lg-hero__tags">
            <Tag tone={STATE_TONE[league.state]}>{STATE_LABEL[league.state]}</Tag>
            <Tag tone="sea">{`ARC ${project.network.toUpperCase()}`}</Tag>
            <Tag tone="ghost">{CATEGORY_LABEL[league.category].toUpperCase()}</Tag>
          </div>
          {league.codenameNote ? <p className="m-small m-muted lg-hero__lore">{league.codenameNote}</p> : null}
        </div>
      </header>

      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-3">
          <Card title={t("league.cityPage.whatItDoes")} kicker={t("league.cityPage.theCity")}>
            <ul className="lg-list">{league.does.map((d) => <li key={d}>{d}</li>)}</ul>
          </Card>
          <Card title={t("league.cityPage.howItUsesLykia")} kicker={t("league.cityPage.modulesFencePages")}>
            <ul className="lg-card__mods" style={{ justifyContent: "flex-start" }}>{project.modules.map((m) => <li key={m}>{MODULE_LABEL[m]}</li>)}</ul>
            <p className="m-small" style={{ marginTop: 10 }}>
              {`Fence: ${project.fence.template}`}
              {caps.perStepUsd ? t("league.cityPage.atMostAStep", { perStepUsd: caps.perStepUsd }) : ""}
              {caps.dailyUsd ? t("league.cityPage.aDay", { dailyUsd: caps.dailyUsd }) : ""}
              {t("league.cityPage.appFeeBps", { bps: project.fee.bps })}
            </p>
            {league.pages.length > 0 ? (
              <ul className="lg-pages">
                {league.pages.map((p) => (
                  <li key={p.href}>{linkable(p.href) ? (p.href.startsWith("/v1/") ? <a href={apiUrl("/v1/reference")} target="_blank" rel="noreferrer">{p.label}</a> : <Link to={p.href}>{p.label}</Link>) : <span>{p.label}</span>}<code className="num">{p.href}</code></li>
                ))}
              </ul>
            ) : null}
          </Card>
          <Card title={t("league.cityPage.liveStatus")} kicker={t("league.cityPage.readFromTheApi")}>
            <div className="lg-live">
              <Stat label={t("league.cityPage.today")} value={String(usage.today.requests)} hint={t("league.cityPage.requests")} />
              <Stat label={t("league.cityPage.n7Days")} value={String(usage.last7Days.plans)} hint={t("league.cityPage.plans")} />
            </div>
            <p className="m-small m-muted" style={{ marginTop: 8 }}>{league.state === "coming" ? t("league.cityPage.notRunningYetNothingIsCounted") : usageLine(usage)}</p>
            {league.note ? <p className="m-note" style={{ marginTop: 10 }}>{league.note}</p> : null}
          </Card>
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 28 }} aria-labelledby="lg-instance">
        <div className="m-center">
          <span className="m-kick">{t("league.cityPage.theCityItself")}</span>
          <h2 id="lg-instance" className="m-h2" style={{ marginTop: 8 }}>{league.state === "live" ? t("league.cityPage.runningOnLykia", { name: project.name }) : league.state === "paused" ? t("league.cityPage.pausedByTheLykiaTeam") : t("league.cityPage.notOpenYet")}</h2>
          <p className="m-small m-muted" style={{ marginTop: 6 }}>{t("league.cityPage.renderedFromItsProjectInThe")}</p>
        </div>
        <div className="m-grid-2 m-grid-2--l" style={{ marginTop: 18, alignItems: "start" }}>
          <div className="m-frame m-card lg-instance" style={{ minWidth: 0 }}>
            {league.state !== "live" ? (
              <EmptyState mood={league.state === "paused" ? "alert" : "resting"} title={league.state === "paused" ? t("league.cityPage.thisCityAnswersReadsOnly") : t("league.cityPage.theHarbourIsStillBeingBuilt")}>{league.note ?? ""}</EmptyState>
            ) : shown.length === 0 ? (
              <p className="m-small m-muted">{t("league.cityPage.thisCityHasNoVisualModule")}</p>
            ) : (
              <>
                {shown.length > 1 ? <Tabs label={t("league.cityPage.module")} value={active ?? shown[0]!} onChange={setModule} tabs={shown.map((m) => ({ id: m, label: MODULE_LABEL[m].split(" · ")[0]!.toUpperCase() }))} /> : null}
                <div style={{ marginTop: 12 }}>
                  <LykiaProvider transport={transport} brand={project.brand} modules={project.modules} assistantName={project.assistantName} vocabulary={project.vocabulary} environment={project.network}>
                    {active ? PREVIEW[active]?.() : null}
                  </LykiaProvider>
                </div>
              </>
            )}
          </div>
          <div style={{ display: "grid", gap: 16, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
            <Card title={t("league.cityPage.openOrEmbed")} kicker={project.id}>
              <p className="m-small">{t("league.cityPage.putThisCityOnYourOwn")}</p>
              <pre className="m-code" style={{ marginTop: 8, fontSize: 12, overflowX: "auto" }}>{embed}</pre>
              <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                <button type="button" className="m-btn m-btn--sm m-btn--ghost" onClick={() => void navigator.clipboard?.writeText(embed)}>{t("league.cityPage.copy")}</button>
                <a className="m-btn m-btn--sm m-btn--ghost" href={apiUrl(`/v1/projects/${project.id}/public`)} target="_blank" rel="noreferrer">{t("league.cityPage.publicProject")}</a>
                <a className="m-btn m-btn--sm m-btn--ghost" href={apiUrl(`/v1/projects/${project.id}/fence`)} target="_blank" rel="noreferrer">{t("league.cityPage.itsFence")}</a>
              </div>
            </Card>
            <Card title={t("league.cityPage.builtInTheForge")} kicker={t("league.cityPage.everyCityIsAProject")}>
              <p className="m-small">{t("league.cityPage.theSameProjectEditorAnyBuilder")}</p>
              <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                <Link to="/forge/strike" className="m-btn m-btn--sm">{t("league.cityPage.strikeACity")}</Link>
                <Link to="/league" className="m-btn m-btn--sm m-btn--ghost">{t("league.cityPage.allCities")}</Link>
              </div>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
