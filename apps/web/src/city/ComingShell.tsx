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

/** A picture of the market screen, not data: labelled as a preview everywhere it shows. */
const PREVIEW_MARKETS = [
  { market: "BTC-USD", side: "Long", size: "0.050", lev: "3x", guard: "Stop at −8%" },
  { market: "ETH-USD", side: "Short", size: "1.20", lev: "2x", guard: "Take profit +12%" },
  { market: "EUR-USD", side: "Long", size: "5,000", lev: "5x", guard: "FX band 0.5%" },
] as const;

const HOW = [
  { icon: "shield" as const, title: "Collateral stays on Arc", line: "Your USDC margin sits in your own account on Arc; Lykia never holds it." },
  { icon: "spark" as const, title: "Matched off Arc", line: "Orders would match on Extended's engine, with settlement reported back." },
  { icon: "agents" as const, title: "Fenced like everything else", line: "Leverage, size and stop rules are Fence rules, checked before you sign." },
];

const ROAD = [
  { title: "Announced", line: "The city, its rules and its coin.", done: true },
  { title: "Design partners", line: "A small group tries the flows on testnet.", done: false },
  { title: "Audited contracts", line: "No real money before an audit.", done: false },
  { title: "Open", line: "Live on Arc mainnet with beta caps.", done: false },
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
          <Tag tone="ochre">{"COMING · NOT LIVE"}</Tag>
          <h1 className="m-title">{project.name}</h1>
          <p className="m-sub">{league.tagline}</p>
          {league.note ? <p className="m-note ctc-note">{league.note}</p> : null}
          <div className="ctc-cta">
            {links.map((p) => <a key={p.href} className="m-btn m-btn--ghost" href={`${home}${p.href}`}>{p.label.toUpperCase()}</a>)}
            <a className="m-btn" href={`${home}/league`}>{"THE LEAGUE"}</a>
          </div>
        </div>
      </section>

      <section className="ctc-three">
        <div className="m-frame m-frame--thin ct-card">
          <h2>{"What it will do"}</h2>
          <ul className="lg-list">{league.does.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
        <div className="m-frame m-frame--thin ct-card">
          <h2>{"How the money is held"}</h2>
          <ol className="ctc-how">
            {HOW.map((h) => (
              <li key={h.title}><PixelIcon name={h.icon} size={22} /><div><b>{h.title}</b><span className="m-small m-muted">{h.line}</span></div></li>
            ))}
          </ol>
        </div>
        <div className="m-frame m-frame--thin ct-card">
          <h2>{"On Lykia's engine"}</h2>
          <ul className="lg-card__mods" style={{ justifyContent: "flex-start" }}>{project.modules.map((m) => <li key={m}>{MODULE_LABEL[m]}</li>)}</ul>
          {league.codenameNote ? <p className="m-small m-muted" style={{ marginTop: 10, fontStyle: "italic" }}>{league.codenameNote}</p> : null}
        </div>
      </section>

      <section className="ctc-two">
        <div className="m-frame m-frame--thin ct-card ctc-preview" aria-label="Preview of the market screen, not live">
          <div className="ct-card__head"><h2>{"The market screen"}</h2><Tag tone="ochre">{"PREVIEW · NOT LIVE · NOT DATA"}</Tag></div>
          <table className="m-table">
            <thead><tr><th>{"Market"}</th><th>{"Side"}</th><th className="r">{"Size"}</th><th className="r">{"Leverage"}</th><th>{"Fence rule"}</th></tr></thead>
            <tbody>
              {PREVIEW_MARKETS.map((m) => (
                <tr key={m.market}><td className="num"><b>{m.market}</b></td><td><Tag tone={m.side === "Long" ? "ok" : "bad"}>{m.side.toUpperCase()}</Tag></td><td className="r num">{m.size}</td><td className="r num">{m.lev}</td><td className="m-small">{m.guard}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="m-small m-muted">{"Every position would carry its stop and size limits as Fence rules, and Lyko would explain each one before you sign."}</p>
        </div>
        <div className="m-frame m-frame--thin ct-card">
          <div className="ct-card__head"><h2>{"The road to open"}</h2><span className="m-kick">{"HONEST STATUS"}</span></div>
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
