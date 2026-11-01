import { CircleMarket, GatewayCard } from "../../features/circle/Circle";
import { Card, PageHead } from "../../mosaic";

export default function CirclePage() {
  return (
    <div>
      <PageHead kicker={"CIRCLE · ON ARC"} title={<>The harbor <em>market.</em></>} sub={"Each Circle product is a stall; the awning colour is its status: live, keyless, needs a key or unavailable, with docs one click away."} mood="happy" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <CircleMarket />
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <GatewayCard />
          <Card title={"Agent wallets"} kicker={"THE DEFAULT AGENT SETUP"}>
            <p className="m-small">{"Each pup runs on a Circle wallet, and Lykia's Fence checks every step before it reaches the wallet. On the Pack page, CIRCLE POLICY compiles the pup's Fence into the wallet's Circle spending policy: caps and allow lists enforced by Circle, everything else by Lykia. A Lykia smart account is optional, for on-chain enforcement."}</p>
            <p className="m-note" style={{ marginTop: 10 }}>{"Compliance screening results appear in the Scent report."}</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
