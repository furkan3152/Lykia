import { Link } from "../../app/routes/Link";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { useLang } from "../../lib/i18n";
import { PageHead } from "../../mosaic";
import { sniff, SNIFF_H, SNIFF_W } from "../../mosaic/scenes";

export default function NotFoundPage() {
  const lang = useLang();
  return (
    <div>
      <PageHead kicker="404 · OFF THE TRAIL" title={lang === "tr" ? <>Lyko burada iz <em>bulamadı.</em></> : <>Lyko found no trail <em>here.</em></>} sub={lang === "tr" ? "Bu sayfa vadide yok. Ana mera bir tık uzakta." : "This page is not in the valley. The home pasture is one click away."} mood="alert">
        <div className="flex justify-center gap-2" style={{ marginTop: 16 }}>
          <Link to="/" className="m-btn">{lang === "tr" ? "VADİYE DÖN" : "BACK TO THE VALLEY"}</Link>
          <Link to="/app" className="m-btn m-btn--ghost">{lang === "tr" ? "LYKO'YA SOR" : "ASK LYKO"}</Link>
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame build={(t) => sniff({ level: "unknown", wolves: 0, lit: false }, t)} width={SNIFF_W} height={SNIFF_H} label="Lyko sniffing for a trail" />
      </section>
    </div>
  );
}
