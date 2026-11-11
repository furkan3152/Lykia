/**
 * The hosted pay page for an invoice or payment link (/pay/:id). It reads
 * the public invoice, shows the line items, the amount due and a QR code of
 * this page, plans the payer's transfer (Lykia's fee shown, the invoice
 * Fence: this payee and this token only, the memo "invoice inv_…"), hands
 * the step to the payer's own wallet through the Outrun and, once it
 * settles, reports the hash so the invoice reconciles from its memo.
 * Mobile first; Mosaic components only.
 */
import { shortAddress, shortHash, type InvoicePublicView } from "@lykia/core";
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { useRouteParam } from "../../app/routes/useRoute";
import { RouteArtifact } from "../../features/route/RouteArtifact";
import { useIntent } from "../../features/route/useIntent";
import { useWallet } from "../../features/wallet/store";
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { qrMatrix, qrSvgPath } from "../../lib/qr";
import { Button, Card, Field, Frame, Input, PageHead, Stat, Tag } from "../../mosaic";
import { intlLocale, t } from "../../i18n";

type PublicInvoice = InvoicePublicView & { readonly url: string };

function Qr({ text }: { text: string }) {
  const { path, size } = useMemo(() => qrSvgPath(qrMatrix(text)), [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={168} height={168} role="img" aria-label={t("pay.qrCodeOfThisPaymentPage")} shapeRendering="crispEdges" style={{ background: "#fff", borderRadius: 6, maxWidth: "100%", height: "auto" }}>
      <path d={path} fill="#111" />
    </svg>
  );
}


const TONE: Record<InvoicePublicView["status"], "ok" | "ochre" | "bad" | "ghost" | "sea"> = { paid: "ok", open: "sea", "partially-paid": "ochre", overdue: "bad", void: "ghost" };

export default function PayPage() {
  const id = useRouteParam("id") ?? "";
  const qc = useQueryClient();
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const invoice = useQuery({ queryKey: ["invoice", id], queryFn: () => apiGet<PublicInvoice>(`/v1/invoices/${encodeURIComponent(id)}/public`), enabled: /^inv_[a-z0-9]{12}$/u.test(id), refetchInterval: 15_000 });
  const [amount, setAmount] = useState("");
  const [intentId, setIntentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState<string | null>(null);
  const intent = useIntent(intentId);
  const reporting = useRef(false);

  const inv = invoice.data;
  const due = inv?.due ?? "0";

  // Once the transfer settles, report its hash: the invoice reconciles from the memo.
  useEffect(() => {
    const step = intent.data?.intent.steps.find((s) => s.kind === "transfer");
    const hash = step?.status === "settled" ? step.references?.[step.references.length - 1] : undefined;
    if (!hash || reported === hash || reporting.current) return;
    reporting.current = true;
    apiPost<{ added: boolean; invoice: InvoicePublicView }>(`/v1/invoices/${encodeURIComponent(id)}/payments`, { hash })
      .then((r) => {
        setReported(hash);
        qc.setQueryData<PublicInvoice>(["invoice", id], (old) => (old ? { ...old, ...r.invoice } : old));
      })
      .catch((e: unknown) => setError(describeError(e)))
      .finally(() => {
        reporting.current = false;
      });
  }, [intent.data, id, qc, reported]);

  const pay = async () => {
    if (!wallet.address) {
      openModal();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { payer: wallet.address, ...(inv?.allowPartial && amount.trim() ? { amount: amount.trim() } : {}), ...(wallet.kind === "passkey" ? { account: "smart" } : {}) };
      const r = await apiPost<{ plan: CreateIntentResponse }>(`/v1/invoices/${encodeURIComponent(id)}/pay`, body);
      qc.setQueryData(["intent", r.plan.intent.id], r.plan);
      setIntentId(r.plan.intent.id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (invoice.isLoading) return <div className="m-wrap" style={{ padding: "48px 0" }}><div className="m-skel" style={{ height: 280 }} /></div>;
  if (!inv) {
    return (
      <div className="m-wrap pay-page" style={{ padding: "32px 0" }}>
        <PageHead kicker={t("pay.payment")} title={t("pay.paymentLinkNotFound")} sub={t("pay.checkTheLinkWithWhoeverSent")} />
      </div>
    );
  }
  const closed = inv.status === "paid" || inv.status === "void";

  return (
    <div className="m-wrap pay-page" style={{ padding: "24px 0 48px" }}>
      <PageHead kicker={inv.brand ? `PAY ${inv.brand.name.toUpperCase()}` : "PAYMENT"} title={`${due === "0" ? inv.amount : due} ${inv.token}`} sub={inv.reference ? t("pay.reference", { reference: inv.reference }) : t("pay.invoice", { id: inv.id })} medal={false}>
        <Tag tone={TONE[inv.status]}>{inv.status.replace("-", " ")}</Tag>
      </PageHead>
      <div className="pay-grid">
        <Card title={t("pay.invoice2")} kicker={inv.environment === "mainnet" ? t("pay.arcMainnet") : t("pay.arcTestnet")}>
          <div className="pay-stats">
            <Stat label={t("pay.total")} value={`${inv.amount} ${inv.token}`} />
            <Stat label={t("pay.paid")} value={`${inv.paid} ${inv.token}`} />
            <Stat label={t("pay.due")} value={`${due} ${inv.token}`} hint={inv.dueDate ? t("pay.dueBy", { date: new Date(inv.dueDate).toLocaleDateString(intlLocale()) }) : undefined} />
          </div>
          {inv.lineItems.length > 0 ? (
            <table className="m-table pay-lines">
              <tbody>
                {inv.lineItems.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{`${l.quantity} × ${l.unitAmount}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {inv.memo ? <p className="m-dim" style={{ marginTop: 12 }}>{inv.memo}</p> : null}
          <p className="m-dim" style={{ marginTop: 12, overflowWrap: "anywhere" }}>{t("pay.paidToTheTransferCarriesThe", { shortAddress: shortAddress(inv.payee), note: inv.note })}</p>
        </Card>
        <Card title={closed ? (inv.status === "paid" ? t("pay.paidInFull") : t("pay.thisInvoiceWasVoided")) : t("pay.pay")} kicker={closed ? t("pay.nothingToPay") : t("pay.signedInYourOwnWallet")}>
          {!closed ? (
            <div className="grid gap-3">
              {inv.allowPartial ? (
                <Field label={t("pay.amount", { token: inv.token })} hint={t("pay.upToLeaveEmptyToPay", { due })}>
                  <Input inputMode="decimal" placeholder={due} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
              ) : null}
              <Button tone="terra" size="lg" onClick={() => void pay()} disabled={busy}>{wallet.address ? (busy ? "Planning…" : t("pay.reviewPayment")) : t("pay.connectAWalletToPay")}</Button>
              <p className="m-dim">{t("pay.lykiaS1FeeIsShown")}</p>
              {error ? <p role="alert" className="m-note">{error}</p> : null}
            </div>
          ) : (
            <p className="m-dim">{inv.status === "paid" ? t("pay.thankYouThePaymentSettledOn") : t("pay.askTheSenderForANew")}</p>
          )}
          {reported ? <p className="m-note" style={{ marginTop: 8, overflowWrap: "anywhere" }}>{t("pay.paymentRecorded", { shortHash: shortHash(reported, 4, 4) })}</p> : null}
          <div className="pay-qr">
            <Qr text={inv.url} />
            <span className="m-dim">{t("pay.scanToOpenThisPageOn")}</span>
          </div>
        </Card>
      </div>
      {intentId ? (
        <div style={{ marginTop: 16 }}>
          <Frame>
            <RouteArtifact intentId={intentId} />
          </Frame>
        </div>
      ) : null}
    </div>
  );
}
