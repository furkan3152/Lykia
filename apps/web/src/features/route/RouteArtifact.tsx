/**
 * The route artifact: the outrun drawn as a harbor scene, the Fence seal
 * with every reason and the stops with "why this route". Signing happens in
 * one place, the review modal (ReviewModal.tsx): one "Review and sign"
 * button opens it here, in the Fold's draft sheet and on the Pay page.
 */
import type { AgentProposal } from "@lykia/core/api/agents";
import { useEffect, useState } from "react";

import { useLykiaStore } from "../../lib/lykiaStore";
import { useLamp } from "../../lib/pulseStore";
import { Button, Seal, Skeleton, Tag, cx } from "../../mosaic";
import { harbor, HARBOR_H, HARBOR_W } from "../../mosaic/scenes";
import { SceneFrame } from "../scenes/SceneFrame";
import { artifactView, optionOut, pct } from "./model";
import { useIntent } from "./useIntent";
import { plainReason, plainRationale, plainRouteWhy, plainStep } from "./plain";
import { planTitle } from "../ask/cardModel";
import { ReviewModal } from "./ReviewModal";
import { t as msg } from "../../i18n";

export function RouteArtifact({ proposal, intentId, onClose, onReview }: { proposal?: AgentProposal | null; intentId: string | null; onClose?: () => void; onReview?: () => void }) {
  const query = useIntent(intentId);
  const lit = useLamp();
  const setLastOutrun = useLykiaStore((s) => s.setLastOutrun);
  // Where no host page owns the modal (the Fold's draft sheet, Pay), the artifact opens its own.
  const [reviewing, setReviewing] = useState(false);
  const review = onReview ?? (() => setReviewing(true));
  useEffect(() => {
    if (intentId) setLastOutrun(intentId);
  }, [intentId, setLastOutrun]);

  const view = query.data ? artifactView(query.data.intent, query.data.outrun) : null;
  const decision = view?.decision ?? proposal?.decision ?? "allow";

  return (
    <div style={{ padding: 16 }}>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: 12 }}>
        <span className="m-kick">{intentId ? msg("route.routeArtifact.theRoute2") : msg("route.routeArtifact.theRouteDryRun")}</span>
        {onClose ? (
          <button type="button" className="m-btn m-btn--ghost m-btn--sm" onClick={onClose} aria-label={msg("route.routeArtifact.closeTheRoutePanel")}>
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
        label={msg("route.routeArtifact.theOutrunThePathFromThe")}
      />
      <div style={{ textAlign: "center", margin: "16px 0 8px" }}>
        <h3 style={{ fontSize: 22 }}>{view && view.stops.length === 1 ? plainStep(view.stops[0]!.summary) : proposal?.title ? planTitle(proposal.title) : msg("route.routeArtifact.theRoute")}</h3>
        <div style={{ marginTop: 10 }}>
          <Seal decision={decision} />
        </div>
      </div>
      {proposal && plainRationale(proposal.rationale) ? <p className="m-small m-muted m-center" style={{ marginBottom: 10 }}>{plainRationale(proposal.rationale)}</p> : null}
      {view ? (
        <>
          {view.reasons.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 12px", display: "grid", gap: 6 }}>
              {view.reasons.map((r, i) => (
                <li key={i} className={cx("m-note", r.decision === "deny" && "m-note--bad")}>
                  {plainReason(r.message, r.rule)}
                </li>
              ))}
              {view.waived.map((r, i) => (
                <li key={`w${i}`} className="m-note">
                  <Tag tone="ghost">{msg("route.routeArtifact.waivedHomeward")}</Tag> {r.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="m-stops">
            {view.stops.map((s, i) => (
              <div key={s.id} className="m-stop" data-status={s.status} style={{ animationDelay: `${i * 70}ms` }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <b>{plainStep(s.summary)}</b>
                    <small>
                      {s.kind.toUpperCase()} · {s.venue.toUpperCase()}
                    </small>
                  </div>
                  <Tag tone={s.status === "settled" ? "ok" : s.status === "failed" ? "bad" : "ghost"}>{s.status}</Tag>
                </div>
                {s.fee ? <div style={{ marginTop: 6 }}><Tag tone="ghost">{s.fee.toUpperCase()} {msg("route.routeArtifact.paidInThisTransaction")}</Tag></div> : null}
                {s.memory.length > 0 ? <div className="flex gap-1 flex-wrap" style={{ marginTop: 6 }}>{s.memory.map((m) => <Tag key={m} tone="sea">{msg("route.routeArtifact.fromMemory")} {m}</Tag>)}</div> : null}
                {s.route ? (
                  <details style={{ marginTop: 8 }}>
                    <summary className="m-small" style={{ cursor: "pointer" }}>
                      {msg("route.routeArtifact.why")} {s.route.chosen.label}? {plainRouteWhy(s.route.reason, s.route.chosen.label)}
                    </summary>
                    <table className="m-table" style={{ marginTop: 6 }}>
                      <thead>
                        <tr>
                          <th>{msg("route.routeArtifact.venue")}</th>
                          <th className="r">{msg("route.routeArtifact.apyOut")}</th>
                          <th>{msg("route.routeArtifact.risk")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[s.route.chosen, ...s.route.alternatives].map((o, k) => (
                          <tr key={o.label} className={k === 0 ? "win" : undefined}>
                            <td>{o.label}{o.executable ? "" : " (read-only)"}</td>
                            <td className="r num">{o.apy !== undefined ? pct(o.apy) : optionOut(o.netAmountOut ?? o.amountOut, s.out)}</td>
                            <td>{o.risk}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
                {s.explorer.map((href) => (
                  <a key={href} className="m-small" href={href} target="_blank" rel="noreferrer">
                    {msg("route.routeArtifact.explorer")}
                  </a>
                ))}
                {s.turn === "signer" && view.signable ? <Tag tone="sea">{msg("route.routeArtifact.nextToSign")}</Tag> : null}
              </div>
            ))}
          </div>
          {view.fees.length > 0 ? <p className="m-small m-muted" style={{ marginTop: 10, textAlign: "center" }}>{msg("route.routeArtifact.lykiaFeeForThisPlanRepaying", { value: view.fees.join(" + ") })}</p> : null}
          {view.warnings.map((w) => (
            <p key={w} className="m-note" style={{ marginTop: 8 }}>
              {w}
            </p>
          ))}
          {view.signable && view.next ? (
            <div className="flex justify-center" style={{ marginTop: 14 }}>
              <Button size="lg" onClick={review}>
                {view.settled > 0 ? msg("route.routeArtifact.reviewAndSignTheNextStep") : msg("route.routeArtifact.reviewAndSign")}
              </Button>
            </div>
          ) : null}
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
              <b>{plainStep(s)}</b>
            </div>
          ))}
          {proposal.reasons.map((r) => (
            <p key={r} className={cx("m-note", proposal.decision === "deny" && "m-note--bad")}>
              {plainReason(r)}
            </p>
          ))}
          {proposal.warnings.map((w) => (
            <p key={w} className="m-note">
              {w}
            </p>
          ))}
        </div>
      ) : null}
      {!onReview && intentId ? <ReviewModal key={intentId} intentId={intentId} proposal={proposal ?? null} open={reviewing} onClose={() => setReviewing(false)} /> : null}
    </div>
  );
}
