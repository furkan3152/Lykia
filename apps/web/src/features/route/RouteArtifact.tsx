/**
 * The route artifact: the outrun drawn as a harbor scene, the Fence seal
 * with every reason, the stops with "why this route", and one-signature
 * execution per step in the owner's wallet.
 */
import type { CreateIntentResponse, SubmitStepResponse } from "@lykia/core/api/intents";
import type { AgentProposal } from "@lykia/core/api/agents";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Link } from "../../app/routes/Link";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useLamp } from "../../lib/pulseStore";
import { Button, Seal, Skeleton, Tag, cx } from "../../mosaic";
import { harbor, HARBOR_H, HARBOR_W } from "../../mosaic/scenes";
import { SceneFrame } from "../scenes/SceneFrame";
import { artifactView, pct } from "./model";
import { useIntent } from "./useIntent";
import { useStepRunner } from "./useStepRunner";

export function RouteArtifact({ proposal, intentId, onClose }: { proposal?: AgentProposal | null; intentId: string | null; onClose?: () => void }) {
  const query = useIntent(intentId);
  const qc = useQueryClient();
  const lit = useLamp();
  const setLastOutrun = useLykiaStore((s) => s.setLastOutrun);
  const [confirmed, setConfirmed] = useState(false);
  const runner = useStepRunner(intentId, (r: SubmitStepResponse) => {
    qc.setQueryData<CreateIntentResponse>(["intent", intentId], (old) => (old ? { ...old, outrun: r.outrun, intent: { ...old.intent, steps: old.intent.steps.map((s) => (s.id === r.step.id ? r.step : s)) } } : old));
  });
  useEffect(() => {
    if (intentId) setLastOutrun(intentId);
  }, [intentId, setLastOutrun]);

  const view = query.data ? artifactView(query.data.intent, query.data.outrun) : null;
  const decision = view?.decision ?? proposal?.decision ?? "allow";

  return (
    <div style={{ padding: 16 }}>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: 12 }}>
        <span className="m-kick">{intentId ? `OUTRUN · ${intentId}` : "PROPOSAL · DRY RUN"}</span>
        {onClose ? (
          <button type="button" className="m-btn m-btn--ghost m-btn--sm" onClick={onClose} aria-label="Close the route panel">
            ✕
          </button>
        ) : null}
      </div>
      <SceneFrame
        build={(t) => harbor({ stops: view?.stops.length ?? proposal?.steps.length ?? 1, settled: view?.settled ?? 0, ferry: view?.ferry ?? false, lit }, t)}
        width={HARBOR_W}
        height={HARBOR_H}
        tile={4}
        fps={8}
        dataKey={`${view?.settled}-${lit}`}
        label="The outrun: the path from the start to the Fold"
      />
      <div style={{ textAlign: "center", margin: "16px 0 8px" }}>
        <h3 style={{ fontSize: 22 }}>{proposal?.title ?? "The Outrun"}</h3>
        <div style={{ marginTop: 10 }}>
          <Seal decision={decision} />
        </div>
      </div>
      {proposal?.rationale ? <p className="m-small m-muted m-center" style={{ marginBottom: 10 }}>{proposal.rationale}</p> : null}
      {view ? (
        <>
          {view.reasons.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 12px", display: "grid", gap: 6 }}>
              {view.reasons.map((r, i) => (
                <li key={i} className={cx("m-note", r.decision === "deny" && "m-note--bad")}>
                  <b className="mono" style={{ fontSize: 11 }}>{r.rule}</b> {r.message}
                </li>
              ))}
              {view.waived.map((r, i) => (
                <li key={`w${i}`} className="m-note">
                  <Tag tone="ghost">WAIVED · HOMEWARD</Tag> {r.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="m-stops">
            {view.stops.map((s, i) => (
              <div key={s.id} className="m-stop" data-status={s.status} style={{ animationDelay: `${i * 70}ms` }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <b>{s.summary}</b>
                    <small>
                      {s.name.toUpperCase()} · {s.kind.toUpperCase()} · {s.venue.toUpperCase()}
                    </small>
                  </div>
                  <Tag tone={s.status === "settled" ? "ok" : s.status === "failed" ? "bad" : "ghost"}>{s.status}</Tag>
                </div>
                {s.memory.length > 0 ? <div className="flex gap-1 flex-wrap" style={{ marginTop: 6 }}>{s.memory.map((m) => <Tag key={m} tone="sea">FROM MEMORY · {m}</Tag>)}</div> : null}
                {s.route ? (
                  <details style={{ marginTop: 8 }}>
                    <summary className="m-small" style={{ cursor: "pointer" }}>
                      Why {s.route.chosen.label}? {s.route.reason}
                    </summary>
                    <table className="m-table" style={{ marginTop: 6 }}>
                      <thead>
                        <tr>
                          <th>Venue</th>
                          <th className="r">APY / out</th>
                          <th>Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[s.route.chosen, ...s.route.alternatives].map((o, k) => (
                          <tr key={o.label} className={k === 0 ? "win" : undefined}>
                            <td>{o.label}{o.executable ? "" : " (read-only)"}</td>
                            <td className="r num">{o.apy !== undefined ? pct(o.apy) : o.netAmountOut ?? o.amountOut ?? "—"}</td>
                            <td>{o.risk}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
                {s.explorer.map((href) => (
                  <a key={href} className="m-small" href={href} target="_blank" rel="noreferrer">
                    explorer ↗
                  </a>
                ))}
                {s.turn === "signer" && view.signable ? (
                  <div style={{ marginTop: 10 }}>
                    <Button size="sm" onClick={() => void runner.run(s.id, confirmed)} disabled={runner.phase[s.id] === "preparing" || runner.phase[s.id] === "signing" || runner.phase[s.id] === "submitting" || (view.decision === "confirm" && !confirmed)}>
                      {runner.phase[s.id] === "signing" ? "SIGN IN WALLET…" : runner.phase[s.id] === "submitting" ? "CHECKING ARC…" : runner.phase[s.id] === "preparing" ? "PREPARING…" : runner.connected ? "SIGN ONCE" : "CONNECT TO SIGN"}
                    </Button>
                    {runner.walletKind === "passkey" ? <p className="m-small m-muted" style={{ marginTop: 6 }}>Your passkey wallet sends this step as one user operation through Circle's bundler; Lykia verifies it on Arc by its user operation hash.</p> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {view.decision === "confirm" ? (
            <label className="m-note" style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I read the Fence's lines and confirm this plan.
            </label>
          ) : null}
          {view.fold.length > 0 ? <p className="m-kick" style={{ marginTop: 14, textAlign: "center" }}>FOLD · {view.fold.join(" · ")}</p> : null}
          {view.warnings.map((w) => (
            <p key={w} className="m-note" style={{ marginTop: 8 }}>
              {w}
            </p>
          ))}
          <div className="flex justify-center" style={{ marginTop: 14 }}>
            <Link to={`/app/outrun/${encodeURIComponent(view.id)}`} className="m-btn m-btn--ghost m-btn--sm">
              OPEN THE OUTRUN
            </Link>
          </div>
        </>
      ) : intentId && query.isLoading ? (
        <div style={{ display: "grid", gap: 8 }}>
          <Skeleton h={60} />
          <Skeleton h={60} />
        </div>
      ) : proposal ? (
        <div className="m-stops">
          {proposal.steps.map((s, i) => (
            <div key={i} className="m-stop" style={{ animationDelay: `${i * 70}ms` }}>
              <b>{s}</b>
            </div>
          ))}
          {proposal.reasons.map((r) => (
            <p key={r} className={cx("m-note", proposal.decision === "deny" && "m-note--bad")}>
              {r}
            </p>
          ))}
          {proposal.warnings.map((w) => (
            <p key={w} className="m-note">
              {w}
            </p>
          ))}
          {proposal.attribution.length > 0 ? (
            <p className="m-small m-muted">By {proposal.attribution.map((a) => `${a.agent} (${a.role})`).join(", ")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
