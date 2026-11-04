/**
 * Move: every money flow on one page, without a sentence. Send (any
 * registry token, to an address or a saved contact, with a memo), Receive
 * (a payment link and its QR), Swap, Earn, Borrow and Bridge. Each form
 * asks the route search for the best route and stores it as a plan; the
 * plan is signed below with the same route artifact Ask Lyko uses (EOA:
 * one transaction per step; passkey: one user operation), with Lykia's
 * fee, the Fence and the beta cap applied by the API.
 */
import type { CreateIntentResponse } from "@lykia/core/api/intents";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useRouteParam } from "../../app/routes/useRoute";
import { navigate } from "../../app/routes/history";
import { RouteArtifact } from "../../features/route/RouteArtifact";
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { useWallet } from "../../features/wallet/store";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useSession } from "../../lib/session";
import { qrMatrix, qrSvgPath } from "../../lib/qr";
import { canReadContacts, friendlyError, isAddress, isAmount, MIN_GAS_USDC, MOVE_TABS, paymentUri, type MoveTab, type TokenRow } from "../../features/move/model";
import { Button, Card, Field, Frame, Input, PageHead, Select, Tag, Toggle } from "../../mosaic";

const TAB_LABEL: Record<MoveTab, string> = { send: "Send", receive: "Receive", swap: "Swap", earn: "Earn", borrow: "Borrow", bridge: "Bridge" };
const BRIDGE_TO = ["base", "ethereum", "arbitrum", "optimism", "polygon", "avalanche", "unichain", "linea"] as const;

interface Contact { readonly id: string; readonly name: string; readonly address: string }
interface SearchAnswer {
  readonly best: { readonly label: string; readonly explanation: { readonly why: string } } | null;
  readonly failedChecks: readonly { readonly label: string; readonly reason: string }[];
  readonly pruned: readonly { readonly label: string; readonly reason: string }[];
  readonly intent?: CreateIntentResponse;
}

function TokenSelect({ tokens, value, onChange, label }: { tokens: readonly TokenRow[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {tokens.map((t) => <option key={t.symbol} value={t.symbol}>{`${t.symbol} · ${t.name}`}</option>)}
      </Select>
    </Field>
  );
}

function Qr({ text }: { text: string }) {
  const { path, size } = useMemo(() => qrSvgPath(qrMatrix(text)), [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={208} height={208} role="img" aria-label="Payment QR code" shapeRendering="crispEdges" style={{ background: "#fff", borderRadius: 6 }}>
      <path d={path} fill="#111" />
    </svg>
  );
}

export default function MovePage() {
  const param = useRouteParam("tab");
  const tab: MoveTab = (MOVE_TABS as readonly string[]).includes(param ?? "") ? (param as MoveTab) : "send";
  const environment = useEnvironment();
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const owner = wallet.address;
  const chainId = environment === "mainnet" ? 5042 : 5042002;

  const tokens = useQuery({ queryKey: ["tokens", environment], queryFn: () => apiGet<{ tokens: TokenRow[] }>(`/v1/tokens?environment=${environment}`), staleTime: 300_000 });
  // The address book needs a signed-in session for this wallet; without one the API answers 401.
  const signedIn = useSession((st) => canReadContacts(owner, st.session));
  const contacts = useQuery({ queryKey: ["contacts", owner], queryFn: () => apiGet<{ contacts: Contact[] }>("/v1/contacts"), enabled: signedIn, retry: false });
  const flock = useQuery({ queryKey: ["flock-native", environment, owner], queryFn: () => apiGet<{ native?: { usdc18?: string } }>(`/v1/flock/${owner}?environment=${environment}`), enabled: Boolean(owner), staleTime: 30_000 });
  const list = tokens.data?.tokens ?? [];
  const stables = list.filter((t) => t.symbol === "USDC" || t.symbol === "EURC" || t.symbol === "cirBTC" || t.symbol === "WETH");

  // A shared payment link (/app/move/send?to=…&token=…&amount=…) fills the send form.
  const query = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [token, setToken] = useState(query.get("token") ?? "USDC");
  const [amount, setAmount] = useState(isAmount(query.get("amount") ?? "") ? (query.get("amount") as string) : "");
  const [to, setTo] = useState(isAddress(query.get("to") ?? "") ? (query.get("to") as string) : "");
  const [memo, setMemo] = useState("");
  const [from, setFrom] = useState("USDC");
  const [into, setInto] = useState("EURC");
  const [risk, setRisk] = useState<"low" | "medium" | "high">("medium");
  const [health, setHealth] = useState("1.8");
  const [deploy, setDeploy] = useState(false);
  const [destination, setDestination] = useState<string>("base");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);

  const native = flock.data?.native?.usdc18 ? Number(BigInt(flock.data.native.usdc18) / 10n ** 12n) / 1e6 : null;
  const lowGas = owner && native !== null && native < MIN_GAS_USDC;

  const actions = (): unknown[] | string => {
    if (!isAmount(amount) && tab !== "receive") return "Enter an amount above zero (use a dot for decimals).";
    switch (tab) {
      case "send":
        if (!isAddress(to)) return "Enter a 0x address or pick a contact.";
        return [{ verb: "send", token, amount: { exact: amount.trim() }, to: to.trim(), ...(memo.trim() ? { memo: memo.trim().slice(0, 120) } : {}) }];
      case "swap":
        if (from === into) return "Pick two different tokens.";
        return [{ verb: (from === "USDC" && into === "EURC") || (from === "EURC" && into === "USDC") ? "fx" : "swap", from, to: into, amount: { exact: amount.trim() } }];
      case "earn":
        return [{ verb: "earn", token: from, amount: { exact: amount.trim() }, maxRisk: risk }];
      case "borrow":
        return [{ verb: "borrow", token: into === "EURC" ? "EURC" : "USDC", amount: { exact: amount.trim() }, collateral: { token: "cirBTC" }, minHealth: health }, ...(deploy ? [{ verb: "earn", token: into === "EURC" ? "EURC" : "USDC", amount: { previous: true }, maxRisk: risk }] : [])];
      case "bridge":
        return [{ verb: "bridge", token: "USDC", amount: { exact: amount.trim() }, destination, ...(isAddress(to) ? { recipient: to.trim() } : {}) }];
      default:
        return "Nothing to plan.";
    }
  };

  const plan = async () => {
    if (!owner) {
      openModal();
      return;
    }
    const built = actions();
    if (typeof built === "string") {
      setError(built);
      return;
    }
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const found = await apiPost<SearchAnswer>("/v1/routes/search", { owner, environment, actions: built, plan: true, appetite: risk });
      if (!found.best) setError(friendlyError(found.failedChecks[0]?.reason ?? found.pruned[0]?.reason ?? "No route passed the checks."));
      setAnswer(found);
    } catch (e) {
      setError(friendlyError(describeError(e)));
    } finally {
      setBusy(false);
    }
  };

  const tokenRow = list.find((t) => t.symbol === token);
  const receiveUri = owner ? paymentUri({ to: owner, token: tokenRow, amount, chainId }) : null;
  const shareLink = owner ? `${typeof window === "undefined" ? "" : window.location.origin}/app/move/send?to=${owner}&token=${token}${isAmount(amount) ? `&amount=${amount.trim()}` : ""}` : null;

  return (
    <div>
      <PageHead kicker={`FLOCK · MOVE · SEND AND SWAP · ARC ${environment.toUpperCase()}`} title={<>Move money, <em>inside the Fence.</em></>} sub={"Send, receive, swap, earn, borrow and bridge without writing a sentence. Lykia finds the best route, checks it against your Fence (your spending rules) and one simulation, and you sign it in your own wallet."} mood="herding" />
      <section className="m-wrap" style={{ marginTop: 24, maxWidth: 880 }}>
        <div className="m-scroll-x" style={{ marginBottom: 16 }}>
          <Toggle label="Flow" value={tab} onChange={(t) => { setAnswer(null); setError(null); navigate(`/app/move/${t}`); }} options={MOVE_TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }))} />
        </div>
        {wallet.wrongChain ? (
          <p className="m-note m-note--bad" role="alert">
            {`Your wallet is on another network. Lykia runs on Arc ${environment} (chain ${chainId}, gas paid in USDC). `}
            <Button size="sm" onClick={() => void wallet.switchToArc().catch((e: unknown) => setError(describeError(e)))}>{`SWITCH TO ARC ${environment.toUpperCase()}`}</Button>
          </p>
        ) : null}
        {lowGas ? <p className="m-note m-note--bad" role="alert">{`You hold ${native?.toFixed(4)} USDC for gas. Arc pays gas in USDC: keep at least ${MIN_GAS_USDC} USDC in this wallet before signing.`}</p> : null}

        {tab === "receive" ? (
          <Card title={"Receive"} kicker={owner ? "SHARE THE LINK OR THE QR" : "NO WALLET"}>
            {!owner ? (
              <div style={{ display: "grid", gap: 10 }}>
                <p className="m-small m-muted">{"Connect a wallet to get your payment link."}</p>
                <Button onClick={openModal}>{"CONNECT"}</Button>
              </div>
            ) : (
              <div className="m-grid-2" style={{ gap: 16, alignItems: "start" }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <TokenSelect tokens={list} value={token} onChange={setToken} label="Token" />
                  <Field label={`Amount (${token}, optional)`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" /></Field>
                  <Field label="Your address on Arc"><Input readOnly value={owner} aria-label="Your address on Arc" /></Field>
                  <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                    <Button size="sm" onClick={() => void navigator.clipboard?.writeText(shareLink ?? "")}>{"COPY LINK"}</Button>
                    <Button size="sm" tone="ghost" onClick={() => void navigator.clipboard?.writeText(receiveUri ?? "")}>{"COPY WALLET URI"}</Button>
                  </div>
                  <p className="m-small m-muted">{`Only send ${token} on Arc ${environment} to this address. From another chain, bridge USDC with CCTP to this address and Lykia mints it here.`}</p>
                </div>
                <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
                  {receiveUri ? <Qr text={receiveUri} /> : null}
                  <span className="m-small m-muted num" style={{ overflowWrap: "anywhere", textAlign: "center" }}>{receiveUri}</span>
                </div>
              </div>
            )}
          </Card>
        ) : (
          <Card title={TAB_LABEL[tab]} kicker={"BEST ROUTE · FENCE · ONE SIMULATION"} footer={<Button onClick={() => void plan()} disabled={busy}>{busy ? "FINDING THE ROUTE…" : owner ? "FIND THE ROUTE" : "CONNECT TO CONTINUE"}</Button>}>
            <div className="m-grid-2" style={{ gap: 10 }}>
              {tab === "send" ? (
                <>
                  <TokenSelect tokens={list} value={token} onChange={setToken} label="Token" />
                  <Field label={`Amount (${token})`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" /></Field>
                  <Field label="To (0x address)"><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" spellCheck={false} /></Field>
                  <Field label="Contact">
                    <Select value="" onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Contact">
                      <option value="">{contacts.isError ? "Sign in to load contacts" : (contacts.data?.contacts.length ?? 0) === 0 ? "No saved contacts" : "Pick a contact"}</option>
                      {(contacts.data?.contacts ?? []).map((c) => <option key={c.id} value={c.address}>{`${c.name} · ${c.address.slice(0, 6)}…${c.address.slice(-4)}`}</option>)}
                    </Select>
                  </Field>
                  <Field label="Memo (optional)"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="invoice 7" maxLength={120} /></Field>
                </>
              ) : null}
              {tab === "swap" ? (
                <>
                  <TokenSelect tokens={stables} value={from} onChange={setFrom} label="From" />
                  <TokenSelect tokens={stables} value={into} onChange={setInto} label="To" />
                  <Field label={`Amount (${from})`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100" /></Field>
                </>
              ) : null}
              {tab === "earn" ? (
                <>
                  <TokenSelect tokens={list.filter((t) => t.symbol === "USDC" || t.symbol === "EURC")} value={from} onChange={setFrom} label="Token" />
                  <Field label={`Amount (${from})`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" /></Field>
                  <Field label="Risk"><Select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)} aria-label="Risk"><option value="low">{"Low"}</option><option value="medium">{"Medium"}</option><option value="high">{"High"}</option></Select></Field>
                </>
              ) : null}
              {tab === "borrow" ? (
                <>
                  <TokenSelect tokens={list.filter((t) => t.symbol === "USDC" || t.symbol === "EURC")} value={into === "EURC" ? "EURC" : "USDC"} onChange={setInto} label="Borrow" />
                  <Field label="Amount"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" /></Field>
                  <Field label="Collateral"><Input readOnly value="cirBTC" aria-label="Collateral" /></Field>
                  <Field label="Health factor floor"><Input inputMode="decimal" value={health} onChange={(e) => setHealth(e.target.value)} /></Field>
                  <Field label="Then"><Select value={deploy ? "earn" : "keep"} onChange={(e) => setDeploy(e.target.value === "earn")} aria-label="Then"><option value="keep">{"Keep it in the wallet"}</option><option value="earn">{"Put it to work (best yield)"}</option></Select></Field>
                </>
              ) : null}
              {tab === "bridge" ? (
                <>
                  <Field label="Amount (USDC)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50" /></Field>
                  <Field label="To chain"><Select value={destination} onChange={(e) => setDestination(e.target.value)} aria-label="To chain">{BRIDGE_TO.map((d) => <option key={d} value={d}>{d[0]!.toUpperCase() + d.slice(1)}</option>)}</Select></Field>
                  <Field label="Recipient (optional, defaults to you)"><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" spellCheck={false} /></Field>
                </>
              ) : null}
            </div>
            {error ? <p className="m-note m-note--bad" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
            {answer?.best ? (
              <div className="m-note" style={{ marginTop: 12 }}>
                <Tag tone="ok">{"ROUTE"}</Tag> <b>{answer.best.label}</b>
                <p className="m-small">{answer.best.explanation.why}</p>
              </div>
            ) : null}
          </Card>
        )}

        {answer?.intent ? (
          <div style={{ marginTop: 20 }}>
            <Frame>
              <RouteArtifact intentId={answer.intent.intent.id} />
            </Frame>
          </div>
        ) : null}
      </section>
    </div>
  );
}
