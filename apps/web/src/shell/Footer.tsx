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
        <span>USDC GAS</span>
        <span>·</span>
        <span>FINAL IN UNDER A SECOND</span>
        <span>·</span>
        <Link to="/app/pastures">PASTURES</Link>
        <Link to="/app/scent">SCENT</Link>
        <Link to="/app/kunye">KÜNYE</Link>
        <Link to="/owner">OWNER</Link>
      </div>
    </footer>
  );
}
