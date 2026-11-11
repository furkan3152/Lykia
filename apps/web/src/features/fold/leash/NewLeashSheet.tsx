/**
 * New leash: who, spend from, limits, review, then the keys. A bottom
 * sheet on phones and a stone panel on wider screens (the Fold's sheet).
 *
 *   Who      the agent's name, the template, and its session key (made in
 *            this browser and shown once, or the agent's own address)
 *   From     Arc wallet (the owner's LykiaAccount) or Gateway balance (the
 *            owner's Circle Gateway USDC through their own LykiaStile), with
 *            the balance per chain and the chains the leash may pay on
 *   Limits   per day, per step, how many days, and the payees or venues
 *   Review   what the chain holds and what the API holds, then create
 *   Keys     the leash key, the MCP config and the session key, shown once
 *            with copy buttons; then the owner signs the session once
 *
 * The leash is created before the wallet opens, so the key is never lost to
 * a rejected signature: it stays pending until the session lands.
 */
import { LEASH_ENFORCEMENT, LEASH_GATEWAY_ENFORCEMENT, LEASH_TEMPLATES, type LeashDraft } from "@lykia/core";
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
import { useGatewayBalance, useGatewayOffer } from "./data";
import { budgetOf, chainName, SAMPLE_GATEWAY_BALANCE, emptyForm, formFromDraft, formIssues, GATEWAY_CEILINGS, gatewayOptionOf, LEASH_STEPS, leashSentence, LIMIT_PRESETS, recipientsOf, requestOf, SHEET_TEMPLATES, toggleDestination, usdText, withSpendFrom, withTemplate, type LeashForm, type LeashStep } from "./model";
import { LYKIA_TERMS } from "@lykia/core";
import { intlLocale, t as msg } from "../../../i18n";

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
          () => toast.error(msg("fold.leash.newLeashSheet.copyDidNotWorkSelectThe"), { from: "LYKO" }),
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

export function NewLeashSheet({ open, owner, draft, spendFrom, onClose, onCreated }: { readonly open: boolean; readonly owner: FoldOwner; readonly draft: LeashDraft | null; readonly spendFrom?: "arc" | "gateway"; readonly onClose: () => void; readonly onCreated: (l: LeashView) => void }) {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const [phase, setPhase] = useState<Phase>("who");
  // Ask Lyko drafts the leash; this sheet is its review step (the Stile option arrives as spendFrom "gateway").
  const [form, setForm] = useState<LeashForm>(() => {
    const base = draft ? formFromDraft(draft) : emptyForm();
    return spendFrom ? withSpendFrom(base, spendFrom) : base;
  });
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
  const offer = useGatewayOffer();
  const gateway = gatewayOptionOf(offer.data, owner.environment);
  const onGateway = form.spendFrom === "gateway";
  const balance = useGatewayBalance(owner.address, owner.environment, onGateway && !owner.sample);
  const shownBalance = owner.sample ? SAMPLE_GATEWAY_BALANCE : balance.data;

  const next = () => {
    setTouched(true);
    if (issues.length > 0) return;
    setTouched(false);
    setPhase(step === "who" ? "from" : step === "from" ? "limits" : "review");
  };

  const create = async () => {
    setTouched(true);
    if (formIssues(form, "review", owner.address).length > 0) return;
    if (owner.sample || !owner.address || !owner.signedIn) {
      toast.info(owner.sample ? msg("fold.leash.newLeashSheet.connectAWalletToMakeA") : msg("fold.leash.newLeashSheet.signInAsTheOwnerFirst"), { from: "LYKO" });
      return;
    }
    setBusy(true);
    try {
      if (onGateway && !gateway.available) {
        toast.info(msg("fold.leash.newLeashSheet.spendingFromAGatewayBalanceIs"), { description: msg("fold.leash.newLeashSheet.pickArcWalletForNow"), from: "LYKO" });
        return;
      }
      // The session key is made here and never leaves this browser; only its address goes to Lykia.
      const key = form.keyMode === "generate" ? generatePrivateKey() : null;
      const signer = key ? privateKeyToAccount(key).address : form.signer.trim();
      const r = await apiPost<CreateLeashResponse>("/v1/leashes", requestOf(form, { owner: owner.address, environment: owner.environment, signer, now: Date.now() }), { timeoutMs: 45_000 });
      setCreated({ ...r, sessionKey: key });
      setPhase("keys");
      onCreated(r.leash);
    } catch (e) {
      toast.error(msg("fold.leash.newLeashSheet.theLeashWasNotMade"), { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    if (!created) return;
    if (!wallet.connected) return openModal();
    setBusy(true);
    try {
      // A Gateway leash may first create the owner's LykiaStile (a creation, no `to`), then the calls, in order.
      const creation = created.stile?.deployment;
      const hashes = await wallet.send([...(creation ? [{ data: creation.data, value: creation.value, chainId: creation.chainId, label: creation.label }] : []), ...created.transactions.map((x) => ({ to: x.to, data: x.data, value: x.value, chainId: x.chainId }))]);
      const last = hashes[hashes.length - 1];
      setSigned(last ?? null);
      if (last) await apiPost(`/v1/leashes/${encodeURIComponent(created.leash.id)}/session`, { txHash: last }).catch(() => undefined);
      onCreated(created.leash);
      toast.success(msg("fold.leash.newLeashSheet.isOnItsLeash", { agentName: created.leash.agentName }), { description: last, from: "LYKO" });
    } catch (e) {
      toast.error(msg("fold.leash.newLeashSheet.notSigned"), { description: msg("fold.leash.newLeashSheet.theLeashWaitsForThisSignature", { describeError: describeError(e) }), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (created && phase === "keys" && !window.confirm(msg("fold.leash.newLeashSheet.theLeashKeyAndTheSession"))) return;
    onClose();
  };

  const enforcement = onGateway ? LEASH_GATEWAY_ENFORCEMENT : LEASH_ENFORCEMENT;
  const chain = enforcement.filter((e) => e.enforcedBy !== "api");
  const api = enforcement.filter((e) => e.enforcedBy === "api");
  const signCount = (created?.transactions.length ?? 0) + (created?.stile?.deployment ? 1 : 0);

  // Portalled to the body: the Fold's panels form their own stacking context, and the sheet must sit above the phone dock.
  return createPortal(
    <Sheet open={open} onClose={close} title={phase === "keys" ? msg("fold.leash.newLeashSheet.storeTheseNow") : msg("fold.leash.newLeashSheet.newLeash")}>
      <div className="fd-newleash">
        <div className="fd-newleash__top">
          <LeashMark scale={2} />
          <ol className="fd-stepper" aria-label={msg("fold.leash.newLeashSheet.stepOf5", { value: phase === "keys" ? 5 : at + 1 })}>
            {[...LEASH_STEPS, { id: "keys" as const, label: msg("fold.leash.newLeashSheet.keys") }].map((s, i) => (
              <li key={s.id} data-on={phase === "keys" ? true : i <= at} aria-current={(phase === "keys" ? "keys" : step) === s.id ? "step" : undefined}>
                <i />
                {s.label}
              </li>
            ))}
          </ol>
        </div>

        {phase === "who" ? (
          <div className="fd-newleash__body">
            <Field label={msg("fold.leash.newLeashSheet.theAgentSName")} error={err("name")}>
              <Input value={form.name} maxLength={48} placeholder={msg("fold.leash.newLeashSheet.invoiceBot")} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <fieldset className="fd-newleash__templates">
              <legend className="m-kick">{msg("fold.leash.newLeashSheet.whatItMayDo")}</legend>
              <p className="m-small m-muted p-leash-what">{`${LYKIA_TERMS.leash.word} · ${LYKIA_TERMS.leash.plain}. ${LYKIA_TERMS.leash.line}`}</p>
              {SHEET_TEMPLATES.map((k) => (
                <label key={k} className={cx("fd-tpl m-frame m-frame--thin", form.template === k && "is-on")}>
                  <input type="radio" name="leash-template" value={k} checked={form.template === k} onChange={() => setForm((f) => withTemplate(f, k))} />
                  <b>{LEASH_TEMPLATES[k].title}</b>
                  <span className="m-small">{LEASH_TEMPLATES[k].summary}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="fd-newleash__key">
              <legend className="m-kick">{msg("fold.leash.newLeashSheet.itsOwnKey")}</legend>
              <label className="fd-radio"><input type="radio" name="leash-key" checked={form.keyMode === "generate"} onChange={() => set({ keyMode: "generate" })} /> {msg("fold.leash.newLeashSheet.makeOneInThisBrowserShown")}</label>
              <label className="fd-radio"><input type="radio" name="leash-key" checked={form.keyMode === "own"} onChange={() => set({ keyMode: "own" })} /> {msg("fold.leash.newLeashSheet.theAgentAlreadyHasOneUse")}</label>
              {form.keyMode === "own" ? (
                <Field label={msg("fold.leash.newLeashSheet.agentAddress")} error={err("signer")}>
                  <Input value={form.signer} placeholder="0x…" spellCheck={false} onChange={(e) => set({ signer: e.target.value })} />
                </Field>
              ) : null}
            </fieldset>
            <Field label={msg("fold.leash.newLeashSheet.missionOptional")}>
              <textarea className="m-textarea" maxLength={400} value={form.mission} placeholder={msg("fold.leash.newLeashSheet.payTheHostingAndDataInvoices")} onChange={(e) => set({ mission: e.target.value })} />
            </Field>
          </div>
        ) : null}

        {phase === "from" ? (
          <div className="fd-newleash__body">
            <fieldset className="fd-newleash__templates">
              <legend className="m-kick">{msg("fold.leash.newLeashSheet.spendFrom")}</legend>
              <label className={cx("fd-tpl m-frame m-frame--thin", !onGateway && "is-on")}>
                <input type="radio" name="leash-from" value="arc" checked={!onGateway} onChange={() => setForm((f) => withSpendFrom(f, "arc"))} />
                <b>{msg("fold.leash.newLeashSheet.arcWallet")}</b>
                <span className="m-small">{msg("fold.leash.newLeashSheet.yourLykiaaccountOnArcHoldsThe")}</span>
              </label>
              <label className={cx("fd-tpl m-frame m-frame--thin", onGateway && "is-on", !gateway.available && "is-off")} aria-disabled={!gateway.available}>
                <input type="radio" name="leash-from" value="gateway" checked={onGateway} disabled={!gateway.available} onChange={() => setForm((f) => withSpendFrom(f, "gateway"))} />
                <b>{msg("fold.leash.newLeashSheet.gatewayBalance")} {gateway.available ? null : <Tag tone="ghost">{msg("fold.leash.newLeashSheet.comingSoon")}</Tag>}</b>
                <span className="m-small">{msg("fold.leash.newLeashSheet.yourCircleGatewayUsdcThroughYour", { usdText: usdText(GATEWAY_CEILINGS.perStepUsd), usdText2: usdText(GATEWAY_CEILINGS.perDayUsd) })}</span>
              </label>
            </fieldset>
            {onGateway ? (
              <>
                <div className="fd-gwbal m-frame m-frame--thin" aria-live="polite">
                  <span className="m-kick">{owner.sample ? msg("fold.leash.newLeashSheet.sampleGatewayBalance") : msg("fold.leash.newLeashSheet.yourGatewayBalance")}</span>
                  {balance.isLoading && !owner.sample ? (
                    <div className="m-skel" style={{ height: 44 }} />
                  ) : shownBalance ? (
                    <ul className="fd-gwbal__rows">
                      {(shownBalance.perChain ?? []).filter((r) => Number(r.balance) > 0 || r.chain === "Arc").map((r) => (
                        <li key={r.chain} data-arc={r.chain === "Arc"}>
                          <span>{r.chain}</span>
                          <b className="num">{`${Number(r.balance).toLocaleString(intlLocale(), { maximumFractionDigits: 2 })} USDC`}</b>
                        </li>
                      ))}
                      <li className="fd-gwbal__total"><span>{msg("fold.leash.newLeashSheet.total")}</span><b className="num">{`${Number(shownBalance.total ?? 0).toLocaleString(intlLocale(), { maximumFractionDigits: 2 })} USDC`}</b></li>
                    </ul>
                  ) : (
                    <p className="m-small m-muted">{msg("fold.leash.newLeashSheet.circleSGatewayApiDidNot")}</p>
                  )}
                  <p className="m-small m-muted">{msg("fold.leash.newLeashSheet.theAgentSpendsThePartDeposited")}</p>
                </div>
                <fieldset className="fd-newleash__venues">
                  <legend className="m-kick">{msg("fold.leash.newLeashSheet.itMayPayOn")}</legend>
                  <div className="fd-suggest">
                    {gateway.destinations.map((d) => {
                      const on = form.destinations.includes(d.key);
                      return (
                        <button key={d.key} type="button" className={cx("m-chip", on && "is-on")} aria-pressed={on} onClick={() => setForm((f) => toggleDestination(f, d.key))}>
                          {on ? "✓ " : ""}{d.name}
                        </button>
                      );
                    })}
                  </div>
                  {err("destinations") ? <p className="m-note m-note--bad">{err("destinations")}</p> : null}
                  <p className="m-small m-muted">{msg("fold.leash.newLeashSheet.lykiaS1FeeIsA")}</p>
                </fieldset>
              </>
            ) : null}
          </div>
        ) : null}

        {phase === "limits" ? (
          <div className="fd-newleash__body">
            <div className="p-leash-presets" role="group" aria-label={msg("fold.leash.newLeashSheet.quickLimits")}>
              <span className="m-kick">{msg("fold.leash.newLeashSheet.pickASizeOrTypeYour")}</span>
              <div>
                {LIMIT_PRESETS.filter((x) => !onGateway || Number(x.perDayUsd) <= Number(GATEWAY_CEILINGS.perDayUsd)).map((x) => {
                  const on = form.perDayUsd === x.perDayUsd && form.perStepUsd === x.perStepUsd && form.days === x.days;
                  return (
                    <button key={x.label} type="button" className={cx("p-preset", on && "is-on")} aria-pressed={on} onClick={() => set({ perDayUsd: x.perDayUsd, perStepUsd: x.perStepUsd, days: x.days })}>
                      <b>{x.label}</b>
                      <span>{x.line}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fd-newleash__money">
              <Field label={msg("fold.leash.newLeashSheet.perDay")} error={err("perDayUsd")} hint={onGateway ? msg("fold.leash.newLeashSheet.theMostItCanSpendIn", { usdText: usdText(GATEWAY_CEILINGS.perDayUsd) }) : msg("fold.leash.newLeashSheet.theMostItCanSpendIn2")}>
                <Input inputMode="decimal" value={form.perDayUsd} onChange={(e) => set({ perDayUsd: e.target.value })} />
              </Field>
              <Field label={msg("fold.leash.newLeashSheet.perStep")} error={err("perStepUsd")} hint={msg("fold.leash.newLeashSheet.theMostItCanMoveIn")}>
                <Input inputMode="decimal" value={form.perStepUsd} onChange={(e) => set({ perStepUsd: e.target.value })} />
              </Field>
              <Field label={msg("fold.leash.newLeashSheet.days")} error={err("days")} hint={msg("fold.leash.newLeashSheet.afterThisManyDaysItsKey")}>
                <Input inputMode="numeric" value={form.days} onChange={(e) => set({ days: e.target.value })} />
              </Field>
            </div>
            <p className="fd-newleash__total">
              {budget.totalUsd ? <>{msg("fold.leash.newLeashSheet.inTotalAtMost")}<b className="num">{usdText(budget.totalUsd)}</b>{msg("fold.leash.newLeashSheet.overDays", { n: Number(form.days) })}</> : msg("fold.leash.newLeashSheet.fillInTheDailyCapAnd")}
            </p>
            {t.recipients === "allowlist" ? (
              <Field label={msg("fold.leash.newLeashSheet.whoItMayPay")} error={err("recipients")} hint={msg("fold.leash.newLeashSheet.oneAddressPerLineItCan")}>
                <textarea className="m-textarea" spellCheck={false} value={form.recipients} placeholder={"0x…\n0x…"} onChange={(e) => set({ recipients: e.target.value })} />
              </Field>
            ) : (
              <fieldset className="fd-newleash__venues">
                <legend className="m-kick">{msg("fold.leash.newLeashSheet.venues")}</legend>
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
                <p className="m-small m-muted">{form.template === "trade-small" ? msg("fold.leash.newLeashSheet.onlyDexsWhoseOutputYourAccount", { value: t.maxSlippageBps / 100 }) : msg("fold.leash.newLeashSheet.depositsAndWithdrawalsStayInYour")}</p>
              </fieldset>
            )}
          </div>
        ) : null}

        {phase === "review" ? (
          <div className="fd-newleash__body">
            <p className="p-leash-sentence" data-testid="leash-sentence">{leashSentence(form, recipientsOf(form).length)}</p>
            <dl className="fd-newleash__summary">
              <div><dt>{msg("fold.leash.newLeashSheet.agent")}</dt><dd>{form.name}</dd></div>
              <div><dt>{msg("fold.leash.newLeashSheet.may")}</dt><dd>{t.title}</dd></div>
              <div><dt>{msg("fold.leash.newLeashSheet.spendsFrom")}</dt><dd>{onGateway ? msg("fold.leash.newLeashSheet.gatewayBalanceArcDeposit") : msg("fold.leash.newLeashSheet.arcWallet")}</dd></div>
              {onGateway ? <div><dt>{msg("fold.leash.newLeashSheet.paysOn")}</dt><dd>{form.destinations.map((d) => chainName(d, offer.data)).join(", ")}</dd></div> : null}
              <div><dt>{msg("fold.leash.newLeashSheet.budget")}</dt><dd className="num">{msg("fold.leash.newLeashSheet.budgetLine", { step: usdText(budget.perStepUsd), day: usdText(budget.perDayUsd), total: budget.totalUsd ? usdText(budget.totalUsd) : "?" })}</dd></div>
              <div><dt>{msg("fold.leash.newLeashSheet.until")}</dt><dd className="num">{new Date(openedAt + Number(form.days) * 86_400_000).toLocaleDateString(intlLocale(), { day: "numeric", month: "short", year: "numeric" })}</dd></div>
              <div><dt>{t.recipients === "allowlist" ? msg("fold.leash.newLeashSheet.payees") : msg("fold.leash.newLeashSheet.venues")}</dt><dd>{t.recipients === "allowlist" ? recipientsOf(form).map((r) => `${r.slice(0, 6)}…${r.slice(-4)}`).join(", ") : form.venues.join(", ")}</dd></div>
              <div><dt>{msg("fold.leash.newLeashSheet.key")}</dt><dd>{form.keyMode === "generate" ? msg("fold.leash.newLeashSheet.madeInThisBrowser") : `${form.signer.slice(0, 8)}…`}</dd></div>
            </dl>
            <details className="p-tech">
            <summary className="m-small">{msg("fold.leash.newLeashSheet.whoEnforcesEachLimit")}</summary>
            <div className="fd-newleash__split">
              <div>
                <span className="m-kick">{onGateway ? msg("fold.leash.newLeashSheet.yourLykiastileHolds") : msg("fold.leash.newLeashSheet.yourLykiaaccountHolds")}</span>
                <ul>{chain.map((e) => <li key={e.limit}><b>{e.limit}</b> {e.enforcedBy === "both" ? <Tag tone="sea">{msg("fold.leash.newLeashSheet.chainApi")}</Tag> : <Tag tone="ok">{msg("fold.leash.newLeashSheet.chain")}</Tag>}</li>)}</ul>
              </div>
              <div>
                <span className="m-kick">{msg("fold.leash.newLeashSheet.lykiaSApiHolds")}</span>
                <ul>{api.map((e) => <li key={e.limit}><b>{e.limit}</b> <Tag tone="ochre">API</Tag></li>)}</ul>
              </div>
            </div>
            </details>
            <p className="m-small m-muted">
              {onGateway
                ? msg("fold.leash.newLeashSheet.gatewayChecksEveryTransferByAsking")
                : msg("fold.leash.newLeashSheet.onChainTheCapsAreToken")}
            </p>
          </div>
        ) : null}

        {phase === "keys" && created ? (
          <div className="fd-newleash__body">
            <div className="m-note fd-newleash__store">
              <b>{msg("fold.leash.newLeashSheet.storeTheseNowTheyAreNot")}</b>
              <span className="m-small">{msg("fold.leash.newLeashSheet.theLeashKeyWorksForS", { agentName: created.leash.agentName })}</span>
            </div>
            <Secret title={msg("fold.leash.newLeashSheet.leashKey")} value={created.apiKey.secret} hint={msg("fold.leash.newLeashSheet.giveItToTheAgentAs")} />
            {created.sessionKey ? <Secret title={msg("fold.leash.newLeashSheet.sessionKeyPrivate")} value={created.sessionKey} hint={msg("fold.leash.newLeashSheet.theAgentSignsWithItIts", { address: privateKeyToAccount(created.sessionKey as `0x${string}`).address })} /> : null}
            <Secret title={msg("fold.leash.newLeashSheet.mcpConfig")} value={JSON.stringify(created.mcp, null, 2)} hint={msg("fold.leash.newLeashSheet.pasteIntoAnyMcpClientIt")} />
            <div className="fd-newleash__sign">
              {signed ? (
                <p className="m-note"><b>{msg("fold.leash.newLeashSheet.signed")}</b>{msg("fold.leash.newLeashSheet.theSessionGoesLiveAsSoon", { signed: signed.slice(0, 10) })}</p>
              ) : (
                <>
                  <p className="m-small">{msg("fold.leash.newLeashSheet.transactionsInOrder", { n: signCount, list: [...(created.stile?.deployment ? [created.stile.deployment.label] : []), ...created.transactions.map((x) => x.label)].join("; ") })}</p>
                  <Button onClick={() => void sign()} disabled={busy}>{busy ? msg("fold.leash.newLeashSheet.waitingForYourWallet") : wallet.connected ? msg("fold.leash.newLeashSheet.signOnce") : msg("fold.leash.newLeashSheet.connectToSign")}</Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="fd-newleash__foot">
          {phase === "who" ? <Button tone="ghost" onClick={close}>{msg("fold.leash.newLeashSheet.cancel")}</Button> : null}
          {phase === "from" ? <Button tone="ghost" onClick={() => setPhase("who")}>{msg("fold.leash.newLeashSheet.back")}</Button> : null}
          {phase === "limits" ? <Button tone="ghost" onClick={() => setPhase("from")}>{msg("fold.leash.newLeashSheet.back")}</Button> : null}
          {phase === "review" ? <Button tone="ghost" onClick={() => setPhase("limits")}>{msg("fold.leash.newLeashSheet.back")}</Button> : null}
          {phase === "who" || phase === "from" || phase === "limits" ? <Button tone="sea" onClick={next}>{msg("fold.leash.newLeashSheet.next")}</Button> : null}
          {phase === "review" ? (
            <Button tone="sea" onClick={() => void create()} disabled={busy}>{busy ? msg("fold.leash.newLeashSheet.makingIt") : owner.sample ? msg("fold.leash.newLeashSheet.connectToCreate") : "CREATE THE LEASH"}</Button>
          ) : null}
          {phase === "keys" ? <Button tone="ghost" onClick={close}>{msg("fold.leash.newLeashSheet.iStoredThem")}</Button> : null}
        </div>
      </div>
    </Sheet>,
    document.body,
  );
}
