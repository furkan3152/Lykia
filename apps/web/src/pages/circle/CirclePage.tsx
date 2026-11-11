import { CircleMarket, GatewayCard } from "../../features/circle/Circle";
import { Card, PageHead } from "../../mosaic";
import { t } from "../../i18n";

export default function CirclePage() {
  return (
    <div>
      <PageHead kicker={t("circle.theForgeCircleRailsOnArc")} title={<>{t("circle.circleProducts")} <em>{t("circle.liveStatus")}</em></>} sub={t("circle.everyCircleProductLykiaUsesWith")} mood="happy" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <CircleMarket />
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <GatewayCard />
          <Card title={t("circle.agentWallets")} kicker={t("circle.circleWalletsOptional")}>
            <p className="m-small">{t("circle.anAgentCanRunOnA")}</p>
            <p className="m-note" style={{ marginTop: 10 }}>{t("circle.complianceScreeningResultsAppearInThe")}</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
