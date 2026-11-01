/** One outrun, full page: the harbor scene, the seal and every stop, live. */
import { useRouteParam } from "../../app/routes/useRoute";
import { RouteArtifact } from "../../features/route/RouteArtifact";
import { useLang } from "../../lib/i18n";
import { Frame, PageHead } from "../../mosaic";

export default function OutrunPage() {
  const id = useRouteParam("id") ?? null;
  const lang = useLang();
  return (
    <div>
      <PageHead kicker={`OUTRUN · ${id ?? ""}`} title={lang === "tr" ? <>Para <em>nerede?</em></> : <>Where is the <em>money?</em></>} sub={lang === "tr" ? "Her durak Likya Yolu'ndan bir isim taşır. Arc'ta her adım makbuzuyla kesinleşir." : "Every stop carries a Lycian Way name. On Arc each step is final the moment its receipt exists."} mood="herding" />
      <section className="m-wrap" style={{ marginTop: 28, maxWidth: 820 }}>
        <Frame>
          <RouteArtifact intentId={id} />
        </Frame>
      </section>
    </div>
  );
}
