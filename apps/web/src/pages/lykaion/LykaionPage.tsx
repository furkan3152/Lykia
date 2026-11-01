import { EASTER_EGGS } from "@lykia/core";

import { routeHref } from "../../app/routes/routeTable";
import { useLang } from "../../lib/i18n";
import { Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { ValleyScene } from "../../pixel/ValleyScene";
import { ButtonLink } from "../../ui/Button";

/** The hidden page: Mount Lykaion, Arcadia, at night. Reachable from the whistle box ("lykaion", "arcadia"). */
export default function LykaionPage() {
  const lang = useLang();
  return (
    <Page className="!pt-0">
      <Section level={1} tag="Λύκαιον · Arcadia" title="Et in Arcadia ego." lede={EASTER_EGGS.lykaion.line}>
        <div className="bg-card p-2 px-frame px-drop-lg">
          <ValleyScene forceNight aspect={0.45} label="Mount Lykaion at night: stars, a crescent moon, the flock asleep inside the Fence and Lyko lying by the gate" sheep={[{ size: 2 }, { size: 1 }, { size: 1 }, { size: 2 }]} lyko="lie" rainbow={false} seed={11} />
        </div>
        <div className="mx-auto mt-10 flex max-w-[620px] flex-col items-center gap-5 text-center">
          <Lyko mood="sleeping" size={96} label="Lyko asleep under the stars" />
          <p className="text-[15px] leading-relaxed text-ink-2">
            {lang === "tr"
              ? "Lykaion, Arkadya'nın kutsal dağı. Çobanlar sürülerini burada, hiçbir zincirden çok önce güttü. Lyko'nun adı oradan, kurttan (lykos) geliyor: kurdu en iyi tanıyan, sürüyü en iyi korur."
              : "Lykaion is the sacred mountain of Arcadia. Shepherds kept their flocks here long before any chain. Lyko takes his name from it and from the wolf, lykos: who knows the wolf best guards the flock best."}
          </p>
          <ButtonLink to={routeHref("deck")} variant="ink">
            {lang === "tr" ? "Vadiye dön" : "Back to the valley"} →
          </ButtonLink>
        </div>
      </Section>
    </Page>
  );
}
