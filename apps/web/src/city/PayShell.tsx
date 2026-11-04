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

  return (
    <CityFrame city={city} home={home} tab={tab} tabs={TABS} onTab={(t) => (t === "ask" ? setSheet("ask") : setTab(t))} action={askBar}>
      {tab === "home" ? (
        <div className="ct-grid">
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
