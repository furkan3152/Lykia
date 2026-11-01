import { EASTER_EGGS } from "@lykia/core";

import { SceneFrame } from "../../features/scenes/SceneFrame";
import { Medallion, PageHead } from "../../mosaic";
import { arcadia, ARCADIA_H, ARCADIA_W } from "../../mosaic/scenes";

export default function LykaionPage() {
  return (
    <div>
      <PageHead kicker="LYKAION · ARCADIA" title={<>Et in Arcadia <em>ego.</em></>} sub={EASTER_EGGS.lykaion.line} medal={false}>
        <div style={{ marginTop: 10 }}><Medallion size={140} mood="sleeping" spin title="Even in Arcadia, there is risk. That is why there is a dog." /></div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame night build={(t) => arcadia(t)} width={ARCADIA_W} height={ARCADIA_H} label="Mount Lykaion at night: shepherds' fire, Lyko and the flock" labels={[{ x: 50, y: 6, text: "MOUNT LYKAION" }]} />
        <p className="m-sub">{EASTER_EGGS["et in arcadia ego"].line}</p>
      </section>
    </div>
  );
}
