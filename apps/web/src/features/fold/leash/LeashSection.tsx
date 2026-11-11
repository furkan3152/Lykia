/**
 * Pack · your agents and their leashes. One card per agent: an outside bot
 * with its leash (who it is for, its template, where it spends from, a
 * budget meter for today and for its whole life read from the LykiaAccount
 * or LykiaStile on chain, the time left, where it may go, its last actions
 * and Revoke), or an agent whose leash is its budget on Lykia's side.
 * Nothing is created here: new agents and leashes start in Ask Lyko, which
 * opens the leash sheet as its review step. An older Ask link (`?leash=`)
 * still opens that review here.
 */
import { decodeDraft, LEASH_TEMPLATES, LYKIA_TERMS } from "@lykia/core";
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
import { useGatewayOffer, useLeashes } from "./data";
import { actionLine, destinationsLabel, draftFromParam, meterOf, nearCap, spendFromLabel, statusLabel, stepLeft, timeLeft, usdText, venueLabel, type GatewayOffer, type MeterView } from "./model";
import { NewLeashSheet } from "./NewLeashSheet";
import { AgentCard, AskTile } from "../tabs/PackTab";
import type { PackAgentView } from "@lykia/core/api/agents";
import { t } from "../../../i18n";

function Bar({ m, label }: { readonly m: MeterView; readonly label: string }) {
  const n = 14;
  const filled = Math.round(m.share * n);
  return (
    <div className="fd-meter fd-leash__meter" data-tone={m.tone}>
      <div className="fd-leash__meterhead">
        <span className="m-kick">{label}</span>
        <span className="num">{t("common.usedOf", { used: usdText(m.used), cap: usdText(m.cap) })}</span>
      </div>
      <div className="fd-meter__row fd-leash__row" role="meter" aria-valuemin={0} aria-valuemax={m.cap} aria-valuenow={m.used} aria-label={t("fold.leash.leashSection.ofUsed", { label, usdText: usdText(m.used), usdText2: usdText(m.cap) })}>
        {Array.from({ length: n }, (_, i) => <i key={i} data-f={i < filled} />)}
      </div>
    </div>
  );
}

export function LeashCard({ l, now, busy, onRevoke, offer, onAsk }: { readonly l: LeashView; readonly now: number; readonly busy: boolean; readonly onRevoke: (l: LeashView) => void; readonly offer?: GatewayOffer | undefined; readonly onAsk?: (l: LeashView) => void }) {
  const live = l.status === "active" || l.status === "pending";
  const close = nearCap(l);
  const paysOn = destinationsLabel(l, offer);
  return (
    <article className="fd-pk__card fd-leash m-frame m-frame--thin" data-status={l.status} data-near={close} data-from={l.spendFrom ?? "arc"} data-tone="terra">
      <header className="fd-leash__head">
        <span className="fd-leash__mark" aria-hidden="true"><LeashMark scale={2} /></span>
        <h3>{l.agentName}</h3>
        <Button size="sm" tone="navy" className="fd-leash__revoke" disabled={!live || busy} onClick={() => onRevoke(l)} aria-label={t("fold.leash.leashSection.revokeSLeash", { agentName: l.agentName })}>
          {live ? (busy ? "REVOKING…" : "REVOKE") : l.status.toUpperCase()}
        </Button>
        <span className="m-kick fd-leash__kick">{`${LEASH_TEMPLATES[l.template].title} · ${statusLabel(l)}`}</span>
      </header>
      <Bar m={meterOf(l.usage.day)} label={t("fold.leash.leashSection.spentToday")} />
      <Bar m={meterOf(l.usage.total)} label={t("fold.leash.leashSection.spentInTotal")} />
      {close && live ? <p className="fd-leash__warn">{t("fold.leash.leashSection.nearItsCapLeftForThe", { usdText: usdText(stepLeft(l)) })}</p> : null}
      <p className="fd-leash__from">
        <Tag tone={l.spendFrom === "gateway" ? "sea" : "ghost"}>{spendFromLabel(l).toUpperCase()}</Tag>
        {paysOn ? <span className="m-small">{t("fold.leash.leashSection.paysOn", { paysOn })}</span> : null}
      </p>
      <dl className="fd-agent__facts">
        <div><dt>{t("fold.leash.leashSection.keyStopsIn")}</dt><dd className="num">{live ? timeLeft(l.expiresAt, now) : "ended"}</dd></div>
        <div><dt>{t("fold.leash.leashSection.mostInOneGo")}</dt><dd className="num">{usdText(l.budget.perStepUsd)}</dd></div>
        <div><dt>{l.template === "pay-invoices" ? t("fold.leash.leashSection.mayPay") : t("fold.leash.leashSection.mayUse")}</dt><dd>{venueLabel(l)}</dd></div>
        <div><dt>{t("fold.leash.leashSection.limitsReadFrom")}</dt><dd>{l.usage.source === "chain" ? t("fold.leash.leashSection.theChain") : t("fold.leash.leashSection.lykiaSRecord")}</dd></div>
      </dl>
      {l.recent.length > 0 ? (
        <ul className="fd-leash__recent" aria-label={t("fold.leash.leashSection.lastActions")}>
          {l.recent.slice(0, 3).map((a) => (
            <li key={`${a.at}${a.summary}`} data-kind={a.kind}>
              <span>{actionLine(a)}</span>
              {a.chainProven ? <Tag tone="ok">{t("fold.leash.leashSection.onChain")}</Tag> : a.kind === "denied" ? <Tag tone="bad">{t("fold.leash.leashSection.refused")}</Tag> : null}
            </li>
          ))}
        </ul>
      ) : <p className="m-small m-muted">{l.status === "pending" ? t("fold.leash.leashSection.nothingYetItGoesLiveOnce") : t("fold.leash.leashSection.noActionsYet")}</p>}
      {onAsk && live ? <button type="button" className="fd-run__ask" onClick={() => onAsk(l)}>{t("fold.leash.leashSection.changeInAskLyko")}</button> : null}
    </article>
  );
}

export function LeashSection({ owner, agents, busyId: agentBusy, onPauseAgent, onRevokeAgent, onAsk }: { readonly owner: FoldOwner; readonly agents: readonly PackAgentView[] | undefined; readonly busyId: string | null; readonly onPauseAgent: (a: PackAgentView) => void; readonly onRevokeAgent: (a: PackAgentView) => void; readonly onAsk: (text: string, context: string) => void }) {
  const leashes = useLeashes(owner);
  const offer = useGatewayOffer();
  const qc = useQueryClient();
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const draftParam = useSearchParam("leash");
  const draft = useMemo(() => draftFromParam(draftParam, decodeDraft), [draftParam]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const list = leashes.data?.leashes ?? [];
  const live = list.filter((l) => l.status === "active" || l.status === "pending");
  const ended = list.filter((l) => l.status !== "active" && l.status !== "pending").slice(0, 3);
  // An agent holding an outside leash shows as that leash's card; the rest show their own.
  const leashed = new Set(list.map((l) => l.agentId));
  const own = (agents ?? []).filter((a) => !leashed.has(a.id) && a.status !== "revoked" && a.role !== "orchestrator");

  const closeSheet = () => {
    if (draftParam) navigate("/app/fold/pack", { replace: true });
  };

  const revoke = async (l: LeashView) => {
    if (owner.sample) {
      toast.info(t("fold.leash.leashSection.thisIsASampleLeash"), { description: t("fold.leash.leashSection.connectAWalletAndYourOwn"), from: "LYKO" });
      return;
    }
    setBusyId(l.id);
    try {
      // The key dies at the API first; then the wallet ends the session on chain.
      const r = await apiPost<RevokeLeashResponse>(`/v1/leashes/${encodeURIComponent(l.id)}/revoke`, {});
      await qc.invalidateQueries({ queryKey: ["leashes"] });
      void qc.invalidateQueries({ queryKey: ["fold-instructions"] });
      toast.success(t("fold.leash.leashSection.sKeyStoppedWorking", { agentName: l.agentName }), { description: r.transaction ? t("fold.leash.leashSection.signRevokesessionToEndItOn") : r.note, from: "LYKO" });
      if (r.transaction) {
        if (!wallet.connected) openModal();
        else {
          const [hash] = await wallet.send([{ to: r.transaction.to, data: r.transaction.data, value: r.transaction.value, chainId: r.transaction.chainId }]);
          toast.success(t("fold.leash.leashSection.sessionEndedOnChain"), { description: hash, from: "LYKO" });
        }
      }
    } catch (e) {
      toast.error(t("fold.leash.leashSection.notRevokedOnChainYet"), { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };

  const loading = (leashes.isLoading && !owner.sample) || agents === undefined;
  return (
    <section className="fd-leashes fd-pk" aria-labelledby="fd-pk-h">
      <header className="fd-leashes__head fd-pk__head m-floor">
        <span className="fd-leashes__mark" aria-hidden="true"><LeashMark scale={3} /></span>
        <div>
          <h3 id="fd-pk-h">{t("fold.leash.leashSection.agentsAndTheirLeashes")} <span className="p-h-sub">{`· ${LYKIA_TERMS.leash.plain}`}</span></h3>
          <p className="m-small">{t("fold.leash.leashSection.anAgentIsWhatHoldsA")}</p>
        </div>
        <span className="fd-pk__count num" aria-label={`${live.length + own.length} agents`}>{live.length + own.length}</span>
      </header>
      {owner.sample ? <p className="fd-leashes__sample m-small m-floor">{t("fold.leash.leashSection.sampleAgentsAndLeashesSoYou")}</p> : null}
      {!owner.sample && !owner.signedIn ? <p className="m-small m-muted m-floor">{t("fold.leash.leashSection.signInAsTheOwnerTo")}</p> : null}
      <div className="fd-leashes__grid fd-pk__grid">
        {loading ? <div className="m-skel" style={{ height: 260 }} /> : null}
        {live.map((l) => <LeashCard key={l.id} l={l} now={now} busy={busyId === l.id} onRevoke={(x) => void revoke(x)} offer={offer.data} onAsk={(x) => onAsk(t("fold.leash.leashSection.changeSLeash", { agentName: x.agentName }), t("fold.leash.leashSection.leashForADayInAll", { id: x.id, agentName: x.agentName, perDayUsd: x.budget.perDayUsd, totalUsd: x.budget.totalUsd, expiresAt: x.expiresAt }))} />)}
        {own.map((a) => <AgentCard key={a.id} a={a} sample={owner.sample} busy={agentBusy === a.id} onPause={onPauseAgent} onRevoke={onRevokeAgent} onAsk={(x) => onAsk(t("fold.leash.leashSection.changeMyAgent", { name: x.name }), /* i18n-ignore: context for Lyko */ `Agent ${x.name} (${x.role}), ${x.status}; daily cap ${x.budget.caps.dailyUsd ?? "none"}, spent today ${x.budget.spent.dayUsd}.`)} />)}
        <AskTile onAsk={onAsk} />
      </div>
      {ended.length > 0 ? (
        <details className="fd-leashes__ended">
          <summary className="m-small">{`${ended.length} ended`}</summary>
          <div className="fd-leashes__grid">{ended.map((l) => <LeashCard key={l.id} l={l} now={now} busy={false} onRevoke={() => undefined} offer={offer.data} />)}</div>
        </details>
      ) : null}
      {draft ? <NewLeashSheet key={draftParam ?? "draft"} open owner={owner} draft={draft} onClose={closeSheet} onCreated={() => void qc.invalidateQueries({ queryKey: ["leashes"] })} /> : null}
    </section>
  );
}
