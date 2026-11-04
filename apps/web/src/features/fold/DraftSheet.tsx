/**
 * A drafted proposal, opened for review: a bottom sheet on phones and a
 * stone panel on wider screens. A plan opens the route card (one signature
 * per step, in your wallet); ready-made transactions (a revoke) are signed
 * here; a Fence edit is applied to your deck, and a loosening asks your
 * wallet to sign first. Nothing is ever signed by Lykia.
 */
import { fenceHash, loosenedRules } from "@lykia/core";
import type { FoldProposal } from "@lykia/core/api/fold";
import { useState } from "react";

import { Sheet } from "../../city/Sheet";
import { describeError } from "../../lib/api";
import { useLykiaStore } from "../../lib/lykiaStore";
import { Button, Seal, Tag, toast } from "../../mosaic";
import { RouteArtifact } from "../route/RouteArtifact";
import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { useWallet } from "../wallet/store";
import { applyFencePatch, proposalStage } from "./model";

const STAGES = ["Proposed", "Signed", "Done"] as const;

export function ProposalStepper({ p }: { readonly p: Pick<FoldProposal, "status"> }) {
  const stage = proposalStage(p);
  return (
    <ol className="fd-stepper" aria-label={`Stage: ${p.status}`}>
      {STAGES.map((s, i) => (
        <li key={s} data-on={i <= stage && p.status !== "stopped"} data-stopped={p.status === "stopped" && i === stage}>
          <i />
          {p.status === "stopped" && i === stage ? "Stopped" : s}
        </li>
      ))}
    </ol>
  );
}

export function DraftSheet({ proposal, onClose, onMove }: { readonly proposal: FoldProposal | null; readonly onClose: () => void; readonly onMove: (id: string, to: "approve" | "done" | "stop", note?: string) => Promise<unknown> }) {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const fence = useLykiaStore((s) => s.fence);
  const setFence = useLykiaStore((s) => s.setFence);
  const [busy, setBusy] = useState(false);
  if (!proposal) return null;
  const p = proposal;
  const open = p.status === "proposed" || p.status === "approved";
  const decision = p.decision === "unknown" ? null : p.decision;

  const signTransactions = async () => {
    if (!wallet.connected) return openModal();
    setBusy(true);
    try {
      if (p.status === "proposed") await onMove(p.id, "approve", "Signing started.");
      const hashes = await wallet.send((p.transactions ?? []).map((t) => ({ to: t.to, data: t.data, value: t.value, chainId: t.chainId })));
      await onMove(p.id, "done", `Signed: ${hashes.map((h) => `${h.slice(0, 10)}…`).join(", ")}`);
      toast.success("Signed and sent", { from: "LYKO" });
      onClose();
    } catch (e) {
      toast.error("Not sent", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const applyFence = async () => {
    if (!p.fencePatch) return;
    const next = applyFencePatch(fence, p.fencePatch);
    const loosened = loosenedRules(fence, next);
    setBusy(true);
    try {
      if (loosened.length > 0) {
        if (!wallet.connected) return openModal();
        // Loosening is the owner's call: the wallet signs the new Fence's hash before the deck takes it.
        await wallet.signMessage(`Lykia: loosen my Fence\n\n${loosened.join("\n")}\n\nNew Fence ${fenceHash(next)}`);
      }
      setFence(next);
      if (p.status === "proposed") await onMove(p.id, "approve");
      await onMove(p.id, "done", loosened.length > 0 ? "Loosened with the owner's signature." : "Tightened.");
      toast.success("Fence updated", { description: fenceHash(next).slice(0, 22), from: "LYKO" });
      onClose();
    } catch (e) {
      toast.error("The Fence did not change", { description: describeError(e), from: "LYKO" });
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
          {decision ? <Seal decision={decision} /> : <Tag tone="ghost">{p.fencePatch ? "FENCE EDIT" : "DRAFT"}</Tag>}
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
            <b>{decision === "deny" ? "Why the Fence said no:" : "The Fence notes:"}</b>
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
            <p className="m-small">{`${p.transactions.length} transaction${p.transactions.length === 1 ? "" : "s"} to sign in your wallet. Each sets an allowance back to zero.`}</p>
            <Button onClick={() => void signTransactions()} disabled={busy}>{busy ? "WAITING FOR YOUR WALLET…" : wallet.connected ? "SIGN AND SEND" : "CONNECT TO SIGN"}</Button>
          </div>
        ) : null}
        {open && p.fencePatch ? (
          <div className="fd-draft__tx">
            {loosens.length > 0 ? (
              <div className="m-note">
                <b>{"This loosens your Fence. Your wallet signs it first:"}</b>
                <ul>{loosens.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            ) : (
              <p className="m-small">{"This only tightens your Fence. It applies at once."}</p>
            )}
            <Button onClick={() => void applyFence()} disabled={busy}>{loosens.length > 0 ? "SIGN AND APPLY" : "APPLY"}</Button>
          </div>
        ) : null}
        {open && !p.intentId && !p.transactions && !p.fencePatch ? <p className="m-note">{"Lyko could not plan this one as written. Open it in Ask Lyko to finish the details."}</p> : null}
        <div className="fd-draft__foot">
          {open ? (
            <Button tone="ghost" size="sm" disabled={busy} onClick={() => void onMove(p.id, "stop", "Stopped by the owner.").then(onClose)}>
              {"STOP THIS DRAFT"}
            </Button>
          ) : null}
          <span className="m-kick">{"LYKO PROPOSES · YOU SIGN"}</span>
        </div>
      </div>
    </Sheet>
  );
}
