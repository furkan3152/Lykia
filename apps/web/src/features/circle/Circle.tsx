/** Circle on Arc: the harbor market of products, and the Gateway unified balance with its transfer flow. */
import { CCTP_DESTINATIONS } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPost, describeError } from "../../lib/api";
import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { useEnvironment } from "../../lib/environment";
import { availabilityOf } from "../../lib/optional";
import { useLamp } from "../../lib/pulseStore";
import { Button, Card, Field, Input, Select, Skeleton, Tag, toast } from "../../mosaic";
import { market, MARKET_H, MARKET_W } from "../../mosaic/scenes";
import { SceneFrame } from "../scenes/SceneFrame";
import { normalizeCircle, STATUS_LABEL } from "./model";
import { useCircleStatus } from "./useCircleStatus";
import { t as msg } from "../../i18n";

export function CircleMarket({ compact = false }: { compact?: boolean }) {
  const lit = useLamp();
  const status = useCircleStatus();
  const products = normalizeCircle(status.data);
  const soon = status.isError && availabilityOf(status.error) === "soon";
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <SceneFrame build={(t) => market({ stalls: products.map((p) => ({ status: p.status })), lit }, t)} width={MARKET_W} height={MARKET_H} tile={compact ? 4 : 6} dataKey={`${products.map((p) => p.status).join()}-${lit}`} assembleKey="market" label={msg("circle.theHarborMarketOneStallPer")} labels={[{ x: 50, y: 6, text: soon ? (msg("circle.statusComingSoon")) : msg("circle.circleMarketOnArc"), tone: soon ? "ghost" : undefined }]} />
      <div className="m-grid-3">
        {products.map((p) => (
          <div key={p.id} className="m-frame m-card" style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <div className="flex justify-between items-start gap-2">
              <b style={{ fontFamily: "Pixelify Sans", fontSize: 18 }}>{p.name}</b>
              <Tag tone={STATUS_LABEL[p.status].tone}>{STATUS_LABEL[p.status].en}</Tag>
            </div>
            {p.note ? <p className="m-small m-muted">{p.note}</p> : null}
            {p.docs ? <a className="m-small" href={p.docs} target="_blank" rel="noreferrer">{msg("circle.docs")}</a> : null}
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
  const environment = useEnvironment();
  const wallet = useLykiaWallet();
  const { address } = wallet;
  const [amount, setAmount] = useState("10");
  const [dest, setDest] = useState("base");
  const [busy, setBusy] = useState(false);
  const balance = useQuery({ queryKey: ["gateway", address, environment], enabled: Boolean(address), retry: false, queryFn: ({ signal }) => apiGet<GatewayBalance>("/v1/circle/gateway/balance", { query: { owner: address, environment }, signal }) });
  const transfer = async () => {
    if (!address) return;
    setBusy(true);
    try {
      const intent = await apiPost<BurnIntent>("/v1/circle/gateway/transfer", { owner: address, environment, amount, destination: dest });
      const signature = await wallet.signTypedData(intent.typedData);
      const mint = await apiPost<MintTx>("/v1/circle/gateway/transfer/attest", { owner: address, environment, signature, ...(intent.transferId ? { transferId: intent.transferId } : {}) });
      if (mint.transaction) {
        const [hash] = await wallet.send([mint.transaction]);
        toast.success(msg("circle.gatewayTransferSent"), { description: hash, from: "LYKO" });
      } else toast.info(mint.note ?? "Attested.", { from: "LYKO" });
    } catch (e) {
      toast.error(availabilityOf(e) === "soon" ? (msg("circle.gatewayTransfersAreComingSoon")) : describeError(e), { from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Gateway" kicker={msg("circle.oneUsdcBalanceEveryChain")} tone="sea" footer={<Button tone="sea" onClick={() => void transfer()} disabled={!address || busy}>{busy ? "…" : msg("circle.signSend")}</Button>}>
      <div style={{ display: "grid", gap: 10 }}>
        {!address ? <p className="m-small m-muted m-center">{msg("circle.connectAWalletToReadThe")}</p> : balance.isLoading ? <Skeleton h={40} /> : balance.isError ? <Tag tone="ghost">{availabilityOf(balance.error) === "soon" ? (msg("circle.balanceComingSoon")) : describeError(balance.error)}</Tag> : (
          <div className="m-center"><div className="m-stat__v num">{balance.data?.total ?? "n/a"} USDC</div>{balance.data?.perChain?.map((c) => <span key={c.chain} className="m-small m-muted">{c.chain}: {c.balance} · </span>)}</div>
        )}
        <div className="m-grid-2" style={{ gap: 10 }}>
          <Field label={msg("circle.amountUsdc")}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label={msg("circle.destination")}><Select value={dest} onChange={(e) => setDest(e.target.value)}>{CCTP_DESTINATIONS.filter((d) => d.vm === "evm").map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}</Select></Field>
        </div>
        <p className="m-note m-small">{msg("circle.youSignAnEip712Burn")}</p>
      </div>
    </Card>
  );
}
