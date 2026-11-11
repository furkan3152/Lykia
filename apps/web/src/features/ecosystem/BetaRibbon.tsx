/** The mainnet beta notice: Lykia's safety limit while the contracts are not audited, never shown as a bare number. */
import { betaCapExplain, DEFAULT_BETA_CAP } from "@lykia/core";

import { BetaCapNote, Hint } from "../help/Help";
import { useBetaCap } from "./useBetaCap";
import { t } from "../../i18n";

export function BetaRibbon({ inline = false }: { readonly inline?: boolean }) {
  const beta = useBetaCap();
  const cap = beta.data === undefined ? DEFAULT_BETA_CAP : beta.data;
  if (cap === null) return null;
  if (inline) return <BetaCapNote cap={cap} compact className="beta-ribbon--inline" />;
  const b = betaCapExplain(cap);
  return (
    <div className="beta-ribbon" role="note" data-beta-explained="">
      <span className="m-kick">{t("ecosystem.betaRibbon.betaLykiaSSafetyLimit")}</span>
      <span className="m-small">
        {`${b.sentence} ${b.home}`}
        <Hint text={`${b.why} ${b.scope}`} label={t("ecosystem.betaRibbon.whyIsThereALimit")} />
      </span>
    </div>
  );
}
