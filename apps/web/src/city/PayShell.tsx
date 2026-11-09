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
  { kind: "Invoice" as const, id: "s1", title: "Logo design, final version", status: "paid", at: "2026-11-04T09:12:00Z", amount: "250" },
  { kind: "Invoice" as const, id: "s2", title: "Lunch on Friday", status: "open", at: "2026-11-04T08:40:00Z", amount: "18.50" },
  { kind: "Payout" as const, id: "s3", title: "Payout to 4 recipients", status: "settled", at: "2026-11-03T17:05:00Z", amount: "1200" },
  { kind: "Invoice" as const, id: "s4", title: "Request (open amount)", status: "open", at: "2026-11-02T11:30:00Z", amount: null },
  { kind: "Invoice" as const, id: "s5", title: "October consulting", status: "paid", at: "2026-11-01T10:00:00Z", amount: "162.50" },
];

const TABS: readonly CityTab<Tab>[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "activity", label: "Activity", icon: "list" },
  { id: "ask", label: "Ask Lyko", icon: "ask" },
];

function QrCode({ text }: { readonly text: string }) {
  const { path, size } = useMemo(() => qrSvgPath(qrMatrix(text)), [text]);
  return (
    <svg className="ct-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code of the payment link" shapeRendering="crispEdges">
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
      setLink({ url: `${home}/pay/${inv.id}`, amount: amount || "any amount" });
      setSheet("share");
      setAmount("");
      setMemo("");
      void qc.invalidateQueries({ queryKey: ["city-invoices"] });
    },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  const usdc = flock.data?.holdings.find((h) => h.symbol === "USDC" && h.where === "wallet");
  const eurc = flock.data?.holdings.find((h) => h.symbol === "EURC" && h.where === "wallet");
  const balance = usdc ? Number(usdc.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : flock.data ? usdc18(flock.data.native.usdc18) : null;
  const share = async () => {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: `${city.project.name} payment link`, text: `Pay ${link.amount} USDC`, url: link.url });
      else {
        await navigator.clipboard?.writeText(link.url);
        toast.success("Link copied", { from: "LYKO" });
      }
    } catch {
      /* The share sheet was dismissed. */
    }
  };
  const recent = [...(invoices.data?.invoices ?? []).map((i) => ({ kind: "Invoice" as const, id: i.id, title: i.memo || `Request ${i.amount ? `${i.amount} ${i.token ?? "USDC"}` : "(open amount)"}`, status: i.status ?? "open", at: i.createdAt ?? "" })), ...(payouts.data?.payouts ?? []).map((p) => ({ kind: "Payout" as const, id: p.id, title: `Payout to ${p.recipients?.length ?? 0} recipients`, status: p.status ?? "draft", at: p.createdAt ?? "" }))].sort((a, b) => b.at.localeCompare(a.at));

  const askBar = (
    <button type="button" className="ct-askbar" onClick={() => setSheet("ask")}>
      <LykoFace mood="happy" scale={2} label="" className="ct-askbar__face" />
      <span>{"Ask Lyko: \"send 25 USDC to Ayla for lunch\""}</span>
    </button>
  );

  const activity = (
    <section className="ct-card m-frame m-frame--thin" aria-labelledby="pay-recent">
      <div className="ct-card__head">
        <h2 id="pay-recent">{"Recent"}</h2>
        <span className="m-kick">{"INVOICES · PAYOUTS"}</span>
      </div>
      {!siwe.signedIn ? (
        <div className="ct-empty">
          <p className="m-small m-muted">{"Sign in with your wallet (one message, no transaction) to see your invoices and payouts."}</p>
          <Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy || !address}>{address ? "SIGN IN" : "CONNECT A WALLET FIRST"}</Button>
        </div>
      ) : invoices.isLoading ? <Skeleton h={90} /> : recent.length === 0 ? (
        <p className="m-small m-muted ct-empty">{"Nothing yet. Request your first payment and it shows up here."}</p>
      ) : (
        <ul className="ct-list">
          {recent.slice(0, 8).map((r) => (
            <li key={r.id}>
              <span className={`ct-dot ct-dot--${r.kind.toLowerCase()}`} aria-hidden="true" />
              <div className="ct-list__t"><b>{r.title}</b><span className="m-small m-muted">{`${r.kind} · ${r.at ? new Date(r.at).toLocaleDateString("en-US") : ""}`}</span></div>
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
  const previewUrl = `Lykia link preview: ${amount ? `${amount.slice(0, 16)} USDC` : "any amount"}. Create the link to get a payable code.`;

  const desk = (
    <div className="ctd-pay">
      <section className="ct-balance ctd-pay__bal" aria-label="Balance">
        <span className="m-kick">{`BALANCE · ARC ${env.toUpperCase()}`}</span>
        <p className="ct-balance__v num">{!address ? "—" : balance === null ? "…" : `$${balance}`}</p>
        <p className="m-small">{!address ? "Connect a wallet to see your balance." : eurc ? `USDC in your wallet · plus ${Number(eurc.amount).toFixed(2)} EURC` : "USDC in your wallet"}</p>
        <div className="ct-bigacts">
          <button type="button" className="ct-big ct-big--in" onClick={() => document.getElementById("ctd-amount")?.focus()}><PixelIcon name="in" size={28} />{"Request payment"}</button>
          <button type="button" className="ct-big ct-big--out" onClick={() => setSheet("pay")}><PixelIcon name="out" size={28} />{"Pay someone"}</button>
        </div>
      </section>

      <section className="ctd-today m-frame m-frame--thin" aria-labelledby="ctd-today-h">
        <div className="ct-card__head"><h2 id="ctd-today-h">{"Today"}</h2><span className="m-kick">{summary.sample ? "SAMPLE · SIGN IN FOR YOURS" : new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span></div>
        <dl className="ctd-today__grid">
          <div><dt>{"Requests sent"}</dt><dd className="num">{summary.requested}</dd></div>
          <div><dt>{"Paid to you today"}</dt><dd className="num">{`$${summary.paid.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd></div>
          <div><dt>{"Waiting to be paid"}</dt><dd className="num">{summary.open}</dd></div>
          <div><dt>{"Payouts"}</dt><dd className="num">{summary.payouts}</dd></div>
        </dl>
        {askBar}
      </section>

      <section className="ctd-builder m-frame m-frame--thin" aria-labelledby="ctd-builder-h">
        <div className="ct-card__head"><h2 id="ctd-builder-h">{"Payment link"}</h2><span className="m-kick">{"LIVE PREVIEW"}</span></div>
        <div className="ctd-builder__in">
          <div className="ct-form">
            <Field label="Amount (USDC)" hint="Leave empty to let the payer choose."><Input id="ctd-amount" value={amount} inputMode="decimal" placeholder="25.00" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/gu, ""))} /></Field>
            <Field label="What for"><Input value={memo} maxLength={200} placeholder="Lunch on Friday" onChange={(e) => setMemo(e.target.value)} /></Field>
            <div className="flex gap-2 flex-wrap">{["10", "25", "100", "250"].map((v) => <button key={v} type="button" className="m-chip ctd-chip" onClick={() => setAmount(v)}>{`$${v}`}</button>)}</div>
            {!address ? (
              <Button className="ct-form__go" onClick={() => setSheet("request")}>{"CONNECT TO CREATE"}</Button>
            ) : !siwe.signedIn ? (
              <Button className="ct-form__go" onClick={() => void siwe.signIn()} disabled={siwe.busy}>{"SIGN IN TO CREATE"}</Button>
            ) : (
              <Button className="ct-form__go" onClick={() => request.mutate()} disabled={request.isPending}>{request.isPending ? "CREATING…" : "CREATE THE LINK"}</Button>
            )}
          </div>
          <figure className="ctd-qr">
            <QrCode text={previewUrl} />
            <figcaption>
              <b className="num">{amount ? `${amount} USDC` : "Any amount"}</b>
              <span className="m-small m-muted">{memo.trim() || "No note"}</span>
              <span className="m-kick">{"PREVIEW · THE LINK GETS ITS OWN ID WHEN CREATED"}</span>
            </figcaption>
          </figure>
        </div>
        <ol className="ct-steps ctd-steps" aria-label="How a payment works">
          <li><PixelIcon name="in" size={20} /><div><b>{"Request"}</b><span className="m-small m-muted">{"A link and a QR code, any amount."}</span></div></li>
          <li><PixelIcon name="shield" size={20} /><div><b>{"They sign"}</b><span className="m-small m-muted">{"A plain USDC transfer, fee shown first."}</span></div></li>
          <li><PixelIcon name="spark" size={20} /><div><b>{"It lands"}</b><span className="m-small m-muted">{"Final on Arc in under a second."}</span></div></li>
        </ol>
      </section>

      <section className="ctd-table m-frame m-frame--thin" aria-labelledby="ctd-table-h">
        <div className="ct-card__head">
          <h2 id="ctd-table-h">{"Recent activity"}</h2>
          {siwe.signedIn ? <span className="m-kick">{"INVOICES · PAYOUTS"}</span> : <span className="ctd-samplehead"><Tag tone="ochre">{"SAMPLE"}</Tag><Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy || !address}>{address ? "SIGN IN FOR YOURS" : "CONNECT A WALLET"}</Button></span>}
        </div>
        {siwe.signedIn && rows.length === 0 ? (
          <p className="m-small m-muted ct-empty">{"Nothing yet. Create your first link above and it shows up here."}</p>
        ) : (
          <table className="m-table ctd-tbl">
            <thead><tr><th>{"Kind"}</th><th>{"What"}</th><th>{"Date"}</th><th className="r">{"Amount"}</th><th className="r">{"Status"}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={siwe.signedIn ? undefined : "ctd-sample"}>
                  <td><span className={`ct-dot ct-dot--${r.kind.toLowerCase()}`} aria-hidden="true" /> {r.kind}</td>
                  <td>{r.title}</td>
                  <td className="num">{r.at ? new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
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
          <section className="ct-balance" aria-label="Balance">
            <span className="m-kick">{`BALANCE · ARC ${env.toUpperCase()}`}</span>
            <p className="ct-balance__v num">{!address ? "—" : balance === null ? "…" : `$${balance}`}</p>
            <p className="m-small">{!address ? "Connect a wallet to see your balance." : eurc ? `USDC in your wallet · plus ${Number(eurc.amount).toFixed(2)} EURC` : "USDC in your wallet"}</p>
            <div className="ct-bigacts">
              <button type="button" className="ct-big ct-big--in" onClick={() => setSheet("request")}><PixelIcon name="in" size={28} />{"Request payment"}</button>
              <button type="button" className="ct-big ct-big--out" onClick={() => setSheet("pay")}><PixelIcon name="out" size={28} />{"Pay someone"}</button>
            </div>
          </section>
          <div className="ct-side">
            <div className="ct-wide-only">{askBar}</div>
            {activity}
          </div>
          <ol className="ct-steps ct-steps--row" aria-label="How a payment works">
            <li><PixelIcon name="in" size={22} /><div><b>{"Request"}</b><span className="m-small m-muted">{"A link and a QR code for any amount, or let the payer choose."}</span></div></li>
            <li><PixelIcon name="shield" size={22} /><div><b>{"They sign"}</b><span className="m-small m-muted">{"A plain USDC transfer from their own wallet, fee shown first."}</span></div></li>
            <li><PixelIcon name="spark" size={22} /><div><b>{"It lands"}</b><span className="m-small m-muted">{"Final on Arc in under a second, straight to your address."}</span></div></li>
          </ol>
        </div>
      ) : (
        <div className="ct-grid ct-grid--one">{activity}</div>
      )}

      <Sheet open={sheet === "request"} onClose={() => setSheet(null)} title="Request a payment">
        {!address ? <EmptyState mood="happy" title="Connect a wallet">{"The money goes straight to your own address."}</EmptyState> : !siwe.signedIn ? (
          <div className="ct-empty"><p className="m-small">{"Sign in once (a signed message, no transaction) so the link is yours."}</p><Button onClick={() => void siwe.signIn()} disabled={siwe.busy}>{"SIGN IN"}</Button></div>
        ) : (
          <div className="ct-form">
            <Field label="Amount (USDC)" hint="Leave empty to let the payer choose."><Input value={amount} inputMode="decimal" placeholder="25.00" onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/gu, ""))} /></Field>
            <Field label="What for"><Input value={memo} maxLength={200} placeholder="Lunch on Friday" onChange={(e) => setMemo(e.target.value)} /></Field>
            <p className="m-small m-muted">{`Paid to ${address.slice(0, 6)}…${address.slice(-4)} on Arc ${env}. The payer sees the amount and Lykia's fee before signing.`}</p>
            <Button className="ct-form__go" onClick={() => request.mutate()} disabled={request.isPending}>{request.isPending ? "CREATING…" : "CREATE THE LINK"}</Button>
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === "share"} onClose={() => setSheet(null)} title="Share the payment link">
        {link ? (
          <div className="ct-share">
            <QrCode text={link.url} />
            <p className="num ct-share__url">{link.url}</p>
            <div className="ct-share__acts">
              <Button onClick={() => void share()}>{"SHARE"}</Button>
              <Button tone="ghost" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => toast.success("Copied", { from: "LYKO" }))}>{"COPY"}</Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet open={sheet === "pay"} onClose={() => setSheet(null)} title="Pay someone">
        <LykiaProvider transport={transport} brand={city.project.brand} modules={city.project.modules} assistantName={city.project.assistantName} environment={env}>
          <Send />
        </LykiaProvider>
      </Sheet>

      <Sheet open={sheet === "ask"} onClose={() => setSheet(null)} title="Ask Lyko">
        <LykiaProvider transport={transport} brand={city.project.brand} modules={city.project.modules} assistantName={city.project.assistantName} environment={env}>
          <LykiaChat />
        </LykiaProvider>
      </Sheet>
    </CityFrame>
  );
}
