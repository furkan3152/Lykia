import { useEnvironment } from "../lib/environment";
import { usePulse } from "../lib/pulseStore";
import { intlLocale, t } from "../i18n";

/** The Patara strip: the lamp flashes on every Arc block the pulse reports. */
export function PulseStrip() {
  const pulse = usePulse((s) => s.pulse);
  const lit = usePulse((s) => s.lit);
  const source = usePulse((s) => s.source);
  const environment = useEnvironment();
  return (
    <div className="m-strip" aria-live="off">
      <span>
        <i className="m-lamp" data-on={lit} aria-hidden="true" />
        PATARA · {environment === "mainnet" ? t("shell.pulseStrip.arcMainnet") : t("shell.pulseStrip.arcTestnet")} · {t("shell.pulseStrip.block")} <b className="num">{pulse ? `#${pulse.block.toLocaleString(intlLocale())}` : "…"}</b>
      </span>
      <span>
        <b className="num">{pulse?.blockTimeMs ? `${Math.round(pulse.blockTimeMs)} MS` : "…"}</b> · {t("shell.pulseStrip.final")}
      </span>
      <span>
        {t("shell.pulseStrip.gas")} <b className="num">{pulse?.gasPriceGwei ? `${Number(pulse.gasPriceGwei).toFixed(1)} GWEI` : "…"}</b>
      </span>
      <span>
        {t("shell.pulseStrip.transfer")} <b className="num">{pulse?.transferCostUsd ? `$${Number(pulse.transferCostUsd).toFixed(4)}` : "…"}</b>
      </span>
      {source === "rpc" ? <span>{t("shell.pulseStrip.viaPublicRpc")}</span> : null}
    </div>
  );
}
