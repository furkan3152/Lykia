/** <Flock>: everything the owner holds on Arc, in one balance sheet. */
import { useEffect } from "react";
import type { Address } from "@lykia/core";
import { useFlock } from "./hooks.js";
import { LykiaRoot, ModuleOff, useLykia } from "./provider.js";

export function Flock(props: { readonly className?: string; readonly owner?: Address }) {
  const ctx = useLykia();
  const flock = useFlock();
  const owner = props.owner ?? ctx.owner;
  const enabled = ctx.modules.has("flock");
  useEffect(() => {
    if (enabled && owner) void flock.load(owner);
  }, [owner, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return <ModuleOff module="flock" />;
  const snap = flock.data;
  return (
    <LykiaRoot name="flock" {...(props.className ? { className: props.className } : {})}>
      <section className="lk-card" aria-label="Flock">
        <h3 className="lk-title">{ctx.t("flock.title", "Flock")}</h3>
        {!owner ? <p className="lk-muted">Connect a wallet to see your balances.</p> : null}
        {flock.loading ? <p className="lk-muted">Counting the flock…</p> : null}
        {snap ? (
          <>
            <p><strong>{snap.totalUsd === null ? "Total unavailable" : `$${snap.totalUsd}`}</strong></p>
            <ul className="lk-list">
              {snap.holdings.map((h) => (
                <li key={`${h.token}:${h.where}`}><span>{h.amount} {h.symbol} <span className="lk-muted">· {h.where}</span></span><span className="lk-muted">{h.usd === null ? "unpriced" : `$${h.usd}`}</span></li>
              ))}
            </ul>
          </>
        ) : null}
        {flock.error ? <p className="lk-error" role="alert">{flock.error}</p> : null}
      </section>
    </LykiaRoot>
  );
}
