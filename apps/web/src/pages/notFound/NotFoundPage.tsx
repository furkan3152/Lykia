import { routeHref } from "../../app/routes/routeTable";
import { useRoute } from "../../app/routes/useRoute";
import { useLang } from "../../lib/i18n";
import { openOracle } from "../../oracle/oracleStore";
import { Page } from "../../pixel/layout";
import { LykoLoader } from "../../pixel/LykoLoader";
import { Button, ButtonLink } from "../../ui/Button";

/** 404: Lyko sniffs along the trail and cannot find it. */
export default function NotFoundPage() {
  const lang = useLang();
  const { route } = useRoute();
  return (
    <Page width="narrow">
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <LykoLoader label={lang === "tr" ? "Lyko izi kokluyor…" : "Lyko is sniffing the trail…"} size="lg" />
        <h1 className="font-display text-[clamp(2.5rem,7vw,4.5rem)] font-bold leading-none text-ink">{lang === "tr" ? "Patika burada bitiyor." : "The trail ends here."}</h1>
        <p className="max-w-[460px] text-[15px] text-ink-2">{lang === "tr" ? "Bu sayfa vadide yok. Düdük kutusuna bir sayfa adı ya da bir cümle yaz." : "This page is not in the valley. Type a page name or a sentence into the whistle box."}</p>
        <div className="flex flex-wrap justify-center gap-4">
          <Button onClick={() => openOracle()}>{lang === "tr" ? "Düdük kutusu" : "Whistle box"}</Button>
          <ButtonLink to={route.kind === "app" ? routeHref("deck") : routeHref("landing")} variant="ink">
            {lang === "tr" ? "Vadiye dön" : "Back to the valley"}
          </ButtonLink>
        </div>
      </div>
    </Page>
  );
}
