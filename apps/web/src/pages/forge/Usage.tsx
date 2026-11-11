/** Usage tab: requests per day and per endpoint, the plan, credits and the monthly quota. */
import type { BillingPlan, BillingUsageView } from "@lykia/core/api/platform";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiGet, apiPut, describeError } from "../../lib/api";
import { Button, Card, EmptyState, Select, Skeleton, Stat, toast } from "../../mosaic";
import { DayBars, ScrollTable } from "./portalShared";
import { intlLocale, t } from "../../i18n";

const usdc = (units: string | number) => (Number(units) / 1_000_000).toLocaleString(intlLocale(), { maximumFractionDigits: 6 });

export function Usage({ enabled }: { readonly enabled: boolean }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(14);
  const usage = useQuery({ queryKey: ["dev-billing-usage", days], enabled, queryFn: ({ signal }) => apiGet<BillingUsageView>("/v1/billing/usage", { signal, query: { days } }) });
  const plan = useQuery({ queryKey: ["dev-billing-plan"], enabled, queryFn: ({ signal }) => apiGet<{ plan: BillingPlan; creditsUnits: string; plans: BillingPlan[] }>("/v1/billing/plan", { signal }) });
  const switchPlan = useMutation({
    mutationFn: (id: string) => apiPut("/v1/billing/plan", { plan: id }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["dev-billing-plan"] }); toast.success(t("forge.usage.planUpdated"), { from: "LYKO" }); },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  if (!enabled) return <EmptyState title={t("forge.usage.signInFirst")}>{t("forge.usage.usageIsCountedPerDeveloperWallet")}</EmptyState>;
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
        <Stat label={t("forge.usage.requestsThisMonth")} value={u ? u.requests.toLocaleString(intlLocale()) : "…"} hint={u ? `${u.includedRequests.toLocaleString(intlLocale())} included` : undefined} />
        <Stat label={t("forge.usage.plan")} value={plan.data?.plan.name ?? "…"} hint={plan.data ? t("forge.usage.perMinute", { n: plan.data.plan.perMinute }) : undefined} />
        <Stat label={t("forge.usage.credits")} value={plan.data ? `${usdc(plan.data.creditsUnits)} USDC` : "…"} hint={u ? t("forge.usage.overageUsdc", { usdc: usdc(u.overageUnits) }) : undefined} />
      </div>
      <Card title={t("forge.usage.requestsPerDay")} kicker={t("forge.usage.liveAndTestKeys")}>
        <div style={{ maxWidth: 200, marginBottom: 10 }}>
          <Select aria-label={t("forge.usage.days")} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}><option value="7">{t("forge.usage.n7Days")}</option><option value="14">{t("forge.usage.n14Days")}</option><option value="30">{t("forge.usage.n30Days")}</option></Select>
        </div>
        {usage.isLoading || !u ? <Skeleton h={140} /> : <DayBars days={u.days} label={t("forge.usage.requestsPerDay")} />}
      </Card>
      <Card title={t("forge.usage.perEndpoint")} kicker={t("forge.usage.lastDays", { days })}>
        {endpoints.length === 0 ? <p className="m-small m-muted">{t("forge.usage.noKeyedRequestsInThisWindow")}</p> : (
          <ScrollTable label={t("forge.usage.usagePerEndpoint")}>
            <thead><tr><th>{t("forge.usage.endpoint")}</th><th className="r">{t("forge.usage.requests")}</th><th className="r">{t("forge.usage.errors")}</th><th className="r">{t("forge.usage.avgMs")}</th></tr></thead>
            <tbody>{endpoints.map(([name, v]) => <tr key={name}><td className="num m-small" style={{ overflowWrap: "anywhere" }}>{name}</td><td className="num r">{v.requests}</td><td className="num r">{v.errors}</td><td className="num r">{v.requests ? Math.round(v.latency / v.requests) : 0}</td></tr>)}</tbody>
          </ScrollTable>
        )}
      </Card>
      <Card title={t("forge.usage.plans")} kicker={t("forge.usage.freePayAsYouGoIn")}>
        <div className="m-grid-3" style={{ gap: 12 }}>
          {(plan.data?.plans ?? []).map((p) => (
            <div key={p.id} className="m-frame m-card" style={{ display: "grid", gap: 6 }}>
              <b>{p.name}</b>
              <p className="m-small m-muted" style={{ margin: 0 }}>{p.summary}</p>
              <p className="m-small" style={{ margin: 0 }}>{p.includedRequests.toLocaleString(intlLocale())} {t("forge.usage.requestsMonthIncluded")}{p.overageUnitsPerRequest ? t("forge.usage.thenUsdcEach", { usdc: usdc(p.overageUnitsPerRequest) }) : ""}{t("forge.usage.logsKept")} {p.logRetentionDays} {t("forge.usage.days2")}</p>
              {p.id === plan.data?.plan.id ? <span className="m-kick">{t("forge.usage.current")}</span> : p.id === "enterprise" ? <span className="m-small m-muted">{t("forge.usage.talkToTheLykiaTeam")}</span> : <Button size="sm" tone="sea" onClick={() => switchPlan.mutate(p.id)} disabled={switchPlan.isPending}>{t("forge.usage.switch")}</Button>}
            </div>
          ))}
        </div>
        <p className="m-small m-muted" style={{ marginTop: 10 }}>{t("forge.usage.creditsAreBoughtWithAnX402")}</p>
      </Card>
    </div>
  );
}
