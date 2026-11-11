/**
 * Situation cards beside Lyko's answers, drawn from typed data (never from
 * parsing prose): the gas gauge, the Fence gate, the pasture of holdings,
 * the rate tile, the herded card, the settled seal, the plan card, the
 * clarifying chips and the calm trouble state. Every animation is laid in
 * steps, like tiles, and stops under prefers-reduced-motion.
 */
import { gasShortfall, sourceLine, type BlockSource } from "@lykia/core/api/answer";
import type { AgentProposal, AnswerBlock } from "@lykia/core/api/agents";
import { planStages, watchForPlan } from "@lykia/core";
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { qrMatrix, qrSvgPath } from "../../lib/qr";
import { LykoFace, Seal, Tag } from "../../mosaic";
import { cx } from "../../mosaic/cx";
import { Mark, PixelArt } from "../../mosaic/PixelArt";
import { useChatActions, useSample } from "./actions";
import { RunningCard } from "./controlCards";
import { PixelIcon } from "../../city/PixelIcon";
import { planTitle, ruleName, type HerdItem } from "./cardModel";
import { HashChip, RichLine } from "./Markdown";
import { memoryBadges } from "./memoryRefs";
import { StateIcon } from "../fold/positions/art";
import { useIntent } from "../route/useIntent";
import { useStopAutopilot } from "../fold/autopilot/data";
import { useEnvironment } from "../../lib/environment";
import { STATE_COLOR, stateLabel } from "../fold/positionsModel";
import { OrderReviewModal } from "../route/OrderReview";
import { CreateCard } from "./createCards";
import { PreflightLine } from "../route/Preflight";
import { preflightView } from "../route/preflightModel";
import { planGist, plainStep } from "../route/plain";
import { runFix } from "../route/preflightActions";
import type { PositionState } from "@lykia/core";
import { formatUsd, intlLocale, formatPercent, t } from "../../i18n";


const fmt = (v: string | number, max = 4) => Number(v).toLocaleString(intlLocale(), { maximumFractionDigits: max });
const usd = (v: string) => formatUsd(Number(v));

/** A card: its title, at most one small label (only when the title does not already say it) and an optional badge. */
export function CardShell({ kind, tone, kick, title, icon, badge, children, className, from }: { readonly kind: string; readonly tone: "sea" | "ochre" | "terra" | "olive" | "navy"; readonly kick?: string | null | undefined; readonly title: React.ReactNode; readonly icon?: React.ReactNode; readonly badge?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string; readonly from?: BlockSource | undefined }) {
  return (
    <section className={cx("m-card2", className)} data-kind={kind} data-tone={tone}>
      <header className="m-card2__head">
        {icon ? <span className="m-card2__icon" aria-hidden="true">{icon}</span> : null}
        <span className="m-card2__titles">
          {kick ? <span className="m-card2__kick">{kick}</span> : null}
          <span className="m-card2__title">{title}</span>
        </span>
        {badge ? <span className="m-card2__badge">{badge}</span> : null}
      </header>
      <div className="m-card2__body">
        {children}
        {from ? <SourceStamp from={from} /> : null}
      </div>
    </section>
  );
}

/** "source · block or time": where a card's figures came from, set like a small tessera stamp; stale data says so. */
export function SourceStamp({ from, compact = false }: { readonly from: BlockSource; readonly compact?: boolean }) {
  const sample = from.source === "sample";
  return (
    <p className={cx("m-source", compact && "m-source--compact")} data-stale={from.stale ? true : undefined} data-sample={sample || undefined} title={sourceLine(from)}>
      <span className="m-source__tile" aria-hidden="true" />
      {from.stale || sample ? <span className="m-source__k">{from.stale ? t("ask.cards.staleBadge") : t("ask.cards.sampleBadge")}</span> : null}
      <span className="m-source__v">{sample ? t("ask.cards.notReadFromArc") : sourceLine(from)}</span>
    </p>
  );
}

/* ----------------------------------------------------------------- gas */

const DROP = ["...k...", "..kkk..", ".kkkkk.", "kkkkkkk", "kkwkkkk", "kkwkkkk", ".kkkkk.", "..kkk.."];

function Qr({ text }: { readonly text: string }) {
  const { path, size } = useMemo(() => qrSvgPath(qrMatrix(text)), [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={132} height={132} role="img" aria-label={t("ask.cards.qrCodeOfTheWalletAddress")} shapeRendering="crispEdges" className="m-qr">
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
    <CardShell kind="gas" tone={low ? "terra" : "olive"} kick={null} title={low ? t("ask.cards.fuelIsLow") : t("ask.cards.fuelIsFine")} icon={<PixelArt art={DROP} palette={{ k: low ? "#b9472e" : "#3f7f45", w: "#fff6de" }} size={20} />} from={block.from}>
      <div className="m-gauge" role="meter" aria-valuemin={0} aria-valuemax={floor * 2} aria-valuenow={balance} aria-label={t("ask.cards.gasUsdcOfAUsdcFloor", { fmt: fmt(balance, 6), fmt2: fmt(floor) })}>
        <div className="m-gauge__stones">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <i key={i} data-lit={i < lit || undefined} data-low={low || undefined} style={{ "--i": i } as React.CSSProperties} />
          ))}
          <span className="m-gauge__floor" style={{ left: "50%" }}>
            <b>{t("ask.cards.floor")}</b>
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
          <dt>{t("ask.cards.balance")}</dt>
          <dd>
            <b className="m-fig">{fmt(balance, 6)}<small>USDC</small></b>
          </dd>
        </div>
        <div>
          <dt>{t("ask.cards.yourFloor")}</dt>
          <dd>
            <b className="m-fig">{fmt(floor, 6)}<small>USDC</small></b>
          </dd>
        </div>
        <div data-tone={low ? "bad" : "ok"}>
          <dt>{low ? t("ask.cards.shortBy") : t("ask.cards.headroom")}</dt>
          <dd>
            <b className="m-fig">{low ? fmt(short, 6) : fmt(balance - floor, 6)}<small>USDC</small></b>
          </dd>
        </div>
        {block.gasPriceGwei ? (
          <div>
            <dt>{t("ask.cards.gasPrice")}</dt>
            <dd>
              <b className="m-fig">{block.gasPriceGwei}<small>gwei</small></b>
            </dd>
          </div>
        ) : null}
      </dl>
      {block.address ? (
        <div className="m-topup">
          <span className="m-topup__k">{low ? t("ask.cards.topUpThisWallet") : t("ask.cards.thisWallet")}</span>
          <HashChip value={block.address} kind="address" environment={environment} />
          <button type="button" className="m-mini" aria-expanded={qr} onClick={() => setQr((q) => !q)}>
            <Mark name="qr" size={11} /> {qr ? t("ask.cards.hideQr") : t("ask.cards.showQr")}
          </button>
          {qr ? <Qr text={block.address} /> : null}
        </div>
      ) : (
        <p className="m-card2__note">{t("ask.cards.sampleWalletConnectYoursToSee")}</p>
      )}
      <div className="m-card2__acts">
        {prefill ? (
          <button type="button" className="m-mini m-mini--solid" onClick={() => prefill(t("ask.cards.alertMeWhenMyGasDrops", { floor: block.floor }))}>
            <Mark name="bell" size={11} /> {t("ask.cards.setAGasAlert")}
          </button>
        ) : null}
        <Link to="/app/you" className="m-mini">{t("ask.cards.changeTheFloor")}</Link>
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
    <CardShell kind="fence" tone={deny ? "terra" : "ochre"} kick={null} title={deny ? t("ask.cards.stoppedBy", { value: ruleName(first.rule).toLowerCase() }) : t("ask.cards.yourConfirmationIsNeeded")} icon={<PixelArt art={GATE} palette={{ k: "#13233a", b: deny ? "#b9472e" : "#b7831f" }} size={22} />}>
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
      <p className="m-card2__note">{deny ? t("ask.cards.nothingWasSignedTheFenceNever") : t("ask.cards.nothingMovesUntilYouConfirmIt")}</p>
      <div className="m-card2__acts">
        {prefill ? (
          <button type="button" className="m-mini m-mini--solid" onClick={() => prefill(t("ask.cards.changeMyFenceRuleSoThat", { ruleName: ruleName(first.rule) }))}>
            {t("ask.cards.askToChangeTheRule")}
          </button>
        ) : null}
        <Link to="/app/fold/fence" className="m-mini">{t("ask.cards.seeYourFence")}</Link>
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
    <CardShell kind="balance" tone="olive" kick={null} from={block.from} title={
        <span className="m-fig m-fig--xl">
          <span className="m-fig__cur">$</span>
          {Number(block.totalUsd ?? total).toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {block.totalUsd === null ? <small>{block.unpriced ? t("ask.cards.plusUnpriced", { n: block.unpriced }) : t("ask.cards.plusSomeUnpriced")}</small> : null}
        </span>
      }>
      {priced.length > 0 ? (
        <div className="m-pasture" role="img" aria-label={t("ask.cards.holdingsByValue", { list: priced.map((h) => `${h.symbol} ${usd(h.usd!)}`).join(", ") })}>
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
      {block.holdings.length === 0 ? <p className="m-card2__note">{t("ask.cards.nothingHereYetOnThisNetwork")}</p> : null}
      <div className="m-card2__acts">
        <Link to="/app/fold" className="m-mini">{t("ask.cards.openTheFold")}</Link>
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
    <CardShell kind="rate" tone={block.from?.stale ? "ochre" : "sea"} from={block.from} kick={block.reference !== null ? t("ask.cards.yourQuote") : t("ask.cards.referenceRate")} title={<span className="m-rate"><span className="m-rate__one">1 {block.base} =</span> <span className="m-fig m-fig--xl">{fmt(rate, 4)}<small>{block.quote}</small></span></span>}>
      <div className="m-fxband" aria-label={band !== null ? t(inside ? "ask.cards.withinBandYes" : "ask.cards.withinBandNo", { band: formatPercent(band / 100) }) : t("ask.cards.referenceRate2")}>
        <div className="m-fxband__bar">
          {band !== null ? <span className="m-fxband__ok" style={{ left: `${50 - bandW}%`, width: `${bandW * 2}%` }} /> : null}
          <span className="m-fxband__ref" style={{ left: "50%" }} />
          <span className="m-fxband__pin" data-out={!inside || undefined} style={{ left: `${pos}%` }} />
        </div>
        <div className="m-fxband__scale" aria-hidden="true">
          <span>{`−${(span / 100).toFixed(2)}%`}</span>
          <span>{t("ask.cards.reference")} {fmt(ref, 4)}</span>
          <span>{`+${(span / 100).toFixed(2)}%`}</span>
        </div>
      </div>
      <dl className="m-facts m-facts--tight">
        {block.reference !== null ? (
          <div data-tone={inside ? "ok" : "bad"}>
            <dt>{t("ask.cards.fromReference")}</dt>
            <dd>
              <b className="m-fig">{devBps >= 0 ? "+" : "−"}{Math.abs(devBps / 100).toFixed(2)}<small>%</small></b>
            </dd>
          </div>
        ) : null}
        {band !== null ? (
          <div>
            <dt>{t("ask.cards.yourFxBand")}</dt>
            <dd>
              <b className="m-fig">±{(band / 100).toFixed(2)}<small>%</small></b>
            </dd>
          </div>
        ) : null}
        {block.source ? (
          <div>
            <dt>{t("ask.cards.source")}</dt>
            <dd className="m-facts__src">{block.source.replace(/chainlink:/giu, "Chainlink ")}</dd>
          </div>
        ) : null}
      </dl>
    </CardShell>
  );
}

/* -------------------------------------------------------------- herded */

const SHEEP = ["..cccc.....", ".cccccccckk", "cccccccckwk", "ccccccccckk", ".cccccccc..", "..k.k..k.k.", "..k.k..k.k."];



const KIND_WORD: Readonly<Record<HerdItem["kind"], string>> = { alert: "WATCH", automation: "AUTOMATION", order: "ORDER", watch: "WATCH" };

export function HerdedCard({ items }: { readonly items: readonly HerdItem[] }) {
  const saved = items.filter((i) => i.saved).length;
  const show = items.every((i) => i.kind === "alert" || i.kind === "watch") ? "watches" : items.every((i) => i.kind === "order") ? "orders" : "automations";
  return (
    <CardShell kind="herded" tone="olive" kick={null} title={saved === items.length ? t("ask.cards.inTheFold", { n: items.length }) : t("ask.cards.readyForYourSignature")}>
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
            {it.next ? <span className="m-herdlist__next">{t("ask.cards.next")} {it.next}</span> : null}
            <span className="m-herdlist__state" data-saved={it.saved || undefined}>{it.saved ? t("ask.cards.saved") : t("ask.cards.notSavedYet")}</span>
            <Link to={it.href} className="m-mini">{it.saved ? t("ask.cards.manage") : t("ask.cards.reviewAndSave")}</Link>
          </li>
        ))}
      </ul>
      <div className="m-card2__acts">
        <Link to={`/app/fold/herding?show=${show}`} className="m-mini m-mini--solid">{t("ask.cards.openHerding")}</Link>
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
    <CardShell kind="settled" tone="olive" kick={null} title={block.summary} className="m-card2--seal">
      <div className="m-sealrow">
        <span className="m-stamp" aria-hidden="true">
          <PixelArt art={SEAL} palette={{ k: "#2c5a31", o: "#3f7f45", y: "#cfe3b8" }} size={64} grout />
        </span>
        <div className="m-sealrow__txt">
          <span className="m-card2__note">{t("ask.cards.finalOnTheReceiptArcSettles")}</span>
          <HashChip value={block.tx} kind="tx" environment={environment} />
        </div>
      </div>
    </CardShell>
  );
}

/* ---------------------------------------------------------------- plan */


const STAGE_WORD: Readonly<Record<string, string>> = { done: "done", active: t("ask.cards.signNow"), settling: "settling", paused: "paused", next: "next", stopped: "stopped" };

/**
 * One plan, live from its intent: what happens (one plain line per step),
 * what you get, what it costs, how long it takes, at most one warning with
 * its fixes, and one primary button. While Lyko's question is open the
 * plan only shows its steps: the question is the thing to do.
 */
function StagedPlan({ p, part, live, waiting }: { readonly p: AgentProposal; readonly part: string | null; readonly live: boolean; readonly waiting: boolean }) {
  const { openReview, openRoute, environment, stopPlan, watchPosition, ask } = useChatActions();
  // A finished plan (from the cache once read) needs no live stream.
  const cached = useQueryClient().getQueryData<CreateIntentResponse>(["intent", p.intentId]);
  const finished = cached ? ((c) => c.done || c.stopped)(planStages(cached.intent)) : false;
  const query = useIntent(p.intentId, { stream: live && !finished });
  const graph = query.data?.intent ?? null;
  const plan = graph ? planStages(graph) : null;
  const [watching, setWatching] = useState<"idle" | "busy" | "set" | "failed">("idle");
  const watchable = plan?.done && graph && watchPosition ? watchForPlan(graph) : null;
  const rows = plan
    ? plan.stages.map((st) => ({ key: st.stepIds.join(","), n: st.n, text: st.summary, state: st.state as string, note: st.state === "done" && st.received ? t("ask.cards.received", { received: st.received }) : st.state === "paused" ? st.reason : st.replanned }))
    : p.steps.map((text, i) => ({ key: `${i}`, n: i + 1, text, state: p.intentId ? (i === 0 ? "active" : "next") : "preview", note: null as string | null }));
  const total = rows.length;
  const started = Boolean(plan?.stages.some((st) => st.state === "done" || st.state === "settling" || st.state === "paused"));
  // Preflight: a block hides Sign; a warning is one line here, and the review modal asks for the tick. Once signing started, it has had its say.
  const pf = preflightView(p.preflight, false);
  const open = !plan?.done && !plan?.stopped;
  const gist = graph && open && !started ? planGist(graph) : null;
  const warning = !waiting && open && !started && pf.needsOwner;
  const signable = Boolean(p.intentId && open && !pf.gate.blocked && !waiting);
  const label = plan?.paused ? t("ask.cards.retryThisStep") : plan && plan.total > 1 && plan.current ? t("ask.cards.reviewAndSignStep", { n: plan.current.n }) : t("ask.cards.reviewAndSign");
  return (
    <div className="m-stageplan">
      {part ? <span className="m-card2__kick">{part}</span> : null}
      {plan && (plan.done || plan.stopped) && total > 1 ? <p className="m-stageplan__head" aria-live="polite">{plan.headline}</p> : null}
      <ol className="m-waypoints m-stages">
        {rows.map((r, i) => (
          <li key={r.key} data-state={r.state} style={{ "--i": i } as React.CSSProperties}>
            <span className="m-waypoints__n" aria-hidden="true">{r.state === "done" ? <Mark name="check" size={10} /> : r.n}</span>
            <span>
              {total > 1 ? <span className="m-stages__of">{t("ask.cards.stepOf", { n: r.n, total })} · {STAGE_WORD[r.state] ?? "preview"}</span> : null}
              <RichLine text={plainStep(r.text)} environment={environment} />
              {r.note ? <small className="m-stages__note" data-tone={r.state === "paused" ? "bad" : undefined}>{r.note}</small> : null}
            </span>
          </li>
        ))}
      </ol>
      {gist && !waiting ? (
        <dl className="m-gist">
          {gist.get ? (
            <div>
              <dt>{t("ask.cards.youGet")}</dt>
              <dd>{gist.get}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t("ask.cards.itCosts")}</dt>
            <dd>{gist.cost}</dd>
          </div>
          <div>
            <dt>{t("ask.cards.itTakes")}</dt>
            <dd>{gist.time}</dd>
          </div>
        </dl>
      ) : null}
      {warning ? <PreflightLine findings={p.preflight} onFix={(fix) => void runFix(fix, ask ? { ask } : {})} /> : null}
      {waiting ? <p className="m-stageplan__wait">{t("ask.cards.answerLykoSQuestionFirstThe")}</p> : null}
      <div className="m-card2__acts m-plan__acts">
        {signable ? (
          openReview ? (
            <div className="m-plan__hero">
              <button type="button" className="m-btn m-btn--hero m-plan__go" onClick={() => openReview(p)}>
                <PixelIcon name="key" size={16} />
                {label}
              </button>
              <small className="m-plan__heroline">{t("ask.cards.opensYourWalletToSignNothing")}</small>
            </div>
          ) : (
            // Outside Ask Lyko the old review route opens the modal over Ask Lyko.
            <Link to={`/app/outrun/${encodeURIComponent(p.intentId!)}`} className="m-btn m-btn--hero m-plan__go">
              {label}
            </Link>
          )
        ) : null}
        {plan?.paused && p.intentId && stopPlan ? (
          <button type="button" className="m-mini" onClick={() => void stopPlan(p.intentId!)}>
            {t("ask.cards.stopHere")}
          </button>
        ) : null}
        {watchable && p.intentId ? (
          <button
            type="button"
            className="m-mini"
            disabled={watching === "busy" || watching === "set"}
            onClick={() => {
              setWatching("busy");
              void watchPosition!(p.intentId!).then(() => setWatching("set"), () => setWatching("failed"));
            }}
          >
            {watching === "set" ? t("ask.cards.lykoOnWatchHasIt") : watching === "failed" ? t("ask.cards.couldNotSetTheWatch") : t("ask.cards.watchThisPosition")}
          </button>
        ) : null}
        {openRoute ? (
          <button type="button" className="m-linkbtn" data-action="open-route" onClick={() => openRoute(p)}>
            {t("ask.cards.openTheRoute")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The plan card: one card for everything a turn planned, signed stage by
 * stage. The current stage is active, later ones wait dimmed as "next";
 * after a stage settles the next is rebuilt from what it delivered.
 */
export function PlanCard({ proposals, compact = false, live = true, waiting = false }: { readonly proposals: readonly AgentProposal[]; readonly compact?: boolean; readonly live?: boolean; readonly waiting?: boolean }) {
  const first = proposals[0];
  if (!first) return null;
  const decision = proposals.some((p) => p.decision === "deny") ? "deny" : proposals.some((p) => p.decision === "confirm") ? "confirm" : "allow";
  const badges = proposals.flatMap((p) => memoryBadges(p));
  const fromWatch = proposals.find((p) => p.from?.agent === "watch");
  const title = proposals.length === 1 ? planTitle(first.title) : t("ask.cards.plansOneAfterAnother", { length: proposals.length });
  const shown = compact ? proposals.slice(0, 1) : proposals;
  const checks = proposals.flatMap((p) => p.preflight ?? []);
  const blocked = checks.some((f) => f.severity === "block");
  const warned = checks.some((f) => f.severity === "warn");
  // At most one warning line: preflight's when it has one, else the plan's own first warning.
  const warningLine = !compact && !waiting && !blocked && !warned ? (proposals.flatMap((p) => p.warnings)[0] ?? null) : null;
  return (
    <CardShell kind="route" tone={decision === "deny" || blocked ? "terra" : decision === "confirm" || warned ? "ochre" : "sea"} kick={waiting ? t("ask.cards.waitingForYourAnswer") : blocked && !first.intentId ? t("ask.cards.canTSignYet") : first.intentId ? null : t("ask.cards.dryRun")} title={title} badge={<Seal decision={decision} stamp={false} />}>
      {fromWatch || badges.length > 0 ? (
        <div className="flex gap-1 flex-wrap">
          {fromWatch ? <Tag tone="ochre">{t("ask.cards.fromLykoOnWatch")}</Tag> : null}
          {[...new Set(badges)].map((b) => <Tag key={b} tone="sea">{t("ask.cards.fromMemory")} {b}</Tag>)}
        </div>
      ) : null}
      {fromWatch?.rationale ? <p className="m-card2__note">{fromWatch.rationale}</p> : null}
      {shown.map((p, i) => <StagedPlan key={`${p.intentId ?? p.title}${i}`} p={p} part={shown.length > 1 ? t("ask.cards.planOf", { value: i + 1, length: shown.length, planTitle: planTitle(p.title) }) : null} live={live} waiting={waiting} />)}
      {warningLine ? <p className="m-plan__warn">{warningLine}</p> : null}
    </CardShell>
  );
}

/** One proposal as a plan card (kept for callers that show a single plan). */
export function ProposalCard({ p, compact = false }: { readonly p: AgentProposal; readonly compact?: boolean }) {
  return <PlanCard proposals={[p]} compact={compact} />;
}

/* ------------------------------------------------------------- clarify */

/**
 * Lyko's question: it waits for the owner, so it speaks in Lyko's voice (his
 * face, a speech tessera, "Lyko asks") and its options are answer tiles,
 * not notes. "Or type your own answer" points at the composer below.
 */
export function ChoiceCard({ question, options, label = (o) => o, onChoose }: { readonly question: string; readonly options: readonly string[]; readonly label?: (o: string) => string; readonly onChoose: (o: string) => void }) {
  return (
    <div className="m-choose" role="group" aria-label={question}>
      <span className="m-choose__who" aria-hidden="true"><LykoFace mood="alert" scale={1.6} /></span>
      <div className="m-choose__bubble">
        <span className="m-choose__k">{t("ask.cards.lykoAsks")}</span>
        <p className="m-choose__q">{question}</p>
        {options.length > 0 ? (
          <div className="m-choose__opts">
            {options.map((o, i) => (
              <button key={o} type="button" className="m-choose__opt" style={{ "--i": i } as React.CSSProperties} onClick={() => onChoose(o)}>
                <span>{label(o)}</span>
                <Mark name="arrow" size={10} />
              </button>
            ))}
          </div>
        ) : null}
        <p className="m-choose__own"><span aria-hidden="true">↓</span> {options.length > 0 ? t("ask.cards.orTypeYourOwnAnswerBelow") : t("ask.cards.typeYourAnswerBelow")}</p>
      </div>
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
        <b>{t("ask.cards.theTrailWentQuiet")}</b>
        <p>{message}</p>
        <p className="m-trouble__calm">{t("ask.cards.nothingWasSignedOrSentYour")}</p>
        {retry ? (
          <button type="button" className="m-mini m-mini--solid" onClick={retry}>
            <Mark name="retry" size={11} /> {t("ask.cards.tryAgain")}
          </button>
        ) : null}
      </div>
    </section>
  );
}


/* --------------------------------------------------------------- facts */

const LANTERN = ["...kk...", "..kyyk..", ".kyyyyk.", ".kyooyk.", ".kyooyk.", ".kyyyyk.", "..kkkk..", "...kk..."];

/** Lyko on watch's sourced answer, and totals the code derived: each figure a tessera with its own source stamp. */
function FactsCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "facts" }> }) {
  // The Fold's sample flock stamps its rows "sample": the card says so in its heading too.
  const fixture = block.rows.some((r) => r.from.source === "sample");
  return (
    <CardShell kind="facts" tone="navy" kick={fixture ? t("ask.cards.sampleFlock") : null} title={block.title} icon={<PixelArt art={LANTERN} palette={{ k: "#13233a", y: "#f0c75e", o: "#d9792b" }} size={20} />}>
      <ul className="m-factrows">
        {block.rows.map((r, i) => (
          <li key={`${r.label}${i}`} style={{ "--i": i } as React.CSSProperties} data-unavailable={r.value === "unavailable" || undefined} data-stale={r.from.stale ? true : undefined}>
            <span className="m-factrows__label">{r.label}</span>
            <b className="m-factrows__value num">{r.value}</b>
            {r.note ? <small className="m-factrows__note">{r.note}</small> : null}
            <SourceStamp from={r.from} compact />
          </li>
        ))}
      </ul>
      {block.note ? <p className="m-card2__note">{block.note}</p> : null}
    </CardShell>
  );
}

/* --------------------------------------------------------------- order */

const KIND_TITLE: Readonly<Record<Extract<AnswerBlock, { kind: "order" }>["input"]["kind"], string>> = { limit: t("ask.cards.limitOrder"), "stop-loss": "Stop-loss", "take-profit": "Take-profit", dca: "DCA", twap: "TWAP" };

/** An order drafted in the chat: its terms and the Fence's verdict, signed through the same review modal as a plan. */
function OrderCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "order" }> }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const deny = block.decision === "deny";
  const pe = block.perExecution;
  const rows = [
    ...(block.approval ? [{ key: "approve", n: 1, text: block.approval, note: t("ask.cards.anExactAllowanceFundsStayIn") }] : []),
    { key: "sign", n: block.approval ? 2 : 1, text: t("ask.cards.signTheOrderOnceEip712"), note: block.executions > 1 ? t("ask.cards.executionsKeepersRunEachWhenIt", { executions: block.executions }) : t("ask.cards.aKeeperRunsItWhenChainlink") },
  ];
  return (
    <CardShell kind="order" tone={deny ? "terra" : block.decision === "confirm" ? "ochre" : "sea"} kick={armed ? t("ask.cards.armedOnArc") : null} title={block.summary.toLowerCase().startsWith(KIND_TITLE[block.input.kind].toLowerCase()) ? block.summary : `${KIND_TITLE[block.input.kind]}: ${block.summary}`}>
      <div className="m-plan__seal">
        <Seal decision={block.decision} />
      </div>
      <dl className="m-facts m-facts--tight">
        <div>
          <dt>{t("ask.cards.eachExecutionSells")}</dt>
          <dd><b className="m-fig">{fmt(block.input.amount, 6)}<small>{pe.symbolIn}</small></b></dd>
        </div>
        <div>
          <dt>{t("ask.cards.getsAtLeast")}</dt>
          <dd><b className="m-fig">{fmt(pe.minOut, 6)}<small>{pe.symbolOut}</small></b></dd>
        </div>
        <div>
          <dt>{t("ask.cards.lykiaFee")}</dt>
          <dd><b className="m-fig">{fmt(pe.fee, 6)}<small>{pe.symbolIn}</small></b></dd>
        </div>
        {block.input.triggerPrice ? (
          <div>
            <dt>{t("ask.cards.trigger")}</dt>
            <dd><b className="m-fig">{fmt(block.input.triggerPrice, 4)}<small>USD</small></b></dd>
          </div>
        ) : null}
      </dl>
      <ol className="m-waypoints m-stages">
        {rows.map((r, i) => (
          <li key={r.key} data-state={armed ? "done" : i === 0 ? "active" : "next"} style={{ "--i": i } as React.CSSProperties}>
            <span className="m-waypoints__n" aria-hidden="true">{armed ? <Mark name="check" size={10} /> : r.n}</span>
            <span>
              <span>{r.text}</span>
              <small className="m-stages__note">{r.note}</small>
            </span>
          </li>
        ))}
      </ol>
      {block.reasons.length > 0 ? (
        <ul className="m-plan__warn">
          {block.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
        </ul>
      ) : null}
      <p className="m-card2__note">{deny ? t("ask.cards.nothingCanBeSignedARule") : t("ask.cards.checkedAgainstYourFenceAndThe")}</p>
      <div className="m-card2__acts">
        {!deny && !armed ? (
          <button type="button" className="m-mini m-mini--solid" onClick={() => setOpen(true)}>
            {t("ask.cards.reviewAndSign")}
          </button>
        ) : null}
        <Link to="/app/fold/herding?show=orders" className="m-mini">{armed ? t("ask.cards.seeItInHerding") : "Herding"}</Link>
      </div>
      {open ? <OrderReviewModal block={block} open={open} onClose={() => setOpen(false)} onArmed={() => setArmed(true)} /> : null}
    </CardShell>
  );
}

/* ----------------------------------------------------------- positions */

function PositionsCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "positions" }> }) {
  const money = (v: number) => `${v < 0 ? "−" : ""}${formatUsd(Math.abs(v), { min: 0, max: Math.abs(v) >= 1000 ? 0 : 2 })}`;
  const sample = useSample();
  // Dust and unpriced lines are one quiet line, never rows of their own.
  const folded = block.hidden ? t("ask.cards.linesHidden", { n: block.hidden }) : block.unpriced ? t("ask.cards.unpricedNotCounted", { unpriced: block.unpriced }) : null;
  const note = [block.weightedApyPercent !== null ? t("ask.cards.earningBlended", { weightedApyPercent: block.weightedApyPercent }) : null, block.yearlyYieldUsd ? t("ask.cards.aYearNet", { usd: usd(block.yearlyYieldUsd) }) : null, block.lowestHealth !== null ? t("ask.cards.lowestHealth", { value: Number(block.lowestHealth).toFixed(2) }) : null, folded, block.unavailable.length > 0 ? t("ask.cards.notRead", { value: block.unavailable.join(", ") }) : null].filter(Boolean).join(" · ");
  const net = block.netUsd ?? block.pricedNetUsd ?? null;
  return (
    <CardShell kind="positions" tone="olive" kick={null} from={block.from} title={
        <span className="m-fig m-fig--xl">
          {net === null ? t("ask.cards.partlyUnpriced") : <><span className="m-fig__cur">$</span>{Number(net).toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{block.netUsd === null ? <small className="m-fig__tag">{t("ask.cards.priced")}</small> : null}</>}
        </span>
      }>
      <ul className="m-poslist">
        {block.rows.map((r) => {
          const state = r.state as PositionState;
          const v = r.valueUsd === null ? null : Number(r.valueUsd);
          return (
            <li key={`${r.venue}${r.label}`} style={{ ["--sc" as string]: STATE_COLOR[state] }}>
              <span className="m-poslist__state" title={stateLabel(state)}><StateIcon state={state} size={11} /></span>
              <span className="m-poslist__main">
                <b>{r.label}</b>
                <small>{sample ? r.doing.replace(/\byour\b/gu, "the") : r.doing}</small>
              </span>
              <span className="m-poslist__usd num" data-tone={v !== null && v < 0 ? "bad" : undefined}>{v === null ? "unpriced" : money(v)}</span>
            </li>
          );
        })}
      </ul>
      {block.rows.length === 0 ? <p className="m-card2__note">{t("ask.cards.nothingDeployedOnThisNetworkYet")}</p> : null}
      <p className="m-card2__note">{note || t("ask.cards.readFromTheChainAndCircle")}</p>
      <div className="m-card2__acts">
        <Link to="/app/fold/flock" className="m-mini">{t("ask.cards.openThePositionMap")}</Link>
      </div>
    </CardShell>
  );
}

/** One block as its card. */
/* -------------------------------------------------- capabilities, offers, stress */

function CapabilitiesCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "capabilities" }> }) {
  return (
    <CardShell kind="capabilities" tone="sea" kick={null} title={block.title}>
      <div className="m-capmap">
        {block.sections.map((sec) => (
          <div key={sec.label} className="m-capmap__sec">
            <b className="m-capmap__label">{sec.label}</b>
            {sec.note ? <p className="m-card2__note">{sec.note}</p> : null}
            <ul className={cx("m-capmap__items", sec.items.every((i) => i.note === null) && "m-capmap__items--chips")}>
              {sec.items.map((i) => (
                <li key={i.name}>
                  <span>{i.name}</span>
                  {i.note ? <small>{i.note}</small> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

function StopAutopilotButton() {
  const environment = useEnvironment();
  const { stop, busy } = useStopAutopilot(environment);
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="m-mini m-mini--stop" disabled={busy || done} onClick={() => void stop(t("ask.cards.stoppedFromAskLyko")).then((r) => setDone(r !== null))}>
      {done ? "STOPPED" : busy ? "STOPPING…" : t("ask.cards.stopAutopilot")}
    </button>
  );
}

function OfferCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "offer" }> }) {
  const stopAutopilot = block.feature === "autopilot" && block.cta === "Stop Autopilot";
  return (
    <CardShell kind="offer" tone={stopAutopilot ? "terra" : "olive"} kick={stopAutopilot ? t("ask.cards.oneTap") : t("ask.cards.lykoSuggests")} title={block.title}>
      <p className="m-card2__note m-offer__line">{block.line}</p>
      <div className="m-card2__acts">
        {stopAutopilot ? <StopAutopilotButton /> : null}
        <Link to={block.href} className="m-mini">{stopAutopilot ? t("ask.cards.openAutopilot") : block.cta}</Link>
      </div>
    </CardShell>
  );
}

function StressCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "stress" }> }) {
  const before = Number(block.beforeUsd);
  const after = Number(block.afterUsd);
  const money = (v: number) => formatUsd(Math.round(v), { min: 0, max: 0 });
  return (
    <CardShell kind="stress" tone={block.closest && Number(block.closest.health) < 1 ? "terra" : "navy"} kick={t("ask.cards.stressTest")} title={block.scenario}>
      <p className="m-card2__note">{block.sentence}</p>
      <dl className="m-stress">
        <div><dt>{t("ask.cards.worthNow")}</dt><dd className="num">{money(before)}</dd></div>
        <div><dt>{t("ask.cards.worthAfter")}</dt><dd className="num" data-tone={after < before ? "bad" : undefined}>{money(after)}</dd></div>
        <div><dt>{t("ask.cards.closestLiquidation")}</dt><dd className="num">{block.closest ? t("ask.cards.away", { value: Number(block.closest.roomPercent).toFixed(0), venue: block.closest.venue }) : "none"}</dd></div>
      </dl>
      <div className="m-card2__acts">
        <Link to="/app/fold/flock" className="m-mini">{t("ask.cards.openTheStressTest")}</Link>
      </div>
    </CardShell>
  );
}

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
    case "positions":
      return <PositionsCard block={block} />;
    case "capabilities":
      return <CapabilitiesCard block={block} />;
    case "offer":
      return <OfferCard block={block} />;
    case "facts":
      return <FactsCard block={block} />;
    case "order":
      return <OrderCard block={block} />;
    case "stress":
      return <StressCard block={block} />;
    case "running":
      return <RunningCard block={block} />;
    case "sample":
      // Drawn first by the message itself (Answer.tsx); never twice.
      return null;
    default:
      return <CreateCard block={block} />;
  }
}
