import { EASTER_EGGS } from "@lykia/core";

import { SceneFrame } from "../../features/scenes/SceneFrame";
import { Medallion, PageHead } from "../../mosaic";
import { arcadia, ARCADIA_H, ARCADIA_W } from "../../mosaic/scenes";
import { t as msg } from "../../i18n";

export default function LykaionPage() {
  return (
    <div>
      <PageHead kicker={msg("lykaion.lykaionArcadia")} title={<>{msg("lykaion.etInArcadia")} {/* i18n-ignore: Latin inscription */}<em>{"ego."}</em></>} sub={EASTER_EGGS.lykaion.line} medal={false}>
        <div style={{ marginTop: 10 }}><Medallion size={140} mood="sleeping" spin title={msg("lykaion.evenInArcadiaThereIsRisk")} /></div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame night build={(t) => arcadia(t)} width={ARCADIA_W} height={ARCADIA_H} label={msg("lykaion.mountLykaionAtNightShepherdsFire")} labels={[{ x: 50, y: 6, text: msg("lykaion.mountLykaion") }]} />
        <p className="m-sub">{EASTER_EGGS["et in arcadia ego"].line}</p>
      </section>
    </div>
  );
}
