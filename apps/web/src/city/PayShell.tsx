/**
 * Lykia Pay (Patara): a payments app on Lykia's engine. Home is the balance,
 * two big actions (request a payment, pay someone), recent invoices and
 * payouts, a payment-link share sheet with a QR code, and an "Ask Lyko" bar.
 * Every payment is a plain USDC transfer the payer signs; Lykia holds nothing.
 */
import type { LeagueCity } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import { LykiaTransport } from "@lykia/sdk";
import { LykiaChat, LykiaProvider, Send } from "@lykia/widget";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useSiwe } from "../features/session/useSiwe";
import { useLykiaWallet } from "../features/wallet/useLykiaWallet";
import { apiGet, apiPost, describeError } from "../lib/api";
import { API_BASE } from "../lib/env";
import { qrMatrix, qrSvgPath } from "../lib/qr";
import { Button, EmptyState, Field, Input, LykoFace, Skeleton, Tag, toast } from "../mosaic";
import { CityFrame, type CityTab } from "./CityFrame";
import { PixelIcon } from "./PixelIcon";
import { usdc18 } from "./model";
import { Sheet } from "./Sheet";
import { intlLocale, t as msg } from "../i18n";

type Tab = "home" | "activity" | "ask";
type SheetId = "request" | "pay" | "share" | "ask" | null;

interface Invoice {
  readonly id: string;
  readonly amount?: string | null;
  /** What has reached the payee so far, and each payment with its time (open-amount invoices count by these). */
  readonly paid?: string;
  readonly payments?: readonly { readonly amount: string; readonly at: string }[];
  readonly token?: string;
  readonly status?: string;
  readonly memo?: string | null;
  readonly createdAt?: string;
}

interface Payout {
  readonly id: string;
  readonly status?: string;
  readonly recipients?: readonly unknown[];
  readonly total?: string;
  readonly createdAt?: string;
}

/** Shown, labelled "sample", until the owner signs in. */
const SAMPLE_ROWS = [
  { kind: "Invoice" as const, id: "s1", title: msg("city.payShell.logoDesignFinalVersion"), status: "paid", at: "2026-11-04T09:12:00Z", amount: "250" },
  { kind: "Invoice" as const, id: "s2", title: msg("city.payShell.lunchOnFriday"), status: "open", at: "2026-11-04T08:40:00Z", amount: "18.50" },
  { kind: "Payout" as const, id: "s3", title: msg("city.payShell.payoutTo4Recipients"), status: "settled", at: "2026-11-03T17:05:00Z", amount: "1200" },
  { kind: "Invoice" as const, id: "s4", title: msg("city.payShell.requestOpenAmount"), status: "open", at: "2026-11-02T11:30:00Z", amount: null },
  { kind: "Invoice" as const, id: "s5", title: msg("city.payShell.octoberConsulting"), status: "paid", at: "2026-11-01T10:00:00Z", amount: "162.50" },
];

const TABS: readonly CityTab<Tab>[] = [
  { id: "home", label: msg("city.payShell.home"), icon: "home" },
  { id: "activity", label: msg("city.payShell.activity"), icon: "list" },
  { id: "ask", label: msg("city.payShell.askLyko"), icon: "ask" },
];

function QrCode({ text }: { readonly text: string }) {
  const { path, size } = useMemo(() => qrSvgPath(qrMatrix(text)), [text]);
  return (
    <svg className="ct-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={msg("city.payShell.qrCodeOfThePaymentLink")} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fbf5e6" />
      <path d={path} fill="#13233a" />
    </svg>
  );
}

export function PayShell({ city, home }: { readonly city: LeagueCity; readonly home: string }) {
  const [tab, setTab] = useState<Tab>("home");
  const [sheet, setSheet] = useState<SheetId>(null);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [link, setLink] = useState<{ readonly url: string; readonly amount: string } | null>(null);
  const wallet = useLykiaWallet();
  const siwe = useSiwe();
  const qc = useQueryClient();
  const env = city.project.network;
  const address = wallet.address;
  const transport = useMemo(() => new LykiaTransport({ baseUrl: new URL(API_BASE).origin, environment: env }), [env]);
  const flock = useQuery({ queryKey: ["city-flock", address, env], enabled: Boolean(address), queryFn: ({ signal }) => apiGet<FlockSnapshot>(`/v1/flock/${address}`, { query: { environment: env }, signal, timeoutMs: 20_000 }) });
  const invoices = useQuery({ queryKey: ["city-invoices"], enabled: siwe.signedIn, queryFn: ({ signal }) => apiGet<{ invoices: Invoice[] }>("/v1/invoices", { signal }) });
  const payouts = useQuery({ queryKey: ["city-payouts"], enabled: siwe.signedIn, queryFn: ({ signal }) => apiGet<{ payouts: Payout[] }>("/v1/payouts", { signal }) });
  const request = useMutation({
    mutationFn: () => apiPost<Invoice>("/v1/invoices", { environment: env, token: "USDC", payee: address, ...(amount ? { amount } : {}), ...(memo.trim() ? { memo: memo.trim() } : {}) }),
    onSuccess: (inv) => {
      setLink({ url: `${home}/pay/${inv.id}`, amount: amount || msg("city.payShell.anyAmount") });
      setSheet("share");
      setAmount("");
      setMemo("");
      void qc.invalidateQueries({ queryKey: ["city-invoices"] });
    },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  const usdc = flock.data?.holdings.find((h) => h.symbol === "USDC" && h.where === "wallet");
  const eurc = flock.data?.holdings.find((h) => h.symbol === "EURC" && h.where === "wallet");
  const balance = usdc ? Number(usdc.amount).toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : flock.data ? usdc18(flock.data.native.usdc18) : null;
  const share = async () => {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: msg("city.payShell.paymentLink", { name: city.project.name }), text: msg("city.payShell.payUsdc", { amount: link.amount }), url: link.url });
      else {
        await navigator.clipboard?.writeText(link.url);
        toast.success(msg("city.payShell.linkCopied"), { from: "LYKO" });
      }
    } catch {
      /* The share sheet was dismissed. */
    }
  };
  const recent = [...(invoices.data?.invoices ?? []).map((i) => ({ kind: "Invoice" as const, id: i.id, title: i.memo || msg("city.payShell.request", { amount: i.amount ? `${i.amount} ${i.token ?? "USDC"}` : msg("city.payShell.openAmount") }), status: i.status ?? "open", at: i.createdAt ?? "" })), ...(payouts.data?.payouts ?? []).map((p) => ({ kind: "Payout" as const, id: p.id, title: msg("city.payShell.payoutToRecipients", { value: p.recipients?.length ?? 0 }), status: p.status ?? "draft", at: p.createdAt ?? "" }))].sort((a, b) => b.at.localeCompare(a.at));

  const askBar = (
    <button type="button" className="ct-askbar" onClick={() => setSheet("ask")}>
      <LykoFace mood="happy" scale={2} label="" className="ct-askbar__face" />
      <span>{msg("city.payShell.askLykoSend25UsdcTo")}</span>
    </button>
  );

  const activity = (
    <section className="ct-card m-frame m-frame--thin" aria-labelledby="pay-recent">
      <div className="ct-card__head">
        <h2 id="pay-recent">{msg("city.payShell.recent")}</h2>
        <span className="m-kick">{msg("city.payShell.invoicesPayouts")}</span>
      </div>
      {!siwe.signedIn ? (
        <div className="ct-empty">
          <p className="m-small m-muted">{msg("city.payShell.signInWithYourWalletOne")}</p>
          <Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy || !address}>{address ? msg("city.payShell.signIn") : msg("city.payShell.connectAWalletFirst")}</Button>
        </div>
      ) : invoices.isLoading ? <Skeleton h={90} /> : recent.length === 0 ? (
        <p className="m-small m-muted ct-empty">{msg("city.payShell.nothingYetRequestYourFirstPayment")}</p>
      ) : (
        <ul className="ct-list">
          {recent.slice(0, 8).map((r) => (
            <li key={r.id}>
              <span className={`ct-dot ct-dot--${r.kind.toLowerCase()}`} aria-hidden="true" />
              <div className="ct-list__t"><b>{r.title}</b><span className="m-small m-muted">{`${r.kind} · ${r.at ? new Date(r.at).toLocaleDateString(intlLocale()) : ""}`}</span></div>
              <Tag tone={r.status === "paid" || r.status === "settled" ? "ok" : "ghost"}>{r.status.toUpperCase()}</Tag>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  // "Today" is the viewer's local day, and every figure in the card counts only today.
  const localDay = (iso: string | undefined | null) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "");
  const today = new Date().toLocaleDateString("en-CA");
  const mine = invoices.data?.invoices ?? [];
  const summary = siwe.signedIn
    ? {
        sample: false,
        requested: mine.filter((i) => localDay(i.createdAt) === today).length,
        // Payments that landed today, so open-amount invoices count by what was actually paid.
        paid: mine.flatMap((i) => i.payments ?? []).filter((p) => localDay(p.at) === today).reduce((a, p) => a + Number(p.amount || 0), 0),
        open: mine.filter((i) => i.status === "open" || i.status === "partially-paid" || i.status === "overdue").length,
        payouts: (payouts.data?.payouts ?? []).filter((x) => localDay(x.createdAt) === today).length,
      }
    : { sample: true, requested: 3, paid: 412.5, open: 2, payouts: 1 };
  const rows = siwe.signedIn
    ? recent.slice(0, 8).map((r) => ({ ...r, amount: r.kind === "Invoice" ? (mine.find((i) => i.id === r.id)?.amount ?? null) : ((payouts.data?.payouts ?? []).find((x) => x.id === r.id)?.total ?? null) }))
    : SAMPLE_ROWS;
  // The preview QR is plain text, not a link: a payment link only exists once it is created (and gets its own id).
  const previewUrl = msg("city.payShell.linkPreview", { amount: amount ? `${amount.slice(0, 16)} USDC` : msg("city.payShell.anyAmount") });

  const desk = (
    <div className="ctd-pay">
      <section className="ct-balance ctd-pay__bal" aria-label={msg("city.payShell.balance")}>
        <span className="m-kick">{msg("city.payShell.balanceArc", { env: env.toUpperCase() })}</span>
        <p className="ct-balance__v num">{!address ? "—" : balance === null ? "…" : `$${balance}`}</p>
        <p className="m-small">{!address ? msg("city.payShell.connectAWalletToSeeYour") : eurc ? msg("city.payShell.usdcInYourWalletPlusEurc", { value: Number(eurc.amount).toFixed(2) }) : msg("city.payShell.usdcInYourWallet")}</p>
        <div className="ct-bigacts">
          <button type="button" className="ct-big ct-big--in" onClick={() => document.getElementById("ctd-amount")?.focus()}><PixelIcon name="in" size={28} />{msg("city.payShell.requestPayment")}</button>
          <button type="button" className="ct-big ct-big--out" onClick={() => setSheet("pay")}><PixelIcon name="out" size={28} />{msg("city.payShell.paySomeone")}</button>
        </div>
      </section>

      <section className="ctd-today m-frame m-frame--thin" aria-labelledby="ctd-today-h">
        <div className="ct-card__head"><h2 id="ctd-today-h">{msg("city.payShell.today")}</h2><span className="m-kick">{summary.sample ? msg("city.payShell.sampleSignInForYours") : new Date().toLocaleDateString(intlLocale(), { weekday: "long", month: "short", day: "numeric" })}</span></div>
        <dl className="ctd-today__grid">
          <div><dt>{msg("city.payShell.requestsSent")}</dt><dd className="num">{summary.requested}</dd></div>
          <div><dt>{msg("city.payShell.paidToYouToday")}</dt><dd className="num">{`$${summary.paid.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd></div>
          <div><dt>{msg("city.payShell.waitingToBePaid")}</dt><dd className="num">{summary.open}</dd></div>
          <div><dt>{msg("city.payShell.payouts")}</dt><dd className="num">{summary.payouts}</dd></div>
        </dl>
        {askBar}
      </section>

      <section className="ctd-builder m-frame m-frame--thin" aria-labelledby="ctd-builder-h">
        <div className="ct-card__head"><h2 id="ctd-builder-h">{msg("city.payShell.paymentLink2")}</h2><span className="m-kick">{msg("city.payShell.livePreview")}</span></div>
        <div className="ctd-builder__in">
          <div className="ct-form">
            <Field label={msg("city.payShell.amountUsdc")} hint={msg("city.payShell.leaveEmptyToLetThePayer")}><Input id="ctd-amount" value={amount} inputMode="decimal" placeholder="25.00" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/gu, ""))} /></Field>
            <Field label={msg("city.payShell.whatFor")}><Input value={memo} maxLength={200} placeholder={msg("city.payShell.lunchOnFriday")} onChange={(e) => setMemo(e.target.value)} /></Field>
            <div className="flex gap-2 flex-wrap">{["10", "25", "100", "250"].map((v) => <button key={v} type="button" className="m-chip ctd-chip" onClick={() => setAmount(v)}>{`$${v}`}</button>)}</div>
            {!address ? (
              <Button className="ct-form__go" onClick={() => setSheet("request")}>{msg("city.payShell.connectToCreate")}</Button>
            ) : !siwe.signedIn ? (
              <Button className="ct-form__go" onClick={() => void siwe.signIn()} disabled={siwe.busy}>{msg("city.payShell.signInToCreate")}</Button>
            ) : (
              <Button className="ct-form__go" onClick={() => request.mutate()} disabled={request.isPending}>{request.isPending ? "CREATING…" : "CREATE THE LINK"}</Button>
            )}
          </div>
          <figure className="ctd-qr">
            <QrCode text={previewUrl} />
            <figcaption>
              <b className="num">{amount ? `${amount} USDC` : msg("city.payShell.anyAmount2")}</b>
              <span className="m-small m-muted">{memo.trim() || msg("city.payShell.noNote")}</span>
              <span className="m-kick">{msg("city.payShell.previewTheLinkGetsItsOwn")}</span>
            </figcaption>
          </figure>
        </div>
        <ol className="ct-steps ctd-steps" aria-label={msg("city.payShell.howAPaymentWorks")}>
          <li><PixelIcon name="in" size={20} /><div><b>{msg("city.payShell.request")}</b><span className="m-small m-muted">{msg("city.payShell.aLinkAndAQrCode")}</span></div></li>
          <li><PixelIcon name="shield" size={20} /><div><b>{msg("city.payShell.theySign")}</b><span className="m-small m-muted">{msg("city.payShell.aPlainUsdcTransferFeeShown")}</span></div></li>
          <li><PixelIcon name="spark" size={20} /><div><b>{msg("city.payShell.itLands")}</b><span className="m-small m-muted">{msg("city.payShell.finalOnArcInUnderA")}</span></div></li>
        </ol>
      </section>

      <section className="ctd-table m-frame m-frame--thin" aria-labelledby="ctd-table-h">
        <div className="ct-card__head">
          <h2 id="ctd-table-h">{msg("city.payShell.recentActivity")}</h2>
          {siwe.signedIn ? <span className="m-kick">{msg("city.payShell.invoicesPayouts")}</span> : <span className="ctd-samplehead"><Tag tone="ochre">{msg("city.payShell.sample")}</Tag><Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy || !address}>{address ? msg("city.payShell.signInForYours") : msg("city.payShell.connectAWallet")}</Button></span>}
        </div>
        {siwe.signedIn && rows.length === 0 ? (
          <p className="m-small m-muted ct-empty">{msg("city.payShell.nothingYetCreateYourFirstLink")}</p>
        ) : (
          <table className="m-table ctd-tbl">
            <thead><tr><th>{msg("city.payShell.kind")}</th><th>{msg("city.payShell.what")}</th><th>{msg("city.payShell.date")}</th><th className="r">{msg("city.payShell.amount")}</th><th className="r">{msg("city.payShell.status")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={siwe.signedIn ? undefined : "ctd-sample"}>
                  <td><span className={`ct-dot ct-dot--${r.kind.toLowerCase()}`} aria-hidden="true" /> {r.kind}</td>
                  <td>{r.title}</td>
                  <td className="num">{r.at ? new Date(r.at).toLocaleDateString(intlLocale(), { month: "short", day: "numeric" }) : "—"}</td>
                  <td className="r num">{r.amount ? `$${Number(r.amount).toFixed(2)}` : "open"}</td>
                  <td className="r"><Tag tone={r.status === "paid" || r.status === "settled" ? "ok" : "ghost"}>{r.status.toUpperCase()}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );

  return (
    <CityFrame city={city} home={home} tab={tab} tabs={TABS} onTab={(t) => (t === "ask" ? setSheet("ask") : setTab(t))} action={askBar}>
      {tab === "home" ? <div className="ct-desk-only">{desk}</div> : null}
      {tab === "home" ? (
        <div className="ct-grid ct-phone-only">
          <section className="ct-balance" aria-label={msg("city.payShell.balance")}>
            <span className="m-kick">{msg("city.payShell.balanceArc", { env: env.toUpperCase() })}</span>
            <p className="ct-balance__v num">{!address ? "—" : balance === null ? "…" : `$${balance}`}</p>
            <p className="m-small">{!address ? msg("city.payShell.connectAWalletToSeeYour") : eurc ? msg("city.payShell.usdcInYourWalletPlusEurc", { value: Number(eurc.amount).toFixed(2) }) : msg("city.payShell.usdcInYourWallet")}</p>
            <div className="ct-bigacts">
              <button type="button" className="ct-big ct-big--in" onClick={() => setSheet("request")}><PixelIcon name="in" size={28} />{msg("city.payShell.requestPayment")}</button>
              <button type="button" className="ct-big ct-big--out" onClick={() => setSheet("pay")}><PixelIcon name="out" size={28} />{msg("city.payShell.paySomeone")}</button>
            </div>
          </section>
          <div className="ct-side">
            <div className="ct-wide-only">{askBar}</div>
            {activity}
          </div>
          <ol className="ct-steps ct-steps--row" aria-label={msg("city.payShell.howAPaymentWorks")}>
            <li><PixelIcon name="in" size={22} /><div><b>{msg("city.payShell.request")}</b><span className="m-small m-muted">{msg("city.payShell.aLinkAndAQrCode2")}</span></div></li>
            <li><PixelIcon name="shield" size={22} /><div><b>{msg("city.payShell.theySign")}</b><span className="m-small m-muted">{msg("city.payShell.aPlainUsdcTransferFromTheir")}</span></div></li>
            <li><PixelIcon name="spark" size={22} /><div><b>{msg("city.payShell.itLands")}</b><span className="m-small m-muted">{msg("city.payShell.finalOnArcInUnderA2")}</span></div></li>
          </ol>
        </div>
      ) : (
        <div className="ct-grid ct-grid--one">{activity}</div>
      )}

      <Sheet open={sheet === "request"} onClose={() => setSheet(null)} title={msg("city.payShell.requestAPayment")}>
        {!address ? <EmptyState mood="happy" title={msg("city.payShell.connectAWallet2")}>{msg("city.payShell.theMoneyGoesStraightToYour")}</EmptyState> : !siwe.signedIn ? (
          <div className="ct-empty"><p className="m-small">{msg("city.payShell.signInOnceASignedMessage")}</p><Button onClick={() => void siwe.signIn()} disabled={siwe.busy}>{msg("city.payShell.signIn")}</Button></div>
        ) : (
          <div className="ct-form">
            <Field label={msg("city.payShell.amountUsdc")} hint={msg("city.payShell.leaveEmptyToLetThePayer")}><Input value={amount} inputMode="decimal" placeholder="25.00" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/gu, ""))} /></Field>
            <Field label={msg("city.payShell.whatFor")}><Input value={memo} maxLength={200} placeholder={msg("city.payShell.lunchOnFriday")} onChange={(e) => setMemo(e.target.value)} /></Field>
            <p className="m-small m-muted">{msg("city.payShell.paidToOnArcThePayer", { address: address.slice(0, 6), address2: address.slice(-4), env })}</p>
            <Button className="ct-form__go" onClick={() => request.mutate()} disabled={request.isPending}>{request.isPending ? "CREATING…" : "CREATE THE LINK"}</Button>
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === "share"} onClose={() => setSheet(null)} title={msg("city.payShell.shareThePaymentLink")}>
        {link ? (
          <div className="ct-share">
            <QrCode text={link.url} />
            <p className="num ct-share__url">{link.url}</p>
            <div className="ct-share__acts">
              <Button onClick={() => void share()}>{msg("city.payShell.share")}</Button>
              <Button tone="ghost" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => toast.success(msg("city.payShell.copied"), { from: "LYKO" }))}>{msg("city.payShell.copy")}</Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={sheet === "pay"} onClose={() => setSheet(null)} title={msg("city.payShell.paySomeone")}>
        <LykiaProvider transport={transport} brand={city.project.brand} modules={city.project.modules} assistantName={city.project.assistantName} environment={env}>
          <Send />
        </LykiaProvider>
      </Sheet>

      <Sheet open={sheet === "ask"} onClose={() => setSheet(null)} title={msg("city.payShell.askLyko")}>
        <LykiaProvider transport={transport} brand={city.project.brand} modules={city.project.modules} assistantName={city.project.assistantName} environment={env}>
          <LykiaChat />
        </LykiaProvider>
      </Sheet>
    </CityFrame>
  );
}
