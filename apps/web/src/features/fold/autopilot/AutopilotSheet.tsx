/**
 * Turn on Autopilot: limits, then what it can do (read and ticked), then one
 * signature. Nothing is signed by Lyko before the owner's session lands.
 *
 *   Limits   per step, per day, how many days, and payees it may pay
 *   Read     the acknowledgement and who holds what; a tick to accept
 *   Sign     the API makes the leash; the owner's wallet signs it once
 */
import type { AutopilotOffer, EnableAutopilotResponse } from "@lykia/core/api/autopilot";
import { useState } from "react";
import { createPortal } from "react-dom";

import { Sheet } from "../../../city/Sheet";
import { apiPost, describeError } from "../../../lib/api";
import { Button, Field, Input, cx, toast } from "../../../mosaic";
import type { FoldOwner } from "../data";
import { useSignSession } from "./data";
import { ACK_LINES, AUTOPILOT_PRESETS, autopilotFormIssues, emptyAutopilotForm, enableRequestOf, money, payeesOf, shortAddress, TRUST, type AutopilotForm } from "./model";
import { t as msg } from "../../../i18n";

type Phase = "limits" | "read" | "sign";
const STEPS: readonly { readonly id: Phase; readonly label: string }[] = [
  { id: "limits", label: msg("fold.autopilot.autopilotSheet.limits") },
  { id: "read", label: msg("fold.autopilot.autopilotSheet.read") },
  { id: "sign", label: msg("fold.autopilot.autopilotSheet.signOnce") },
];

export function AutopilotSheet({ owner, offer, initial, onClose, onDone }: { readonly owner: FoldOwner; readonly offer: AutopilotOffer | undefined; readonly initial?: Partial<Pick<AutopilotForm, "perStepUsd" | "perDayUsd" | "days" | "payees">>; readonly onClose: () => void; readonly onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("limits");
  // Ask Lyko drafts the limits the owner stated or picked; this sheet is their review (read, accept, sign once).
  const [form, setForm] = useState<AutopilotForm>(() => ({ ...emptyAutopilotForm(), ...initial }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<EnableAutopilotResponse | null>(null);
  const [signed, setSigned] = useState<string | null>(null);
  const session = useSignSession();
  const ceilings = offer?.ceilings ?? { perStepUsd: "100", perDayUsd: "300" };
  const issues = autopilotFormIssues(form, phase === "limits" ? "limits" : "accept", ceilings, owner.address);
  const err = (f: keyof AutopilotForm) => (touched ? issues.find((i) => i.field === f)?.message ?? null : null);
  const set = (patch: Partial<AutopilotForm>) => setForm((f) => ({ ...f, ...patch }));
  const at = STEPS.findIndex((s) => s.id === phase);
  const total = Number(form.perDayUsd) * Number(form.days);

  const next = () => {
    setTouched(true);
    if (issues.length > 0) return;
    setTouched(false);
    setPhase("read");
  };

  const turnOn = async () => {
    setTouched(true);
    if (issues.length > 0) return;
    if (owner.sample || !owner.signedIn) {
      toast.info(owner.sample ? msg("fold.autopilot.autopilotSheet.connectAWalletToTurnOn") : msg("fold.autopilot.autopilotSheet.signInAsTheOwnerFirst"), { from: "LYKO" });
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<EnableAutopilotResponse>("/v1/autopilot/enable", enableRequestOf(form, owner.environment), { timeoutMs: 45_000 });
      setMade(r);
      setPhase("sign");
      onDone();
    } catch (e) {
      toast.error(msg("fold.autopilot.autopilotSheet.autopilotWasNotTurnedOn"), { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    if (!made) return;
    const hash = await session.sign(made.autopilot.leashId, made.transactions);
    if (hash) {
      setSigned(hash);
      onDone();
    }
  };

  return createPortal(
    <Sheet open onClose={onClose} title={msg("fold.autopilot.autopilotSheet.turnOnAutopilot")}>
      <div className="fd-newleash ap-sheet">
        <div className="fd-newleash__top">
          <ol className="fd-stepper" aria-label={msg("fold.autopilot.autopilotSheet.stepOf3", { value: at + 1 })}>
            {STEPS.map((s, i) => (
              <li key={s.id} data-on={i <= at} aria-current={phase === s.id ? "step" : undefined}>
                <i />
                {s.label}
              </li>
            ))}
          </ol>
        </div>

        {phase === "limits" ? (
          <div className="fd-newleash__body">
            <div className="p-leash-presets" role="group" aria-label={msg("fold.autopilot.autopilotSheet.quickLimits")}>
              <span className="m-kick">{msg("fold.autopilot.autopilotSheet.pickASizeOrTypeYour")}</span>
              <div className="fd-suggest">
                {AUTOPILOT_PRESETS.map((p) => {
                  const on = p.form.perStepUsd === form.perStepUsd && p.form.perDayUsd === form.perDayUsd && p.form.days === form.days;
                  return (
                    <button key={p.id} type="button" className={cx("m-chip", on && "is-on")} aria-pressed={on} onClick={() => set(p.form)}>
                      <b>{p.label}</b> <span className="m-small">{p.line}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fd-newleash__money">
              <Field label={msg("fold.autopilot.autopilotSheet.perStep")} error={err("perStepUsd")} hint={msg("fold.autopilot.autopilotSheet.theMostLykoCanMoveIn", { money: money(ceilings.perStepUsd) })}>
                <Input inputMode="decimal" value={form.perStepUsd} onChange={(e) => set({ perStepUsd: e.target.value })} />
              </Field>
              <Field label={msg("fold.autopilot.autopilotSheet.perDay")} error={err("perDayUsd")} hint={msg("fold.autopilot.autopilotSheet.theMostLykoCanSignIn", { money: money(ceilings.perDayUsd) })}>
                <Input inputMode="decimal" value={form.perDayUsd} onChange={(e) => set({ perDayUsd: e.target.value })} />
              </Field>
              <Field label={msg("fold.autopilot.autopilotSheet.days")} error={err("days")} hint={msg("fold.autopilot.autopilotSheet.afterThisTheKeyStopsWorking")}>
                <Input inputMode="numeric" value={form.days} onChange={(e) => set({ days: e.target.value })} />
              </Field>
            </div>
            <p className="fd-newleash__total">
              {Number.isFinite(total) && total > 0 ? <>{msg("fold.autopilot.autopilotSheet.inTotalAtMost")}<b className="num">{money(total)}</b>{msg("fold.autopilot.autopilotSheet.overDays", { n: Number(form.days) })}</> : msg("fold.autopilot.autopilotSheet.fillInTheDailyLimitAnd")}
            </p>
            <Field label={msg("fold.autopilot.autopilotSheet.payeesItMayPayOptional")} error={err("payees")} hint={msg("fold.autopilot.autopilotSheet.forRecurringInvoicesOneAddressPer")}>
              <textarea className="m-textarea" spellCheck={false} value={form.payees} placeholder={"0x…"} onChange={(e) => set({ payees: e.target.value })} />
            </Field>
          </div>
        ) : null}

        {phase === "read" ? (
          <div className="fd-newleash__body">
            <div className="ap-ack m-frame m-frame--thin" role="note">
              <span className="m-kick">{msg("fold.autopilot.autopilotSheet.whatAutopilotMeans")}</span>
              <ul>{ACK_LINES.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
            <dl className="fd-newleash__summary">
              <div><dt>{msg("fold.autopilot.autopilotSheet.perStep2")}</dt><dd className="num">{money(form.perStepUsd)}</dd></div>
              <div><dt>{msg("fold.autopilot.autopilotSheet.perDay2")}</dt><dd className="num">{money(form.perDayUsd)}</dd></div>
              <div><dt>{msg("fold.autopilot.autopilotSheet.inTotal")}</dt><dd className="num">{money(total)}</dd></div>
              <div><dt>{msg("fold.autopilot.autopilotSheet.for")}</dt><dd className="num">{msg("fold.autopilot.autopilotSheet.days", { n: Number(form.days) })}</dd></div>
              <div><dt>{msg("fold.autopilot.autopilotSheet.payees")}</dt><dd>{payeesOf(form).length > 0 ? payeesOf(form).map(shortAddress).join(", ") : msg("fold.autopilot.autopilotSheet.noneOnlyYourOwnAccount")}</dd></div>
              <div><dt>{msg("fold.autopilot.autopilotSheet.mayDo")}</dt><dd>{msg("fold.autopilot.autopilotSheet.payThosePayeesConvertUsdcAnd")}</dd></div>
            </dl>
            <details className="p-tech">
              <summary className="m-small">{msg("fold.autopilot.autopilotSheet.whoHoldsWhat")}</summary>
              <ul className="ap-trust">{TRUST.map((t) => <li key={t.who}><b>{t.who}</b> {t.holds}</li>)}</ul>
            </details>
            <label className="fd-radio ap-accept">
              <input type="checkbox" checked={form.accepted} onChange={(e) => set({ accepted: e.target.checked })} />
              {msg("fold.autopilot.autopilotSheet.iUnderstandLykoSignsForMe")}
            </label>
            {err("accepted") ? <p className="m-note m-note--bad">{err("accepted")}</p> : null}
          </div>
        ) : null}

        {phase === "sign" && made ? (
          <div className="fd-newleash__body">
            <ul className="ap-notes">{made.notes.map((n) => <li key={n} className="m-small">{n}</li>)}</ul>
            <div className="fd-newleash__sign">
              {signed ? (
                <p className="m-note"><b>{msg("fold.autopilot.autopilotSheet.signed")}</b>{msg("fold.autopilot.autopilotSheet.autopilotGoesOnAsSoonAs", { signed: signed.slice(0, 10) })}</p>
              ) : (
                <>
                  <p className="m-small">{msg("fold.autopilot.autopilotSheet.transactionsToSign", { n: made.transactions.length, list: made.transactions.map((x) => x.label).join("; ") })}</p>
                  <Button onClick={() => void sign()} disabled={session.busy}>{session.busy ? msg("fold.autopilot.autopilotSheet.waitingForYourWallet") : session.connected ? msg("fold.autopilot.autopilotSheet.signOnce2") : msg("fold.autopilot.autopilotSheet.connectToSign")}</Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="fd-newleash__foot">
          {phase === "limits" ? <Button tone="ghost" onClick={onClose}>{msg("fold.autopilot.autopilotSheet.cancel")}</Button> : null}
          {phase === "read" ? <Button tone="ghost" onClick={() => setPhase("limits")}>{msg("fold.autopilot.autopilotSheet.back")}</Button> : null}
          {phase === "limits" ? <Button tone="sea" onClick={next}>{msg("fold.autopilot.autopilotSheet.next")}</Button> : null}
          {phase === "read" ? <Button tone="sea" onClick={() => void turnOn()} disabled={busy}>{busy ? msg("fold.autopilot.autopilotSheet.makingIt") : msg("fold.autopilot.autopilotSheet.turnOn")}</Button> : null}
          {phase === "sign" ? <Button tone="ghost" onClick={onClose}>{signed ? "DONE" : "LATER"}</Button> : null}
        </div>
      </div>
    </Sheet>,
    document.body,
  );
}
