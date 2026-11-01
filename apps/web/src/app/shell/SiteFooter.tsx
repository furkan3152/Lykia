import { NETWORKS } from "@lykia/core";

import { cx, FOCUS_RING } from "../../ui/cx";
import { Link } from "../routes/Link";
import { routeHref } from "../routes/routeTable";
import { useRoute } from "../routes/useRoute";
import { useUiStore } from "../state/uiStore";
import { LykiaLogo } from "./LykiaMark";
import { MotionSwitch } from "./MotionToggle";
import { sheetFor } from "./sheets";
import { ThemeToggle } from "./ThemeToggle";

const testnetExplorer = NETWORKS["arc-testnet"].explorerUrl;
const mainnetExplorer = NETWORKS["arc-mainnet"].explorerUrl;

interface FooterLink {
  readonly label: string;
  readonly to: string;
  readonly external?: boolean;
}

const COLUMNS: ReadonlyArray<{ readonly title: string; readonly links: readonly FooterLink[] }> = [
  {
    title: "Deck",
    links: [
      { label: "Deck", to: routeHref("deck") },
      { label: "Flock", to: routeHref("flock") },
      { label: "Fence", to: routeHref("fence") },
      { label: "Scent", to: routeHref("scent") },
    ],
  },
  {
    title: "On Arc",
    links: [
      { label: "Künye", to: routeHref("kunye") },
      { label: "Arc explorer", to: mainnetExplorer, external: true },
      { label: "Testnet explorer", to: testnetExplorer, external: true },
      { label: "Testnet faucet", to: "https://faucet.circle.com", external: true },
    ],
  },
  {
    title: "Builders",
    links: [
      { label: "Developers", to: routeHref("developers") },
      { label: "MCP server", to: `${routeHref("developers")}#mcp` },
      { label: "x402", to: `${routeHref("developers")}#x402` },
    ],
  },
];

function today(): string {
  return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

/** The cartographic margin under every page, centred on the axis. */
function MarginLine() {
  const mode = useUiStore((state) => state.mode);
  return (
    <p className="flex flex-col items-center gap-1 text-center font-tag text-[11px] uppercase text-ink-2 sm:flex-row sm:justify-center sm:gap-3">
      <span>Lykia · built on Arc Network · USDC gas · final in under a second</span>
      <span aria-hidden="true" className="hidden sm:inline">
        ·
      </span>
      <span>{mode === "testnet" ? "Practice pasture (Arc testnet 5042002)" : "Arc mainnet 5042"}</span>
    </p>
  );
}

/** The centred pixel title block: four equal cells. */
function TitleBlock({ cells }: { readonly cells: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className="mx-auto grid w-full max-w-[720px] grid-cols-2 gap-[2px] bg-rule px-frame sm:grid-cols-4">
      {cells.map(([term, value]) => (
        <div key={term} className="flex flex-col items-center gap-1 bg-card px-3 py-2.5 text-center">
          <dt className="font-tag text-[11px] uppercase text-ink-2">{term}</dt>
          <dd className="tnum font-display text-[15px] font-bold uppercase text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Site footer, centred: Lyko and the wordmark, three equal link columns, the title block, the switches and the independence notice. */
export function SiteFooter() {
  const { route } = useRoute();
  const mode = useUiStore((state) => state.mode);
  const sheet = sheetFor(route.id);
  return (
    <footer className="relative z-10 mt-8">
      <div aria-hidden="true" className="px-rule" />
      <div className="mx-auto flex max-w-[1248px] flex-col items-center gap-10 px-6 pb-12 pt-14 text-center">
        <div className="flex flex-col items-center gap-4">
          <LykiaLogo size="lg" />
          <p className="max-w-[460px] text-[15px] leading-relaxed text-ink-2">The agent and stablecoin desk built on Arc Network. Lyko keeps the flock inside the Fence and the wolves out. Your keys stay in your wallet.</p>
        </div>
        <nav aria-label="Footer" className="grid w-full max-w-[720px] grid-cols-1 gap-8 sm:grid-cols-3">
          {COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col items-center">
              <p className="caption mb-3 !text-ink">{column.title}</p>
              <ul className="flex flex-col items-center gap-2 text-[15px]">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a href={link.to} target="_blank" rel="noopener noreferrer" className={cx("text-ink-2 underline-offset-4 hover:text-ink hover:underline", FOCUS_RING)}>
                        {link.label} ↗<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link to={link.to} className={cx("text-ink-2 underline-offset-4 hover:text-ink hover:underline", FOCUS_RING)}>
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <TitleBlock
          cells={[
            ["Stop", `${sheet.number} · ${sheet.name}`],
            ["Date", today()],
            ["Finality", "< 1 s"],
            ["Mode", mode === "testnet" ? "Testnet" : "Mainnet"],
          ]}
        />
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
          <ThemeToggle />
          <MotionSwitch />
        </div>
        <div className="flex flex-col items-center gap-2">
          <MarginLine />
          <p className="text-xs text-ink-3">Lykia is an independent, non-custodial interface built on Arc Network. Not affiliated with or endorsed by Circle.</p>
        </div>
      </div>
    </footer>
  );
}

/** The deck's footer: the margin line, centred, so the sheet ends like a map. */
export function AppFooter() {
  return (
    <footer className="mt-10 hidden md:block">
      <div aria-hidden="true" className="px-rule" />
      <div className="mx-auto max-w-[1248px] px-6 py-6">
        <MarginLine />
      </div>
    </footer>
  );
}
