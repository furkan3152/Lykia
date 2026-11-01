/** The mainnet beta notice: Lykia's contracts are not audited yet, so caps apply to everyone. */
import { useBetaCap } from "./useBetaCap";

export function BetaRibbon({ inline = false }: { readonly inline?: boolean }) {
  const beta = useBetaCap();
  const cap = beta.data === undefined ? { perStepUsd: "1000", perDayUsd: "5000" } : beta.data;
  if (cap === null) return null;
  return (
    <div className={inline ? "m-note beta-ribbon beta-ribbon--inline" : "beta-ribbon"} role="note">
      <span className="m-kick">{"BETA · CONTRACTS NOT YET AUDITED · CAPS APPLY"}</span>
      <span className="m-small">{`$${Number(cap.perStepUsd).toLocaleString("en-US")} per step, $${Number(cap.perDayUsd).toLocaleString("en-US")} per day on mainnet. Moves that bring value home are never capped.`}</span>
    </div>
  );
}
