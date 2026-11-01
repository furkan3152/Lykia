/** The plan card every action component shares: verdict, steps, fees (Lykia's and the app's), sign. */
import type { IntentGraph } from "@lykia/core";
import { feeLine } from "@lykia/core";
import type { PlanState } from "../controllers.js";

export function decisionClass(decision: string): string {
  return decision === "allow" ? "lk-allow" : decision === "confirm" ? "lk-confirm" : "lk-deny";
}

export function PlanCard(props: { readonly state: PlanState; readonly onRun: () => void; readonly onReset: () => void }) {
  const { state } = props;
  const intent: IntentGraph | null = state.intent;
  if (state.status === "error" && !intent) return <p className="lk-error" role="alert">{state.error}</p>;
  if (!intent) return null;
  const verdict = intent.verdict;
  const label = verdict.decision === "allow" ? "Inside the Fence" : verdict.decision === "confirm" ? "Needs your confirmation" : "Outside the Fence";
  return (
    <div className="lk-card" data-part="plan" aria-live="polite">
      <div className="lk-row" style={{ justifyContent: "space-between" }}>
        <strong>Plan</strong>
        <span className={`lk-pill ${decisionClass(verdict.decision)}`}>{label}</span>
      </div>
      <ol className="lk-list">
        {intent.steps.map((step) => (
          <li key={step.id}>
            <span>{step.summary}</span>
            <span className="lk-muted">{step.fee ? feeLine(step.fee) : "No fee"}</span>
          </li>
        ))}
      </ol>
      {verdict.reasons.filter((r) => r.rule !== "fee").slice(0, 4).map((r, i) => (
        <p key={i} className="lk-muted">{r.message}</p>
      ))}
      {state.error ? <p className="lk-error" role="alert">{state.error}</p> : null}
      <div className="lk-row">
        {state.status === "settled" ? (
          <span className="lk-pill lk-allow">Settled</span>
        ) : (
          <button className="lk-btn" type="button" disabled={!verdict.signable || state.status === "signing"} onClick={props.onRun}>
            {state.status === "signing" ? `Signing ${state.stepId ?? ""}` : verdict.signable ? "Sign and send" : "Cannot be signed"}
          </button>
        )}
        <button className="lk-btn lk-ghost" type="button" onClick={props.onReset}>Clear</button>
      </div>
    </div>
  );
}
