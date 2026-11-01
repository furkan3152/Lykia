import { Link } from "../app/routes/Link";
import { MeanderBand } from "../mosaic";

export function Footer() {
  return (
    <footer className="m-footer">
      <MeanderBand />
      <div className="m-wrap m-footer__in">
        <span>LYKIA</span>
        <span>·</span>
        <span>BUILT ON ARC NETWORK</span>
        <span>·</span>
        <span>POWERED BY CIRCLE</span>
        <span>·</span>
        <span>USDC GAS</span>
        <span>·</span>
        <span>FINAL IN UNDER A SECOND</span>
        <span>·</span>
        <Link to="/ecosystem">ECOSYSTEM</Link>
        <Link to="/app/pastures">PASTURES</Link>
        <Link to="/app/scent">SCENT</Link>
        <Link to="/app/tag">TAG</Link>
        <Link to="/stats">STATS</Link>
        <Link to="/owner">OWNER</Link>
        <span>·</span>
        <Link to="/legal/notice">TERMS · SOFTWARE NOTICE</Link>
        <Link to="/legal/notice">RISKS</Link>
        <Link to="/legal/privacy">PRIVACY</Link>
        <span>{"DRAFT · NOT AFFILIATED WITH CIRCLE OR ARC"}</span>
      </div>
    </footer>
  );
}
