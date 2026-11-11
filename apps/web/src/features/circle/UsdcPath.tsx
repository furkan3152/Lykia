/**
 * "Where USDC and Circle sit in Lykia": one USDC followed through a Lykia
 * step, stone by stone, each stone tagged with the Circle or Arc primitive
 * it uses, and the Circle integrations beside the router. Data in
 * usdcPath.ts (README.md and docs/circle/README.md carry the same rows).
 */
import { Link } from "../../app/routes/Link";
import { PixelArt } from "../../mosaic/PixelArt";
import { MARK_ART, STEP_ART } from "../../mosaic/pixelArtData";
import { BESIDE_ROUTER, PROVIDER_LABEL, USDC_PATH, type BesidePlace, type Provider } from "./usdcPath";

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

/** A EURC coin: the same disc in gold. */
const EURC_PALETTE = { b: "#c8901f", w: "#fff6de" } as const;

/** One pixel icon per product, so each tessera can be told apart at a glance. */
const ICON: Readonly<Record<string, { readonly art: readonly string[]; readonly palette: Readonly<Record<string, string>> }>> = {
  EURC: { art: USDC_COIN, palette: EURC_PALETTE },
  "Compliance Engine": { art: STEP_ART.fence, palette: { k: "#1e6fa8" } },
  "Circle Wallets": { art: STEP_ART.wallet, palette: { k: "#1e6fa8" } },
  "Agent Wallet policy": { art: MARK_ART.out, palette: { k: "#1e6fa8" } },
  "ERC-8004": { art: STEP_ART.delegate, palette: { k: "#13233a" } },
  StableFX: { art: STEP_ART.price, palette: { k: "#7a8696" } },
  "USYC Teller": { art: STEP_ART.read, palette: { k: "#7a8696" } },
  "x402 facilitator": { art: MARK_ART.qr, palette: { k: "#7a8696" } },
  "Agent Marketplace": { art: STEP_ART.scent, palette: { k: "#7a8696" } },
};

const PLACES: readonly { readonly id: BesidePlace; readonly title: string; readonly line: string }[] = [
  { id: "route", title: "IN THE ROUTE", line: "Inside a Lykia step" },
  { id: "beside", title: "BESIDE IT", line: "Wallets, policy and identity around the step" },
  { id: "not-route", title: "NOT ROUTES", line: "A reference quote or a payment rail; never a path your money takes" },
];

export function UsdcCoin({ size = 28 }: { readonly size?: number }) {
  return <PixelArt art={USDC_COIN} palette={COIN_PALETTE} size={size} grout />;
}

export function UsdcPath() {
  return (
    <section id="usdc-circle" className="m-wrap usdc m-floor" style={{ scrollMarginTop: 80 }} aria-labelledby="usdc-title">
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
        <div className="usdc-map" aria-label="Circle and Arc integrations, by where they sit">
          {PLACES.map((place) => (
            <section key={place.id} className={`usdc-map__zone usdc-map__zone--${place.id}`} aria-label={`${place.title}: ${place.line}`}>
              <header className="usdc-map__head">
                <span className="usdc-map__title">{place.title}</span>
                <span className="usdc-map__line">{place.line}</span>
              </header>
              <ul className="usdc-map__stones">
                {BESIDE_ROUTER.filter((b) => b.place === place.id).map((item, i) => {
                  const icon = ICON[item.primitive];
                  return (
                    <li key={item.primitive} className="usdc-tessera" style={{ ["--i" as string]: i }}>
                      <span className="usdc-tessera__icon" aria-hidden="true">{icon ? <PixelArt art={icon.art} palette={icon.palette} size={20} grout /> : null}</span>
                      <span className="usdc-tessera__body">
                        <PrimitiveTag name={item.primitive} by={item.by} />
                        <span className="m-small m-muted">{item.line}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
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
