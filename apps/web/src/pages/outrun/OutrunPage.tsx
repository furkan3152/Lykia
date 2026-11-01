/** One outrun, full page: the harbor scene, the seal and every stop, live. */
import { useRouteParam } from "../../app/routes/useRoute";
import { RouteArtifact } from "../../features/route/RouteArtifact";
import { Frame, PageHead } from "../../mosaic";

export default function OutrunPage() {
  const id = useRouteParam("id") ?? null;
  return (
    <div>
      <PageHead kicker={`OUTRUN · ${id ?? ""}`} title={<>Where is the <em>money?</em></>} sub={"Every stop carries a Lycian Way name. On Arc each step is final the moment its receipt exists."} mood="herding" />
      <section className="m-wrap" style={{ marginTop: 28, maxWidth: 820 }}>
        <Frame>
          <RouteArtifact intentId={id} />
        </Frame>
      </section>
    </div>
  );
}
