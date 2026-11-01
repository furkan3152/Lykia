import { useEnvironment } from "../lib/environment";
import { useLang } from "../lib/i18n";
import { usePulse } from "../lib/pulseStore";

/** The Patara strip: the lamp flashes on every Arc block the pulse reports. */
export function PulseStrip() {
  const pulse = usePulse((s) => s.pulse);
  const lit = usePulse((s) => s.lit);
  const source = usePulse((s) => s.source);
  const environment = useEnvironment();
  const lang = useLang();
  return (
    <div className="m-strip" aria-live="off">
      <span>
        <i className="m-lamp" data-on={lit} aria-hidden="true" />
        PATARA · {environment === "mainnet" ? "ARC MAINNET" : "ARC TESTNET"} · {lang === "tr" ? "BLOK" : "BLOCK"} <b className="num">{pulse ? `#${pulse.block.toLocaleString("en-US")}` : "…"}</b>
      </span>
      <span>
        <b className="num">{pulse?.blockTimeMs ? `${Math.round(pulse.blockTimeMs)} MS` : "…"}</b> · {lang === "tr" ? "KESİN" : "FINAL"}
      </span>
      <span>
        GAS <b className="num">{pulse?.gasPriceGwei ? `${Number(pulse.gasPriceGwei).toFixed(1)} GWEI` : "…"}</b>
      </span>
      <span>
        TRANSFER <b className="num">{pulse?.transferCostUsd ? `$${Number(pulse.transferCostUsd).toFixed(4)}` : "…"}</b>
      </span>
      {source === "rpc" ? <span>VIA PUBLIC RPC</span> : null}
    </div>
  );
}
