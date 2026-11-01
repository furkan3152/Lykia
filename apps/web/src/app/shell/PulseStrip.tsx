import { useArcPulse } from "../../hooks/useArcPulse";
import { useEnvironment } from "../../lib/environment";
import { formatBlockNumber } from "../../lib/format";
import { cx } from "../../ui/cx";

/**
 * The thin strip under the header: Arc's head block, block interval, gas in
 * USDC and the finality note. Labels its source; says "offline" honestly.
 */
export function PulseStrip({ compact = false, className }: { readonly compact?: boolean; readonly className?: string }) {
  const environment = useEnvironment();
  const { pulse, source, loading, offline } = useArcPulse(environment);
  if (loading && !pulse) return <span className={cx("font-tag text-[11px] uppercase text-ink-3", className)}>Reading Arc…</span>;
  if (!pulse || offline) return <span className={cx("font-tag text-[11px] uppercase text-warn-ink", className)}>Arc pulse offline</span>;
  return (
    <span className={cx("inline-flex items-center gap-3 font-tag text-[11px] uppercase text-ink-2", className)} title={source === "rpc" ? "Read straight from Arc's public RPC (the Lykia API is unreachable)" : "From the Lykia API"}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 bg-up" />
        <span className="tnum text-ink">#{formatBlockNumber(pulse.block)}</span>
      </span>
      {compact ? null : (
        <>
          {pulse.blockTimeMs !== null ? <span className="tnum">{pulse.blockTimeMs} ms</span> : null}
          {pulse.gasPriceGwei !== null ? <span className="tnum">gas {pulse.gasPriceGwei} gwei USDC</span> : null}
          <span>final &lt; 1 s</span>
          {source === "rpc" ? <span className="text-ink-3">· via RPC</span> : null}
        </>
      )}
    </span>
  );
}
