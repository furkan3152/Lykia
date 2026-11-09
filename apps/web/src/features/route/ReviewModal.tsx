/**
 * Review and sign, as a modal over the conversation. It lays itself like a
 * mosaic (tesserae settle into the frame, then each section is set in
 * place; reduced motion skips straight to the finished panel), loads a
 * fresh quote for the next step as it opens, and walks one step through
 * the owner's wallet: quote, refreshed quote, waiting for the wallet,
 * submitted, settled with its seal and transaction, or failed with the
 * reason in plain words and the one retry that fits.
 *
 * `ReviewDialog` only draws (the kit page renders every state from
 * fixtures); `ReviewModal` wires it to the intent and the wallet.
 */
import type { AgentProposal } from "@lykia/core/api/agents";
import type { SecurityReport } from "@lykia/core/security/index";
import { MEANINGS, networkFor, preflightGate, quoteAgeFinding, walletNetworkFinding, type ArcEnvironment, type Finding, type FindingFix } from "@lykia/core";
import React, { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";

import { usePulse } from "../../lib/pulseStore";
import { Seal, Skeleton, Tag, cx } from "../../mosaic";
import { Mark } from "../../mosaic/PixelArt";
import { HashChip } from "../ask/Markdown";
import { BetaRibbon } from "../ecosystem/BetaRibbon";
import { Hint, HowItWorks } from "../help/Help";
import { balanceLines, decisionLabel, decisionTone, severityTone, visibleFindings } from "../security/model";
import { bpsLabel, reviewView, type ReviewView } from "./reviewModel";
import type { TxFailure } from "./txErrors";
import { useIntent } from "./useIntent";
import { useReviewFlow, type ReviewPhase } from "./useReviewFlow";
import { STAGE_START, stageHeadline, stageReduce, type StageState } from "./stagedFlow";
import { PreflightPanel } from "./Preflight";
import { usePreflightAcks } from "./preflightModel";
import { runFix } from "./preflightActions";

const TILE_COLS = 12;
const TILE_ROWS = 8;
const TILE_TONES = ["terra", "ochre", "sea", "cream", "navy", "cream", "olive", "cream"] as const;

export interface ReviewDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly view: ReviewView | null;
  readonly phase: ReviewPhase;
  readonly failure: TxFailure | null;
  readonly security: SecurityReport | null;
  readonly refreshes: number;
  /** When the current quote was built (ms), for "refreshed hh:mm:ss". */
  readonly quotedAt: number | null;
  readonly lastTx: `0x${string}` | null;
  readonly connected: boolean;
  readonly walletLabel: string | null;
  readonly confirmed: boolean;
  readonly onConfirm: (value: boolean) => void;
  readonly onSign: () => void;
  readonly onRetry: () => void;
  readonly onReplan?: () => void;
  readonly onConnect: () => void;
  /** Transactions in the prepared step (approvals included), when known. */
  readonly txCount: number | null;
  readonly transferCostUsd?: string | null;
  /** The staged plan's stage on screen (one signature per stage). */
  readonly stage?: StageState;
  /** "Stop here": stop every step not started yet. */
  readonly onStop?: () => void;
  /** "Before you sign": preflight's findings for the step on screen (server and wallet checks). */
  readonly preflight?: readonly Finding[];
  readonly preflightAcked?: boolean;
  readonly onPreflightAck?: (value: boolean) => void;
  readonly onFix?: (fix: FindingFix) => void;
}

/** Focus stays inside the dialog; Escape closes; focus returns where it came from. */
function useDialogFocus(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void, initial: React.RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => (initial.current ?? ref.current)?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      before?.focus?.();
    };
  }, [open, ref, initial]);
}

function phaseBanner(p: ReviewDialogProps): { tone: "sea" | "ochre" | "ok" | "bad" | "ghost"; text: string } | null {
  const v = p.view;
  if (!v) return { tone: "ghost", text: "Loading the plan…" };
  const st = p.stage;
  if (st?.mode === "paused" && st.pause) return { tone: "bad", text: `Paused at step ${st.stage} of ${st.total}. ${st.pause.reason} Done steps stay done.` };
  if (st && st.total > 1 && st.settled && (st.mode === "advancing" || p.phase === "quoting")) return { tone: "sea", text: `Step ${st.settled.n} settled${st.settled.received ? `: ${st.settled.received} arrived` : ""}. Rebuilding step ${st.stage} with exactly what arrived…` };
  if (v.stage === "denied") return { tone: "bad", text: "Your Fence refused this plan. Nothing can be signed." };
  if (v.stage === "dry-run") return { tone: "ghost", text: "Dry run: this plan is a preview for a sample address. Connect a wallet and plan again to sign." };
  switch (p.phase) {
    case "quoting":
      return { tone: "sea", text: p.refreshes > 0 || p.quotedAt ? "Refreshing the quote from Arc…" : "Loading a fresh quote from Arc…" };
    case "quoted":
      if (st && st.total > 1 && st.replanned) return { tone: "ok", text: `${st.replanned}. Checked against your Fence again; sign step ${st.stage} of ${st.total}.` };
      return { tone: "ok", text: `Quote refreshed${p.quotedAt ? ` at ${new Date(p.quotedAt).toLocaleTimeString("en-GB")}` : ""}: rebuilt from Arc just now, checked against your Fence. It is rebuilt again if you wait more than 30 seconds.` };
    case "switching":
      return { tone: "ochre", text: `Asking your wallet to switch to Arc ${v.environment}…` };
    case "signing":
      return { tone: "ochre", text: `Waiting for your wallet${p.walletLabel ? ` (${p.walletLabel})` : ""}: check the amounts there and confirm.${p.txCount && p.txCount > 1 ? ` ${p.txCount} transactions, one after another.` : ""}` };
    case "submitting":
      return { tone: "sea", text: "Sent. Lykia is checking the receipt on Arc…" };
    case "submitted":
      return { tone: "sea", text: "Submitted. This step settles off Arc; the plan updates on its own." };
    case "settled":
      return null;
    case "failed":
      return null;
    default:
      return v.stage === "settled" ? null : v.decision === "confirm" && !p.confirmed ? { tone: "ochre", text: "Your Fence asks you to confirm this plan before the quote is built." } : null;
  }
}

function primaryOf(p: ReviewDialogProps): { label: string; disabled: boolean; action: () => void } {
  const v = p.view;
  if (!v) return { label: "Sign with wallet", disabled: true, action: p.onSign };
  const gate = preflightGate(p.preflight, p.preflightAcked === true);
  const open = v.stage !== "settled" && v.stage !== "denied" && v.stage !== "dry-run" && v.settledCount === 0;
  if (open && gate.blocked) return { label: "Fix it first", disabled: true, action: p.onSign };
  if (open && gate.needsAck.length > 0 && p.phase !== "failed") return { label: "Tick the warnings first", disabled: true, action: p.onSign };
  if (v.stage === "denied") return { label: "Refused by your Fence", disabled: true, action: p.onSign };
  if (v.stage === "dry-run") return { label: "Dry run · nothing to sign", disabled: true, action: p.onSign };
  if (v.stage === "settled" && p.phase !== "failed") return { label: "Done", disabled: false, action: p.onClose };
  if (p.stage?.mode === "stopped") return { label: "Stopped", disabled: true, action: p.onClose };
  if (p.stage?.mode === "paused" && (p.phase !== "failed" || !p.failure || p.failure.retry === "sign-again" || p.failure.retry === "switch-chain")) return { label: "Retry this step", disabled: p.stage.pause?.retryable === false, action: p.onRetry };
  if (p.phase === "failed" && p.failure) {
    if (p.failure.retry === "replan") return { label: p.failure.retryLabel ?? "Plan again", disabled: !p.onReplan, action: p.onReplan ?? p.onClose };
    if (p.failure.retry === "none") return { label: "Sign with wallet", disabled: true, action: p.onSign };
    return { label: p.failure.retryLabel ?? "Try again", disabled: p.failure.retry === "confirm" && !p.confirmed, action: p.onRetry };
  }
  if (!p.connected) return { label: "Connect wallet to sign", disabled: false, action: p.onConnect };
  const busy = p.phase === "quoting" || p.phase === "switching" || p.phase === "signing" || p.phase === "submitting";
  const label = p.phase === "signing" || p.phase === "switching" ? "Waiting for wallet…" : p.phase === "submitting" ? "Checking Arc…" : p.phase === "quoting" ? "Loading quote…" : p.stage && p.stage.total > 1 ? `Sign step ${p.stage.stage} of ${p.stage.total}` : v.settledCount > 0 && v.nextStepId ? `Sign step ${v.steps.findIndex((s) => s.id === v.nextStepId) + 1} with wallet` : "Sign with wallet";
  return { label, disabled: busy || !v.nextStepId || (v.decision === "confirm" && !p.confirmed), action: p.onSign };
}

function Figures({ title, list, tone }: { readonly title: string; readonly list: ReviewView["send"]; readonly tone: "send" | "get" }) {
  const min = list.find((f) => f.minimum);
  return (
    <div className={cx("rv-fig", `rv-fig--${tone}`)}>
      <span className="m-kick">
        {title}
        <Hint text={tone === "send" ? "What leaves your wallet in this step, at today's prices." : "What arrives. The amount can move a little with the price until you sign."} />
      </span>
      {list.length === 0 ? <b className="rv-big">{"—"}</b> : null}
      {list.map((f) => (
        <div key={`${f.symbol}${f.where ?? ""}`} className="rv-fig__row">
          <b className="rv-big num">
            {f.amount} <span className="rv-sym">{f.symbol}</span>
          </b>
          <span className="m-small m-muted">
            {[f.usd !== null ? `≈ $${Number(f.usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : null, f.where, f.minimum ? `at least ${f.minimum} ${f.symbol}` : null].filter(Boolean).join(" · ")}
          </span>
        </div>
      ))}
      {min ? <span className="rv-mean">{`You get at least ${min.minimum} ${min.symbol}. ${MEANINGS.minReceived.replace("The least you can get. ", "")}`}</span> : null}
    </div>
  );
}

function SecurityPanel({ report, phase }: { readonly report: SecurityReport | null; readonly phase: ReviewPhase }) {
  if (!report) {
    return phase === "quoting" ? (
      <div className="rv-sec__wait">
        <Skeleton h={14} />
        <Skeleton h={14} w="70%" />
      </div>
    ) : (
      <p className="m-small m-muted">{"Checked when the quote loads: the calls are simulated against Arc and every balance change is listed here before you sign."}</p>
    );
  }
  const leaves = balanceLines(report);
  const findings = visibleFindings(report.findings);
  return (
    <div className="rv-sec">
      <div className="rv-sec__head">
        <Tag tone={decisionTone(report.decision)}>{decisionLabel(report.decision)}</Tag>
        <b>{"What you will sign"}</b>
        <span className="m-small m-muted">{report.simulation === "unavailable" ? "read, not test-run" : "test-run on Arc before your wallet opens"}</span>
      </div>
      {leaves.length > 0 ? (
        <p className="rv-diff">
          <span className="m-kick">{"LEAVES YOUR WALLET"}</span> <b className="num">{leaves.join(" · ")}</b>
        </p>
      ) : null}
      <ul className="rv-sec__lines m-small">
        {report.summary.lines.slice(0, 6).map((line, i) => (
          <li key={`${i}${line}`}>{line}</li>
        ))}
      </ul>
      {findings.map((f) => (
        <p key={`${f.rule}${f.message}`} className="m-small rv-sec__finding">
          <Tag tone={severityTone(f.severity)}>{f.severity}</Tag> <span>{f.message}</span>
        </p>
      ))}
    </div>
  );
}

export function ReviewDialog(p: ReviewDialogProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const uid = useId();
  useDialogFocus(ref, p.open, p.onClose, titleRef);
  const tiles = useMemo(() => Array.from({ length: TILE_COLS * TILE_ROWS }, (_, i) => ({ i, d: (i % TILE_COLS) + Math.floor(i / TILE_COLS), tone: TILE_TONES[(i * 7 + Math.floor(i / TILE_COLS)) % TILE_TONES.length]! })), []);
  if (!p.open) return null;
  const v = p.view;
  const banner = phaseBanner(p);
  const primary = primaryOf(p);
  const network = v ? (v.environment === "mainnet" ? "ARC MAINNET" : "ARC TESTNET") : "ARC";
  const activeStep = v?.nextStepId ?? null;
  const settledAll = v?.stage === "settled" && p.phase !== "failed";
  const gas = p.transferCostUsd ? `from $${Number(p.transferCostUsd).toFixed(4)} per transaction at today's gas price` : "a few cents at most on Arc";
  return (
    <div className="rv-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div ref={ref} className="rv-dialog m-frame" role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} data-phase={p.phase} data-stage={v?.stage ?? "loading"}>
        <div className="rv-tiles" aria-hidden="true" style={{ "--cols": TILE_COLS } as React.CSSProperties}>
          {tiles.map((t) => (
            <span key={t.i} className={`rv-tile rv-tile--${t.tone}`} style={{ "--d": t.d } as React.CSSProperties} />
          ))}
        </div>
        <button type="button" className="rv-grab" aria-label="Close the review" onClick={p.onClose} />
        <header className="rv-head rv-lay" style={{ "--k": 0 } as React.CSSProperties}>
          <span className="m-kick">{`REVIEW · ${network}${v ? ` · ${v.id}` : ""}`}</span>
          <h2 id={`${uid}-t`} ref={titleRef} tabIndex={-1}>
            {p.stage && p.stage.total > 1 && v?.staged.current ? stageHeadline(p.stage, v.staged.current.summary) : p.title}
          </h2>
          <p id={`${uid}-d`} className="m-small m-muted">
            {"Check what leaves your wallet and what you get. Nothing moves until you confirm in your wallet."}
          </p>
          <HowItWorks area="review" className="rv-how" />
          <button type="button" className="rv-x" aria-label="Close the review" onClick={p.onClose}>
            <Mark name="cross" size={12} />
          </button>
        </header>

        <div className="rv-body">
          {v ? (
            <section key={`stage-${p.stage?.stage ?? 0}`} className={cx("rv-swap rv-lay", p.stage && p.stage.total > 1 && p.stage.stage > 1 && "rv-stagein")} style={{ "--k": 1 } as React.CSSProperties} aria-label={p.stage && p.stage.total > 1 ? `What step ${p.stage.stage} sends and gets` : "What you send and what you get"}>
              <Figures title="YOU SEND" list={v.send} tone="send" />
              <span className="rv-arrow" aria-hidden="true">
                <Mark name="arrow" size={18} />
              </span>
              <Figures title="YOU GET" list={v.get} tone="get" />
            </section>
          ) : (
            <section className="rv-swap" aria-label="Loading">
              <Skeleton h={72} />
              <span />
              <Skeleton h={72} />
            </section>
          )}

          {v && (p.preflight?.length ?? 0) > 0 && v.stage !== "settled" ? (
            <div className="rv-card rv-pf rv-lay" style={{ "--k": 1 } as React.CSSProperties}>
              <PreflightPanel findings={p.preflight} mode="review" acknowledged={p.preflightAcked === true} {...(p.onPreflightAck ? { onAcknowledge: p.onPreflightAck } : {})} {...(p.onFix ? { onFix: p.onFix } : {})} actionable={v.settledCount === 0} />
            </div>
          ) : null}

          <div className="rv-cols">
            <section className="rv-card rv-lay" style={{ "--k": 2 } as React.CSSProperties} aria-labelledby={`${uid}-steps`}>
              <h3 id={`${uid}-steps`} className="rv-h">
                {"Steps"}
                {v ? <span className="m-kick">{`${v.settledCount} OF ${v.steps.length} SETTLED`}</span> : null}
              </h3>
              {v ? (
                <ol className="rv-steps">
                  {v.steps.map((s) => (
                    <li key={s.id} className="rv-step" data-status={s.status} data-active={s.id === activeStep || undefined}>
                      <span className="rv-step__n" aria-hidden="true">
                        {s.status === "settled" ? <Mark name="check" size={11} /> : s.n}
                      </span>
                      <div className="rv-step__body">
                        <b>{s.summary}</b>
                        <div className="rv-step__meta">
                          <Tag tone="sea">{s.venue}</Tag>
                          <Tag tone={s.status === "settled" ? "ok" : s.status === "failed" ? "bad" : "ghost"}>{s.status === "awaiting-signature" ? "ready to sign" : s.status === "blocked" ? "next" : s.failure ? "paused" : s.status}</Tag>
                        </div>
                        <code className="rv-memo" title={MEANINGS.arcMemo}>
                          <span className="m-kick">{"REFERENCE"}</span> {s.memo}
                        </code>
                        {s.why ? (
                          <details className="rv-why">
                            <summary className="m-small">{`Why ${s.venue}?`}</summary>
                            <p className="m-small m-muted">{s.why}</p>
                          </details>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <Skeleton h={90} />
              )}
            </section>

            <div className="rv-side">
              <section className="rv-card rv-lay" style={{ "--k": 3 } as React.CSSProperties} aria-labelledby={`${uid}-fees`}>
                <h3 id={`${uid}-fees`} className="rv-h">{"Fees"}</h3>
                <dl className="rv-fees">
                  <div>
                    <dt>{`Lykia fee${v?.feeBps !== null && v?.feeBps !== undefined ? ` · ${bpsLabel(v.feeBps)}` : ""}`}<Hint text={MEANINGS.lykiaFee} /></dt>
                    <dd className="num">{v ? (v.fees.length > 0 ? v.fees.join(" + ") : "none on this plan") : "…"}</dd>
                  </div>
                  <div>
                    <dt>{"Network fee · in USDC"}<Hint text={MEANINGS.gas} /></dt>
                    <dd>{`${gas}${p.txCount ? ` · ${p.txCount} transaction${p.txCount === 1 ? "" : "s"}` : ""}; your wallet shows the exact figure`}</dd>
                  </div>
                </dl>
                <p className="m-small m-muted">{"The Lykia fee is paid in the same transaction as the step. Repaying and withdrawing home are free. The network fee goes to Arc, not to Lykia."}</p>
              </section>

              <section className="rv-card rv-fence rv-lay" style={{ "--k": 4 } as React.CSSProperties} aria-labelledby={`${uid}-fence`}>
                <h3 id={`${uid}-fence`} className="rv-h">{"Your rules say"}<Hint text={MEANINGS.verdict} /></h3>
                <div className="rv-fence__row">
                  {v ? <Seal decision={v.decision} /> : <Skeleton h={28} w={110} />}
                  <span className="m-small">{v ? (v.decision === "allow" ? "Allowed: every step is inside your Fence (your spending rules)." : v.decision === "confirm" ? "Allowed once you confirm below: a rule asks you first." : "Refused: a rule in your Fence says no, so nothing can be signed.") : ""}</span>
                </div>
                {v && v.reasons.length > 0 ? (
                  <ul className="rv-reasons m-small">
                    {v.reasons.slice(0, 4).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : null}
                {v?.decision === "confirm" && v.stage !== "settled" ? (
                  <label className="rv-confirm">
                    <input type="checkbox" checked={p.confirmed} onChange={(e) => p.onConfirm(e.target.checked)} /> {"I read the Fence's lines and confirm this plan."}
                  </label>
                ) : null}
              </section>

              <section className="rv-card rv-lay" style={{ "--k": 5 } as React.CSSProperties} aria-labelledby={`${uid}-sec`}>
                <h3 id={`${uid}-sec`} className="rv-h">{"Safety check"}<Hint text={MEANINGS.security} /></h3>
                <SecurityPanel report={p.security} phase={p.phase} />
              </section>
            </div>
          </div>

          <div className="rv-lay" style={{ "--k": 6 } as React.CSSProperties}>
            <BetaRibbon inline />
          </div>

        </div>

        <div className="rv-status" role="status" aria-live="polite">
          {banner ? <p className={cx("rv-banner", `rv-banner--${banner.tone}`)}>{banner.text}</p> : null}
          {settledAll || (p.phase === "settled" && v) ? (
            <div className="rv-settled">
              <span className="rv-settled__seal" aria-hidden="true">
                <Mark name="check" size={18} />
              </span>
              <div>
                <b>{settledAll ? "Settled on Arc" : "Step settled on Arc"}</b>
                <p className="m-small m-muted">{settledAll ? "Final on the receipt: Arc settles in under a second." : "Final on the receipt. The next step is ready to sign."}</p>
                {p.lastTx ?? v?.lastTx ? <HashChip value={(p.lastTx ?? v?.lastTx) as string} kind="tx" environment={(v?.environment ?? "mainnet") as ArcEnvironment} /> : null}
              </div>
            </div>
          ) : null}
          {p.phase === "failed" && p.failure ? (
            <div className="rv-failed" role="alert">
              <b>{p.failure.title}</b>
              <p className="m-small">{p.failure.detail}</p>
              {p.failure.raw && p.failure.raw !== p.failure.detail ? (
                <details>
                  <summary className="m-small">{"Details"}</summary>
                  <code className="m-small">{p.failure.raw}</code>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="rv-foot">
          <button type="button" className="m-btn m-btn--ghost" onClick={p.onClose}>
            {"Back"}
          </button>
          {p.stage?.mode === "paused" && p.onStop ? (
            <button type="button" className="m-btn m-btn--ghost" onClick={p.onStop}>
              {"Stop here"}
            </button>
          ) : null}
          <button type="button" className="m-btn m-btn--lg rv-primary" onClick={primary.action} disabled={primary.disabled} data-busy={p.phase === "signing" || p.phase === "submitting" || p.phase === "quoting" || undefined}>
            {primary.label}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** The live modal: the intent, the next step's quote and the wallet. */
export function ReviewModal({ intentId, proposal, open, onClose, onReplan, askFix }: { readonly intentId: string | null; readonly proposal?: AgentProposal | null; readonly open: boolean; readonly onClose: () => void; readonly onReplan?: () => void; readonly askFix?: (sentence: string) => void }) {
  const query = useIntent(open ? intentId : null);
  const view = useMemo(() => (query.data ? reviewView(query.data.intent, query.data.outrun) : null), [query.data]);
  const network = view ? networkFor(view.environment).name : "Arc";
  // Before you sign: the plan's preflight (read again at each quote), plus the wallet's network and the quote's age.
  const chatAcked = usePreflightAcks((s) => (intentId ? Boolean(s.acked[intentId]) : false));
  const [ticked, setTicked] = useState<string | null>(null);
  // The plan's preflight: prepare reads it again and stores it on the plan, so the plan's copy is the one to show.
  const serverFindings = query.data?.intent.preflight ?? [];
  const warnIds = serverFindings.filter((f) => f.severity === "warn").map((f) => f.id);
  const warnKey = warnIds.join("|");
  // "Use all anyway" in the chat ticks the warnings the chat showed, and only those: a new one needs a new tick.
  const [chatKey] = useState(() => (chatAcked ? (query.data?.intent.preflight ?? []).filter((f) => f.severity === "warn").map((f) => f.id).join("|") : null));
  const preflightAcked = warnKey !== "" && (ticked === null ? chatKey === warnKey : ticked === warnKey);
  const flow = useReviewFlow(intentId, network, preflightAcked ? warnIds : []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const clientFindings = [view && flow.connected ? walletNetworkFinding(flow.chainId, view.environment) : null, quoteAgeFinding(flow.prepared?.at ?? null, now)].filter((f): f is Finding => f !== null);
  const findings = [...clientFindings.filter((f) => f.severity === "block"), ...serverFindings, ...clientFindings.filter((f) => f.severity !== "block")];
  const gate = preflightGate(findings, preflightAcked);
  const transferCostUsd = usePulse((s) => s.pulse?.transferCostUsd ?? null);
  const [confirmed, setConfirmed] = useState(false);
  const next = view?.nextStepId ?? null;
  // A step the server paused waits for "Retry this step"; it is never re-quoted on its own.
  const fresh = (view?.settledCount ?? 0) === 0;
  const quotable = Boolean(open && view && view.signable && next && !view.staged.paused && (view.decision !== "confirm" || confirmed) && (!fresh || (!gate.blocked && gate.needsAck.length === 0)));

  // A fresh quote for the next step as soon as the modal opens, and after each step settles.
  useEffect(() => {
    if (!quotable || !next) return;
    if (flow.phase === "idle" || ((flow.phase === "settled" || flow.phase === "submitted") && flow.stepId !== next)) void flow.quote(next, confirmed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotable, next, flow.phase]);

  // The stage on screen: rebuilt from the plan on every update (a reload resumes at the right stage) and from the wallet flow.
  const [stage, dispatch] = useReducer(stageReduce, STAGE_START);
  useEffect(() => {
    if (query.data && view) dispatch({ type: "graph", plan: view.staged, decision: view.decision, signable: view.signable });
  }, [query.data, view]);
  useEffect(() => {
    if (flow.phase !== "idle" && flow.phase !== "failed") dispatch({ type: "phase", phase: flow.phase });
  }, [flow.phase]);
  useEffect(() => {
    if (flow.phase === "failed" && flow.failure) dispatch({ type: "failed", reason: `${flow.failure.title}. ${flow.failure.detail}`, retryable: flow.failure.retry !== "none" });
  }, [flow.phase, flow.failure]);
  const serverPaused = Boolean(view?.staged.paused);
  const title = proposal?.title ?? (view && view.steps.length === 1 ? view.steps[0]!.summary : "Review and sign");
  return (
    <ReviewDialog
      open={open}
      onClose={onClose}
      title={title.length > 90 ? `${title.slice(0, 88)}…` : title}
      view={view}
      phase={query.isError && flow.phase === "idle" ? "failed" : flow.phase}
      failure={flow.failure ?? (query.isError ? { kind: "rpc", title: "The plan could not be loaded", detail: "The Lykia API did not answer. Close this and open the plan again in a moment.", retry: "none", retryLabel: null, sent: false, raw: String(query.error) } : null)}
      security={flow.security}
      refreshes={flow.refreshes}
      quotedAt={flow.prepared?.at ?? null}
      lastTx={flow.lastTx}
      connected={flow.connected}
      walletLabel={flow.walletKind === "passkey" ? "passkey" : null}
      confirmed={confirmed}
      onConfirm={(value) => {
        setConfirmed(value);
        if (value && next && flow.phase === "idle") void flow.quote(next, true);
      }}
      onSign={() => next && void flow.sign(next, confirmed)}
      onRetry={() => {
        const sid = (flow.stepId ?? next) as string | null;
        if (!sid) return;
        dispatch({ type: "retry" });
        void (serverPaused ? flow.resume(sid, confirmed) : flow.retry(sid, confirmed));
      }}
      onStop={() => {
        dispatch({ type: "stop" });
        void flow.stopPlan();
      }}
      stage={stage}
      preflight={findings}
      preflightAcked={preflightAcked}
      onPreflightAck={(value) => setTicked(value ? warnKey : "")}
      onFix={(fix) => {
        if (fix.kind === "replan" || fix.kind === "open" || fix.kind === "change-fence") onClose();
        void runFix(fix, { switchNetwork: flow.switchNetwork, ...(askFix ? { ask: askFix } : {}) });
      }}
      {...(onReplan ? { onReplan } : {})}
      onConnect={flow.connect}
      txCount={flow.prepared?.response.transactions.length ?? null}
      transferCostUsd={transferCostUsd}
    />
  );
}
