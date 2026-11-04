import { CircleMarket, GatewayCard } from "../../features/circle/Circle";
import { Card, PageHead } from "../../mosaic";

export default function CirclePage() {
  return (
    <div>
      <PageHead kicker={"THE MINT · CIRCLE · RAILS ON ARC"} title={<>Circle products, <em>live status.</em></>} sub={"Every Circle product Lykia uses, with its status read live: works without a key, needs a key, or unavailable. Docs are one click away."} mood="happy" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <CircleMarket />
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <GatewayCard />
          <Card title={"Agent wallets"} kicker={"THE DEFAULT AGENT SETUP"}>
            <p className="m-small">{"Each agent runs on a Circle wallet, and Lykia's Fence checks every step before it reaches the wallet. On the Pack page, CIRCLE POLICY compiles the agent's Fence into the wallet's Circle spending policy: caps and allow lists enforced by Circle, everything else by Lykia. A Lykia smart account is optional, for on-chain enforcement."}</p>
            <p className="m-note" style={{ marginTop: 10 }}>{"Compliance screening results appear in the token check report."}</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
