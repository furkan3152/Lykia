/** <Pack>: the owner's agents, each inside its own Fence, with a Tag when registered. */
import { useEffect } from "react";
import type { Address } from "@lykia/core";
import { usePack } from "./hooks.js";
import { LykiaRoot, ModuleOff, useLykia } from "./provider.js";

export function Pack(props: { readonly className?: string; readonly owner?: Address }) {
  const ctx = useLykia();
  const pack = usePack();
  const owner = props.owner ?? ctx.owner;
  const enabled = ctx.modules.has("pack");
  useEffect(() => {
    if (enabled && owner) void pack.load(owner);
  }, [owner, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return <ModuleOff module="pack" />;
  return (
    <LykiaRoot name="pack" {...(props.className ? { className: props.className } : {})}>
      <section className="lk-card" aria-label="Pack">
        <h3 className="lk-title">{ctx.t("pack.title", "Pack")}</h3>
        {!owner ? <p className="lk-muted">Connect a wallet to see your agents.</p> : null}
        {pack.data && pack.data.length === 0 ? <p className="lk-muted">No agents yet.</p> : null}
        <ul className="lk-list">
          {(pack.data ?? []).map((a) => (
            <li key={a.id}>
              <span>{"· ".repeat(a.depth)}{a.name} <span className="lk-muted">({a.role})</span></span>
              <span className="lk-row">
                <span className="lk-pill">{a.status}</span>
                {a.agentId ? <span className="lk-pill">Tag #{a.agentId}</span> : null}
                {a.status === "active" ? <button className="lk-btn lk-ghost" type="button" onClick={() => void pack.revoke(a.id).then(() => owner && pack.load(owner))}>Revoke</button> : null}
              </span>
            </li>
          ))}
        </ul>
        {pack.error ? <p className="lk-error" role="alert">{pack.error}</p> : null}
      </section>
    </LykiaRoot>
  );
}
