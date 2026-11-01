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
          <Card title={"Agent wallets"} kicker={"CIRCLE WALLETS FOR PUPS"}>
            <p className="m-small">{"On the Pack page each pup can get a Circle agent wallet; its spending rules are derived from the pup's Fence."}</p>
            <p className="m-note" style={{ marginTop: 10 }}>{"Compliance screening results appear in the Scent report."}</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
