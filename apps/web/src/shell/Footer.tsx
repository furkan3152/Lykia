import { Link } from "../app/routes/Link";
import { MeanderBand } from "../mosaic";
import { ACCOUNT, AREAS, MORE } from "./nav";

const REPO = "https://github.com/furkan3152/Lykia";

export function Footer() {
  return (
    <footer className="m-footer">
      <MeanderBand />
      <div className="m-wrap m-footer__grid">
        <div>
          <span className="m-footer__h">{"PRODUCT"}</span>
          {AREAS.map((a) => (
            <Link key={a.id} to={a.href} title={a.blurb}>{`${a.label.toUpperCase()} · ${a.short.toUpperCase()}`}</Link>
          ))}
        </div>
        <div>
          <span className="m-footer__h">{"PROOF"}</span>
          <Link to="/league">{"THE LEAGUE"}</Link>
          <Link to="/stats">{"LEDGER · STATS"}</Link>
          <Link to="/ecosystem">{"HARBOUR · ECOSYSTEM"}</Link>
          <a href={`${REPO}/blob/main/docs/flows.md`} target="_blank" rel="noreferrer">{"MAINNET FLOWS"}</a>
          <a href={`${REPO}/blob/main/docs/security/self-review.md`} target="_blank" rel="noreferrer">{"SELF-REVIEW"}</a>
          <a href={REPO} target="_blank" rel="noreferrer">{"SOURCE (MIT)"}</a>
        </div>
        <div>
          <span className="m-footer__h">{"MORE"}</span>
          {ACCOUNT.map((l) => (
            <Link key={l.id} to={l.href}>{l.label.toUpperCase()}</Link>
          ))}
          {MORE.map((l) => (
            <Link key={l.id} to={l.href}>{l.label.toUpperCase()}</Link>
          ))}
          <Link to="/legal/privacy">{"PRIVACY"}</Link>
        </div>
      </div>
      <p className="m-wrap m-footer__note">{"LYKIA · BUILT ON ARC NETWORK · POWERED BY CIRCLE · INDEPENDENT, NOT AFFILIATED WITH OR ENDORSED BY CIRCLE OR ARC · BETA"}</p>
    </footer>
  );
}
