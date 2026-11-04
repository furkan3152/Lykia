/** A city that is announced but not running yet (Lykia Perps): the plan, honestly, in the city's own frame. */
import type { LeagueCity } from "@lykia/core";

import { Coin } from "../features/league/Coin";
import { MODULE_LABEL } from "../features/league/model";
import { Tag } from "../mosaic";
import { CityFrame } from "./CityFrame";

export function ComingShell({ city, home }: { readonly city: LeagueCity; readonly home: string }) {
  const { league, project } = city;
  return (
    <CityFrame city={city} home={home}>
      <section className="ct-coming">
        <Coin state={league.state} emblem={league.emblem} codename={league.codename} name={project.name} size={200} />
        <Tag tone="ochre">{"COMING · NOT LIVE"}</Tag>
        <h1 className="m-title">{project.name}</h1>
        <p className="m-sub">{league.tagline}</p>
        {league.note ? <p className="m-note ct-coming__note">{league.note}</p> : null}
        <div className="ct-coming__grid">
          <div className="m-frame m-frame--thin ct-card">
            <h2>{"What it will do"}</h2>
            <ul className="lg-list">{league.does.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
          <div className="m-frame m-frame--thin ct-card">
            <h2>{"On Lykia's engine"}</h2>
            <ul className="lg-card__mods" style={{ justifyContent: "flex-start" }}>{project.modules.map((m) => <li key={m}>{MODULE_LABEL[m]}</li>)}</ul>
            {league.codenameNote ? <p className="m-small m-muted" style={{ marginTop: 10, fontStyle: "italic" }}>{league.codenameNote}</p> : null}
          </div>
        </div>
        <div className="lp-cta">
          {league.pages.filter((p) => !p.href.includes(":")).map((p) => <a key={p.href} className="m-btn m-btn--ghost" href={`${home}${p.href}`}>{p.label.toUpperCase()}</a>)}
          <a className="m-btn" href={`${home}/league`}>{"THE LEAGUE"}</a>
        </div>
      </section>
    </CityFrame>
  );
}
