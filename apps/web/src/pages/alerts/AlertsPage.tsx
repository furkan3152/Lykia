/** Alerts: price, health, transfers, Scent and fills, delivered to the inbox, webhooks and Telegram. */
import { ALERT_KINDS, describeAlert, type AlertChannel, type AlertFiring, type AlertKind, type AlertRule } from "@lykia/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ALERT_TOKENS, alertFormFromSearch } from "../../features/desk/drafts";
import { useSiwe } from "../../features/session/useSiwe";
import { apiFetch, apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, EmptyState, Field, Input, PageHead, Select, Skeleton, Tag, toast } from "../../mosaic";

const KIND_LABEL: Record<AlertKind, string> = {
  "price-above": "Price above",
  "price-below": "Price below",
  "health-below": "Health factor below",
  "transfer-in": "Incoming transfer",
  "transfer-out": "Outgoing transfer",
  "scent-warning": "Token-check warning on something I hold",
  "order-filled": "Order executed",
};
const TOKEN_FOR = ALERT_TOKENS;
const THRESHOLD_LABEL: Partial<Record<AlertKind, string>> = { "price-above": "Price (USD)", "price-below": "Price (USD)", "health-below": "Health factor", "transfer-in": "At least (tokens)", "transfer-out": "At least (tokens)" };

export default function AlertsPage() {
  const environment = useEnvironment();
  const siwe = useSiwe();
  const qc = useQueryClient();
  // A draft from Lyko (?draft=) only prefills the form; the owner still presses ARM.
  const [draft] = useState(() => (typeof window === "undefined" ? null : alertFormFromSearch(window.location.search)));
  const [kind, setKind] = useState<AlertKind>(draft?.kind ?? "price-below");
  const [token, setToken] = useState(draft?.token ?? "cirBTC");
  const [threshold, setThreshold] = useState(draft?.threshold ?? "");
  const [channels, setChannels] = useState<AlertChannel[]>(draft?.channels ?? ["inbox"]);
  const cooldownSeconds = draft?.cooldownSeconds ?? null;
  const [busy, setBusy] = useState(false);
  const enabled = siwe.signedIn;
  const rules = useQuery({ queryKey: ["alerts", siwe.address], enabled, queryFn: ({ signal }) => apiGet<{ alerts: AlertRule[] }>("/v1/alerts", { signal }) });
  const inbox = useQuery({ queryKey: ["alerts-inbox", siwe.address], enabled, refetchInterval: 30_000, queryFn: ({ signal }) => apiGet<{ firings: AlertFiring[] }>("/v1/alerts/inbox", { signal }) });
  const telegram = useQuery({ queryKey: ["telegram", siwe.address], enabled, queryFn: ({ signal }) => apiGet<{ linked: boolean; configured: boolean }>("/v1/telegram/status", { signal }) });
  const tokens = TOKEN_FOR[kind];
  const thresholdLabel = THRESHOLD_LABEL[kind];
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ["alerts", "alerts-inbox", "telegram"].includes(String(q.queryKey[0])) });

  const create = async () => {
    setBusy(true);
    try {
      await apiPost("/v1/alerts", { kind, environment, channels, ...(tokens ? { token } : {}), ...(thresholdLabel ? { threshold: threshold.trim() } : {}), ...(cooldownSeconds ? { cooldownSeconds } : {}) });
      toast.success("Alert armed", { description: describeAlert({ kind, token, threshold }), from: "LYKO" });
      setThreshold("");
      await refresh();
    } catch (e) {
      toast.error("Alert not armed", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.info(done, { from: "LYKO" });
      await refresh();
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  const link = async () => {
    try {
      const r = await apiPost<{ code: string; bot: string | null; configured: boolean }>("/v1/telegram/link-code", {});
      if (!r.configured || !r.bot) return void toast.warning("The Telegram bot is not configured on this server", { from: "LYKO" });
      window.open(`https://t.me/${r.bot}?start=${r.code}`, "_blank", "noopener");
      toast.info("Press Start in Telegram, then come back", { from: "LYKO" });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };

  return (
    <div>
      <PageHead kicker={"HERDING · BARKS · ALERTS"} title={<>Be told, <em>never moved.</em></>} sub={"Price levels on Chainlink, health factors, big transfers, token-check warnings on what you hold and executed orders. Delivered to the inbox here, your developer webhooks (alert.fired) and Telegram. Alerts never move money."} mood="alert" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {!enabled ? (
          <Card title={"Sign in first"}>
            <EmptyState mood="happy" title={"Alerts belong to your address"}>{draft ? "Lyko drafted an alert for you. Sign in with your wallet (one message, no transaction), check the prefilled form and press ARM." : "Sign in with your wallet (one message, no transaction) to arm alerts and read your inbox."}</EmptyState>
            <div className="m-center"><Button onClick={() => void siwe.signIn()} disabled={siwe.busy || !siwe.address}>{siwe.address ? "SIGN IN" : "CONNECT A WALLET"}</Button></div>
          </Card>
        ) : (
          <div className="m-grid-2 m-grid-2--r">
            <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
              <Card title={"New alert"} kicker={draft ? "DRAFTED BY LYKO · CHECK AND ARM" : undefined} footer={<Button onClick={() => void create()} disabled={busy || (Boolean(thresholdLabel) && !threshold.trim())}>{busy ? "…" : "ARM"}</Button>}>
                <div style={{ display: "grid", gap: 10 }}>
                  <Field label="When"><Select value={kind} onChange={(e) => { const k = e.target.value as AlertKind; setKind(k); const t = TOKEN_FOR[k]; if (t && !t.includes(token)) setToken(t[0] as string); }}>{ALERT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
                  {tokens ? <Field label="Token"><Select value={token} onChange={(e) => setToken(e.target.value)}>{tokens.map((t) => <option key={t}>{t}</option>)}</Select></Field> : null}
                  {thresholdLabel ? <Field label={thresholdLabel}><Input inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field> : null}
                  <Field label="Deliver to">
                    <div className="flex gap-3 flex-wrap">
                      {(["inbox", "webhook", "telegram"] as const).map((c) => (
                        <label key={c} className="m-small flex gap-1 items-center"><input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels((cur) => (e.target.checked ? [...cur, c] : cur.filter((x) => x !== c)))} />{c}</label>
                      ))}
                    </div>
                  </Field>
                </div>
              </Card>
              <Card title={"Telegram"} kicker={telegram.data?.linked ? "LINKED" : "NOT LINKED"} tone="sea"
                footer={telegram.data?.linked ? <Button tone="ghost" onClick={() => void act(() => apiFetch("/v1/telegram/link", { method: "DELETE" }), "Telegram unlinked")}>{"UNLINK"}</Button> : <Button tone="sea" onClick={() => void link()} disabled={telegram.data ? !telegram.data.configured : true}>{"LINK TELEGRAM"}</Button>}>
                <p className="m-small">{telegram.data?.configured === false ? "This server has no Telegram bot token yet (TELEGRAM_BOT_TOKEN)." : "Opens the Lykia bot with a one-time code tied to your signed-in address. Alerts with the Telegram channel arrive there."}</p>
              </Card>
            </div>
            <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
              <Card title={"Your alerts"} kicker={rules.data ? `${rules.data.alerts.length} ARMED` : "…"}>
                {rules.isLoading ? <Skeleton h={100} /> : !rules.data?.alerts.length ? <p className="m-small m-muted m-center">{"No alerts yet."}</p> : rules.data.alerts.map((a) => (
                  <div key={a.id} className="m-row" style={{ flexWrap: "wrap" }}>
                    <Tag tone={a.paused ? "ghost" : "ok"}>{a.paused ? "paused" : "armed"}</Tag>
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}><b className="m-small">{describeAlert(a)}</b><p className="m-small m-muted">{`${a.channels.join(", ")} · ${a.environment}${a.lastFiredAt ? ` · last ${new Date(a.lastFiredAt).toLocaleString("en-US")}` : ""}`}</p></div>
                    <div className="flex gap-2">
                      <Button size="sm" tone="ghost" onClick={() => void act(() => apiFetch(`/v1/alerts/${a.id}`, { method: "PATCH", body: { paused: !a.paused } }), a.paused ? "Resumed" : "Paused")}>{a.paused ? "RESUME" : "PAUSE"}</Button>
                      <Button size="sm" tone="ghost" onClick={() => void act(() => apiFetch(`/v1/alerts/${a.id}`, { method: "DELETE" }), "Deleted")}>{"DELETE"}</Button>
                    </div>
                  </div>
                ))}
              </Card>
              <Card title={"Inbox"} kicker={inbox.data ? `${inbox.data.firings.filter((f) => !f.read).length} NEW` : "…"} footer={inbox.data?.firings.some((f) => !f.read) ? <Button size="sm" tone="ghost" onClick={() => void act(() => apiPost("/v1/alerts/inbox/read", {}), "Marked read")}>{"MARK ALL READ"}</Button> : undefined}>
                {inbox.isLoading ? <Skeleton h={100} /> : !inbox.data?.firings.length ? <p className="m-small m-muted m-center">{"Quiet. Lyko is watching."}</p> : inbox.data.firings.slice(0, 30).map((f) => (
                  <div key={f.id} className="m-row">
                    <Tag tone={f.read ? "ghost" : "ochre"}>{f.read ? "read" : "new"}</Tag>
                    <div style={{ minWidth: 0 }}><b className="m-small">{f.title}</b><p className="m-small m-muted">{f.body}</p><p className="m-small m-muted">{new Date(f.at).toLocaleString("en-US")}</p></div>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
