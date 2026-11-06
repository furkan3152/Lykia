/**
 * The landing, written for builders and for the Arc and Circle teams:
 * the story in one sentence, the problem, how it works, live proof from
 * mainnet, the Circle products underneath, developer entry points and an
 * honest beta note. The composer in the bay scene hands a sentence to Ask
 * (shared composer + scene in a View Transition).
 */
import { useQuery } from "@tanstack/react-query";
import { explorerAddress, lykiaContracts, networkFor } from "@lykia/core";
import { useMemo } from "react";

import { Link } from "../../app/routes/Link";
import { warmRoute } from "../../app/routes/loader";
import { Composer } from "../../features/ask/Composer";
import { BetaRibbon } from "../../features/ecosystem/BetaRibbon";
import { EcosystemStats } from "../../features/ecosystem/Harbour";
import { useEcosystem } from "../../features/ecosystem/useEcosystem";
import { FeesCard } from "../../features/fees/FeesCard";
import { Coin } from "../../features/league/Coin";
import { STATE_LABEL, STATE_TONE } from "../../features/league/model";
import { useLeague } from "../../features/league/useLeague";
import { SAMPLE_PENS, topYields, useRates } from "../../features/data/hooks";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { handleLine } from "../../shell/palette";
import { apiGet } from "../../lib/api";
import { usePulse } from "../../lib/pulseStore";
import { Card, MeanderBand, Medallion, Stat, Tag } from "../../mosaic";
import { bay, BAY_H, BAY_W } from "../../mosaic/scenes";

const REPO = "https://github.com/furkan3152/Lykia";
const API_REFERENCE = "https://lykia-api-akdogan1.vercel.app/v1/reference";

const CHIPS = ["Put half my USDC to work", "Keep 5000 USDC for payroll, put the rest in the best vault and hedge 20% into EURC", "Convert 200 USDC to EURC", "Bridge 50 USDC to Base"] as const;

/** Why a policy layer: what goes wrong without one. */
const PROBLEM: readonly (readonly [string, string])[] = [
  ["Too many paths", "Arc already has exchanges, lending markets, vaults and Circle's own rails. Picking the best route by hand, every time, is slow and easy to get wrong."],
  ["Wallets sign anything", "A wallet or an agent key signs whatever it is handed. Spending caps alone do not know a health factor, a slippage limit or a look-alike token."],
  ["No record of the rules", "After an agent moves money, nobody can show which rules it was held to, or that the check happened before the signature."],
];

/** How it works: one sentence in, one checked transaction out. */
const STEPS: readonly (readonly [string, string, string])[] = [
  ["1", "Say the outcome", "\"Keep 5,000 USDC for payroll, put the rest in the best vault and hedge 20% into EURC.\" A sentence in the app, or one API call."],
  ["2", "Lykia compiles a route", "Every capable Arc protocol and Circle rail (CCTP, Gateway, StableFX) is compared on the net result after fees, gas and slippage. The winner is simulated on Arc before you see it."],
  ["3", "The Fence decides, you sign once", "Your rules (caps, recipients, tokens, health factor, FX band) return allow, confirm or deny with reasons. Approve, act and an Arc Memo with the verdict go out as one transaction."],
];

/** The three pillars, each pointing at the area of the app that carries it. */
const PILLARS: readonly { title: string; kicker: string; line: string; links: readonly (readonly [string, string])[] }[] = [
  { title: "Outcomes, not transactions", kicker: "ASK LYKO · FLOCK · HERDING", line: "Send, swap, earn, borrow and bridge by saying what you want, or with plain forms. Orders and automations re-plan under the same rules while you are away.", links: [["/app", "ASK LYKO"], ["/app/move", "MOVE"], ["/app/orders", "HERDING"]] },
  { title: "Rules that hold", kicker: "FENCE · PACK · TAG", line: "The Fence is checked off chain before signing and on chain by Lykia's smart account. Sub-agents get a Fence inside yours, and a Tag (an ERC-8004 identity) pins the hash of the Fence an agent obeys.", links: [["/app/fence", "FENCE"], ["/app/pack", "PACK"], ["/app/tag", "TAG"]] },
  { title: "One engine for every builder", kicker: "REST · MCP · SDK · x402", line: "The planner, the router and the Fence behind this app are a public API, an MCP server, TypeScript and Python SDKs and drop-in components. Your brand, your fee.", links: [["/mint", "THE MINT"], ["/league", "THE LEAGUE"]] },
];

/** Which Circle product each Lykia feature uses (docs/circle/README.md). */
const TOGETHER: readonly (readonly [string, string, string])[] = [
  ["Agent wallets", "Circle Wallets", "The default signer for every agent, with gas sponsored by Gas Station."],
  ["Fence caps and allow lists", "Agent Wallet policies", "Your Fence compiles into the wallet's Circle spending policy; Lykia checks the rest."],
  ["Bridging", "CCTP V2 · Gateway", "Burn and mint USDC across chains, or spend one unified balance."],
  ["FX", "StableFX", "USDC and EURC on Arc, checked against the Chainlink reference."],
  ["Recipient checks", "Compliance Engine", "A screened-out address becomes a Fence deny."],
  ["Paid agent services", "x402 · Agent Marketplace", "Agents find services and pay them in USDC, inside their caps."],
  ["Every plan", "USDC · EURC", "USDC is Arc's gas and Lykia's unit of account."],
];

/** Mainnet flow proofs in docs/flows.md: simulated with eth_call, nothing signed. */
const FLOWS = { passed: 33, refused: 7 } as const;

interface StatsLite {
  readonly circle: { readonly productsUsed: readonly string[] };
}

export default function LandingPage() {
  const rates = useRates("mainnet");
  const league = useLeague();
  const eco = useEcosystem("mainnet");
  const stats = useQuery({ queryKey: ["stats", "mainnet"], queryFn: ({ signal }) => apiGet<StatsLite>("/v1/stats", { query: { environment: "mainnet" }, signal, timeoutMs: 20_000 }), staleTime: 60_000, retry: 1 });
  const lit = usePulse((s) => s.lit);
  const pulse = usePulse((s) => s.pulse);
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
        <div style={{ marginTop: 14 }}>
          <span className="m-kick">{"BUILT ON ARC NETWORK · POWERED BY CIRCLE · MAINNET BETA"}</span>
        </div>
        <h1 className="m-title">
          Say the outcome. <em>Keep the rules.</em>
        </h1>
        <p className="m-sub">
          {"Lykia is the policy layer for money that agents and apps move on Arc. It compiles what you want into a route across Arc protocols and Circle rails, checks every step against your Fence, and hands it to your wallet or your agent to sign. The same engine is an API for every builder."}
        </p>
        <div className="lp-cta">
          <Link to="/app" className="m-btn">{"OPEN THE APP"}</Link>
          <Link to="/mint" className="m-btn m-btn--sea">{"BUILD IN THE MINT"}</Link>
          <a href="#proof" className="m-btn m-btn--ghost">{"SEE THE PROOF"}</a>
        </div>
      </header>

      <section className="m-wrap" style={{ marginTop: 28 }} aria-label="Try it">
        <SceneFrame
          vt
          build={(t) => bay({ pens: pens.map((p) => ({ label: p.label, apy: p.apy })), flock: ["USDC", "EURC", "USDC", "USDC", "cirBTC", "EURC"], wolves: 2, lit, grow: rates.isLoading ? 0.25 : 1 }, t)}
          width={BAY_W}
          height={BAY_H}
          dataKey={dataKey}
          assembleKey="bay"
          label="Three pens whose grass height is each Arc vault's live yield, your assets inside the Fence, and two bad tokens kept outside it"
          labels={[
            { x: 28, y: 26, text: "BASE · CCTP" },
            { x: 72, y: 26, text: "ETHEREUM · CCTP" },
            { x: 18.5, y: 63, text: `${short(pens[0]!.label)} ${pens[0]!.apy?.toFixed(1) ?? "n/a"}%`, tone: pens[0]!.apy === best ? "ok" : "ochre" },
            { x: 50, y: 59, text: `${short(pens[1]!.label)} ${pens[1]!.apy?.toFixed(1) ?? "n/a"}%${pens[1]!.apy === best ? " · BEST" : ""}`, tone: pens[1]!.apy === best ? "ok" : "ochre" },
            { x: 81.5, y: 66, text: `${short(pens[2]!.label)} ${pens[2]!.apy?.toFixed(1) ?? "n/a"}%`, tone: pens[2]!.apy === best ? "ok" : "ochre" },
            { x: 6.5, y: 76, text: "LOOK-ALIKE", tone: "wolf" },
            { x: 93.5, y: 76, text: "HONEYPOT", tone: "wolf" },
          ]}
          footer={
            <div style={{ padding: 12, borderTop: "8px solid", borderImage: "var(--rule8) 8 round" }} onFocus={() => void warmRoute("/app")} onMouseEnter={() => void warmRoute("/app")}>
              <Composer onSubmit={ask} className="m-frame--thin" />
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
          {live.length >= 3 ? "LIVE USDC YIELDS · MORPHO + AAVE · ARC MAINNET" : rates.isLoading ? "…" : "SAMPLE YIELDS · THE API DID NOT ANSWER"}
        </p>
      </section>

      <MeanderBand className="mt-12" />

      <section className="m-wrap" style={{ marginTop: 40 }} aria-labelledby="lp-problem">
        <div className="m-center">
          <span className="m-kick">{"THE PROBLEM"}</span>
          <h2 id="lp-problem" className="m-h2" style={{ marginTop: 8 }}>{"Agents can hold money on Arc. Nobody should hand them a blank cheque."}</h2>
        </div>
        <div className="m-grid-3" style={{ marginTop: 24 }}>
          {PROBLEM.map(([title, line]) => (
            <div key={title} className="m-frame m-frame--thin lp-box">
              <b>{title}</b>
              <p className="m-small m-muted">{line}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }} aria-labelledby="lp-how">
        <div className="m-center">
          <span className="m-kick">{"HOW IT WORKS"}</span>
          <h2 id="lp-how" className="m-h2" style={{ marginTop: 8 }}>{"One sentence in. One checked transaction out."}</h2>
        </div>
        <ol className="lp-steps" aria-label="How Lykia works">
          {STEPS.map(([n, title, line]) => (
            <li key={n} className="m-frame lp-step">
              <span className="lp-step__n" aria-hidden="true">{n}</span>
              <b>{title}</b>
              <p className="m-small m-muted">{line}</p>
            </li>
          ))}
        </ol>
        <p className="m-small m-muted m-center" style={{ marginTop: 12 }}>{"The server never holds keys and never signs. A deny comes back with its reasons; nothing is sent."}</p>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }} aria-labelledby="lp-pillars">
        <h2 id="lp-pillars" className="sr-only">{"What Lykia does"}</h2>
        <div className="m-grid-3">
          {PILLARS.map((p) => (
            <Card key={p.title} title={p.title} kicker={p.kicker} footer={<div className="lp-links">{p.links.map(([href, label]) => <Link key={href} to={href} className="m-btn m-btn--sm m-btn--navy">{label}</Link>)}</div>}>
              <p className="m-small">{p.line}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }} aria-labelledby="lp-league">
        <div className="m-center">
          <span className="m-kick">{"THE LEAGUE"}</span>
          <h2 id="lp-league" className="m-h2" style={{ marginTop: 8 }}>{"One engine, a league of cities"}</h2>
          <p className="m-sub" style={{ marginTop: 8 }}>{"The Lycian League struck one coinage for many cities. Lykia's products are its cities: each is a project built in The Mint, with its own brand, modules and Fence caps, on the same engine you can call."}</p>
        </div>
        <ul className="lp-coins" aria-label="Cities of the League">
          {(league.data?.cities ?? []).slice(0, 3).map((c, i) => (
            <li key={c.slug}>
              <Link to={`/league/${c.slug}`} className="lp-coin">
                <Coin state={c.league.state} emblem={c.league.emblem} codename={c.league.codename} name={c.project.name} size={104} delay={i * 220} interactive={false} />
                <b>{c.project.name}</b>
                <span className="m-small m-muted">{c.league.tagline}</span>
                <Tag tone={STATE_TONE[c.league.state]}>{STATE_LABEL[c.league.state]}</Tag>
              </Link>
            </li>
          ))}
        </ul>
        {league.data && league.data.cities.length === 0 ? <p className="m-small m-muted m-center">{"The first cities are being struck."}</p> : null}
        <div className="lp-cta" style={{ marginTop: 18 }}>
          <Link to="/league" className="m-btn m-btn--navy">{"ENTER THE LEAGUE"}</Link>
          <Link to="/mint/strike" className="m-btn m-btn--ghost">{"STRIKE YOUR OWN CITY"}</Link>
        </div>
      </section>

      <section id="proof" className="m-wrap" style={{ marginTop: 48, scrollMarginTop: 80 }} aria-labelledby="lp-proof">
        <div className="m-center">
          <span className="m-kick">{"LIVE ON ARC MAINNET"}</span>
          <h2 id="lp-proof" className="m-h2" style={{ marginTop: 8 }}>{"Proof, not promises"}</h2>
        </div>
        <div className="m-grid-4" style={{ marginTop: 24 }}>
          <Stat label="FLOWS PROVEN" value={String(FLOWS.passed + FLOWS.refused)} hint={`${FLOWS.passed} pass, ${FLOWS.refused} refused as designed`} />
          <Stat label="CIRCLE PRODUCTS USED" value={stats.data ? String(stats.data.circle.productsUsed.length) : stats.isError ? "n/a" : "…"} hint="read live from GET /v1/stats" />
          <Stat label="BLOCK TIME" value={pulse?.blockTimeMs ? `${Math.round(pulse.blockTimeMs)} ms` : "…"} hint={pulse ? `block #${pulse.block.toLocaleString("en-US")}, final on inclusion` : undefined} />
          <Stat label="A TRANSFER COSTS" value={pulse?.transferCostUsd ? `$${Number(pulse.transferCostUsd).toFixed(4)}` : "…"} hint="gas paid in USDC" />
        </div>
        <div className="m-grid-2" style={{ marginTop: 16 }}>
          <Card title={"Lykia's contracts"} kicker={"DEPLOYED FROM THE OWNER'S WALLET"}>
            <ul className="lp-contracts">
              {contracts.map(([name, address]) => (
                <li key={name}>
                  <b>{name}</b>
                  <a className="mono" href={explorerAddress(mainnet, address)} target="_blank" rel="noreferrer">{address}</a>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={"Every flow, simulated on mainnet"} kicker={"ETH_CALL · NOTHING SIGNED"} footer={<div className="lp-links"><a className="m-btn m-btn--sm m-btn--navy" href={`${REPO}/blob/main/docs/flows.md`} target="_blank" rel="noreferrer">{"THE FLOW MATRIX"}</a><Link to="/stats" className="m-btn m-btn--sm m-btn--ghost">{"ALL STATS"}</Link></div>}>
            <p className="m-small">{"Send with a memo, FX, swaps, vault deposits, Aave V4 and Morpho borrow and repay, CCTP out, Gateway deposits, payouts, invoices and agent sessions: each built by the same code the API serves and run as one Multicall3From call on Arc. The refusals (beta cap, strangers, over-cap agents, the emergency stop) are on-chain errors from the contracts themselves."}</p>
          </Card>
        </div>
        <div style={{ marginTop: 16 }}>
          <EcosystemStats data={eco.data} />
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }} aria-labelledby="better-together">
        <div className="m-center">
          <span className="m-kick">{"POWERED BY CIRCLE"}</span>
          <h2 id="better-together" className="m-h2" style={{ marginTop: 8 }}>{"Better together with Circle"}</h2>
          <p className="m-sub" style={{ marginTop: 8 }}>{"Wherever Circle already runs something, Lykia uses it instead of rebuilding it, and adds what an agent still needs on top: routing across the Arc venues it has executable adapters for, and a Fence that understands DeFi."}</p>
        </div>
        <ul className="together" aria-label="Which Circle product each Lykia feature uses">
          {TOGETHER.map(([feature, product, line]) => (
            <li key={feature} className="m-frame m-frame--thin together__row">
              <b>{feature}</b>
              <Tag tone="sea">{product}</Tag>
              <p className="m-small m-muted">{line}</p>
            </li>
          ))}
        </ul>
        <p className="m-center" style={{ marginTop: 14 }}>
          <Link to="/app/circle" className="m-btn m-btn--sm m-btn--sea">{"LIVE STATUS OF EACH CIRCLE PRODUCT"}</Link>
        </p>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }} aria-labelledby="lp-build">
        <div className="m-center">
          <span className="m-kick">{"FOR BUILDERS"}</span>
          <h2 id="lp-build" className="m-h2" style={{ marginTop: 8 }}>{"The engine behind this app is yours to call"}</h2>
        </div>
        <div className="m-grid-2" style={{ marginTop: 24 }}>
          <Card title={"Quote, check, build"} kicker={"REST · SSE"}>
            <pre className="m-code">{`curl -X POST $LYKIA/v1/aggregator/quote \\
  -H 'content-type: application/json' \\
  -d '{"tokenIn":"USDC","tokenOut":"EURC",
       "amount":"100","taker":"0xYou"}'

# then POST /v1/aggregator/build with the quote id:
# unsigned calls, simulated, Fence verdict attached`}</pre>
          </Card>
          <Card title={"Entry points"} kicker={"PICK ONE"}>
            <ul className="lp-entry">
              <li><a href={API_REFERENCE} target="_blank" rel="noreferrer"><b>{"API reference"}</b></a><span className="m-small m-muted">{"OpenAPI 3.1, test and live keys, signed webhooks"}</span></li>
              <li><Link to="/mint/reference#mcp"><b>{"MCP server and agent tools"}</b></Link><span className="m-small m-muted">{"Plan and check moves from any agent framework"}</span></li>
              <li><a href={`${REPO}/tree/main/packages/sdk`} target="_blank" rel="noreferrer"><b>{"SDKs"}</b></a><span className="m-small m-muted">{"TypeScript and Python, plus a CLI"}</span></li>
              <li><a href={`${REPO}/tree/main/packages/widget`} target="_blank" rel="noreferrer"><b>{"Widget and embed"}</b></a><span className="m-small m-muted">{"React components, or one script tag"}</span></li>
              <li><a href={`${REPO}/blob/main/docs/integrate-your-protocol.md`} target="_blank" rel="noreferrer"><b>{"Integrate your protocol"}</b></a><span className="m-small m-muted">{"One typed adapter makes it routable"}</span></li>
            </ul>
          </Card>
        </div>
        <div style={{ marginTop: 16 }}>
          <FeesCard compact />
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }} aria-labelledby="lp-beta">
        <h2 id="lp-beta" className="sr-only">{"Beta status"}</h2>
        <BetaRibbon inline />
        <p className="m-small m-muted">
          {"Lykia is an independent, open-source (MIT) project by one developer, live on Arc mainnet in beta. Its contracts have a published "}
          <a href={`${REPO}/blob/main/docs/security/self-review.md`} target="_blank" rel="noreferrer">{"self-review"}</a>
          {" but no paid audit yet, so the caps above apply to everyone, above any Fence. Not affiliated with or endorsed by Circle or Arc."}
        </p>
      </section>
    </div>
  );
}
