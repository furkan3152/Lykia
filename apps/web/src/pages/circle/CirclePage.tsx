import { CircleMarket, GatewayCard } from "../../features/circle/Circle";
import { Card, PageHead } from "../../mosaic";

export default function CirclePage() {
  return (
    <div>
      <PageHead kicker={"THE FORGE · CIRCLE · RAILS ON ARC"} title={<>Circle products, <em>live status.</em></>} sub={"Every Circle product Lykia uses, with its status read live: works without a key, needs a key, or unavailable. Docs are one click away."} mood="happy" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <CircleMarket />
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <GatewayCard />
          <Card title={"Agent wallets"} kicker={"CIRCLE WALLETS · OPTIONAL"}>
            <p className="m-small">{"An agent can run on a Circle Agent Wallet, with Lykia's Fence checking every step before it reaches the wallet. On the Pack page, CIRCLE POLICY exports the agent's Fence as a Circle spending policy, which you apply with the Circle CLI: caps and allow lists enforced by Circle, everything else by Lykia. Server-side Circle wallets are off by default; a Lykia smart account is optional, for on-chain enforcement."}</p>
            <p className="m-note" style={{ marginTop: 10 }}>{"Compliance screening results appear in the token check report."}</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
