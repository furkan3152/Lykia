/**
 * A city that is announced but not running yet (Lykia Perps): the plan,
 * honestly, in the city's own frame. On wide screens the coin and the pitch
 * sit side by side, then what it will do, how the money is held, the modules
 * it runs on, a clearly labelled preview of the market screen and the road
 * to launch. Nothing here trades.
 */
import type { LeagueCity } from "@lykia/core";

import { Coin } from "../features/league/Coin";
import { MODULE_LABEL } from "../features/league/model";
import { Tag } from "../mosaic";
import { CityFrame } from "./CityFrame";
import { PixelIcon } from "./PixelIcon";
import { t } from "../i18n";

/** A picture of the market screen, not data: labelled as a preview everywhere it shows. */
const PREVIEW_MARKETS = [
  { market: "BTC-USD", side: t("city.comingShell.long"), size: "0.050", lev: "3x", guard: t("city.comingShell.stopAt8") },
  { market: "ETH-USD", side: t("city.comingShell.short"), size: "1.20", lev: "2x", guard: t("city.comingShell.takeProfit12") },
  { market: "EUR-USD", side: t("city.comingShell.long"), size: "5,000", lev: "5x", guard: t("city.comingShell.fxBand05") },
] as const;

const HOW = [
  { icon: "shield" as const, title: t("city.comingShell.collateralStaysOnArc"), line: t("city.comingShell.yourUsdcMarginSitsInYour") },
  { icon: "spark" as const, title: t("city.comingShell.matchedOffArc"), line: t("city.comingShell.ordersWouldMatchOnExtendedS") },
  { icon: "agents" as const, title: t("city.comingShell.fencedLikeEverythingElse"), line: t("city.comingShell.leverageSizeAndStopRulesAre") },
];

const ROAD = [
  { title: t("city.comingShell.announced"), line: t("city.comingShell.theCityItsRulesAndIts"), done: true },
  { title: t("city.comingShell.designPartners"), line: t("city.comingShell.aSmallGroupTriesTheFlows"), done: false },
  { title: t("city.comingShell.auditedContracts"), line: t("city.comingShell.noRealMoneyBeforeAnAudit"), done: false },
  { title: t("city.comingShell.open"), line: t("city.comingShell.liveOnArcMainnetWithBeta"), done: false },
];

export function ComingShell({ city, home }: { readonly city: LeagueCity; readonly home: string }) {
  const { league, project } = city;
  const links = league.pages.filter((p) => !p.href.includes(":"));
  return (
    <CityFrame city={city} home={home}>
      <section className="ctc-hero">
        <div className="ctc-hero__coin">
          <Coin state={league.state} emblem={league.emblem} codename={league.codename} name={project.name} size={220} />
        </div>
        <div className="ctc-hero__text">
          <Tag tone="ochre">{t("city.comingShell.comingNotLive")}</Tag>
          <h1 className="m-title">{project.name}</h1>
          <p className="m-sub">{league.tagline}</p>
          {league.note ? <p className="m-note ctc-note">{league.note}</p> : null}
          <div className="ctc-cta">
            {links.map((p) => <a key={p.href} className="m-btn m-btn--ghost" href={`${home}${p.href}`}>{p.label.toUpperCase()}</a>)}
            <a className="m-btn" href={`${home}/league`}>{t("city.comingShell.theLeague")}</a>
          </div>
        </div>
      </section>

      <section className="ctc-three">
        <div className="m-frame m-frame--thin ct-card">
          <h2>{t("city.comingShell.whatItWillDo")}</h2>
          <ul className="lg-list">{league.does.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
        <div className="m-frame m-frame--thin ct-card">
          <h2>{t("city.comingShell.howTheMoneyIsHeld")}</h2>
          <ol className="ctc-how">
            {HOW.map((h) => (
              <li key={h.title}><PixelIcon name={h.icon} size={22} /><div><b>{h.title}</b><span className="m-small m-muted">{h.line}</span></div></li>
            ))}
          </ol>
        </div>
        <div className="m-frame m-frame--thin ct-card">
          <h2>{t("city.comingShell.onLykiaSEngine")}</h2>
          <ul className="lg-card__mods" style={{ justifyContent: "flex-start" }}>{project.modules.map((m) => <li key={m}>{MODULE_LABEL[m]}</li>)}</ul>
          {league.codenameNote ? <p className="m-small m-muted" style={{ marginTop: 10, fontStyle: "italic" }}>{league.codenameNote}</p> : null}
        </div>
      </section>

      <section className="ctc-two">
        <div className="m-frame m-frame--thin ct-card ctc-preview" aria-label={t("city.comingShell.previewOfTheMarketScreenNot")}>
          <div className="ct-card__head"><h2>{t("city.comingShell.theMarketScreen")}</h2><Tag tone="ochre">{t("city.comingShell.previewNotLiveNotData")}</Tag></div>
          <table className="m-table">
            <thead><tr><th>{t("city.comingShell.market")}</th><th>{t("city.comingShell.side")}</th><th className="r">{t("city.comingShell.size")}</th><th className="r">{t("city.comingShell.leverage")}</th><th>{t("city.comingShell.fenceRule")}</th></tr></thead>
            <tbody>
              {PREVIEW_MARKETS.map((m) => (
                <tr key={m.market}><td className="num"><b>{m.market}</b></td><td><Tag tone={m.side === "Long" ? "ok" : "bad"}>{m.side.toUpperCase()}</Tag></td><td className="r num">{m.size}</td><td className="r num">{m.lev}</td><td className="m-small">{m.guard}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="m-small m-muted">{t("city.comingShell.everyPositionWouldCarryItsStop")}</p>
        </div>
        <div className="m-frame m-frame--thin ct-card">
          <div className="ct-card__head"><h2>{t("city.comingShell.theRoadToOpen")}</h2><span className="m-kick">{t("city.comingShell.honestStatus")}</span></div>
          <ol className="ctc-road">
            {ROAD.map((r) => (
              <li key={r.title} data-done={r.done}><i aria-hidden="true" /><div><b>{r.title}</b><span className="m-small m-muted">{r.line}</span></div></li>
            ))}
          </ol>
        </div>
      </section>
    </CityFrame>
  );
}
