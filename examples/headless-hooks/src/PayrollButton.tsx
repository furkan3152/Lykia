// Your own markup, Lykia's logic: plan a payroll run, show the Fence verdict and
// the fees (Lykia's and your app's), then sign every step with the user's wallet.
import { feeLine } from "@lykia/core";
import { useLykiaPlan, useScent } from "@lykia/widget";

export interface Payee {
  readonly name: string;
  readonly address: `0x${string}`;
  readonly usdc: string;
}

export function PayrollButton({ payees }: { readonly payees: readonly Payee[] }) {
  const plan = useLykiaPlan();
  const actions = payees.map((p) => ({ verb: "send" as const, token: "USDC", amount: { exact: p.usdc }, to: p.address, memo: `Payroll: ${p.name}` }));
  return (
    <section>
      <button type="button" disabled={plan.status === "planning"} onClick={() => void plan.plan({ actions })}>
        {plan.status === "planning" ? "Planning…" : `Plan payroll for ${payees.length} people`}
      </button>
      {plan.intent ? (
        <div>
          <p>Fence: {plan.intent.verdict.decision}</p>
          <ul>{plan.intent.steps.map((s) => <li key={s.id}>{s.summary} · {s.fee ? feeLine(s.fee) : "no fee"}</li>)}</ul>
          <button type="button" disabled={!plan.intent.verdict.signable || plan.status === "signing"} onClick={() => void plan.run()}>
            {plan.status === "settled" ? "Paid" : "Sign and pay"}
          </button>
        </div>
      ) : null}
      {plan.error ? <p role="alert">{plan.error}</p> : null}
    </section>
  );
}

/** A token check in one line of UI. */
export function TokenBadge({ token }: { readonly token: `0x${string}` }) {
  const scent = useScent();
  return (
    <button type="button" onClick={() => void scent.check(token)}>
      {scent.loading ? "Checking…" : scent.data ? `${scent.data.symbol ?? "token"}: ${scent.data.level}` : "Check token"}
    </button>
  );
}
