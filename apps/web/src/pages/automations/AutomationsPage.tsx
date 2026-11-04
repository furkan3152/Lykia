/** Automations: schedules, price feeds, balances and flow events that re-plan a sentence under the Fence or notify webhooks. */
import { AUTOMATION_EVENTS, PRICE_FEEDS, WEEKDAYS, type AutomationListEntry } from "@lykia/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { automationFormFromSearch, automationRequest, emptyAutomationForm, type AutomationForm, type TriggerType } from "../../features/desk/drafts";
import { useSiwe } from "../../features/session/useSiwe";
import { apiFetch, apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, EmptyState, Field, Input, PageHead, Select, Skeleton, Tag, toast } from "../../mosaic";

const TRIGGER_LABEL: Record<TriggerType, string> = { schedule: "On a schedule", price: "A price feed crosses a value", balance: "A wallet balance crosses a value", event: "A payout or invoice event" };

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function ready(f: AutomationForm): boolean {
  if (!f.name.trim()) return false;
  if (f.actionType === "plan" && f.sentence.trim().length < 3) return false;
  if ((f.triggerType === "price" || f.triggerType === "balance") && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(f.value.trim())) return false;
  if (f.triggerType === "schedule" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(f.at)) return false;
  return true;
}

export default function AutomationsPage() {
  const environment = useEnvironment();
  const siwe = useSiwe();
  const qc = useQueryClient();
  // A draft from Lyko (?draft=) only prefills the form; the owner still presses SAVE.
  const [draft] = useState(() => (typeof window === "undefined" ? null : automationFormFromSearch(window.location.search, localZone())));
  const [form, setForm] = useState<AutomationForm>(() => draft ?? emptyAutomationForm(localZone()));
  const [busy, setBusy] = useState(false);
  const enabled = siwe.signedIn && Boolean(siwe.address);
  const owner = siwe.address ?? "";
  const list = useQuery({ queryKey: ["automations", owner], enabled, queryFn: ({ signal }) => apiGet<{ entries: AutomationListEntry[] }>(`/v1/automations?owner=${owner}`, { signal }) });
  const set = <K extends keyof AutomationForm>(key: K, value: AutomationForm[K]) => setForm((cur) => ({ ...cur, [key]: value }));
  const refresh = () => qc.invalidateQueries({ queryKey: ["automations"] });

  const save = async () => {
    setBusy(true);
    try {
      await apiPost("/v1/automations", automationRequest(form, owner, environment));
      toast.success("Automation saved", { description: form.name, from: "LYKO" });
      setForm(emptyAutomationForm(form.timezone));
      await refresh();
    } catch (e) {
      toast.error("Automation not saved", { description: describeError(e), from: "LYKO" });
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

  return (
    <div>
      <PageHead kicker={"HERDING · ROUNDS · AUTOMATIONS"} title={<>Re-plan a sentence <em>when something happens.</em></>} sub={"A schedule, a Chainlink price, a wallet balance or a payout event re-plans one sentence under your Fence, or notifies your webhooks. Every fire is a proposal you sign; nothing moves on its own."} mood="alert" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {!enabled ? (
          <Card title={"Sign in first"}>
            <EmptyState mood="happy" title={"Automations belong to your address"}>{draft ? "Lyko drafted an automation for you. Sign in with your wallet (one message, no transaction), check the prefilled form and press SAVE." : "Sign in with your wallet (one message, no transaction) to set up and manage automations."}</EmptyState>
            <div className="m-center"><Button onClick={() => void siwe.signIn()} disabled={siwe.busy || !siwe.address}>{siwe.address ? "SIGN IN" : "CONNECT A WALLET"}</Button></div>
          </Card>
        ) : (
          <div className="m-grid-2 m-grid-2--r">
            <Card title={"New automation"} kicker={draft ? "DRAFTED BY LYKO · CHECK AND SAVE" : undefined} footer={<Button onClick={() => void save()} disabled={busy || !ready(form)}>{busy ? "…" : "SAVE"}</Button>}>
              <div style={{ display: "grid", gap: 10 }}>
                <Field label="Name"><Input value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} /></Field>
                <Field label="When"><Select value={form.triggerType} onChange={(e) => set("triggerType", e.target.value as TriggerType)}>{(Object.keys(TRIGGER_LABEL) as TriggerType[]).map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}</Select></Field>
                {form.triggerType === "schedule" ? (
                  <>
                    <Field label="Every"><Select value={form.every} onChange={(e) => set("every", e.target.value as AutomationForm["every"])}>{(["day", "week", "month"] as const).map((x) => <option key={x}>{x}</option>)}</Select></Field>
                    {form.every === "week" ? <Field label="Weekday"><Select value={form.weekday} onChange={(e) => set("weekday", e.target.value)}>{WEEKDAYS.map((d) => <option key={d}>{d}</option>)}</Select></Field> : null}
                    {form.every === "month" ? <Field label="Day of month (1-28)"><Input inputMode="numeric" value={form.day} onChange={(e) => set("day", e.target.value)} /></Field> : null}
                    <Field label="At (HH:MM)"><Input value={form.at} onChange={(e) => set("at", e.target.value)} /></Field>
                    <Field label="Time zone"><Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} /></Field>
                  </>
                ) : null}
                {form.triggerType === "price" ? <Field label="Feed"><Select value={form.feed} onChange={(e) => set("feed", e.target.value)}>{PRICE_FEEDS.map((f) => <option key={f}>{f}</option>)}</Select></Field> : null}
                {form.triggerType === "balance" ? <Field label="Token"><Input value={form.token} onChange={(e) => set("token", e.target.value)} /></Field> : null}
                {form.triggerType === "price" || form.triggerType === "balance" ? (
                  <>
                    <Field label="Goes"><Select value={form.op} onChange={(e) => set("op", e.target.value as AutomationForm["op"])}><option>above</option><option>below</option></Select></Field>
                    <Field label="Value"><Input inputMode="decimal" value={form.value} onChange={(e) => set("value", e.target.value)} /></Field>
                  </>
                ) : null}
                {form.triggerType === "event" ? <Field label="Event"><Select value={form.event} onChange={(e) => set("event", e.target.value)}>{AUTOMATION_EVENTS.map((ev) => <option key={ev}>{ev}</option>)}</Select></Field> : null}
                <Field label="Then"><Select value={form.actionType} onChange={(e) => set("actionType", e.target.value as AutomationForm["actionType"])}><option value="plan">{"Plan a sentence (a proposal you sign)"}</option><option value="notify">{"Notify my webhooks"}</option></Select></Field>
                {form.actionType === "plan" ? <Field label="Sentence" hint={"e.g. keep 1 USDC liquid and earn the rest"}><Input value={form.sentence} maxLength={400} onChange={(e) => set("sentence", e.target.value)} /></Field> : null}
                <Field label="At most fires per day"><Input inputMode="numeric" value={form.maxFiresPerDay} onChange={(e) => set("maxFiresPerDay", e.target.value)} /></Field>
              </div>
            </Card>
            <Card title={"Your automations"} kicker={list.data ? `${list.data.entries.length} IN ALL` : "…"}>
              {list.isLoading ? <Skeleton h={100} /> : list.isError ? <p className="m-note m-note--bad">{describeError(list.error)}</p> : !list.data?.entries.length ? <p className="m-small m-muted m-center">{"No automations yet."}</p> : list.data.entries.map((a) => (
                <div key={`${a.source}:${a.id}`} className="m-row" style={{ flexWrap: "wrap" }}>
                  <Tag tone={a.status === "active" ? "ok" : "ghost"}>{a.status}</Tag>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}><b className="m-small">{a.name}</b><p className="m-small m-muted">{`${a.source} · ${a.trigger} · ${a.action}`}</p></div>
                  {a.controllable && a.source !== "order" ? (
                    <div className="flex gap-2">
                      <Button size="sm" tone="ghost" onClick={() => void act(() => apiPost(`/v1/automations/${encodeURIComponent(a.id)}/${a.status === "active" ? "pause" : "resume"}?owner=${owner}`, {}), a.status === "active" ? "Paused" : "Resumed")}>{a.status === "active" ? "PAUSE" : "RESUME"}</Button>
                      <Button size="sm" tone="ghost" onClick={() => void act(() => apiFetch(`/v1/automations/${encodeURIComponent(a.id)}?owner=${owner}`, { method: "DELETE" }), "Deleted")}>{"DELETE"}</Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </Card>
          </div>
        )}
      </section>
    </div>
  );
}
