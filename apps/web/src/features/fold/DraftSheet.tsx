/**
 * A drafted proposal, opened for review: a bottom sheet on phones and a
 * stone panel on wider screens. A plan opens the route card (one signature
 * per step, in your wallet); ready-made transactions (a revoke) are signed
 * here; a Fence edit is saved to your Fence on the server, and a loosening
 * asks your wallet to sign first. Nothing is ever signed by Lykia.
 */
import { loosenedRules } from "@lykia/core";
import type { FoldProposal } from "@lykia/core/api/fold";
import { useState } from "react";

import { Sheet } from "../../city/Sheet";
import { describeError } from "../../lib/api";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useFenceWrite } from "../fence/data";
import { Button, Seal, Tag, toast } from "../../mosaic";
import { RouteArtifact } from "../route/RouteArtifact";
import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { useWallet } from "../wallet/store";
import { applyFencePatch, proposalStage } from "./model";
import { t as msg } from "../../i18n";

const STAGES = [msg("fold.draftSheet.proposed"), msg("fold.draftSheet.signed"), msg("fold.draftSheet.done")] as const;

export function ProposalStepper({ p }: { readonly p: Pick<FoldProposal, "status"> }) {
  const stage = proposalStage(p);
  return (
    <ol className="fd-stepper" aria-label={`Stage: ${p.status}`}>
      {STAGES.map((s, i) => (
        <li key={s} data-on={i <= stage && p.status !== "stopped"} data-stopped={p.status === "stopped" && i === stage}>
          <i />
          {p.status === "stopped" && i === stage ? msg("fold.draftSheet.stopped") : s}
        </li>
      ))}
    </ol>
  );
}

export function DraftSheet({ proposal, onClose, onMove }: { readonly proposal: FoldProposal | null; readonly onClose: () => void; readonly onMove: (id: string, to: "approve" | "done" | "stop", note?: string) => Promise<unknown> }) {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const fence = useLykiaStore((s) => s.fence);
  const write = useFenceWrite();
  const [busy, setBusy] = useState(false);
  if (!proposal) return null;
  const p = proposal;
  const open = p.status === "proposed" || p.status === "approved";
  const decision = p.decision === "unknown" ? null : p.decision;

  const signTransactions = async () => {
    if (!wallet.connected) return openModal();
    setBusy(true);
    try {
      if (p.status === "proposed") await onMove(p.id, "approve", msg("fold.draftSheet.signingStarted"));
      const hashes = await wallet.send((p.transactions ?? []).map((t) => ({ to: t.to, data: t.data, value: t.value, chainId: t.chainId })));
      await onMove(p.id, "done", `Signed: ${hashes.map((h) => `${h.slice(0, 10)}…`).join(", ")}`);
      toast.success(msg("fold.draftSheet.signedAndSent"), { from: "LYKO" });
      onClose();
    } catch (e) {
      toast.error(msg("fold.draftSheet.notSent"), { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const applyFence = async () => {
    if (!p.fencePatch) return;
    const next = applyFencePatch(fence, p.fencePatch);
    const loosened = loosenedRules(fence, next);
    if (loosened.length > 0 && !wallet.connected) return openModal();
    setBusy(true);
    try {
      // The server keeps the Fence; a loosening is signed by the owner's wallet when the server asks for it.
      const saved = await write.save.mutateAsync({ fence: next });
      if (p.status === "proposed") await onMove(p.id, "approve");
      await onMove(p.id, "done", loosened.length > 0 ? msg("fold.draftSheet.loosenedWithTheOwnerSSignature") : "Tightened.");
      toast.success(msg("fold.draftSheet.fenceUpdated"), { description: saved.hash.slice(0, 22), from: "LYKO" });
      onClose();
    } catch (e) {
      toast.error(msg("fold.draftSheet.theFenceDidNotChange"), { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const loosens = p.fencePatch ? loosenedRules(fence, applyFencePatch(fence, p.fencePatch)) : [];

  return (
    <Sheet open onClose={onClose} title={p.title}>
      <div className="fd-draft">
        <div className="fd-draft__head">
          <ProposalStepper p={p} />
          {decision ? <Seal decision={decision} /> : <Tag tone="ghost">{p.fencePatch ? msg("fold.draftSheet.fenceEdit") : "DRAFT"}</Tag>}
        </div>
        {p.steps.length > 0 ? (
          <ol className="fd-draft__steps">
            {p.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        ) : null}
        {p.reasons.length > 0 ? (
          <div className={decision === "deny" ? "m-note m-note--bad" : "m-note"}>
            <b>{decision === "deny" ? msg("fold.draftSheet.whyTheFenceSaidNo") : msg("fold.draftSheet.theFenceNotes")}</b>
            <ul>{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        ) : null}
        {p.outcome ? <p className="m-small m-muted">{p.outcome}</p> : null}
        {open && p.intentId ? (
          <div className="fd-draft__route">
            <RouteArtifact intentId={p.intentId} />
          </div>
        ) : null}
        {open && p.transactions && p.transactions.length > 0 ? (
          <div className="fd-draft__tx">
            <p className="m-small">{msg("fold.draftSheet.transactionsToSignRevoke", { n: p.transactions.length })}</p>
            <Button onClick={() => void signTransactions()} disabled={busy}>{busy ? msg("fold.draftSheet.waitingForYourWallet") : wallet.connected ? msg("fold.draftSheet.signAndSend") : msg("fold.draftSheet.connectToSign")}</Button>
          </div>
        ) : null}
        {open && p.fencePatch ? (
          <div className="fd-draft__tx">
            {loosens.length > 0 ? (
              <div className="m-note">
                <b>{msg("fold.draftSheet.thisLoosensYourFenceYourWallet")}</b>
                <ul>{loosens.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            ) : (
              <p className="m-small">{msg("fold.draftSheet.thisOnlyTightensYourFenceIt")}</p>
            )}
            <Button onClick={() => void applyFence()} disabled={busy}>{loosens.length > 0 ? msg("fold.draftSheet.signAndApply") : "APPLY"}</Button>
          </div>
        ) : null}
        {open && !p.intentId && !p.transactions && !p.fencePatch ? <p className="m-note">{msg("fold.draftSheet.lykoCouldNotPlanThisOne")}</p> : null}
        <div className="fd-draft__foot">
          {open ? (
            <Button tone="ghost" size="sm" disabled={busy} onClick={() => void onMove(p.id, "stop", msg("fold.draftSheet.stoppedByTheOwner")).then(onClose)}>
              {msg("fold.draftSheet.stopThisDraft")}
            </Button>
          ) : null}
          <span className="m-kick">{msg("fold.draftSheet.lykoProposesYouSign")}</span>
        </div>
      </div>
    </Sheet>
  );
}
