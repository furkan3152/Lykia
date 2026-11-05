/**
 * Situation cards beside Lyko's answers, drawn from typed data (never from
 * parsing prose): the gas gauge, the Fence gate, the pasture of holdings,
 * the rate tile, the herded card, the settled seal, the plan card, the
 * clarifying chips and the calm trouble state. Every animation is laid in
 * steps, like tiles, and stops under prefers-reduced-motion.
 */
import { gasShortfall } from "@lykia/core/api/answer";
import type { AgentProposal, AnswerBlock } from "@lykia/core/api/agents";
import { useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { qrMatrix, qrSvgPath } from "../../lib/qr";
import { LykoFace, Seal, Tag } from "../../mosaic";
import { cx } from "../../mosaic/cx";
import { Mark, PixelArt } from "../../mosaic/PixelArt";
import { useChatActions } from "./actions";
import { planTitle, ruleName, type HerdItem } from "./cardModel";
import { HashChip, RichLine } from "./Markdown";
import { memoryBadges } from "./memoryRefs";


const fmt = (v: string | number, max = 4) => Number(v).toLocaleString("en-US", { maximumFractionDigits: max });
const usd = (v: string) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CardShell({ kind, tone, kick, title, icon, children, className }: { readonly kind: string; readonly tone: "sea" | "ochre" | "terra" | "olive" | "navy"; readonly kick: string; readonly title: React.ReactNode; readonly icon?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <section className={cx("m-card2", className)} data-kind={kind} data-tone={tone}>
      <header className="m-card2__head">
        {icon ? <span className="m-card2__icon" aria-hidden="true">{icon}</span> : null}
        <span className="m-card2__titles">
          <span className="m-card2__kick">{kick}</span>
          <span className="m-card2__title">{title}</span>
        </span>
      </header>
      <div className="m-card2__body">{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- gas */

const DROP = ["...k...", "..kkk..", ".kkkkk.", "kkkkkkk", "kkwkkkk", "kkwkkkk", ".kkkkk.", "..kkk.."];

function Qr({ text }: { readonly text: string }) {
  const { path, size } = useMemo(() => qrSvgPath(qrMatrix(text)), [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={132} height={132} role="img" aria-label="QR code of the wallet address" shapeRendering="crispEdges" className="m-qr">
      <path d={path} fill="#13233a" />
    </svg>
  );
}

function GasCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "gas" }> }) {
  const { prefill, environment } = useChatActions();
  const [qr, setQr] = useState(false);
  const balance = Number(block.balance);
  const floor = Math.max(Number(block.floor), 1e-9);
  const short = gasShortfall(block);
  const low = short !== "0";
  // Twelve stones from empty to twice the floor; the floor sits at the sixth.
  const SEGMENTS = 12;
  const lit = Math.max(balance > 0 ? 1 : 0, Math.min(SEGMENTS, Math.round((balance / (floor * 2)) * SEGMENTS)));
  return (
    <CardShell kind="gas" tone={low ? "terra" : "olive"} kick={low ? "GAS · BELOW YOUR FLOOR" : "GAS · ABOVE YOUR FLOOR"} title={low ? "Fuel is low" : "Fuel is fine"} icon={<PixelArt art={DROP} palette={{ k: low ? "#b9472e" : "#3f7f45", w: "#fff6de" }} size={20} />}>
      <div className="m-gauge" role="meter" aria-valuemin={0} aria-valuemax={floor * 2} aria-valuenow={balance} aria-label={`Gas: ${fmt(balance, 6)} USDC of a ${fmt(floor)} USDC floor`}>
        <div className="m-gauge__stones">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <i key={i} data-lit={i < lit || undefined} data-low={low || undefined} style={{ "--i": i } as React.CSSProperties} />
          ))}
          <span className="m-gauge__floor" style={{ left: "50%" }}>
            <b>floor</b>
          </span>
        </div>
        <div className="m-gauge__scale" aria-hidden="true">
          <span>0</span>
          <span>{fmt(floor)}</span>
          <span>{fmt(floor * 2)}</span>
        </div>
      </div>
      <dl className="m-facts">
        <div>
          <dt>Balance</dt>
          <dd>
            <b className="m-fig">{fmt(balance, 6)}<small>USDC</small></b>
          </dd>
        </div>
        <div>
          <dt>Your floor</dt>
          <dd>
            <b className="m-fig">{fmt(floor, 6)}<small>USDC</small></b>
          </dd>
        </div>
        <div data-tone={low ? "bad" : "ok"}>
          <dt>{low ? "Short by" : "Headroom"}</dt>
          <dd>
            <b className="m-fig">{low ? fmt(short, 6) : fmt(balance - floor, 6)}<small>USDC</small></b>
          </dd>
        </div>
        {block.gasPriceGwei ? (
          <div>
            <dt>Gas price</dt>
            <dd>
              <b className="m-fig">{block.gasPriceGwei}<small>gwei</small></b>
            </dd>
          </div>
        ) : null}
      </dl>
      {block.address ? (
        <div className="m-topup">
          <span className="m-topup__k">{low ? "Top up this wallet" : "This wallet"}</span>
          <HashChip value={block.address} kind="address" environment={environment} />
          <button type="button" className="m-mini" aria-expanded={qr} onClick={() => setQr((q) => !q)}>
            <Mark name="qr" size={11} /> {qr ? "Hide QR" : "Show QR"}
          </button>
          {qr ? <Qr text={block.address} /> : null}
        </div>
      ) : (
        <p className="m-card2__note">Sample wallet: connect yours to see where to top up.</p>
      )}
      <div className="m-card2__acts">
        {prefill ? (
          <button type="button" className="m-mini m-mini--solid" onClick={() => prefill(`Alert me when my gas drops below ${block.floor} USDC`)}>
            <Mark name="bell" size={11} /> Set a gas alert
          </button>
        ) : null}
        <Link to="/app/you" className="m-mini">Change the floor</Link>
      </div>
    </CardShell>
  );
}

/* --------------------------------------------------------------- fence */

const GATE = [
  "k........k",
  "kk......kk",
  "kkbbbbbbkk",
  "kk.b..b.kk",
  "kkbbbbbbkk",
  "kk.b..b.kk",
  "kkbbbbbbkk",
  "kk.b..b.kk",
  "kkbbbbbbkk",
  "kk......kk",
];


function FenceGateCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "fence" }> }) {
  const { prefill, environment } = useChatActions();
  const deny = block.decision === "deny";
  const first = block.rules[0]!;
  return (
    <CardShell kind="fence" tone={deny ? "terra" : "ochre"} kick={deny ? "THE FENCE · GATE SHUT" : "THE FENCE · CONFIRM FIRST"} title={deny ? `Stopped by ${ruleName(first.rule).toLowerCase()}` : "Your confirmation is needed"} icon={<PixelArt art={GATE} palette={{ k: "#13233a", b: deny ? "#b9472e" : "#b7831f" }} size={22} />}>
      <div className="m-gate" data-shut={deny || undefined}>
        <span className="m-gate__post" aria-hidden="true" />
        <ul className="m-gate__rules">
          {block.rules.map((r) => (
            <li key={`${r.rule}${r.message}`}>
              <span className="m-gate__plaque">{ruleName(r.rule)}</span>
              <span className="m-gate__msg"><RichLine text={r.message} environment={environment} /></span>
            </li>
          ))}
        </ul>
        <span className="m-gate__post" aria-hidden="true" />
      </div>
      {block.headroom.length > 0 ? (
        <dl className="m-facts m-facts--tight">
          {block.headroom.map((h) => (
            <div key={h.label}>
              <dt>{h.label}</dt>
              <dd>
                <b className="m-fig">{h.value}</b>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="m-card2__note">{deny ? "Nothing was signed. The Fence never bends for a plan; only you can change a rule, with your signature." : "Nothing moves until you confirm it in your wallet."}</p>
      <div className="m-card2__acts">
        {prefill ? (
          <button type="button" className="m-mini m-mini--solid" onClick={() => prefill(`Change my Fence rule "${ruleName(first.rule)}" so that `)}>
            Ask to change the rule
          </button>
        ) : null}
        <Link to="/app/fold/fence" className="m-mini">See your Fence</Link>
      </div>
    </CardShell>
  );
}

/* ------------------------------------------------------------- balance */

const PASTURE_COLOURS = ["#1e8fa3", "#5f8a3a", "#d9a441", "#b9472e", "#7a5aa8", "#2f4a72", "#c77d2e", "#8aa6b8"];

function PastureCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "balance" }> }) {
  const priced = block.holdings.filter((h) => h.usd !== null && Number(h.usd) > 0);
  const total = priced.reduce((n, h) => n + Number(h.usd), 0);
  // A pasture of 24 x 4 stones, each holding's share laid in its colour, the rest grass.
  const CELLS = 96;
  const cells: string[] = [];
  priced.forEach((h, i) => {
    const n = Math.max(1, Math.round((Number(h.usd) / Math.max(total, 1e-9)) * CELLS));
    for (let k = 0; k < n && cells.length < CELLS; k++) cells.push(PASTURE_COLOURS[i % PASTURE_COLOURS.length]!);
  });
  while (cells.length < CELLS) cells.push("");
  return (
    <CardShell kind="balance" tone="olive" kick="THE FLOCK · WHAT YOU HOLD" title={
        <span className="m-fig m-fig--xl">
          <span className="m-fig__cur">$</span>
          {Number(block.totalUsd ?? total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {block.totalUsd === null ? <small>+ UNPRICED</small> : null}
        </span>
      }>
      {priced.length > 0 ? (
        <div className="m-pasture" role="img" aria-label={`Holdings by value: ${priced.map((h) => `${h.symbol} ${usd(h.usd!)}`).join(", ")}`}>
          {cells.map((c, i) => (
            <i key={i} style={{ ...(c ? { background: c } : {}), "--i": i } as React.CSSProperties} data-grass={!c || undefined} />
          ))}
        </div>
      ) : null}
      <ul className="m-herd">
        {block.holdings.map((h, i) => (
          <li key={`${h.symbol}${h.where}`}>
            <i style={{ background: h.usd !== null && Number(h.usd) > 0 ? PASTURE_COLOURS[priced.indexOf(h) % PASTURE_COLOURS.length] : "#c9b994" }} aria-hidden="true" />
            <b>{h.symbol}</b>
            <span className="m-herd__where">{h.where}</span>
            <span className="m-herd__amt num">{fmt(h.amount, 4)}</span>
            <span className="m-herd__usd num">{h.usd !== null ? usd(h.usd) : "unpriced"}</span>
            <span className="sr-only">{i < block.holdings.length - 1 ? ";" : ""}</span>
          </li>
        ))}
      </ul>
      {block.holdings.length === 0 ? <p className="m-card2__note">Nothing here yet on this network.</p> : null}
      <div className="m-card2__acts">
        <Link to="/app/fold" className="m-mini">Open the Fold</Link>
      </div>
    </CardShell>
  );
}

/* ---------------------------------------------------------------- rate */

function RateTile({ block }: { readonly block: Extract<AnswerBlock, { kind: "rate" }> }) {
  const rate = Number(block.rate);
  const ref = block.reference !== null ? Number(block.reference) : rate;
  const devBps = ref > 0 ? ((rate - ref) / ref) * 10_000 : 0;
  const band = block.bandBps ?? null;
  // The bar spans ±span bps around the reference; the band sits in its middle half.
  const span = Math.max((band ?? 25) * 2, Math.abs(devBps) * 1.25, 20);
  const at = (bps: number) => Math.min(100, Math.max(0, 50 + (bps / span) * 50));
  const pos = at(devBps);
  const bandW = band !== null ? at(band) - 50 : 0;
  const inside = band === null || Math.abs(devBps) <= band;
  return (
    <CardShell kind="rate" tone="sea" kick={block.reference !== null ? "RATE · YOUR QUOTE" : "RATE · REFERENCE"} title={<span className="m-rate"><span className="m-rate__one">1 {block.base} =</span> <span className="m-fig m-fig--xl">{fmt(rate, 4)}<small>{block.quote}</small></span></span>}>
      <div className="m-fxband" aria-label={band !== null ? `Within ${(band / 100).toFixed(2)}% of the reference: ${inside ? "yes" : "no"}` : "Reference rate"}>
        <div className="m-fxband__bar">
          {band !== null ? <span className="m-fxband__ok" style={{ left: `${50 - bandW}%`, width: `${bandW * 2}%` }} /> : null}
          <span className="m-fxband__ref" style={{ left: "50%" }} />
          <span className="m-fxband__pin" data-out={!inside || undefined} style={{ left: `${pos}%` }} />
        </div>
        <div className="m-fxband__scale" aria-hidden="true">
          <span>{`−${(span / 100).toFixed(2)}%`}</span>
          <span>reference {fmt(ref, 4)}</span>
          <span>{`+${(span / 100).toFixed(2)}%`}</span>
        </div>
      </div>
      <dl className="m-facts m-facts--tight">
        {block.reference !== null ? (
          <div data-tone={inside ? "ok" : "bad"}>
            <dt>From reference</dt>
            <dd>
              <b className="m-fig">{devBps >= 0 ? "+" : "−"}{Math.abs(devBps / 100).toFixed(2)}<small>%</small></b>
            </dd>
          </div>
        ) : null}
        {band !== null ? (
          <div>
            <dt>Your FX band</dt>
            <dd>
              <b className="m-fig">±{(band / 100).toFixed(2)}<small>%</small></b>
            </dd>
          </div>
        ) : null}
        {block.source ? (
          <div>
            <dt>Source</dt>
            <dd className="m-facts__src">{block.source.replace(/chainlink:/giu, "Chainlink ")}</dd>
          </div>
        ) : null}
      </dl>
    </CardShell>
  );
}

/* -------------------------------------------------------------- herded */

const SHEEP = ["..cccc.....", ".cccccccckk", "cccccccckwk", "ccccccccckk", ".cccccccc..", "..k.k..k.k.", "..k.k..k.k."];



const KIND_WORD: Readonly<Record<HerdItem["kind"], string>> = { alert: "BARK · ALERT", automation: "ROUND · AUTOMATION", order: "ORDER" };

export function HerdedCard({ items }: { readonly items: readonly HerdItem[] }) {
  const saved = items.filter((i) => i.saved).length;
  const show = items.every((i) => i.kind === "alert") ? "alerts" : items.every((i) => i.kind === "order") ? "orders" : "rounds";
  return (
    <CardShell kind="herded" tone="olive" kick={saved === items.length ? "HERDED · IN YOUR FOLD" : saved > 0 ? "HERDED · SOME NEED YOU" : "DRAFTED · ONE STEP LEFT"} title={saved === items.length ? `${items.length === 1 ? "It's" : "They're"} in the Fold` : "Ready for your signature"}>
      <div className="m-herding" aria-hidden="true">
        {items.slice(0, 5).map((_, i) => (
          <span key={i} className="m-herding__sheep" style={{ "--i": i } as React.CSSProperties}>
            <PixelArt art={SHEEP} palette={{ c: "#fbf5e6", k: "#13233a", w: "#fff" }} size={44} grout />
          </span>
        ))}
        <span className="m-herding__pen" />
      </div>
      <ul className="m-herdlist">
        {items.map((it, i) => (
          <li key={`${it.label}${i}`}>
            <span className="m-herdlist__k">{KIND_WORD[it.kind]}</span>
            <b>{it.label}</b>
            {it.next ? <span className="m-herdlist__next">Next: {it.next}</span> : null}
            <span className="m-herdlist__state" data-saved={it.saved || undefined}>{it.saved ? "Saved" : "Not saved yet"}</span>
            <Link to={it.href} className="m-mini">{it.saved ? "Manage" : it.kind === "order" ? "Sign on the Orders page" : "Review and save"}</Link>
          </li>
        ))}
      </ul>
      <div className="m-card2__acts">
        <Link to={`/app/fold/herding?show=${show}`} className="m-mini m-mini--solid">Open Herding</Link>
      </div>
    </CardShell>
  );
}

/* ------------------------------------------------------------- settled */

const SEAL = [
  "...kkkkkk...",
  "..kooooook..",
  ".kooyyyyook.",
  "kooyyyyyyook",
  "koyyyyyykyok",
  "koyyyyykyyok",
  "koykyykyyyok",
  "koyykkyyyyok",
  "kooyykyyyook",
  ".kooyyyyook.",
  "..kooooook..",
  "...kkkkkk...",
];

function SettledSeal({ block }: { readonly block: Extract<AnswerBlock, { kind: "settled" }> }) {
  const { environment } = useChatActions();
  return (
    <CardShell kind="settled" tone="olive" kick="SETTLED · ON ARC" title={block.summary} className="m-card2--seal">
      <div className="m-sealrow">
        <span className="m-stamp" aria-hidden="true">
          <PixelArt art={SEAL} palette={{ k: "#2c5a31", o: "#3f7f45", y: "#cfe3b8" }} size={64} grout />
        </span>
        <div className="m-sealrow__txt">
          <span className="m-card2__note">Final on the receipt. Arc settles in under a second.</span>
          <HashChip value={block.tx} kind="tx" environment={environment} />
        </div>
      </div>
    </CardShell>
  );
}

/* ---------------------------------------------------------------- plan */


export function ProposalCard({ p, compact = false }: { readonly p: AgentProposal; readonly compact?: boolean }) {
  const { openRoute, environment } = useChatActions();
  const badges = memoryBadges(p);
  return (
    <CardShell kind="route" tone={p.decision === "deny" ? "terra" : p.decision === "confirm" ? "ochre" : "sea"} kick={p.intentId ? "PLAN · READY TO REVIEW" : "PLAN · DRY RUN"} title={planTitle(p.title)}>
      <div className="m-plan__seal">
        <Seal decision={p.decision} />
      </div>
      {badges.length > 0 ? <div className="flex gap-1 flex-wrap">{badges.map((b) => <Tag key={b} tone="sea">FROM MEMORY · {b}</Tag>)}</div> : null}
      <ol className="m-waypoints">
        {p.steps.slice(0, compact ? 3 : 12).map((s, i) => (
          <li key={`${s}${i}`} style={{ "--i": i } as React.CSSProperties}>
            <span className="m-waypoints__n" aria-hidden="true">{i + 1}</span>
            <span><RichLine text={s} environment={environment} /></span>
          </li>
        ))}
      </ol>
      {p.warnings.length > 0 && !compact ? (
        <ul className="m-plan__warn">
          {p.warnings.slice(0, 3).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {p.attribution.length > 0 ? <p className="m-card2__note">By {[...new Set(p.attribution.map((a) => a.agent))].join(", ")}</p> : null}
      <div className="m-card2__acts">
        {openRoute ? (
          <button type="button" className="m-mini m-mini--solid" onClick={() => openRoute(p)}>
            Open the route
          </button>
        ) : null}
        {p.intentId ? (
          <Link to={`/app/outrun/${encodeURIComponent(p.intentId)}`} className="m-mini">
            Review and sign
          </Link>
        ) : null}
      </div>
    </CardShell>
  );
}

/* ------------------------------------------------------------- clarify */

export function ChoiceCard({ question, options, label = (o) => o, onChoose }: { readonly question: string; readonly options: readonly string[]; readonly label?: (o: string) => string; readonly onChoose: (o: string) => void }) {
  return (
    <div className="m-choose" role="group" aria-label={question}>
      <span className="m-choose__q">
        <Mark name="bang" size={10} /> {question}
      </span>
      {options.length > 0 ? (
        <div className="m-choose__opts">
          {options.map((o, i) => (
            <button key={o} type="button" className="m-choose__opt" style={{ "--i": i } as React.CSSProperties} onClick={() => onChoose(o)}>
              {label(o)}
              <Mark name="arrow" size={10} />
            </button>
          ))}
        </div>
      ) : (
        <span className="m-choose__hint">Answer in the box below.</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- trouble */

export function TroubleCard({ message }: { readonly message: string }) {
  const { retry } = useChatActions();
  return (
    <section className="m-trouble" role="status">
      <LykoFace mood="resting" scale={2} />
      <div>
        <b>The trail went quiet.</b>
        <p>{message}</p>
        <p className="m-trouble__calm">Nothing was signed or sent. Your funds did not move.</p>
        {retry ? (
          <button type="button" className="m-mini m-mini--solid" onClick={retry}>
            <Mark name="retry" size={11} /> Try again
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** One block as its card. */
export function BlockCard({ block }: { readonly block: AnswerBlock }) {
  switch (block.kind) {
    case "gas":
      return <GasCard block={block} />;
    case "fence":
      return <FenceGateCard block={block} />;
    case "balance":
      return <PastureCard block={block} />;
    case "rate":
      return <RateTile block={block} />;
    case "herded":
      return <HerdedCard items={block.items} />;
    case "settled":
      return <SettledSeal block={block} />;
    default:
      return null;
  }
}
