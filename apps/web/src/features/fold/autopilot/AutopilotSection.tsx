/**
 * Pack · Autopilot. Lyko signs the owner's own tasks inside a leash on the
 * owner's own LykiaAccount. Off by default. The card says where it stands in
 * one sentence, shows each number with what it means, keeps Stop one tap
 * away, lists the tasks (with Run now) and what Lyko signed or refused.
 * Turning it on and adding tasks start in Ask Lyko, which opens the review
 * sheet (limits, what Autopilot can do, one signature); the Fold only
 * pauses, resumes and stops.
 */
import type { AutopilotRun, AutopilotView } from "@lykia/core/api/autopilot";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiPost, describeError } from "../../../lib/api";
import { Button, Tag, toast } from "../../../mosaic";
import type { FoldOwner } from "../data";
import { useAutopilot, useSignSession, useStopAutopilot } from "./data";
import { LABEL, money, runLine, shortAddress, statusLine } from "./model";

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
        {r.label ? <Tag tone="sea">{"SIGNED BY LYKO"}</Tag> : null}
        {r.chainProven ? <Tag tone="ok">{"ON CHAIN"}</Tag> : r.status === "refused" ? <Tag tone="bad">{"REFUSED"}</Tag> : null}
      </span>
      {r.label ? <span className="m-small m-muted ap-run__why">{`${LABEL}${r.verdictDigest ? ` · verdict ${r.verdictDigest.slice(7, 15)}…` : ""}`}</span> : null}
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
  const sampleNote = () => toast.info("This is the sample Autopilot", { description: "Connect a wallet and sign in to turn on your own.", from: "LYKO" });

  const act = async (path: string, done: string) => {
    if (owner.sample) return sampleNote();
    setBusyId(path);
    try {
      await apiPost(path, { environment: owner.environment });
      toast.success(done, { from: "LYKO" });
      refresh();
    } catch (e) {
      toast.error("No change", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };

  const onStop = () => (owner.sample ? sampleNote() : void stop());

  return (
    <section className="ap" id="autopilot" aria-labelledby="ap-h" data-status={ap?.status ?? "off"}>
      <header className="ap__head">
        <div>
          <h3 id="ap-h">{"Autopilot"} <span className="p-h-sub">{"· Lyko signs for you"}</span></h3>
          <p className="m-small">{"Lyko runs your own repeats (repay a loan, buy on a schedule, sweep idle USDC, pay an invoice) without asking each time. Your money stays in your LykiaAccount; the limits sit on chain; Stop ends it at once."}</p>
        </div>
        <Tag tone={status.tone}>{status.tag}</Tag>
      </header>
      <p className="ap__status" role="status">{status.line}</p>

      {live ? (
        <>
          {ap.status === "paused" ? (
            <div className="m-note m-note--bad ap__paused">
              <b>{"Autopilot paused."}</b>
              <span className="m-small">{ap.paused?.reason ?? "Paused."}</span>
              <Button size="sm" tone="ochre" disabled={busyId !== null} onClick={() => void act("/v1/autopilot/resume", "Autopilot is back on")}>{"RESUME"}</Button>
            </div>
          ) : null}
          {ap.status === "pending" && ap.sign && ap.sign.length > 0 ? (
            <div className="m-note ap__pending">
              <b>{"One signature left."}</b>
              <span className="m-small">{`${ap.sign.map((x) => x.label).join("; ")}.`}</span>
              <Button size="sm" tone="sea" disabled={session.busy || owner.sample} onClick={() => void session.sign(ap.leashId, ap.sign!)}>{session.busy ? "WAITING FOR YOUR WALLET…" : session.connected ? "SIGN THE SESSION" : "CONNECT TO SIGN"}</Button>
            </div>
          ) : null}
          <dl className="ap__facts">
            <Fact label="Signed today" value={`${money(view?.today?.spentUsd ?? "0")} of ${money(ap.limits.perDayUsd)}`} meaning="What Lyko signed for you today. It cannot pass the daily limit; your LykiaAccount refuses more too." />
            <Fact label="Most in one step" value={money(ap.limits.perStepUsd)} meaning="The largest single move Lyko can sign, held on chain as the session's per-call cap." />
            <Fact label="Session ends" value={new Date(Date.parse(ap.createdAt) + ap.limits.days * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} meaning="After this the key stops working on its own. Turn Autopilot on again for a new one." />
            <Fact label="Signing key" value={shortAddress(ap.signer.address)} meaning="A Circle wallet made for you. Circle holds the key; it holds no funds and needs about 1 USDC for gas." />
          </dl>
          <div className="ap__stop">
            <Button tone="navy" className="ap__stopbtn" disabled={stopping} onClick={onStop} aria-label="Stop Autopilot">{stopping ? "STOPPING…" : "STOP AUTOPILOT"}</Button>
            <span className="m-small m-muted">{"Lyko stops signing at once; then your wallet signs revokeSession to end the session on chain. The Whistle stops it too."}</span>
          </div>

          <div className="ap__tasks">
            <div className="ap__row">
              <span className="m-kick">{`TASKS · ${ap.tasks.length}`}</span>
              {ap.status !== "pending" ? <Button size="sm" tone="ghost" onClick={() => onAsk("Have Autopilot ", "A new Autopilot task from the Pack.")}>{"ASK LYKO FOR A TASK"}</Button> : null}
            </div>
            {ap.tasks.length === 0 ? <p className="m-small m-muted">{"No tasks yet. Ask Lyko for one: \"Have Autopilot repay 50 USDC on Aave when health drops below 1.5\". Lyko checks it on every background pass and signs only inside your limits."}</p> : null}
            <ul className="ap__tasklist">
              {ap.tasks.map((t) => (
                <li key={t.id} className="ap-task" data-enabled={t.enabled}>
                  <div>
                    <b>{t.label}</b>
                    <span className="m-small m-muted">{t.lastRunAt ? `Last: ${t.lastResult ?? "ran"} · ${new Date(t.lastRunAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : t.when.kind === "schedule" ? "Runs on the next background pass." : "Waiting for the condition."}</span>
                  </div>
                  <div className="ap-task__acts">
                    <Button size="sm" tone="ghost" disabled={busyId !== null || ap.status !== "on"} onClick={() => void act(`/v1/autopilot/tasks/${t.id}/run`, "Run requested")}>{"RUN NOW"}</Button>
                    <Button size="sm" tone="ghost" disabled={busyId !== null} onClick={() => void act(`/v1/autopilot/tasks/${t.id}/${t.enabled ? "pause" : "resume"}`, t.enabled ? "Task paused" : "Task on")}>{t.enabled ? "PAUSE" : "RESUME"}</Button>
                    <Button size="sm" tone="ghost" disabled={busyId !== null} onClick={() => void act(`/v1/autopilot/tasks/${t.id}/remove`, "Task removed")}>{"REMOVE"}</Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="ap__off">
          <Button tone="terra" disabled={view?.offer.available === false && !owner.sample} onClick={() => onAsk("Turn on Autopilot with ", "Turning on Autopilot from the Pack.")}>{"ASK LYKO"}</Button>
          <span className="m-small m-muted">{`Off by default. Say the limits in Ask Lyko (at most ${money(view?.offer.ceilings.perStepUsd ?? "100")} a step and ${money(view?.offer.ceilings.perDayUsd ?? "300")} a day while in beta); you review and sign once there.`}</span>
        </div>
      )}

      {view && view.runs.length > 0 ? (
        <div className="ap__runs">
          <span className="m-kick">{"WHAT LYKO DID"}</span>
          <ul>{view.runs.slice(0, 5).map((r) => <RunItem key={r.id} r={r} />)}</ul>
        </div>
      ) : null}
    </section>
  );
}
