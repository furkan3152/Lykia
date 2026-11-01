/** Security center: the six layers between the flock and the wolves, in one place. */
import { useQuery } from "@tanstack/react-query";

import { AddressCheck, Approvals, AuditLog, KillSwitch, LayerGrid, Monitors, SecurityAlerts, VenueBreakers, type SecurityStatus } from "../../features/security/SecurityCenter";
import { useSiwe } from "../../features/session/useSiwe";
import { apiGet } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, EmptyState, PageHead } from "../../mosaic";

export default function SecurityPage() {
  const environment = useEnvironment();
  const siwe = useSiwe();
  const status = useQuery({ queryKey: ["security-status", environment], refetchInterval: 60_000, queryFn: ({ signal }) => apiGet<SecurityStatus>("/v1/security/status", { signal, query: { environment } }) });
  const admin = Boolean(siwe.signedIn && siwe.session?.roles.includes("admin"));
  const address = siwe.address ?? undefined;
  return (
    <div>
      <PageHead kicker="FENCE · SECURITY" title={<>Six layers between the flock and the <em>wolves</em>.</>} sub="Every step is decoded, simulated and diffed against its plan before it reaches your wallet. Recipients are checked for look-alikes and blocklists, approvals stay exact, agents are watched, and venues trip a breaker when they look wrong. Every decision lands in a hash-chained audit log." mood={status.data?.halted ? "growling" : "watching"} />
      <section className="m-wrap" style={{ marginTop: 28, display: "grid", gap: 24 }}>
        <LayerGrid status={status.data} />
        <div className="m-grid-2">
          <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
            {siwe.signedIn ? null : (
              <Card title="Sign in for your own view">
                <EmptyState mood="happy" title="Alerts, monitors and the audit log belong to your address">Sign in with your wallet (one message, no transaction).</EmptyState>
                <div className="m-center"><Button onClick={() => void siwe.signIn()} disabled={siwe.busy || !siwe.address}>{siwe.address ? "SIGN IN" : "CONNECT A WALLET"}</Button></div>
              </Card>
            )}
            <SecurityAlerts enabled={siwe.signedIn} address={address} />
            <Monitors enabled={siwe.signedIn} address={address} />
            <AddressCheck owner={address} environment={environment} />
          </div>
          <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
            <Approvals owner={address} environment={environment} />
            <VenueBreakers status={status.data} />
            {admin ? <KillSwitch status={status.data} /> : null}
          </div>
        </div>
        <AuditLog enabled={siwe.signedIn} address={address} admin={admin} />
        {status.data ? (
          <Card title="Platform hardening" kicker={`${status.data.platform.filter((c) => c.ok).length}/${status.data.platform.length} CHECKS`}>
            <ul className="m-small" style={{ margin: 0, paddingLeft: 18 }}>
              {status.data.platform.map((c) => <li key={c.id}>{c.ok ? "✓" : "✗"} {c.detail}</li>)}
            </ul>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
