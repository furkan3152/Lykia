import { Link } from "../app/routes/Link";
import { MeanderBand } from "../mosaic";
import { ACCOUNT, AREAS, MORE } from "./nav";
import { t } from "../i18n";

const REPO = "https://github.com/furkan3152/Lykia";

export function Footer() {
  return (
    <footer className="m-footer">
      <MeanderBand />
      <div className="m-wrap m-footer__grid">
        <div>
          <span className="m-footer__h">{t("shell.footer.product")}</span>
          {AREAS.map((a) => (
            <Link key={a.id} to={a.href} title={a.blurb}>{`${a.label.toUpperCase()} · ${a.short.toUpperCase()}`}</Link>
          ))}
        </div>
        <div>
          <span className="m-footer__h">{t("shell.footer.proof")}</span>
          <Link to="/league">{t("shell.footer.theLeague")}</Link>
          <Link to="/stats">{t("shell.footer.ledgerStats")}</Link>
          <Link to="/ecosystem">{t("shell.footer.harbourEcosystem")}</Link>
          <a href={`${REPO}/blob/main/docs/flows.md`} target="_blank" rel="noreferrer">{t("shell.footer.mainnetFlows")}</a>
          <a href={`${REPO}/blob/main/docs/security/self-review.md`} target="_blank" rel="noreferrer">{t("shell.footer.selfReview")}</a>
          <a href={REPO} target="_blank" rel="noreferrer">{t("shell.footer.sourceMit")}</a>
        </div>
        <div>
          <span className="m-footer__h">{t("shell.footer.more")}</span>
          {ACCOUNT.map((l) => (
            <Link key={l.id} to={l.href}>{l.label.toUpperCase()}</Link>
          ))}
          {MORE.map((l) => (
            <Link key={l.id} to={l.href}>{l.label.toUpperCase()}</Link>
          ))}
          <Link to="/legal/privacy">{t("shell.footer.privacy")}</Link>
        </div>
      </div>
      <p className="m-wrap m-footer__note">{t("shell.footer.lykiaBuiltOnArcNetworkIndependent")}</p>
    </footer>
  );
}
