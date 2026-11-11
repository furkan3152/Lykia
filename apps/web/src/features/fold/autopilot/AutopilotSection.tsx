/**
 * Pack · Autopilot. Lyko signs the owner's own tasks inside a leash on the
 * owner's own LykiaAccount. Off by default. The card says where it stands in
 * one sentence, shows each number with what it means, keeps Stop one tap
 * away, lists the tasks (with Run now) and what Lyko signed or refused.
 * Turning it on and adding tasks start in Ask Lyko, which opens the review
 * sheet (limits, what Autopilot can do, one signature); the Fold only
 * pauses, resumes and stops.
 */
import { txKnown } from "@lykia/core";
import type { AutopilotRun, AutopilotView } from "@lykia/core/api/autopilot";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiPost, describeError } from "../../../lib/api";
import { Button, Tag, toast } from "../../../mosaic";
import type { FoldOwner } from "../data";
import { useAutopilot, useSignSession, useStopAutopilot } from "./data";
import { LABEL, money, runLine, shortAddress, statusLine } from "./model";
import { intlLocale, formatDate, t as msg } from "../../../i18n";

function Fact({ label, value, meaning }: { readonly label: string; readonly value: string; readonly meaning: string }) {
  return (
    <div className="ap-fact">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
      <p className="m-small m-muted">{meaning}</p>
    </div>
  );
}

function RunItem({ r }: { readonly r: AutopilotRun }) {
  return (
    <li className="ap-run" data-status={r.status}>
      <span className="ap-run__line">{runLine(r)}</span>
      <span className="ap-run__tags">
        {r.label ? <Tag tone="sea">{msg("fold.autopilot.autopilotSection.signedByLyko")}</Tag> : null}
        {r.chainProven ? <Tag tone="ok">{msg("fold.autopilot.autopilotSection.onChain")}</Tag> : r.status === "refused" ? <Tag tone="bad">{msg("fold.autopilot.autopilotSection.refused")}</Tag> : null}
      </span>
      {r.label ? <span className="m-small m-muted ap-run__why">{`${txKnown(LABEL)}${r.verdictDigest ? msg("fold.autopilot.autopilotSection.verdict", { value: r.verdictDigest.slice(7, 15) }) : ""}`}</span> : null}
    </li>
  );
}

export function AutopilotSection({ owner, onAsk }: { readonly owner: FoldOwner; readonly onAsk: (text: string, context: string) => void }) {
  const q = useAutopilot(owner);
  const qc = useQueryClient();
  const { stop, busy: stopping } = useStopAutopilot(owner.environment);
  const session = useSignSession();
  const [busyId, setBusyId] = useState<string | null>(null);
  const view: AutopilotView | undefined = q.data;
  const ap = view?.autopilot ?? null;
  const live = ap !== null && ap.status !== "stopped";
  const status = statusLine(ap, view?.offer.available === false ? view.offer.reason : null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["autopilot"] });
  const sampleNote = () => toast.info(msg("fold.autopilot.autopilotSection.thisIsTheSampleAutopilot"), { description: msg("fold.autopilot.autopilotSection.connectAWalletAndSignIn"), from: "LYKO" });

  const act = async (path: string, done: string) => {
    if (owner.sample) return sampleNote();
    setBusyId(path);
    try {
      await apiPost(path, { environment: owner.environment });
      toast.success(done, { from: "LYKO" });
      refresh();
    } catch (e) {
      toast.error(msg("fold.autopilot.autopilotSection.noChange"), { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };

  const onStop = () => (owner.sample ? sampleNote() : void stop());

  return (
    <section className="ap" id="autopilot" aria-labelledby="ap-h" data-status={ap?.status ?? "off"}>
      <header className="ap__head">
        <div>
          <h3 id="ap-h">{"Autopilot"} <span className="p-h-sub">{msg("fold.autopilot.autopilotSection.lykoSignsForYou")}</span></h3>
          <p className="m-small">{msg("fold.autopilot.autopilotSection.lykoRunsYourOwnRepeatsRepay")}</p>
        </div>
        <Tag tone={status.tone}>{status.tag}</Tag>
      </header>
      <p className="ap__status" role="status">{status.line}</p>

      {live ? (
        <>
          {ap.status === "paused" ? (
            <div className="m-note m-note--bad ap__paused">
              <b>{msg("fold.autopilot.autopilotSection.autopilotPaused")}</b>
              <span className="m-small">{ap.paused?.reason ?? "Paused."}</span>
              <Button size="sm" tone="ochre" disabled={busyId !== null} onClick={() => void act("/v1/autopilot/resume", msg("fold.autopilot.autopilotSection.autopilotIsBackOn"))}>{msg("fold.autopilot.autopilotSection.resume")}</Button>
            </div>
          ) : null}
          {ap.status === "pending" && ap.sign && ap.sign.length > 0 ? (
            <div className="m-note ap__pending">
              <b>{msg("fold.autopilot.autopilotSection.oneSignatureLeft")}</b>
              <span className="m-small">{`${ap.sign.map((x) => x.label).join("; ")}.`}</span>
              <Button size="sm" tone="sea" disabled={session.busy || owner.sample} onClick={() => void session.sign(ap.leashId, ap.sign!)}>{session.busy ? msg("fold.autopilot.autopilotSection.waitingForYourWallet") : session.connected ? msg("fold.autopilot.autopilotSection.signTheSession") : msg("fold.autopilot.autopilotSection.connectToSign")}</Button>
            </div>
          ) : null}
          <dl className="ap__facts">
            <Fact label={msg("fold.autopilot.autopilotSection.signedToday")} value={msg("common.usedOf", { used: money(view?.today?.spentUsd ?? "0"), cap: money(ap.limits.perDayUsd) })} meaning={msg("fold.autopilot.autopilotSection.whatLykoSignedForYouToday")} />
            <Fact label={msg("fold.autopilot.autopilotSection.mostInOneStep")} value={money(ap.limits.perStepUsd)} meaning={msg("fold.autopilot.autopilotSection.theLargestSingleMoveLykoCan")} />
            <Fact label={msg("fold.autopilot.autopilotSection.sessionEnds")} value={new Date(Date.parse(ap.createdAt) + ap.limits.days * 86_400_000).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" })} meaning={msg("fold.autopilot.autopilotSection.afterThisTheKeyStopsWorking")} />
            <Fact label={msg("fold.autopilot.autopilotSection.signingKey")} value={shortAddress(ap.signer.address)} meaning={msg("fold.autopilot.autopilotSection.aCircleWalletMadeForYou")} />
          </dl>
          <div className="ap__stop">
            <Button tone="navy" className="ap__stopbtn" disabled={stopping} onClick={onStop} aria-label={msg("fold.autopilot.autopilotSection.stopAutopilot")}>{stopping ? "STOPPING…" : msg("fold.autopilot.autopilotSection.stopAutopilot2")}</Button>
            <span className="m-small m-muted">{msg("fold.autopilot.autopilotSection.lykoStopsSigningAtOnceThen")}</span>
          </div>

          <div className="ap__tasks">
            <div className="ap__row">
              <span className="m-kick">{msg("fold.autopilot.autopilotSection.tasks", { length: ap.tasks.length })}</span>
              {ap.status !== "pending" ? <Button size="sm" tone="ghost" onClick={() => onAsk(msg("fold.autopilot.autopilotSection.haveAutopilot"), msg("fold.autopilot.autopilotSection.aNewAutopilotTaskFromThe"))}>{msg("fold.autopilot.autopilotSection.askLykoForATask")}</Button> : null}
            </div>
            {ap.tasks.length === 0 ? <p className="m-small m-muted">{msg("fold.autopilot.autopilotSection.noTasksYetAskLykoFor")}</p> : null}
            <ul className="ap__tasklist">
              {ap.tasks.map((t) => (
                <li key={t.id} className="ap-task" data-enabled={t.enabled}>
                  <div>
                    <b>{t.label}</b>
                    <span className="m-small m-muted">{t.lastRunAt ? msg("fold.autopilot.autopilotSection.last", { result: t.lastResult ?? msg("fold.autopilot.autopilotSection.ran"), when: formatDate(t.lastRunAt, { day: "numeric", month: "short" }) }) : t.when.kind === "schedule" ? msg("fold.autopilot.autopilotSection.runsOnTheNextBackgroundPass") : msg("fold.autopilot.autopilotSection.waitingForTheCondition")}</span>
                  </div>
                  <div className="ap-task__acts">
                    <Button size="sm" tone="ghost" disabled={busyId !== null || ap.status !== "on"} onClick={() => void act(`/v1/autopilot/tasks/${t.id}/run`, msg("fold.autopilot.autopilotSection.runRequested"))}>{msg("fold.autopilot.autopilotSection.runNow")}</Button>
                    <Button size="sm" tone="ghost" disabled={busyId !== null} onClick={() => void act(`/v1/autopilot/tasks/${t.id}/${t.enabled ? "pause" : "resume"}`, t.enabled ? msg("fold.autopilot.autopilotSection.taskPaused") : msg("fold.autopilot.autopilotSection.taskOn"))}>{t.enabled ? "PAUSE" : "RESUME"}</Button>
                    <Button size="sm" tone="ghost" disabled={busyId !== null} onClick={() => void act(`/v1/autopilot/tasks/${t.id}/remove`, msg("fold.autopilot.autopilotSection.taskRemoved"))}>{msg("fold.autopilot.autopilotSection.remove")}</Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="ap__off">
          <Button tone="terra" disabled={view?.offer.available === false && !owner.sample} onClick={() => onAsk(msg("fold.autopilot.autopilotSection.turnOnAutopilotWith"), msg("fold.autopilot.autopilotSection.turningOnAutopilotFromThePack"))}>{msg("fold.autopilot.autopilotSection.askLyko")}</Button>
          <span className="m-small m-muted">{msg("fold.autopilot.autopilotSection.offByDefault", { step: money(view?.offer.ceilings.perStepUsd ?? "100"), day: money(view?.offer.ceilings.perDayUsd ?? "300") })}</span>
        </div>
      )}

      {view && view.runs.length > 0 ? (
        <div className="ap__runs">
          <span className="m-kick">{msg("fold.autopilot.autopilotSection.whatLykoDid")}</span>
          <ul>{view.runs.slice(0, 5).map((r) => <RunItem key={r.id} r={r} />)}</ul>
        </div>
      ) : null}
    </section>
  );
}
