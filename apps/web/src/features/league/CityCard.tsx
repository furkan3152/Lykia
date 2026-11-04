/** One city of the League as a coin card: the coin, the name, one line, its status and its modules. */
import type { LeagueCity } from "@lykia/core";

import { Link } from "../../app/routes/Link";
import { Tag } from "../../mosaic";
import { Coin } from "./Coin";
import { CATEGORY_LABEL, MODULE_LABEL, STATE_LABEL, STATE_TONE, STATUS_LABEL, usageLine } from "./model";

export function CityCard({ city, index = 0 }: { readonly city: LeagueCity; readonly index?: number }) {
  const { league, project } = city;
  return (
    <article className={`m-frame lg-card lg-card--${league.state}`} style={{ animationDelay: `${index * 90}ms` }} aria-labelledby={`city-${city.slug}`}>
      <div className="lg-card__coin">
        <Coin state={league.state} emblem={league.emblem} codename={league.codename} name={project.name} delay={index * 220} />
      </div>
      <div className="lg-card__tags">
        <Tag tone={STATE_TONE[league.state]}>{STATE_LABEL[league.state]}</Tag>
        <Tag tone="ghost">{league.status === "official" ? "OFFICIAL" : "COMMUNITY"}</Tag>
      </div>
      <h3 id={`city-${city.slug}`} className="lg-card__name">{project.name}</h3>
      {league.codename ? <p className="lg-card__code">{`${league.codename.toUpperCase()} · ${CATEGORY_LABEL[league.category].toUpperCase()}`}</p> : <p className="lg-card__code">{CATEGORY_LABEL[league.category].toUpperCase()}</p>}
      <p className="lg-card__line">{league.tagline}</p>
      <ul className="lg-card__mods" aria-label={`${project.name} modules`}>
        {project.modules.map((m) => <li key={m}>{MODULE_LABEL[m]}</li>)}
      </ul>
      <p className="m-small m-muted lg-card__usage">{league.state === "coming" ? "Not running yet" : usageLine(city.usage)}</p>
      <Link to={`/league/${city.slug}`} className={`m-btn m-btn--sm ${league.state === "live" ? "" : "m-btn--ghost"}`} aria-label={`Open ${project.name}`}>
        {league.state === "live" ? "ENTER THE CITY" : league.state === "coming" ? "SEE THE PLAN" : "SEE WHY"}
      </Link>
      <span className="sr-only">{STATUS_LABEL[league.status]}</span>
    </article>
  );
}
