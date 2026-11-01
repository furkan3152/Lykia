import { NETWORKS, type ArcEnvironment, type FenceVerdict, type Outrun } from "@lykia/core";
import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { useLang } from "../../lib/i18n";
import { ValleyScene } from "../../pixel/ValleyScene";
import { Tag } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { decisionLabel, STATUS_TR, verdictLines } from "./model";
import type { StepRun } from "./useStepRunner";

const DECISION_CLASS = {
  allow: "bg-up text-white",
  confirm: "bg-signal text-[#1B1714]",
  deny: "bg-down text-white",
} as const;

export function VerdictPanel({ verdict }: { readonly verdict: FenceVerdict }) {
  const lang = useLang();
  const lines = verdictLines(verdict);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("px-2 py-0.5 font-tag text-[12px] uppercase", DECISION_CLASS[verdict.decision])}>
          {lang === "tr" ? "Çit" : "Fence"} · {decisionLabel(verdict.decision, lang)}
        </span>
        {!verdict.signable ? <span className="font-tag text-[11px] uppercase text-warn-ink">{lang === "tr" ? "imzalanamaz" : "not signable"}</span> : null}
        <span className="truncate font-mono text-[11px] text-ink-3" title={verdict.digest}>
          {verdict.digest.slice(0, 18)}…
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="text-[13px] text-ink-2">{lang === "tr" ? "Her kural geçti." : "Every rule passed."}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lines.map((line, i) => (
            <li key={`${line.rule}-${line.step ?? ""}-${i}`} className={cx("flex items-start gap-2 text-[13px] leading-snug", line.waived ? "text-ink-3" : "text-ink-2")}>
              <span className={cx("mt-0.5 shrink-0 px-1.5 font-tag text-[10px] uppercase", line.waived ? "bg-paper-2 text-ink-3" : DECISION_CLASS[line.decision])}>{line.waived ? (lang === "tr" ? "feragat" : "waived") : decisionLabel(line.decision, lang)}</span>
              <span>
                <span className="font-mono text-[11px] text-ink-3">{line.rule}</span> {line.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {verdict.waived.length > 0 ? <p className="font-tag text-[10px] uppercase text-ink-3">{lang === "tr" ? "Feragat edilenler: eve dönüş adımları (düdük yolu)" : "Waived: homeward steps (the whistle lane)"}</p> : null}
    </div>
  );
}

export interface OutrunCardProps {
  readonly outrun: Outrun;
  readonly verdict: FenceVerdict;
  readonly environment: ArcEnvironment;
  /** Step actions; omitted = read-only. */
  readonly runs?: Readonly<Record<string, StepRun>>;
  readonly onRun?: (stepId: string, confirmed: boolean) => void;
  readonly connected?: boolean;
  readonly whistle?: boolean;
  readonly className?: string;
}

/** The Outrun: the arc drawing, the Fence verdict and every waypoint with its venue, amounts and action. */
export function OutrunCard({ outrun, verdict, environment, runs = {}, onRun, connected = false, whistle = false, className }: OutrunCardProps) {
  const lang = useLang();
  const [confirmed, setConfirmed] = useState(false);
  const needsConfirm = verdict.decision === "confirm";
  const explorer = NETWORKS[environment === "mainnet" ? "arc-mainnet" : "arc-testnet"].explorerUrl;
  return (
    <article className={cx("flex flex-col gap-5 bg-card p-4 px-frame px-drop-lg sm:p-5", className)} aria-label="Outrun">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tag>
          OUTRUN · {outrun.intentId.slice(0, 12)} · {outrun.status.toUpperCase()}
        </Tag>
        <span className="font-tag text-[11px] uppercase text-ink-2">{Math.round(outrun.progress * 100)}% · {environment === "mainnet" ? "Arc mainnet" : "Arc testnet"}</span>
      </div>
      <div className="bg-paper-2 p-1 px-frame-thin">
        <ValleyScene
          aspect={0.36}
          pixelSize={3}
          label={`Outrun arc with ${outrun.waypoints.length} waypoints, ${Math.round(outrun.progress * 100)} percent settled`}
          outrun={{ waypoints: outrun.waypoints.length, progress: outrun.progress }}
          lyko={whistle ? "lie" : "run"}
          sheep={[{ size: 2 }, { size: 1 }, { size: 1 }]}
          wolves={verdict.decision === "deny" ? 2 : 0}
          rainbow={false}
        />
      </div>
      <VerdictPanel verdict={verdict} />
      <ol className="flex flex-col gap-3">
        {outrun.waypoints.map((w, index) => {
          const run = runs[w.stepId];
          const busy = run && run.phase !== "idle" && run.phase !== "done" && run.phase !== "error";
          const actionable = w.turn === "signer" && verdict.signable && onRun;
          return (
            <li key={w.stepId} className={cx("flex flex-col gap-2 bg-paper p-3 px-frame-thin", outrun.current === index && "ring-2 ring-signal")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold text-ink">{w.name}</span>
                <span className="font-tag text-[11px] uppercase text-ink-3">
                  {w.kind} · {w.venue}
                </span>
                <span className={cx("ml-auto font-tag text-[11px] uppercase", w.status === "settled" ? "text-up" : w.status === "failed" ? "text-down" : "text-ink-2")}>{lang === "tr" ? (STATUS_TR[w.status] ?? w.status) : w.status}</span>
              </div>
              <p className="text-[14px] text-ink">{w.summary}</p>
              <p className="font-mono text-[12px] text-ink-2">
                {w.gives.length > 0 ? `${lang === "tr" ? "verir" : "gives"} ${w.gives.join(" + ")}` : ""}
                {w.gives.length > 0 && w.gets.length > 0 ? "  →  " : ""}
                {w.gets.length > 0 ? `${lang === "tr" ? "alır" : "gets"} ${w.gets.join(" + ")}` : ""}
                {w.leavesArc ? `  ·  ${lang === "tr" ? "Arc'tan çıkar" : "leaves Arc for"} ${w.leavesArc}` : ""}
              </p>
              {w.explorer.length > 0 || (run?.hashes.length ?? 0) > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {(w.explorer.length > 0 ? w.explorer : (run?.hashes ?? []).map((h) => `${explorer}/tx/${h}`)).map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer" className={cx("inline-flex items-center gap-1 font-mono text-[12px] text-summit-ink underline underline-offset-4", FOCUS_RING)}>
                      {url.split("/tx/")[1]?.slice(0, 12)}… <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">(opens the Arc explorer)</span>
                    </a>
                  ))}
                </div>
              ) : null}
              {run?.memo ? <p className="font-mono text-[11px] text-ink-3">memo · {run.memo}</p> : null}
              {actionable ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" disabled={!connected || busy || (needsConfirm && !confirmed)} onClick={() => onRun?.(w.stepId, confirmed)}>
                    {busy ? `${run?.phase}…` : lang === "tr" ? "Hazırla ve imzala" : "Prepare & sign"}
                  </Button>
                  {!connected ? <span className="text-[12px] text-ink-3">{lang === "tr" ? "Önce cüzdanını bağla." : "Connect a wallet first."}</span> : null}
                  {run?.message ? <span className={cx("text-[12px]", run.phase === "error" ? "text-down" : "text-ink-2")}>{run.message}</span> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {needsConfirm && onRun ? (
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />
          {lang === "tr" ? "Çit onay istiyor: bu planı onaylıyorum." : "The Fence asks for confirmation: I confirm this plan."}
        </label>
      ) : null}
      {outrun.fold.length > 0 ? (
        <p className="border-t-2 border-dashed border-rule pt-3 font-tag text-[12px] uppercase text-ink-2">
          {lang === "tr" ? "Ağıl" : "Fold"} · <span className="text-ink">{outrun.fold.join(" · ")}</span>
        </p>
      ) : null}
    </article>
  );
}
