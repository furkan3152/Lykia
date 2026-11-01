/** Conditional orders on Arc: limit, stop-loss, take-profit, DCA and TWAP, signed once and run by keepers. */
import { ORDER_KINDS, type OrderKind, type OrderView, type SignedOrderStruct } from "@lykia/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { DeskTabs } from "../../features/desk/DeskTabs";
import { useLykiaWallet, type WalletTx } from "../../features/wallet/useLykiaWallet";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, EmptyState, Field, Input, PageHead, Select, Skeleton, Tag, Toggle, toast } from "../../mosaic";

interface OrdersConfig {
  readonly address: string | null;
  readonly feeBps: number;
  readonly keeper: "server" | "anyone";
  readonly feeds: Record<string, { address: string; pair: string }>;
  readonly notes: readonly string[];
}
interface Draft {
  readonly order: SignedOrderStruct;
  readonly hash: string;
  readonly summary: string;
  readonly typedData: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: SignedOrderStruct };
  readonly approval: (WalletTx & { label: string }) | null;
  readonly perExecution: { fee: string; maxTip: string; swapped: string; minOut: string; symbolIn: string; symbolOut: string };
  readonly notes: readonly string[];
}
type Tx = WalletTx & { label: string };

const KIND_LABEL: Record<OrderKind, string> = { limit: "Limit", "stop-loss": "Stop-loss", "take-profit": "Take-profit", dca: "DCA", twap: "TWAP" };
const KIND_HELP: Record<OrderKind, string> = {
  limit: "Swap once, when the price reaches your level (or at once at your minimum, without a trigger).",
  "stop-loss": "Sell when the Chainlink price falls to your level, so a drop does not run further.",
  "take-profit": "Sell when the Chainlink price rises to your level.",
  dca: "Buy the same amount on a schedule, optionally only while the price is on your side.",
  twap: "Split one large swap into equal slices over time to soften the price impact.",
};
const STATUS_TONE = { open: "ok", waiting: "ochre", filled: "sea", cancelled: "ghost", expired: "ghost", invalid: "bad" } as const;
const TOKENS = ["USDC", "EURC", "cirBTC"] as const;

/** viem wants bigint for uint fields in typed data. */
function signable(td: Draft["typedData"]): Record<string, unknown> {
  const m = td.message;
  const message = { ...m, amountIn: BigInt(m.amountIn), minAmountOut: BigInt(m.minAmountOut), maxTip: BigInt(m.maxTip), triggerPrice: BigInt(m.triggerPrice), startTime: BigInt(m.startTime), deadline: BigInt(m.deadline), nonce: BigInt(m.nonce) };
  const { EIP712Domain: _drop, ...types } = td.types as Record<string, unknown>;
  return { domain: td.domain, types, primaryType: td.primaryType, message };
}

export default function OrdersPage() {
  const environment = useEnvironment();
  const wallet = useLykiaWallet();
  const owner = wallet.address ?? null;
  const qc = useQueryClient();
  const [kind, setKind] = useState<OrderKind>("stop-loss");
  const [sell, setSell] = useState<string>("cirBTC");
  const [buy, setBuy] = useState<string>("USDC");
  const [amount, setAmount] = useState("0.01");
  const [trigger, setTrigger] = useState("");
  const [executions, setExecutions] = useState("6");
  const [hours, setHours] = useState("4");
  const [slippage, setSlippage] = useState("1");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const config = useQuery({ queryKey: ["orders-config", environment], queryFn: ({ signal }) => apiGet<OrdersConfig>("/v1/orders/config", { query: { environment }, signal }) });
  const orders = useQuery({ queryKey: ["orders", owner, environment], enabled: Boolean(owner), refetchInterval: 30_000, queryFn: ({ signal }) => apiGet<{ orders: OrderView[] }>("/v1/orders", { query: { owner, environment }, signal }) });
  const repeating = kind === "dca" || kind === "twap";
  const needsTrigger = kind === "stop-loss" || kind === "take-profit";
  const deployed = Boolean(config.data?.address);

  const prepare = async () => {
    if (!owner) return void toast.warning("Connect a wallet first", { from: "LYKO" });
    setBusy("draft");
    try {
      const d = await apiPost<Draft>("/v1/orders/draft", {
        owner,
        environment,
        kind,
        sell,
        buy,
        amount,
        slippageBps: Math.round(Number(slippage) * 100),
        ...(trigger.trim() ? { triggerPrice: trigger.trim() } : {}),
        ...(repeating ? { executions: Number(executions), intervalSeconds: Math.round(Number(hours) * 3600) } : {}),
      }, { timeoutMs: 20_000 });
      setDraft(d);
    } catch (e) {
      toast.error("Could not prepare the order", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  const signAndSubmit = async () => {
    if (!draft || !owner) return;
    setBusy("sign");
    try {
      if (draft.approval) {
        await wallet.send([draft.approval]);
        toast.info("Allowance sent", { description: draft.approval.label, from: "LYKO" });
      }
      const signature = await wallet.signTypedData(signable(draft.typedData));
      await apiPost("/v1/orders", { environment, kind, summary: draft.summary, order: draft.order, signature });
      toast.success("Order armed", { description: draft.summary, from: "LYKO" });
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) {
      toast.error("Order not armed", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  const sendTx = async (path: string, label: string, hash: string) => {
    setBusy(hash);
    try {
      const tx = await apiGet<Tx>(path, { query: { environment, ...(path.endsWith("execute-tx") ? { keeper: owner } : {}) } });
      const [h] = await wallet.send([tx]);
      toast.success(label, { description: h, from: "LYKO" });
      await qc.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) {
      toast.error(`${label} failed`, { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHead kicker={"DESK · CONDITIONAL ORDERS"} title={<>Set it, <em>sign once.</em></>} sub={"Limit, stop-loss, take-profit, DCA and TWAP on Arc. Your funds stay in your wallet behind an allowance; keepers execute when Chainlink says the condition holds, and the contract checks every term you signed."} mood="watching">
        <DeskTabs />
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2 m-grid-2--r">
          <Card title={"New order"} kicker={config.data ? `FEE ${config.data.feeBps / 100}% · KEEPER ${config.data.keeper.toUpperCase()}` : "…"}
            footer={draft ? (
              <div className="flex gap-2"><Button onClick={() => void signAndSubmit()} disabled={busy !== null}>{busy === "sign" ? "…" : draft.approval ? "APPROVE & SIGN" : "SIGN & ARM"}</Button><Button tone="ghost" onClick={() => setDraft(null)}>{"EDIT"}</Button></div>
            ) : <Button onClick={() => void prepare()} disabled={busy !== null || !owner || !deployed}>{busy === "draft" ? "…" : "PREPARE"}</Button>}>
            <div style={{ display: "grid", gap: 12 }}>
              <div className="m-scroll-x"><Toggle label="Order type" value={kind} onChange={(k) => { setKind(k); setDraft(null); }} options={ORDER_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} /></div>
              <p className="m-small m-muted">{KIND_HELP[kind]}</p>
              <div className="m-grid-2" style={{ gap: 10 }}>
                <Field label="Sell"><Select value={sell} onChange={(e) => { setSell(e.target.value); setDraft(null); }}>{TOKENS.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                <Field label="Buy"><Select value={buy} onChange={(e) => { setBuy(e.target.value); setDraft(null); }}>{TOKENS.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                <Field label={repeating ? `Amount per slice (${sell})` : `Amount (${sell})`}><Input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setDraft(null); }} /></Field>
                <Field label={needsTrigger ? "Trigger price (USD)" : "Trigger price (optional)"} hint={sell === "USDC" && buy === "USDC" ? undefined : `${sell === "USDC" ? buy : sell}/USD on Chainlink`}><Input inputMode="decimal" placeholder={needsTrigger ? "required" : "none"} value={trigger} onChange={(e) => { setTrigger(e.target.value); setDraft(null); }} /></Field>
                {repeating ? <Field label="Slices"><Input inputMode="numeric" value={executions} onChange={(e) => { setExecutions(e.target.value); setDraft(null); }} /></Field> : null}
                {repeating ? <Field label="Hours between slices"><Input inputMode="decimal" value={hours} onChange={(e) => { setHours(e.target.value); setDraft(null); }} /></Field> : null}
                <Field label="Slippage (%)"><Input inputMode="decimal" value={slippage} onChange={(e) => { setSlippage(e.target.value); setDraft(null); }} /></Field>
              </div>
              {draft ? (
                <div className="m-note">
                  <b>{draft.summary}</b>
                  <p className="m-small">{`Each execution: ${draft.perExecution.fee} ${draft.perExecution.symbolIn} fee, at most ${draft.perExecution.maxTip} ${draft.perExecution.symbolIn} keeper tip, ${draft.perExecution.swapped} ${draft.perExecution.symbolIn} swapped for at least ${draft.perExecution.minOut} ${draft.perExecution.symbolOut}.`}</p>
                  {draft.notes.map((n) => <p key={n} className="m-small m-muted">{n}</p>)}
                </div>
              ) : null}
              {config.data?.notes.map((n) => <p key={n} className="m-small m-muted">{n}</p>)}
            </div>
          </Card>
          <Card title={"Your orders"} kicker={`ARC ${environment.toUpperCase()}`}>
            {!owner ? <EmptyState mood="happy" title={"No wallet"}>{"Connect a wallet to see your orders."}</EmptyState> : orders.isLoading ? <Skeleton h={160} /> : orders.isError ? <p className="m-note m-note--bad">{describeError(orders.error)}</p> : !orders.data?.orders.length ? (
              <EmptyState mood="watching" title={"Nothing armed"}>{"A stop-loss on cirBTC is a good first order."}</EmptyState>
            ) : orders.data.orders.map((o) => (
              <div key={o.hash} className="m-row" style={{ flexWrap: "wrap" }}>
                <Tag tone={STATUS_TONE[o.status]}>{o.status}</Tag>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <b className="m-small">{o.summary}</b>
                  <p className="m-small m-muted">{o.waitingFor ? `Waiting for ${o.waitingFor}` : `${o.executed}/${o.order.executions} executed`}{o.lastExecutedAt ? ` · last ${new Date(o.lastExecutedAt).toLocaleString("en-US")}` : ""}</p>
                </div>
                {o.status === "open" || o.status === "waiting" ? (
                  <div className="flex gap-2">
                    {o.status === "open" ? <Button size="sm" tone="sea" disabled={busy !== null} onClick={() => void sendTx(`/v1/orders/${o.hash}/execute-tx`, "Executed", o.hash)}>{"RUN NOW"}</Button> : null}
                    <Button size="sm" tone="ghost" disabled={busy !== null} onClick={() => void sendTx(`/v1/orders/${o.hash}/cancel-tx`, "Cancelled", o.hash)}>{"CANCEL"}</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </Card>
        </div>
      </section>
    </div>
  );
}
