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

type Phase = "limits" | "read" | "sign";
const STEPS: readonly { readonly id: Phase; readonly label: string }[] = [
  { id: "limits", label: "Limits" },
  { id: "read", label: "Read" },
  { id: "sign", label: "Sign once" },
];

export function AutopilotSheet({ owner, offer, onClose, onDone }: { readonly owner: FoldOwner; readonly offer: AutopilotOffer | undefined; readonly onClose: () => void; readonly onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("limits");
  const [form, setForm] = useState<AutopilotForm>(emptyAutopilotForm);
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
      toast.info(owner.sample ? "Connect a wallet to turn on your own Autopilot" : "Sign in as the owner first", { from: "LYKO" });
      return;
    }
    setBusy(true);
    try {
      const r = await apiPost<EnableAutopilotResponse>("/v1/autopilot/enable", enableRequestOf(form, owner.environment), { timeoutMs: 45_000 });
      setMade(r);
      setPhase("sign");
      onDone();
    } catch (e) {
      toast.error("Autopilot was not turned on", { description: describeError(e), from: "LYKO" });
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
    <Sheet open onClose={onClose} title="Turn on Autopilot">
      <div className="fd-newleash ap-sheet">
        <div className="fd-newleash__top">
          <ol className="fd-stepper" aria-label={`Step ${at + 1} of 3`}>
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
            <div className="p-leash-presets" role="group" aria-label="Quick limits">
              <span className="m-kick">{"PICK A SIZE · OR TYPE YOUR OWN BELOW"}</span>
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
              <Field label="Per step $" error={err("perStepUsd")} hint={`The most Lyko can move in one go (at most ${money(ceilings.perStepUsd)} in beta).`}>
                <Input inputMode="decimal" value={form.perStepUsd} onChange={(e) => set({ perStepUsd: e.target.value })} />
              </Field>
              <Field label="Per day $" error={err("perDayUsd")} hint={`The most Lyko can sign in 24 hours (at most ${money(ceilings.perDayUsd)} in beta).`}>
                <Input inputMode="decimal" value={form.perDayUsd} onChange={(e) => set({ perDayUsd: e.target.value })} />
              </Field>
              <Field label="Days" error={err("days")} hint="After this the key stops working on its own (1 to 30).">
                <Input inputMode="numeric" value={form.days} onChange={(e) => set({ days: e.target.value })} />
              </Field>
            </div>
            <p className="fd-newleash__total">
              {Number.isFinite(total) && total > 0 ? <>{"In total at most "}<b className="num">{money(total)}</b>{` over ${form.days} day${form.days === "1" ? "" : "s"}. Lykia's 1% fee counts toward the limits.`}</> : "Fill in the daily limit and the days."}
            </p>
            <Field label="Payees it may pay (optional)" error={err("payees")} hint="For recurring invoices. One address per line. Money to you, repaying and earning in your own account need no payee.">
              <textarea className="m-textarea" spellCheck={false} value={form.payees} placeholder={"0x…"} onChange={(e) => set({ payees: e.target.value })} />
            </Field>
          </div>
        ) : null}

        {phase === "read" ? (
          <div className="fd-newleash__body">
            <div className="ap-ack m-frame m-frame--thin" role="note">
              <span className="m-kick">{"WHAT AUTOPILOT MEANS"}</span>
              <ul>{ACK_LINES.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
            <dl className="fd-newleash__summary">
              <div><dt>{"Per step"}</dt><dd className="num">{money(form.perStepUsd)}</dd></div>
              <div><dt>{"Per day"}</dt><dd className="num">{money(form.perDayUsd)}</dd></div>
              <div><dt>{"In total"}</dt><dd className="num">{money(total)}</dd></div>
              <div><dt>{"For"}</dt><dd className="num">{`${form.days} days`}</dd></div>
              <div><dt>{"Payees"}</dt><dd>{payeesOf(form).length > 0 ? payeesOf(form).map(shortAddress).join(", ") : "none (only your own account)"}</dd></div>
              <div><dt>{"May do"}</dt><dd>{"pay those payees, convert USDC and EURC, earn and withdraw in Morpho or Aave, repay"}</dd></div>
            </dl>
            <details className="p-tech">
              <summary className="m-small">{"Who holds what"}</summary>
              <ul className="ap-trust">{TRUST.map((t) => <li key={t.who}><b>{t.who}</b> {t.holds}</li>)}</ul>
            </details>
            <label className="fd-radio ap-accept">
              <input type="checkbox" checked={form.accepted} onChange={(e) => set({ accepted: e.target.checked })} />
              {" I understand: Lyko signs for me up to these limits until I stop it or revoke the session."}
            </label>
            {err("accepted") ? <p className="m-note m-note--bad">{err("accepted")}</p> : null}
          </div>
        ) : null}

        {phase === "sign" && made ? (
          <div className="fd-newleash__body">
            <ul className="ap-notes">{made.notes.map((n) => <li key={n} className="m-small">{n}</li>)}</ul>
            <div className="fd-newleash__sign">
              {signed ? (
                <p className="m-note"><b>{"Signed."}</b>{` Autopilot goes on as soon as Arc includes ${signed.slice(0, 10)}…`}</p>
              ) : (
                <>
                  <p className="m-small">{`${made.transactions.length} transaction${made.transactions.length === 1 ? "" : "s"} to sign in your wallet: ${made.transactions.map((x) => x.label).join("; ")}.`}</p>
                  <Button onClick={() => void sign()} disabled={session.busy}>{session.busy ? "WAITING FOR YOUR WALLET…" : session.connected ? "SIGN ONCE" : "CONNECT TO SIGN"}</Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="fd-newleash__foot">
          {phase === "limits" ? <Button tone="ghost" onClick={onClose}>{"CANCEL"}</Button> : null}
          {phase === "read" ? <Button tone="ghost" onClick={() => setPhase("limits")}>{"BACK"}</Button> : null}
          {phase === "limits" ? <Button tone="sea" onClick={next}>{"NEXT"}</Button> : null}
          {phase === "read" ? <Button tone="sea" onClick={() => void turnOn()} disabled={busy}>{busy ? "MAKING IT…" : "TURN ON"}</Button> : null}
          {phase === "sign" ? <Button tone="ghost" onClick={onClose}>{signed ? "DONE" : "LATER"}</Button> : null}
        </div>
      </div>
    </Sheet>,
    document.body,
  );
}
