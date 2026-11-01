/** Usage tab: requests per day and per endpoint, the plan, credits and the monthly quota. */
import type { BillingPlan, BillingUsageView } from "@lykia/core/api/platform";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPut, describeError } from "../../lib/api";
import { Button, Card, EmptyState, Select, Skeleton, Stat, toast } from "../../mosaic";
import { DayBars, ScrollTable } from "./portalShared";

const usdc = (units: string | number) => (Number(units) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 });

export function Usage({ enabled }: { readonly enabled: boolean }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(14);
  const usage = useQuery({ queryKey: ["dev-billing-usage", days], enabled, queryFn: ({ signal }) => apiGet<BillingUsageView>("/v1/billing/usage", { signal, query: { days } }) });
  const plan = useQuery({ queryKey: ["dev-billing-plan"], enabled, queryFn: ({ signal }) => apiGet<{ plan: BillingPlan; creditsUnits: string; plans: BillingPlan[] }>("/v1/billing/plan", { signal }) });
  const switchPlan = useMutation({
    mutationFn: (id: string) => apiPut("/v1/billing/plan", { plan: id }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["dev-billing-plan"] }); toast.success("Plan updated", { from: "LYKO" }); },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  if (!enabled) return <EmptyState title="Sign in first">Usage is counted per developer wallet.</EmptyState>;
  const u = usage.data;
  const byEndpoint = new Map<string, { requests: number; errors: number; latency: number }>();
  for (const e of u?.endpoints ?? []) {
    const cur = byEndpoint.get(e.endpoint) ?? { requests: 0, errors: 0, latency: 0 };
    byEndpoint.set(e.endpoint, { requests: cur.requests + e.requests, errors: cur.errors + e.errors, latency: cur.latency + e.avgLatencyMs * e.requests });
  }
  const endpoints = [...byEndpoint].sort((a, b) => b[1].requests - a[1].requests);
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="m-grid-3">
        <Stat label="Requests this month" value={u ? u.requests.toLocaleString("en-US") : "…"} hint={u ? `${u.includedRequests.toLocaleString("en-US")} included` : undefined} />
        <Stat label="Plan" value={plan.data?.plan.name ?? "…"} hint={plan.data ? `${plan.data.plan.perMinute}/min per project` : undefined} />
        <Stat label="Credits" value={plan.data ? `${usdc(plan.data.creditsUnits)} USDC` : "…"} hint={u ? `overage ${usdc(u.overageUnits)} USDC` : undefined} />
      </div>
      <Card title="Requests per day" kicker="LIVE AND TEST KEYS">
        <div style={{ maxWidth: 200, marginBottom: 10 }}>
          <Select aria-label="Days" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></Select>
        </div>
        {usage.isLoading || !u ? <Skeleton h={140} /> : <DayBars days={u.days} label="Requests per day" />}
      </Card>
      <Card title="Per endpoint" kicker={`LAST ${days} DAYS`}>
        {endpoints.length === 0 ? <p className="m-small m-muted">No keyed requests in this window.</p> : (
          <ScrollTable label="Usage per endpoint">
            <thead><tr><th>Endpoint</th><th className="r">Requests</th><th className="r">Errors</th><th className="r">Avg ms</th></tr></thead>
            <tbody>{endpoints.map(([name, v]) => <tr key={name}><td className="num m-small" style={{ overflowWrap: "anywhere" }}>{name}</td><td className="num r">{v.requests}</td><td className="num r">{v.errors}</td><td className="num r">{v.requests ? Math.round(v.latency / v.requests) : 0}</td></tr>)}</tbody>
          </ScrollTable>
        )}
      </Card>
      <Card title="Plans" kicker="FREE · PAY AS YOU GO IN USDC ON ARC">
        <div className="m-grid-3" style={{ gap: 12 }}>
          {(plan.data?.plans ?? []).map((p) => (
            <div key={p.id} className="m-frame m-card" style={{ display: "grid", gap: 6 }}>
              <b>{p.name}</b>
              <p className="m-small m-muted" style={{ margin: 0 }}>{p.summary}</p>
              <p className="m-small" style={{ margin: 0 }}>{p.includedRequests.toLocaleString("en-US")} requests/month included{p.overageUnitsPerRequest ? `, then ${usdc(p.overageUnitsPerRequest)} USDC each` : ""}. Logs kept {p.logRetentionDays} days.</p>
              {p.id === plan.data?.plan.id ? <span className="m-kick">CURRENT</span> : p.id === "enterprise" ? <span className="m-small m-muted">Talk to the Lykia team.</span> : <Button size="sm" tone="sea" onClick={() => switchPlan.mutate(p.id)} disabled={switchPlan.isPending}>SWITCH</Button>}
            </div>
          ))}
        </div>
        <p className="m-small m-muted" style={{ marginTop: 10 }}>Credits are bought with an x402 payment in USDC on Arc (POST /v1/billing/credits). This is separate from Lykia's protocol fee on money moves.</p>
      </Card>
    </div>
  );
}
