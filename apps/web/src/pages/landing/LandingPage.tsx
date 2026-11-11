/**
 * The landing, for a first-time visitor: one headline, one line, one action
 * (Ask Lyko) and the bay scene with its composer, which hands a sentence to
 * Ask (shared composer and scene in a View Transition). Below, each section
 * is a short title and a line or two: how it works (with the wolves the
 * Fence keeps out, and the USDC journey behind "Learn more"), proof on
 * mainnet, the League and the builders' entry points.
 */
import { explorerAddress, lykiaContracts, networkFor } from "@lykia/core";
import { useMemo } from "react";

import { Link } from "../../app/routes/Link";
import { warmRoute } from "../../app/routes/loader";
import { Composer } from "../../features/ask/Composer";
import { Coin } from "../../features/league/Coin";
import { STATE_LABEL, STATE_TONE } from "../../features/league/model";
import { useLeague } from "../../features/league/useLeague";
import { SAMPLE_PENS, topYields, useRates } from "../../features/data/hooks";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { handleLine } from "../../shell/palette";
import { usePulse } from "../../lib/pulseStore";
import { MeanderBand, Medallion, Tag } from "../../mosaic";
import { NavIcon } from "../../mosaic/PixelArt";
import { UsdcPath } from "../../features/circle/UsdcPath";
import { AREAS } from "../../shell/nav";
import { bay, BAY_H, BAY_W } from "../../mosaic/scenes";
import { GateWalk, ProblemNight } from "./Story";
import { t as msg } from "../../i18n";

const REPO = "https://github.com/furkan3152/Lykia";
const API_REFERENCE = "https://api.lykiaai.com/v1/reference";

const CHIPS = [msg("landing.putHalfMyUsdcToWork"), msg("landing.convert200UsdcToEurc"), msg("landing.bridge50UsdcToBase")] as const;

/** What the Fence keeps out: one wolf each. */
const WOLVES: readonly (readonly [string, string])[] = [
  [msg("landing.wrongRoutes"), ""],
  [msg("landing.blindSigning"), ""],
  [msg("landing.noRecord"), ""],
];

/** How it works: one sentence in, one checked transaction out. */
const STEPS: readonly (readonly [string, string, string])[] = [
  ["1", msg("landing.sayTheOutcome"), msg("landing.inOneSentenceInTheApp")],
  ["2", msg("landing.lykiaFindsTheRoute"), msg("landing.comparedOnWhatYouEndUp")],
  ["3", msg("landing.yourFenceDecidesYouSignOnce"), msg("landing.allowAskYouFirstOrRefuse")],
];

/** The three ways in, one line each (the nav blurbs are written for menus). */
const DOOR_LINE: Readonly<Record<(typeof AREAS)[number]["id"], string>> = {
  ask: msg("landing.sayWhatYourUsdcShouldDo"),
  fold: msg("landing.seeWhatYouOwnAndWhat"),
  forge: msg("landing.buildOnTheSameEngine"),
};

/** Mainnet flow proofs in docs/flows.md (all three tables): simulated with eth_call, nothing signed. */
const FLOWS = { passed: 35, refused: 8 } as const;

export default function LandingPage() {
  const rates = useRates("mainnet");
  const league = useLeague();
  const lit = usePulse((s) => s.lit);
  const live = useMemo(() => topYields(rates.data, "USDC", 3), [rates.data]);
  const pens = useMemo(() => (live.length >= 3 ? [live[1]!, live[0]!, live[2]!] : SAMPLE_PENS), [live]);
  const best = Math.max(...pens.map((p) => p.apy ?? 0));
  const contracts = Object.entries(lykiaContracts.LYKIA_DEPLOYMENTS.mainnet);
  const mainnet = networkFor("mainnet");
  // A question is handed to Ask (and the composer morphs there); commands and page names run here.
  const ask = (text: string) => handleLine(text);
  const dataKey = useMemo(() => `${pens.map((p) => p.apy).join(",")}|${lit}`, [pens, lit]);
  const short = (s: string) => s.replace(/ USDC$/u, "").replace(/^Aave V4 /u, "AAVE V4 ").toUpperCase().slice(0, 16);

  return (
    <div>
      <header className="m-head m-wrap">
        <Medallion size={104} spin />
        <h1 className="m-title" style={{ marginTop: 14 }}>
          {msg("landing.sayTheOutcome2")} <em>{msg("landing.keepTheRules")}</em>
        </h1>
        <p className="m-sub lp-oneline">{msg("landing.tellLykiaWhatYourUsdcShould")}</p>
        <div className="lp-cta" style={{ marginTop: 16 }}>
          <Link to="/app" className="m-btn m-btn--hero" onFocus={() => void warmRoute("/app")} onMouseEnter={() => void warmRoute("/app")}>{msg("landing.askLyko")}</Link>
        </div>
        <nav className="lp-doors" aria-label={msg("landing.startHere")}>
          {AREAS.map((area) => (
            <Link key={area.id} to={area.href} className={`lp-door lp-door--${area.id}`} onFocus={() => void warmRoute(area.href)} onMouseEnter={() => void warmRoute(area.href)}>
              <span className="lp-door__plate" aria-hidden="true"><NavIcon name={area.id} size={30} /></span>
              <span className="lp-door__text">
                <b className="lp-door__name">{area.label}</b>
                <span className="lp-door__sub">{DOOR_LINE[area.id]}</span>
              </span>
            </Link>
          ))}
        </nav>
      </header>

      <section className="m-wrap m-floor" style={{ marginTop: 28 }} aria-label={msg("landing.tryIt")}>
        <SceneFrame
          vt
          build={(t) => bay({ pens: pens.map((p) => ({ label: p.label, apy: p.apy })), flock: ["USDC", "EURC", "USDC", "USDC", "cirBTC", "EURC"], wolves: 2, lit, grow: rates.isLoading ? 0.25 : 1 }, t)}
          width={BAY_W}
          height={BAY_H}
          dataKey={dataKey}
          assembleKey="bay"
          label={msg("landing.threePensWhoseGrassHeightIs")}
          labels={[
            { x: 28, y: 26, text: "BASE · CCTP" },
            { x: 72, y: 26, text: "ETHEREUM · CCTP" },
            { x: 18.5, y: 63, text: `${short(pens[0]!.label)} ${pens[0]!.apy?.toFixed(1) ?? "n/a"}%`, tone: pens[0]!.apy === best ? "ok" : "ochre" },
            { x: 50, y: 59, text: `${short(pens[1]!.label)} ${pens[1]!.apy?.toFixed(1) ?? "n/a"}%${pens[1]!.apy === best ? msg("landing.best") : ""}`, tone: pens[1]!.apy === best ? "ok" : "ochre" },
            { x: 81.5, y: 66, text: `${short(pens[2]!.label)} ${pens[2]!.apy?.toFixed(1) ?? "n/a"}%`, tone: pens[2]!.apy === best ? "ok" : "ochre" },
            { x: 6.5, y: 76, text: "LOOK-ALIKE", tone: "wolf" },
            { x: 93.5, y: 76, text: "HONEYPOT", tone: "wolf" },
          ]}
          footer={
            <div style={{ padding: 12, borderTop: "8px solid", borderImage: "var(--rule8) 8 round" }} onFocus={() => void warmRoute("/app")} onMouseEnter={() => void warmRoute("/app")}>
              <Composer onSubmit={ask} className="m-frame--thin" sendLabel={msg("landing.planIt")} />
              <div className="m-chips">
                {CHIPS.map((c) => (
                  <button key={c} type="button" className="m-chip" onClick={() => ask(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          }
        />
        <p className="m-kick m-center" style={{ marginTop: 10 }}>
          {live.length >= 3 ? msg("landing.liveUsdcYieldsArcMainnet") : rates.isLoading ? "…" : msg("landing.sampleYields")}
        </p>
      </section>

      <MeanderBand className="mt-12" />

      <section className="m-wrap m-floor" style={{ marginTop: 40 }} aria-labelledby="lp-how">
        <div className="m-center">
          <h2 id="lp-how" className="m-h2">{msg("landing.oneSentenceInOneCheckedTransaction")}</h2>
        </div>
        <GateWalk steps={STEPS} />
        <ProblemNight items={WOLVES} />
        <details className="lp-more">
          <summary className="m-linkbtn">{msg("landing.learnMoreWhereUsdcCircleAnd")}</summary>
          <UsdcPath />
        </details>
      </section>

      <section id="proof" className="m-wrap m-floor" style={{ marginTop: 48, scrollMarginTop: 80 }} aria-labelledby="lp-proof">
        <div className="m-center">
          <h2 id="lp-proof" className="m-h2">{msg("landing.proofOnMainnet")}</h2>
          <p className="m-sub" style={{ marginTop: 8 }}>{msg("landing.flowsSimulatedOnArcMainnetPass", { value: FLOWS.passed + FLOWS.refused, passed: FLOWS.passed, refused: FLOWS.refused })}</p>
        </div>
        <ul className="lp-contracts" style={{ marginTop: 18 }}>
          {contracts.map(([name, address]) => (
            <li key={name}>
              <b>{name}</b>
              <a className="mono" data-i18n-skip href={explorerAddress(mainnet, address)} target="_blank" rel="noreferrer">{address}</a>
            </li>
          ))}
        </ul>
        <div className="lp-cta" style={{ marginTop: 14 }}>
          <a className="m-btn m-btn--ghost" href={`${REPO}/blob/main/docs/flows.md`} target="_blank" rel="noreferrer">{msg("landing.theFlowMatrix")}</a>
          <Link to="/stats" className="m-btn m-btn--ghost">{msg("landing.allStats")}</Link>
        </div>
      </section>

      <section className="m-wrap m-floor" style={{ marginTop: 48 }} aria-labelledby="lp-league">
        <div className="m-center">
          <h2 id="lp-league" className="m-h2">{msg("landing.theLeague")}</h2>
          <p className="m-sub" style={{ marginTop: 8 }}>{msg("landing.productsBuiltInTheForgeOn")}</p>
        </div>
        <ul className="lp-coins" aria-label={msg("landing.citiesOfTheLeague")}>
          {(league.data?.cities ?? []).slice(0, 3).map((c, i) => (
            <li key={c.slug}>
              <Link to={`/league/${c.slug}`} className="lp-coin">
                <Coin state={c.league.state} emblem={c.league.emblem} codename={c.league.codename} name={c.project.name} size={104} delay={i * 220} interactive={false} />
                <b>{c.project.name}</b>
                <Tag tone={STATE_TONE[c.league.state]}>{STATE_LABEL[c.league.state]}</Tag>
              </Link>
            </li>
          ))}
        </ul>
        <div className="lp-cta" style={{ marginTop: 18 }}>
          <Link to="/league" className="m-btn m-btn--ghost">{msg("landing.enterTheLeague")}</Link>
        </div>
      </section>

      <section className="m-wrap m-floor" style={{ marginTop: 48, marginBottom: 24 }} aria-labelledby="lp-build">
        <div className="m-center">
          <h2 id="lp-build" className="m-h2">{msg("landing.forBuilders")}</h2>
          <p className="m-sub" style={{ marginTop: 8 }}>{msg("landing.theEngineBehindThisAppIs")}</p>
        </div>
        <div className="lp-cta" style={{ marginTop: 16 }}>
          <a className="m-btn m-btn--ghost" href={API_REFERENCE} target="_blank" rel="noreferrer">{msg("landing.apiReference")}</a>
          <Link to="/forge/reference#mcp" className="m-btn m-btn--ghost">{msg("landing.mcpServer")}</Link>
          <a className="m-btn m-btn--ghost" href={`${REPO}/tree/main/packages/sdk`} target="_blank" rel="noreferrer">{msg("landing.sdks")}</a>
          <Link to="/forge" className="m-btn m-btn--ghost">{msg("landing.theForge")}</Link>
        </div>
      </section>
    </div>
  );
}
