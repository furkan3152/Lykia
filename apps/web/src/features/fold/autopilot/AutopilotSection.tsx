/**
 * Pack · Autopilot. Lyko signs the owner's own tasks inside a leash on the
 * owner's own LykiaAccount. Off by default. The card says where it stands in
 * one sentence, shows each number with what it means, keeps Stop one tap
 * away, lists the tasks (with Run now) and what Lyko signed or refused.
 * "Turn on" opens the sheet: limits, then what Autopilot can do (accepted
 * with a tick), then one signature.
 */
import type { AutopilotTaskKind } from "@lykia/core";
import type { AutopilotRun, AutopilotView } from "@lykia/core/api/autopilot";
import type { FoldInstruction } from "@lykia/core/api/fold";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../../app/routes/history";
import { useSearchParam } from "../../../app/routes/useRoute";
import { apiPost, describeError } from "../../../lib/api";
import { Button, Field, Input, Tag, cx, toast } from "../../../mosaic";
import type { FoldOwner } from "../data";
import { AutopilotSheet } from "./AutopilotSheet";
import { useAutopilot, useSignSession, useStopAutopilot } from "./data";
import { emptyTaskForm, LABEL, money, runLine, shortAddress, statusLine, TASK_KINDS, taskInputOf, type TaskForm } from "./model";

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

function AddTask({ owner, payees, watches, onDone }: { readonly owner: FoldOwner; readonly payees: readonly string[]; readonly watches: readonly FoldInstruction[]; readonly onDone: () => void }) {
  const [f, setF] = useState<TaskForm>(() => ({ ...emptyTaskForm("repay"), payee: payees[0] ?? "", watchId: watches[0]?.id ?? "" }));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<TaskForm>) => setF((x) => ({ ...x, ...patch }));
  const { input, issue } = taskInputOf(f, watches);
  const save = async () => {
    if (!input) return toast.info(issue ?? "Fill in the task", { from: "LYKO" });
    setBusy(true);
    try {
      await apiPost("/v1/autopilot/tasks", { environment: owner.environment, task: input });
      toast.success("Task added", { description: "Lyko checks it on every background pass.", from: "LYKO" });
      onDone();
    } catch (e) {
      toast.error("Not added", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };
  const kinds = TASK_KINDS.filter((k) => (k.kind !== "pay" || payees.length > 0) && (k.kind !== "watch" || watches.length > 0));
  return (
    <div className="ap-add m-frame m-frame--thin">
      <div className="fd-suggest" role="group" aria-label="What should Lyko do">
        {kinds.map((k) => (
          <button key={k.kind} type="button" className={cx("m-chip", f.kind === k.kind && "is-on")} aria-pressed={f.kind === k.kind} onClick={() => set({ kind: k.kind as AutopilotTaskKind })}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="m-small m-muted">{TASK_KINDS.find((k) => k.kind === f.kind)?.line}</p>
      <div className="ap-add__fields">
        <Field label="At most $ each time" hint="The most one run moves. Never above your per-step limit.">
          <Input inputMode="decimal" value={f.amountUsd} onChange={(e) => set({ amountUsd: e.target.value })} />
        </Field>
        {f.kind === "repay" ? (
          <Field label="When health drops below" hint="Your Aave health factor on your LykiaAccount. Liquidation starts at 1.">
            <Input inputMode="decimal" value={f.floor} onChange={(e) => set({ floor: e.target.value })} />
          </Field>
        ) : null}
        {f.kind === "dca" || f.kind === "pay" ? (
          <Field label="Every" hint="The first run is on the next background pass.">
            <select className="m-input" value={f.every} onChange={(e) => set({ every: e.target.value as TaskForm["every"] })}>
              <option value="day">{"day"}</option>
              <option value="week">{"week"}</option>
              <option value="month">{"month"}</option>
            </select>
          </Field>
        ) : null}
        {f.kind === "dca" ? (
          <Field label="Buy" hint="Converted at the best on-chain price, at most 0.5% slippage.">
            <select className="m-input" value={f.to} onChange={(e) => set({ to: e.target.value as TaskForm["to"] })}>
              <option value="EURC">{"EURC with USDC"}</option>
              <option value="USDC">{"USDC with EURC"}</option>
            </select>
          </Field>
        ) : null}
        {f.kind === "sweep" ? (
          <>
            <Field label="Keep $ in the account" hint="Only USDC above this moves.">
              <Input inputMode="decimal" value={f.keepUsd} onChange={(e) => set({ keepUsd: e.target.value })} />
            </Field>
            <Field label="Into" hint='A vault name, e.g. "Morpho" or "Galaxy vault".'>
              <Input value={f.vault} onChange={(e) => set({ vault: e.target.value })} />
            </Field>
          </>
        ) : null}
        {f.kind === "pay" ? (
          <Field label="Pay" hint="Only payees you named when you turned Autopilot on.">
            <select className="m-input" value={f.payee} onChange={(e) => set({ payee: e.target.value })}>
              {payees.map((p) => <option key={p} value={p}>{shortAddress(p)}</option>)}
            </select>
          </Field>
        ) : null}
        {f.kind === "watch" ? (
          <>
            <Field label="When this watch is met" hint="Checked on your LykiaAccount, where Autopilot's money is.">
              <select className="m-input" value={f.watchId} onChange={(e) => set({ watchId: e.target.value })}>
                {watches.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label="Lyko does" hint='One sentence, e.g. "repay 30 USDC on Aave".'>
              <Input value={f.sentence} onChange={(e) => set({ sentence: e.target.value })} />
            </Field>
          </>
        ) : null}
      </div>
      <div className="ap-add__foot">
        {issue ? <span className="m-small m-muted">{issue}</span> : <span className="m-small m-muted">{"Each run is planned under your Fence and checked again before Lyko signs."}</span>}
        <Button size="sm" tone="sea" onClick={() => void save()} disabled={busy || !input}>{busy ? "ADDING…" : "ADD TASK"}</Button>
      </div>
    </div>
  );
}

export function AutopilotSection({ owner, watches, onSignIn }: { readonly owner: FoldOwner; readonly watches: readonly FoldInstruction[] | undefined; readonly onSignIn: () => void }) {
  const q = useAutopilot(owner);
  const qc = useQueryClient();
  const { stop, busy: stopping } = useStopAutopilot(owner.environment);
  const session = useSignSession();
  // Ask Lyko's "Turn on Autopilot" links here with ?autopilot=on.
  const asked = useSearchParam("autopilot") === "on";
  const [sheet, setSheet] = useState(false);
  const [adding, setAdding] = useState(false);
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
  const openSheet = () => (owner.sample ? sampleNote() : owner.signedIn ? setSheet(true) : onSignIn());
  const activeWatches = (watches ?? []).filter((w) => w.source === "watch" && w.status === "active");

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
              {ap.status !== "pending" ? <Button size="sm" tone="ghost" onClick={() => (owner.sample ? sampleNote() : setAdding((v) => !v))}>{adding ? "CLOSE" : "+ ADD TASK"}</Button> : null}
            </div>
            {adding ? <AddTask owner={owner} payees={ap.payees} watches={activeWatches} onDone={() => { setAdding(false); refresh(); }} /> : null}
            {ap.tasks.length === 0 ? <p className="m-small m-muted">{"No tasks yet. Add one: Lyko checks it on every background pass and signs only inside your limits."}</p> : null}
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
          <Button tone="sea" disabled={view?.offer.available === false && !owner.sample} onClick={openSheet}>{owner.signedIn || owner.sample ? "TURN ON AUTOPILOT" : "SIGN IN TO TURN ON"}</Button>
          <span className="m-small m-muted">{`Off by default. At most ${money(view?.offer.ceilings.perStepUsd ?? "100")} a step and ${money(view?.offer.ceilings.perDayUsd ?? "300")} a day while in beta; you can choose less.`}</span>
        </div>
      )}

      {view && view.runs.length > 0 ? (
        <div className="ap__runs">
          <span className="m-kick">{"WHAT LYKO DID"}</span>
          <ul>{view.runs.slice(0, 5).map((r) => <RunItem key={r.id} r={r} />)}</ul>
        </div>
      ) : null}
      {sheet || (asked && !live) || (asked && owner.sample) ? (
        <AutopilotSheet
          owner={owner}
          offer={view?.offer}
          onClose={() => {
            setSheet(false);
            if (asked) navigate("/app/fold/pack", { replace: true });
          }}
          onDone={refresh}
        />
      ) : null}
    </section>
  );
}
