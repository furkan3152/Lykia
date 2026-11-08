/**
 * Pack · Leashes. Every leash as a card: who it is for, its template, a
 * budget meter for today and for its whole life (read from the LykiaAccount
 * on chain), the time left, where it may go, its last actions, and Revoke,
 * always one click away. "New leash" opens the three-step sheet; a draft
 * from Ask Lyko (`?leash=`) opens it prefilled.
 */
import { decodeDraft, LEASH_TEMPLATES } from "@lykia/core";
import type { LeashView, RevokeLeashResponse } from "@lykia/core/api/leash";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { navigate } from "../../../app/routes/history";
import { useSearchParam } from "../../../app/routes/useRoute";
import { apiPost, describeError } from "../../../lib/api";
import { Button, LeashMark, Tag, toast } from "../../../mosaic";
import { useLykiaWallet } from "../../wallet/useLykiaWallet";
import { useWallet } from "../../wallet/store";
import type { FoldOwner } from "../data";
import { useLeashes } from "./data";
import { actionLine, draftFromParam, meterOf, nearCap, statusLabel, stepLeft, timeLeft, usdText, venueLabel, type MeterView } from "./model";
import { NewLeashSheet } from "./NewLeashSheet";

function Bar({ m, label }: { readonly m: MeterView; readonly label: string }) {
  const n = 14;
  const filled = Math.round(m.share * n);
  return (
    <div className="fd-meter fd-leash__meter" data-tone={m.tone}>
      <div className="fd-leash__meterhead">
        <span className="m-kick">{label}</span>
        <span className="num">{`${usdText(m.used)} of ${usdText(m.cap)}`}</span>
      </div>
      <div className="fd-meter__row fd-leash__row" role="meter" aria-valuemin={0} aria-valuemax={m.cap} aria-valuenow={m.used} aria-label={`${label}: ${usdText(m.used)} of ${usdText(m.cap)} used`}>
        {Array.from({ length: n }, (_, i) => <i key={i} data-f={i < filled} />)}
      </div>
    </div>
  );
}

export function LeashCard({ l, now, busy, onRevoke }: { readonly l: LeashView; readonly now: number; readonly busy: boolean; readonly onRevoke: (l: LeashView) => void }) {
  const live = l.status === "active" || l.status === "pending";
  const close = nearCap(l);
  return (
    <article className="fd-leash m-frame m-frame--thin" data-status={l.status} data-near={close}>
      <header className="fd-leash__head">
        <span className="fd-leash__mark" aria-hidden="true"><LeashMark scale={2} /></span>
        <h3>{l.agentName}</h3>
        <Button size="sm" tone="navy" className="fd-leash__revoke" disabled={!live || busy} onClick={() => onRevoke(l)} aria-label={`Revoke ${l.agentName}'s leash`}>
          {live ? (busy ? "REVOKING…" : "REVOKE") : l.status.toUpperCase()}
        </Button>
        <span className="m-kick fd-leash__kick">{`${LEASH_TEMPLATES[l.template].title} · ${statusLabel(l)}`}</span>
      </header>
      <Bar m={meterOf(l.usage.day)} label="TODAY" />
      <Bar m={meterOf(l.usage.total)} label="WHOLE LEASH" />
      {close && live ? <p className="fd-leash__warn">{`Near its cap: ${usdText(stepLeft(l))} left for the next step.`}</p> : null}
      <dl className="fd-agent__facts">
        <div><dt>{"Time left"}</dt><dd className="num">{live ? timeLeft(l.expiresAt, now) : "ended"}</dd></div>
        <div><dt>{"Per step"}</dt><dd className="num">{usdText(l.budget.perStepUsd)}</dd></div>
        <div><dt>{l.template === "pay-invoices" ? "Pays" : "Venues"}</dt><dd>{venueLabel(l)}</dd></div>
        <div><dt>{"Limits read"}</dt><dd>{l.usage.source === "chain" ? "on chain" : "Lykia's record"}</dd></div>
      </dl>
      {l.recent.length > 0 ? (
        <ul className="fd-leash__recent" aria-label="Last actions">
          {l.recent.slice(0, 3).map((a) => (
            <li key={`${a.at}${a.summary}`} data-kind={a.kind}>
              <span>{actionLine(a)}</span>
              {a.chainProven ? <Tag tone="ok">ON CHAIN</Tag> : a.kind === "denied" ? <Tag tone="bad">REFUSED</Tag> : null}
            </li>
          ))}
        </ul>
      ) : <p className="m-small m-muted">{l.status === "pending" ? "Nothing yet. It goes live once you sign the session." : "No actions yet."}</p>}
    </article>
  );
}

export function LeashSection({ owner, onSignIn }: { readonly owner: FoldOwner; readonly onSignIn: () => void }) {
  const leashes = useLeashes(owner);
  const qc = useQueryClient();
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const draftParam = useSearchParam("leash");
  const draft = useMemo(() => draftFromParam(draftParam, decodeDraft), [draftParam]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const sheetOpen = open || draft !== null;
  const list = leashes.data?.leashes ?? [];
  const live = list.filter((l) => l.status === "active" || l.status === "pending");
  const ended = list.filter((l) => l.status !== "active" && l.status !== "pending").slice(0, 3);

  const closeSheet = () => {
    setOpen(false);
    if (draftParam) navigate("/app/fold/pack", { replace: true });
  };

  const revoke = async (l: LeashView) => {
    if (owner.sample) {
      toast.info("This is a sample leash", { description: "Connect a wallet and your own leashes show here.", from: "LYKO" });
      return;
    }
    setBusyId(l.id);
    try {
      // The key dies at the API first; then the wallet ends the session on chain.
      const r = await apiPost<RevokeLeashResponse>(`/v1/leashes/${encodeURIComponent(l.id)}/revoke`, {});
      await qc.invalidateQueries({ queryKey: ["leashes"] });
      toast.success(`${l.agentName}'s key stopped working`, { description: r.transaction ? "Sign revokeSession to end it on chain too." : r.note, from: "LYKO" });
      if (r.transaction) {
        if (!wallet.connected) openModal();
        else {
          const [hash] = await wallet.send([{ to: r.transaction.to, data: r.transaction.data, value: r.transaction.value, chainId: r.transaction.chainId }]);
          toast.success("Session ended on chain", { description: hash, from: "LYKO" });
        }
      }
    } catch (e) {
      toast.error("Not revoked on chain yet", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="fd-leashes" aria-labelledby="fd-leashes-h">
      <header className="fd-leashes__head">
        <span className="fd-leashes__mark" aria-hidden="true"><LeashMark scale={3} /></span>
        <div>
          <h3 id="fd-leashes-h">{"Leashes"}</h3>
          <p className="m-small">{"A budget an outside agent cannot exceed: per step, per day and in total, until a date, only where you allow. Your LykiaAccount holds the caps on chain; Revoke cuts the key at once."}</p>
        </div>
        <Button tone="sea" onClick={() => (owner.sample || owner.signedIn ? setOpen(true) : onSignIn())}>{owner.signedIn || owner.sample ? "+ NEW LEASH" : "SIGN IN TO LEASH"}</Button>
      </header>
      {owner.sample ? <p className="fd-leashes__sample m-small">{"Sample leashes, so you can look around."}</p> : null}
      {!owner.sample && !owner.signedIn ? <p className="m-small m-muted">{"Sign in as the owner to see and manage your leashes."}</p> : null}
      {leashes.isLoading && !owner.sample ? <div className="fd-leashes__grid"><div className="m-skel" style={{ height: 260 }} /></div> : null}
      {live.length > 0 ? (
        <div className="fd-leashes__grid">
          {live.map((l) => <LeashCard key={l.id} l={l} now={now} busy={busyId === l.id} onRevoke={(x) => void revoke(x)} />)}
        </div>
      ) : owner.signedIn && !leashes.isLoading ? (
        <p className="fd-leashes__empty m-small">{"No leashes yet. Give a bot $20 a day for a week to pay invoices, or let a trading agent swap small amounts: it gets a key for its leash only, and you sign the limits once."}</p>
      ) : null}
      {ended.length > 0 ? (
        <details className="fd-leashes__ended">
          <summary className="m-small">{`${ended.length} ended`}</summary>
          <div className="fd-leashes__grid">{ended.map((l) => <LeashCard key={l.id} l={l} now={now} busy={false} onRevoke={() => undefined} />)}</div>
        </details>
      ) : null}
      {sheetOpen ? <NewLeashSheet key={draftParam ?? "new"} open owner={owner} draft={draft} onClose={closeSheet} onCreated={() => void qc.invalidateQueries({ queryKey: ["leashes"] })} /> : null}
    </section>
  );
}
