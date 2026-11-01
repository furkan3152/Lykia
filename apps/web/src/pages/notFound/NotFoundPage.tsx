import { Link } from "../../app/routes/Link";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { PageHead } from "../../mosaic";
import { sniff, SNIFF_H, SNIFF_W } from "../../mosaic/scenes";

export default function NotFoundPage() {
  return (
    <div>
      <PageHead kicker="404 · OFF THE TRAIL" title={<>Lyko found no trail <em>here.</em></>} sub={"This page is not in the valley. The home pasture is one click away."} mood="alert">
        <div className="flex justify-center gap-2" style={{ marginTop: 16 }}>
          <Link to="/" className="m-btn">{"BACK TO THE VALLEY"}</Link>
          <Link to="/app" className="m-btn m-btn--ghost">{"ASK LYKO"}</Link>
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame build={(t) => sniff({ level: "unknown", wolves: 0, lit: false }, t)} width={SNIFF_W} height={SNIFF_H} label="Lyko sniffing for a trail" />
      </section>
    </div>
  );
}
