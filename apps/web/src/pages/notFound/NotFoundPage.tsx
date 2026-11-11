import { Link } from "../../app/routes/Link";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { PageHead } from "../../mosaic";
import { sniff, SNIFF_H, SNIFF_W } from "../../mosaic/scenes";
import { t as msg } from "../../i18n";

export default function NotFoundPage() {
  return (
    <div>
      <PageHead kicker={msg("notFound.n404OffTheTrail")} title={<>{msg("notFound.lykoFoundNoTrail")} <em>{msg("notFound.here")}</em></>} sub={msg("notFound.thisPageIsNotInThe")} mood="alert">
        <div className="flex justify-center gap-2" style={{ marginTop: 16 }}>
          <Link to="/" className="m-btn">{msg("notFound.backToTheValley")}</Link>
          <Link to="/app" className="m-btn m-btn--ghost">{msg("notFound.askLyko")}</Link>
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame build={(t) => sniff({ level: "unknown", wolves: 0, lit: false }, t)} width={SNIFF_W} height={SNIFF_H} label={msg("notFound.lykoSniffingForATrail")} />
      </section>
    </div>
  );
}
