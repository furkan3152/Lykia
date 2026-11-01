/** Circle on Arc: the harbor market of products, and the Gateway unified balance with its transfer flow. */
import { CCTP_DESTINATIONS } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, useSendTransaction, useSignTypedData } from "wagmi";

import { apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLang } from "../../lib/i18n";
import { availabilityOf } from "../../lib/optional";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, Field, Input, Select, Skeleton, Tag, toast } from "../../mosaic";
import { market, MARKET_H, MARKET_W } from "../../mosaic/scenes";
import { SceneFrame } from "../scenes/SceneFrame";
import { normalizeCircle, STATUS_LABEL } from "./model";
import { useCircleStatus } from "./useCircleStatus";

export function CircleMarket({ compact = false }: { compact?: boolean }) {
  const lang = useLang();
  const lit = useLamp();
  const status = useCircleStatus();
  const products = normalizeCircle(status.data);
  const soon = status.isError && availabilityOf(status.error) === "soon";
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <SceneFrame build={(t) => market({ stalls: products.map((p) => ({ status: p.status })), lit }, t)} width={MARKET_W} height={MARKET_H} tile={compact ? 4 : 6} dataKey={`${products.map((p) => p.status).join()}-${lit}`} assembleKey="market" label="The harbor market: one stall per Circle product, awning colour is its status" labels={[{ x: 50, y: 6, text: soon ? (lang === "tr" ? "DURUM YAKINDA" : "STATUS COMING SOON") : lang === "tr" ? "CIRCLE PAZARI · ARC" : "CIRCLE MARKET · ON ARC", tone: soon ? "ghost" : undefined }]} />
      <div className="m-grid-3">
        {products.map((p) => (
          <div key={p.id} className="m-frame m-card" style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <div className="flex justify-between items-start gap-2">
              <b style={{ fontFamily: "Pixelify Sans", fontSize: 18 }}>{p.name}</b>
              <Tag tone={STATUS_LABEL[p.status].tone}>{STATUS_LABEL[p.status][lang]}</Tag>
            </div>
            {p.note ? <p className="m-small m-muted">{p.note}</p> : null}
            {p.docs ? <a className="m-small" href={p.docs} target="_blank" rel="noreferrer">docs ↗</a> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

interface GatewayBalance { readonly total: string | null; readonly perChain?: readonly { readonly chain: string; readonly balance: string }[]; readonly note?: string }
interface BurnIntent { readonly typedData: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }; readonly transferId?: string }
interface MintTx { readonly transaction: { chainId: number; to: `0x${string}`; data: `0x${string}`; value: string } | null; readonly note?: string }

export function GatewayCard() {
  const lang = useLang();
  const environment = useEnvironment();
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const [amount, setAmount] = useState("10");
  const [dest, setDest] = useState("base");
  const [busy, setBusy] = useState(false);
  const balance = useQuery({ queryKey: ["gateway", address, environment], enabled: Boolean(address), retry: false, queryFn: ({ signal }) => apiGet<GatewayBalance>("/v1/circle/gateway/balance", { query: { owner: address, environment }, signal }) });
  const transfer = async () => {
    if (!address) return;
    setBusy(true);
    try {
      const intent = await apiPost<BurnIntent>("/v1/circle/gateway/transfer", { owner: address, environment, amount, destination: dest });
      const signature = await signTypedDataAsync(intent.typedData as never);
      const mint = await apiPost<MintTx>("/v1/circle/gateway/transfer/attest", { owner: address, environment, signature, ...(intent.transferId ? { transferId: intent.transferId } : {}) });
      if (mint.transaction) {
        const hash = await sendTransactionAsync({ to: mint.transaction.to, data: mint.transaction.data, value: BigInt(mint.transaction.value), chainId: mint.transaction.chainId });
        toast.success(lang === "tr" ? "Gateway transferi gönderildi" : "Gateway transfer sent", { description: hash, from: "LYKO" });
      } else toast.info(mint.note ?? "Attested.", { from: "LYKO" });
    } catch (e) {
      toast.error(availabilityOf(e) === "soon" ? (lang === "tr" ? "Gateway transferi yakında" : "Gateway transfers are coming soon") : describeError(e), { from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Gateway" kicker={lang === "tr" ? "TEK USDC BAKİYESİ · HER ZİNCİRDE" : "ONE USDC BALANCE · EVERY CHAIN"} tone="sea" footer={<Button tone="sea" onClick={() => void transfer()} disabled={!address || busy}>{busy ? "…" : lang === "tr" ? "İMZALA VE GÖNDER" : "SIGN & SEND"}</Button>}>
      <div style={{ display: "grid", gap: 10 }}>
        {!address ? <p className="m-small m-muted m-center">{lang === "tr" ? "Bakiye için cüzdan bağla." : "Connect a wallet to read the balance."}</p> : balance.isLoading ? <Skeleton h={40} /> : balance.isError ? <Tag tone="ghost">{availabilityOf(balance.error) === "soon" ? (lang === "tr" ? "BAKİYE YAKINDA" : "BALANCE COMING SOON") : describeError(balance.error)}</Tag> : (
          <div className="m-center"><div className="m-stat__v num">{balance.data?.total ?? "n/a"} USDC</div>{balance.data?.perChain?.map((c) => <span key={c.chain} className="m-small m-muted">{c.chain}: {c.balance} · </span>)}</div>
        )}
        <div className="m-grid-2" style={{ gap: 10 }}>
          <Field label={lang === "tr" ? "Tutar (USDC)" : "Amount (USDC)"}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={lang === "tr" ? "Hedef" : "Destination"}><Select value={dest} onChange={(e) => setDest(e.target.value)}>{CCTP_DESTINATIONS.filter((d) => d.vm === "evm").map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}</Select></Field>
        </div>
        <p className="m-note m-small">{lang === "tr" ? "Önce EIP-712 yakma niyetini imzalarsın, sonra hedefte mint işlemini gönderirsin. Sunucu imzalamaz." : "You sign an EIP-712 burn intent, then send the mint on the destination. The server never signs."}</p>
      </div>
    </Card>
  );
}
