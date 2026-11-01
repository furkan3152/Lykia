import { CircleMarket, GatewayCard } from "../../features/circle/Circle";
import { useLang } from "../../lib/i18n";
import { Card, PageHead } from "../../mosaic";

export default function CirclePage() {
  const lang = useLang();
  return (
    <div>
      <PageHead kicker={lang === "tr" ? "CIRCLE · ARC ÜZERİNDE" : "CIRCLE · ON ARC"} title={lang === "tr" ? <>Liman <em>pazarı.</em></> : <>The harbor <em>market.</em></>} sub={lang === "tr" ? "Circle'ın ürünleri birer tezgâh: tente rengi durumu söyler. Canlı, anahtarsız, anahtar gerekli ya da yok; dokümanlar bir tık uzakta." : "Each Circle product is a stall; the awning colour is its status: live, keyless, needs a key or unavailable, with docs one click away."} mood="happy" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <CircleMarket />
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <GatewayCard />
          <Card title={lang === "tr" ? "Agent cüzdanları" : "Agent wallets"} kicker={lang === "tr" ? "YAVRULAR İÇİN CIRCLE CÜZDANI" : "CIRCLE WALLETS FOR PUPS"}>
            <p className="m-small">{lang === "tr" ? "Pack sayfasında her yavruya bir Circle agent cüzdanı açabilirsin; cüzdanın harcama kuralları yavrunun Çit'inden türetilir." : "On the Pack page each pup can get a Circle agent wallet; its spending rules are derived from the pup's Fence."}</p>
            <p className="m-note" style={{ marginTop: 10 }}>{lang === "tr" ? "Uyum taraması sonuçları Koku raporunda görünür." : "Compliance screening results appear in the Scent report."}</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
