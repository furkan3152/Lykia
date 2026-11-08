/**
 * New leash: who, limits, review, then the keys. A bottom sheet on phones
 * and a stone panel on wider screens (the Fold's sheet).
 *
 *   Who      the agent's name, the template, and its session key (made in
 *            this browser and shown once, or the agent's own address)
 *   Limits   per day, per step, how many days, and the payees or venues
 *   Review   what the chain holds and what the API holds, then create
 *   Keys     the leash key, the MCP config and the session key, shown once
 *            with copy buttons; then the owner signs the session once
 *
 * The leash is created before the wallet opens, so the key is never lost to
 * a rejected signature: it stays pending until the session lands.
 */
import { LEASH_ENFORCEMENT, LEASH_TEMPLATES, type LeashDraft } from "@lykia/core";
import type { CreateLeashResponse, LeashView } from "@lykia/core/api/leash";
import { useState } from "react";
import { createPortal } from "react-dom";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { Sheet } from "../../../city/Sheet";
import { apiPost, describeError } from "../../../lib/api";
import { Button, Field, Input, LeashMark, Tag, cx, toast } from "../../../mosaic";
import { useLykiaWallet } from "../../wallet/useLykiaWallet";
import { useWallet } from "../../wallet/store";
import type { FoldOwner } from "../data";
import { budgetOf, emptyForm, formFromDraft, formIssues, LEASH_STEPS, recipientsOf, requestOf, SHEET_TEMPLATES, usdText, withTemplate, type LeashForm, type LeashStep } from "./model";

type Phase = LeashStep | "keys";

function Copy({ value, label }: { readonly value: string; readonly label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      tone="ghost"
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true);
            toast.success(`${label} copied`, { from: "LYKO" });
          },
          () => toast.error("Copy did not work; select the text instead.", { from: "LYKO" }),
        )
      }
    >
      {done ? "COPIED" : "COPY"}
    </Button>
  );
}

function Secret({ title, value, hint }: { readonly title: string; readonly value: string; readonly hint: string }) {
  return (
    <div className="fd-leashkey">
      <div className="fd-leashkey__head">
        <span className="m-kick">{title}</span>
        <Copy value={value} label={title.toLowerCase()} />
      </div>
      <pre className="m-code fd-leashkey__value">{value}</pre>
      <p className="m-small m-muted">{hint}</p>
    </div>
  );
}

export function NewLeashSheet({ open, owner, draft, onClose, onCreated }: { readonly open: boolean; readonly owner: FoldOwner; readonly draft: LeashDraft | null; readonly onClose: () => void; readonly onCreated: (l: LeashView) => void }) {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const [phase, setPhase] = useState<Phase>("who");
  const [form, setForm] = useState<LeashForm>(() => (draft ? formFromDraft(draft) : emptyForm()));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<(CreateLeashResponse & { readonly sessionKey: string | null }) | null>(null);
  const [signed, setSigned] = useState<string | null>(null);

  // The sheet mounts fresh each time it opens (the section keys it), so its state starts clean.
  const [openedAt] = useState(() => Date.now());

  const step = phase === "keys" ? "review" : phase;
  const issues = formIssues(form, step, owner.address);
  const at = LEASH_STEPS.findIndex((s) => s.id === step);
  const err = (field: keyof LeashForm) => (touched ? issues.find((i) => i.field === field)?.message ?? null : null);
  const t = LEASH_TEMPLATES[form.template];
  const budget = budgetOf(form);
  const set = (patch: Partial<LeashForm>) => setForm((f) => ({ ...f, ...patch }));

  const next = () => {
    setTouched(true);
    if (issues.length > 0) return;
    setTouched(false);
    setPhase(step === "who" ? "limits" : "review");
  };

  const create = async () => {
    setTouched(true);
    if (formIssues(form, "review", owner.address).length > 0) return;
    if (owner.sample || !owner.address || !owner.signedIn) {
      toast.info(owner.sample ? "Connect a wallet to make a real leash" : "Sign in as the owner first", { from: "LYKO" });
      return;
    }
    setBusy(true);
    try {
      // The session key is made here and never leaves this browser; only its address goes to Lykia.
      const key = form.keyMode === "generate" ? generatePrivateKey() : null;
      const signer = key ? privateKeyToAccount(key).address : form.signer.trim();
      const r = await apiPost<CreateLeashResponse>("/v1/leashes", requestOf(form, { owner: owner.address, environment: owner.environment, signer, now: Date.now() }), { timeoutMs: 45_000 });
      setCreated({ ...r, sessionKey: key });
      setPhase("keys");
      onCreated(r.leash);
    } catch (e) {
      toast.error("The leash was not made", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    if (!created) return;
    if (!wallet.connected) return openModal();
    setBusy(true);
    try {
      const hashes = await wallet.send(created.transactions.map((x) => ({ to: x.to, data: x.data, value: x.value, chainId: x.chainId })));
      const last = hashes[hashes.length - 1];
      setSigned(last ?? null);
      if (last) await apiPost(`/v1/leashes/${encodeURIComponent(created.leash.id)}/session`, { txHash: last }).catch(() => undefined);
      onCreated(created.leash);
      toast.success(`${created.leash.agentName} is on its leash`, { description: last, from: "LYKO" });
    } catch (e) {
      toast.error("Not signed", { description: `${describeError(e)} The leash waits for this signature; its key works once the session lands.`, from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (created && phase === "keys" && !window.confirm("The leash key and the session key are not shown again. Did you store them?")) return;
    onClose();
  };

  const chain = LEASH_ENFORCEMENT.filter((e) => e.enforcedBy !== "api");
  const api = LEASH_ENFORCEMENT.filter((e) => e.enforcedBy === "api");

  // Portalled to the body: the Fold's panels form their own stacking context, and the sheet must sit above the phone dock.
  return createPortal(
    <Sheet open={open} onClose={close} title={phase === "keys" ? "Store these now" : "New leash"}>
      <div className="fd-newleash">
        <div className="fd-newleash__top">
          <LeashMark scale={2} />
          <ol className="fd-stepper" aria-label={`Step ${phase === "keys" ? 4 : at + 1} of 4`}>
            {[...LEASH_STEPS, { id: "keys" as const, label: "Keys" }].map((s, i) => (
              <li key={s.id} data-on={phase === "keys" ? true : i <= at} aria-current={(phase === "keys" ? "keys" : step) === s.id ? "step" : undefined}>
                <i />
                {s.label}
              </li>
            ))}
          </ol>
        </div>

        {phase === "who" ? (
          <div className="fd-newleash__body">
            <Field label="The agent's name" error={err("name")}>
              <Input value={form.name} maxLength={48} placeholder="Invoice bot" onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <fieldset className="fd-newleash__templates">
              <legend className="m-kick">{"What it may do"}</legend>
              {SHEET_TEMPLATES.map((k) => (
                <label key={k} className={cx("fd-tpl m-frame m-frame--thin", form.template === k && "is-on")}>
                  <input type="radio" name="leash-template" value={k} checked={form.template === k} onChange={() => setForm((f) => withTemplate(f, k))} />
                  <b>{LEASH_TEMPLATES[k].title}</b>
                  <span className="m-small">{LEASH_TEMPLATES[k].summary}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="fd-newleash__key">
              <legend className="m-kick">{"Its own key"}</legend>
              <label className="fd-radio"><input type="radio" name="leash-key" checked={form.keyMode === "generate"} onChange={() => set({ keyMode: "generate" })} /> {"Make one in this browser (shown once, never sent to Lykia)"}</label>
              <label className="fd-radio"><input type="radio" name="leash-key" checked={form.keyMode === "own"} onChange={() => set({ keyMode: "own" })} /> {"The agent already has one: use its address"}</label>
              {form.keyMode === "own" ? (
                <Field label="Agent address" error={err("signer")}>
                  <Input value={form.signer} placeholder="0x…" spellCheck={false} onChange={(e) => set({ signer: e.target.value })} />
                </Field>
              ) : null}
            </fieldset>
            <Field label="Mission (optional)">
              <textarea className="m-textarea" maxLength={400} value={form.mission} placeholder="Pay the hosting and data invoices as they come in." onChange={(e) => set({ mission: e.target.value })} />
            </Field>
          </div>
        ) : null}

        {phase === "limits" ? (
          <div className="fd-newleash__body">
            <div className="fd-newleash__money">
              <Field label="Per day $" error={err("perDayUsd")}>
                <Input inputMode="decimal" value={form.perDayUsd} onChange={(e) => set({ perDayUsd: e.target.value })} />
              </Field>
              <Field label="Per step $" error={err("perStepUsd")} hint="at most the daily cap">
                <Input inputMode="decimal" value={form.perStepUsd} onChange={(e) => set({ perStepUsd: e.target.value })} />
              </Field>
              <Field label="Days" error={err("days")}>
                <Input inputMode="numeric" value={form.days} onChange={(e) => set({ days: e.target.value })} />
              </Field>
            </div>
            <p className="fd-newleash__total">
              {budget.totalUsd ? <>{"In total at most "}<b className="num">{usdText(budget.totalUsd)}</b>{` over ${form.days} day${form.days === "1" ? "" : "s"}. Lykia's 1% fee counts toward the caps.`}</> : "Fill in the daily cap and the days."}
            </p>
            {t.recipients === "allowlist" ? (
              <Field label="Payees" error={err("recipients")} hint="one address per line; the agent can pay these and you, nobody else">
                <textarea className="m-textarea" spellCheck={false} value={form.recipients} placeholder={"0x…\n0x…"} onChange={(e) => set({ recipients: e.target.value })} />
              </Field>
            ) : (
              <fieldset className="fd-newleash__venues">
                <legend className="m-kick">{"Venues"}</legend>
                <div className="fd-suggest">
                  {(t.venues ?? []).map((v) => {
                    const on = form.venues.includes(v);
                    return (
                      <button key={v} type="button" className={cx("m-chip", on && "is-on")} aria-pressed={on} onClick={() => set({ venues: on ? form.venues.filter((x) => x !== v) : [...form.venues, v] })}>
                        {on ? "✓ " : ""}{v}
                      </button>
                    );
                  })}
                </div>
                {err("venues") ? <p className="m-note m-note--bad">{err("venues")}</p> : null}
                <p className="m-small m-muted">{form.template === "trade-small" ? `Only DEXs whose output your account can pin to itself. Slippage at most ${t.maxSlippageBps / 100}%.` : "Deposits and withdrawals stay in your account."}</p>
              </fieldset>
            )}
          </div>
        ) : null}

        {phase === "review" ? (
          <div className="fd-newleash__body">
            <dl className="fd-newleash__summary">
              <div><dt>{"Agent"}</dt><dd>{form.name}</dd></div>
              <div><dt>{"May"}</dt><dd>{t.title}</dd></div>
              <div><dt>{"Budget"}</dt><dd className="num">{`${usdText(budget.perStepUsd)} a step · ${usdText(budget.perDayUsd)} a day · ${budget.totalUsd ? usdText(budget.totalUsd) : "?"} in total`}</dd></div>
              <div><dt>{"Until"}</dt><dd className="num">{new Date(openedAt + Number(form.days) * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</dd></div>
              <div><dt>{t.recipients === "allowlist" ? "Payees" : "Venues"}</dt><dd>{t.recipients === "allowlist" ? recipientsOf(form).map((r) => `${r.slice(0, 6)}…${r.slice(-4)}`).join(", ") : form.venues.join(", ")}</dd></div>
              <div><dt>{"Key"}</dt><dd>{form.keyMode === "generate" ? "made in this browser" : `${form.signer.slice(0, 8)}…`}</dd></div>
            </dl>
            <div className="fd-newleash__split">
              <div>
                <span className="m-kick">{"YOUR LYKIAACCOUNT HOLDS"}</span>
                <ul>{chain.map((e) => <li key={e.limit}><b>{e.limit}</b> {e.enforcedBy === "both" ? <Tag tone="sea">CHAIN + API</Tag> : <Tag tone="ok">CHAIN</Tag>}</li>)}</ul>
              </div>
              <div>
                <span className="m-kick">{"LYKIA'S API HOLDS"}</span>
                <ul>{api.map((e) => <li key={e.limit}><b>{e.limit}</b> <Tag tone="ochre">API</Tag></li>)}</ul>
              </div>
            </div>
            <p className="m-small m-muted">{"On chain the caps are token units (USDC 1:1, EURC at today's reference rate); dollar caps, venues and slippage are checked by Lykia before anything is prepared. You sign one transaction on your LykiaAccount (two if the account does not exist yet)."}</p>
          </div>
        ) : null}

        {phase === "keys" && created ? (
          <div className="fd-newleash__body">
            <div className="m-note fd-newleash__store">
              <b>{"Store these now. They are not shown again."}</b>
              <span className="m-small">{`The leash key works for ${created.leash.agentName}'s leash only and stops the moment you revoke it.`}</span>
            </div>
            <Secret title="LEASH KEY" value={created.apiKey.secret} hint="Give it to the agent as Lykia-Key. It can plan and submit inside this leash, nothing else." />
            {created.sessionKey ? <Secret title="SESSION KEY (PRIVATE)" value={created.sessionKey} hint={`The agent signs with it. Its address, ${privateKeyToAccount(created.sessionKey as `0x${string}`).address}, is the only part Lykia knows.`} /> : null}
            <Secret title="MCP CONFIG" value={JSON.stringify(created.mcp, null, 2)} hint="Paste into any MCP client: it sees only this leash's tools." />
            <div className="fd-newleash__sign">
              {signed ? (
                <p className="m-note"><b>{"Signed."}</b>{` The session goes live as soon as Arc includes ${signed.slice(0, 10)}…`}</p>
              ) : (
                <>
                  <p className="m-small">{`${created.transactions.length} transaction${created.transactions.length === 1 ? "" : "s"} to sign in your wallet: ${created.transactions.map((x) => x.label).join("; ")}.`}</p>
                  <Button onClick={() => void sign()} disabled={busy}>{busy ? "WAITING FOR YOUR WALLET…" : wallet.connected ? "SIGN ONCE" : "CONNECT TO SIGN"}</Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="fd-newleash__foot">
          {phase === "who" ? <Button tone="ghost" onClick={close}>{"CANCEL"}</Button> : null}
          {phase === "limits" ? <Button tone="ghost" onClick={() => setPhase("who")}>{"BACK"}</Button> : null}
          {phase === "review" ? <Button tone="ghost" onClick={() => setPhase("limits")}>{"BACK"}</Button> : null}
          {phase === "who" || phase === "limits" ? <Button tone="sea" onClick={next}>{"NEXT"}</Button> : null}
          {phase === "review" ? (
            <Button tone="sea" onClick={() => void create()} disabled={busy}>{busy ? "MAKING IT…" : owner.sample ? "CONNECT TO CREATE" : "CREATE THE LEASH"}</Button>
          ) : null}
          {phase === "keys" ? <Button tone="ghost" onClick={close}>{"I STORED THEM"}</Button> : null}
        </div>
      </div>
    </Sheet>,
    document.body,
  );
}
