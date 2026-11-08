/**
 * "Where USDC and Circle sit in Lykia": one USDC followed through a Lykia
 * step, stone by stone, each stone tagged with the Circle or Arc primitive
 * it uses, and the Circle integrations beside the router. Data in
 * usdcPath.ts (README.md and docs/circle/README.md carry the same rows).
 */
import { Link } from "../../app/routes/Link";
import { PixelArt } from "../../mosaic/PixelArt";
import { BESIDE_ROUTER, PROVIDER_LABEL, USDC_PATH, type Provider } from "./usdcPath";

const REPO = "https://github.com/furkan3152/Lykia";

/** A USDC coin in tesserae: a blue disc with a cream dollar sign. */
const USDC_COIN = [
  "...bbbbbb...",
  "..bbbbbbbb..",
  ".bbbbwwbbbb.",
  "bbbwwwwwwbbb",
  "bbbwwbbbbbbb",
  "bbbwwwwwwbbb",
  "bbbbbbbwwbbb",
  "bbbwwwwwwbbb",
  ".bbbbwwbbbb.",
  ".bbbbbbbbbb.",
  "..bbbbbbbb..",
  "...bbbbbb...",
];
const COIN_PALETTE = { b: "#1e6fa8", w: "#fff6de" } as const;

export function UsdcCoin({ size = 28 }: { readonly size?: number }) {
  return <PixelArt art={USDC_COIN} palette={COIN_PALETTE} size={size} grout />;
}

export function UsdcPath() {
  return (
    <section id="usdc-circle" className="m-wrap usdc" style={{ scrollMarginTop: 80 }} aria-labelledby="usdc-title">
      <div className="m-center">
        <span className="m-kick">{"WHERE USDC AND CIRCLE SIT IN LYKIA"}</span>
        <h2 id="usdc-title" className="m-h2" style={{ marginTop: 8 }}>{"Follow one USDC through a Lykia step"}</h2>
        <p className="m-sub" style={{ marginTop: 8 }}>{"USDC is what Lykia moves, what it measures in and what it pays gas with. Circle's rails carry it; Lykia adds the route and the rules."}</p>
      </div>

      <p className="usdc-legend" aria-label="Tag colours">
        {(["circle", "arc", "lykia"] as const).map((by) => (
          <span key={by} className="usdc-legend__item"><span className={`usdc-swatch usdc-swatch--${by}`} aria-hidden="true" />{PROVIDER_LABEL[by]}</span>
        ))}
      </p>

      <ol className="usdc-path" aria-label="One USDC through a Lykia step">
        {USDC_PATH.map((stop, i) => (
          <li key={stop.id} className={stop.optional ? "usdc-stop usdc-stop--optional" : "usdc-stop"}>
            <div className="usdc-stop__head">
              <span className="usdc-stop__n" aria-hidden="true">{i === 0 ? <UsdcCoin size={28} /> : i + 1}</span>
              <b className="usdc-stop__title">
                {stop.optional ? <span className="usdc-stop__opt">{"Optional: "}</span> : null}
                {stop.title}
              </b>
            </div>
            <p className="m-small m-muted">{stop.line}</p>
            <ul className="usdc-stop__tags" aria-label="Uses">
              {stop.primitives.map((p) => <li key={p.name}><PrimitiveTag name={p.name} by={p.by} /></li>)}
            </ul>
          </li>
        ))}
      </ol>
      <p className="m-small m-muted m-center usdc-note">{"Shown from a wallet. Lykia's smart account runs the same calls after its own on-chain Fence check. Lykia's 1% fee is a transfer inside the same transaction, in the token the step spends."}</p>

      <div className="usdc-beside">
        <h3 className="m-kick m-center">{"ALSO FROM CIRCLE AND ARC, BESIDE THE ROUTER"}</h3>
        <ul className="usdc-beside__grid" aria-label="Circle and Arc integrations beside the router">
          {BESIDE_ROUTER.map((item) => (
            <li key={item.primitive} className="usdc-beside__item">
              <PrimitiveTag name={item.primitive} by={item.by} />
              <span className="m-small m-muted">{item.line}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="lp-cta" style={{ marginTop: 16 }}>
        <Link to="/app/circle" className="m-btn m-btn--sm m-btn--navy">{"LIVE STATUS OF EACH CIRCLE PRODUCT"}</Link>
        <a href={`${REPO}/blob/main/docs/circle/README.md`} className="m-btn m-btn--sm m-btn--ghost" target="_blank" rel="noreferrer">{"WHERE EACH ONE LIVES IN THE CODE"}</a>
      </div>
    </section>
  );
}

function PrimitiveTag({ name, by }: { readonly name: string; readonly by: Provider }) {
  return (
    <span className={`usdc-tag usdc-tag--${by}`}>
      <span className="sr-only">{`${PROVIDER_LABEL[by]}: `}</span>
      {name}
    </span>
  );
}
