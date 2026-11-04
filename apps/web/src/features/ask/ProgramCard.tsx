/**
 * A compiled program in the conversation: what happens Now (one signable
 * plan), what is Scheduled (drafts: automations, LykiaOrders orders, alerts,
 * standing orders, budgets) and the Assumptions Lykia made, each with its
 * Fence verdict. Picking another value for an assumption recompiles the
 * owner's words through POST /v1/ai/compile with that override; nothing is
 * signed or saved from here.
 */
import type { ChatProgramView } from "@lykia/core/api/agents";
import { useState } from "react";

import { Link } from "../../app/routes/Link";
import { apiPost } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Seal, Tag, cx } from "../../mosaic";
import { useLykiaWallet } from "../wallet/useLykiaWallet";

const SAMPLE_OWNER = "0x000000000000000000000000000000000000dEaD";
const KIND_LABEL: Readonly<Record<ChatProgramView["scheduled"][number]["kind"], string>> = { automation: "AUTOMATION", order: "LYKIAORDERS", alert: "ALERT", standing: "STANDING ORDER", budget: "FENCE BUDGET" };

/** The Fence verdict as a seal, or a quiet tag when it is decided later. */
export function Verdict({ decision, reasons }: { decision: "allow" | "confirm" | "deny" | "unknown"; reasons: readonly string[] }) {
  return (
    <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
      {decision === "unknown" ? <Tag tone="ghost">FENCE · CHECKED WHEN IT RUNS</Tag> : <Seal decision={decision} stamp={false} />}
      {reasons.slice(0, 3).map((r) => (
        <span key={r} className="m-small m-muted">
          {r}
        </span>
      ))}
    </div>
  );
}

function Section({ kick, count, children }: { kick: string; count?: number; children: React.ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 8 }}>
      <span className="m-kick">
        {kick}
        {count !== undefined ? ` · ${count}` : ""}
      </span>
      {children}
    </section>
  );
}

/** The labels an assumption's value takes in the chips. */
function assumptionChoices(a: ChatProgramView["assumptions"][number]): string[] {
  return [a.value, ...a.options.filter((o) => o !== a.value)];
}

export function ProgramCard({ view: initial }: { view: ChatProgramView }) {
  const environment = useEnvironment();
  const { address } = useLykiaWallet();
  const [view, setView] = useState<ChatProgramView>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const change = async (id: string, value: string) => {
    setBusy(id);
    setError(null);
    try {
      const overrides = { ...view.overrides, [id]: value };
      const owner = address ?? SAMPLE_OWNER;
      const result = await apiPost<{ view: ChatProgramView }>("/v1/ai/compile", { text: view.text, owner, environment, overrides, plan: address !== undefined, search: false }, { timeoutMs: 60_000 });
      if (result.view) setView(result.view);
    } catch (e) {
      setError((e as Error).message || "Lykia could not recompile that.");
    } finally {
      setBusy(null);
    }
  };

  const shortHash = view.programHash.replace(/^sha256:/u, "").slice(0, 10);
  return (
    <div className="m-frame m-frame--thin" style={{ padding: 12, display: "grid", gap: 14, minWidth: 0, animation: "m-msg-in 400ms both" }} data-testid="program-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span className="m-kick">PROGRAM · {shortHash}</span>
          <b style={{ fontFamily: "Pixelify Sans", fontSize: 18 }}>{view.goals.slice(0, 3).join(" · ") || "Your request, compiled"}</b>
        </div>
        <div className="flex gap-1 flex-wrap">
          <Tag tone={view.status === "ready" ? "ok" : view.status === "refused" ? "bad" : "ochre"}>{view.status === "ready" ? "READY" : view.status === "refused" ? "REFUSED" : "NEEDS YOUR INPUT"}</Tag>
          <Tag tone="ghost">{view.source === "llm" ? "MODEL" : "LEXICON"}</Tag>
          {view.hypothetical ? <Tag tone="sea">WHAT-IF</Tag> : null}
        </div>
      </div>
      <p className="m-small" style={{ margin: 0 }}>{view.summary}</p>

      {view.questions.length > 0 || view.blockers.length > 0 || view.refusals.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          {view.questions.map((q) => (
            <p key={q} className="m-note" style={{ margin: 0 }}>
              <b>Question:</b> {q}
            </p>
          ))}
          {view.blockers.map((b) => (
            <p key={b} className="m-note m-note--bad" style={{ margin: 0 }}>
              {b}
            </p>
          ))}
          {view.refusals.map((r) => (
            <p key={r} className="m-note m-note--bad" style={{ margin: 0 }}>
              <b>Not done:</b> {r}
            </p>
          ))}
        </div>
      ) : null}

      <Section kick="NOW · ONE SIGNATURE PLAN" {...(view.now ? { count: view.now.steps.length } : {})}>
        {view.now ? (
          <>
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 14 }}>
              {view.now.steps.map((s, i) => (
                <li key={`${s.summary}${i}`}>
                  <details>
                    <summary style={{ cursor: "pointer" }}>{s.summary}</summary>
                    <p className="m-small m-muted" style={{ margin: "4px 0 0", overflowWrap: "anywhere" }}>{s.rationale}</p>
                  </details>
                </li>
              ))}
            </ol>
            <Verdict decision={view.now.decision} reasons={view.now.reasons} />
            {view.kept.length > 0 ? <p className="m-small m-muted" style={{ margin: 0 }}>Kept liquid · {view.kept.join(" · ")}</p> : null}
            {view.fees ? <p className="m-small m-muted" style={{ margin: 0 }}>{view.fees}</p> : null}
            {view.now.intentId ? (
              <div>
                <Link to={`/app/outrun/${encodeURIComponent(view.now.intentId)}`} className="m-btn m-btn--sm">
                  REVIEW AND SIGN
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <p className="m-small m-muted" style={{ margin: 0 }}>Nothing moves now.</p>
        )}
      </Section>

      {view.scheduled.length > 0 ? (
        <Section kick="SCHEDULED · DRAFTS" count={view.scheduled.length}>
          <div style={{ display: "grid", gap: 8 }}>
            {view.scheduled.map((s, i) => (
              <div key={`${s.summary}${i}`} className="m-note" style={{ display: "grid", gap: 6, minWidth: 0 }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Tag tone="sea">{KIND_LABEL[s.kind]}</Tag>
                  <b style={{ overflowWrap: "anywhere" }}>{s.summary}</b>
                </div>
                <span className="m-small m-muted" style={{ overflowWrap: "anywhere" }}>{s.rationale}</span>
                <Verdict decision={s.decision} reasons={s.reasons} />
                <div>
                  <Link to={s.href} className={cx("m-btn m-btn--sm", s.saved && "m-btn--ghost")}>
                    {s.saved ? "MANAGE" : s.kind === "order" ? "SIGN ON THE ORDERS PAGE" : s.kind === "budget" ? "OPEN THE PACK" : "REVIEW AND SAVE"}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {view.assumptions.length > 0 ? (
        <Section kick="ASSUMPTIONS · YOU CAN CHANGE THEM" count={view.assumptions.length}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {view.assumptions.map((a) => (
              <li key={a.id} style={{ display: "grid", gap: 6 }}>
                <span className="m-small" style={{ overflowWrap: "anywhere" }}>{a.text}</span>
                {a.options.length > 0 ? (
                  <div className="flex gap-1 flex-wrap" role="group" aria-label={`Change: ${a.text}`}>
                    {assumptionChoices(a).map((choice) => (
                      <Button key={choice} size="sm" tone={choice === (view.overrides[a.id] ?? a.value) ? "terra" : "ghost"} disabled={busy !== null || choice === (view.overrides[a.id] ?? a.value)} onClick={() => void change(a.id, choice)}>
                        {busy === a.id && choice !== a.value ? "…" : choice.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {error ? <p className="m-note m-note--bad" style={{ margin: 0 }}>{error}</p> : null}
        </Section>
      ) : null}

      {view.tradeoffs.length > 0 || view.rejected.length > 0 ? (
        <details>
          <summary className="m-kick" style={{ cursor: "pointer" }}>WHY THIS PLAN</summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {view.tradeoffs.map((t) => (
              <p key={t} className="m-small" style={{ margin: 0 }}>
                {t}
              </p>
            ))}
            {view.rejected.map((r) => (
              <p key={`${r.option}${r.reason}`} className="m-small m-muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
                <b>Not chosen · {r.option}:</b> {r.reason}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
