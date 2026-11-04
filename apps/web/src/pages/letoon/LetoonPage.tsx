/**
 * Letoon · team console. In the Lycian League, the Letoon was the sanctuary
 * of Leto where the league met. Here the Lykia team meets: the League
 * council, contracts and deployments, flags and the Whistle, Circle setup,
 * the audit log and platform usage.
 *
 * The page never trusts the client: it asks the API (GET /v1/admin/league,
 * admin role checked on the server) and opens the door only on a yes. Every
 * action is enforced again server side. Anyone else sees a closed door with
 * Lyko on watch, and no admin data is requested for them.
 */
import type { FeatureFlag } from "@lykia/core/api/platform";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { navigate } from "../../app/routes/history";
import { useRoute } from "../../app/routes/useRoute";
import { CircleSetupCard } from "../../features/circle/CircleSetupCard";
import { Council, type CouncilData } from "../../features/letoon/Council";
import { TempleDoor } from "../../features/letoon/TempleDoor";
import { AuditLog, KillSwitch, VenueBreakers, type SecurityStatus } from "../../features/security/SecurityCenter";
import { useSiwe } from "../../features/session/useSiwe";
import { ApiError, apiGet, apiPut, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, Stat, Tag, cx, toast } from "../../mosaic";
import { Contracts } from "./Contracts";

type Section = "council" | "contracts" | "flags" | "circle" | "audit" | "usage";

const SECTIONS: readonly { readonly id: Section; readonly label: string; readonly sub: string }[] = [
  { id: "council", label: "League council", sub: "cities" },
  { id: "contracts", label: "Contracts", sub: "deployments" },
  { id: "flags", label: "Flags", sub: "and the Whistle" },
  { id: "circle", label: "Circle", sub: "setup" },
  { id: "audit", label: "Audit log", sub: "platform chain" },
  { id: "usage", label: "Usage", sub: "platform" },
];

/** Flags switched here directly. `routing.halt` goes through the audited Whistle instead. */
const DIRECT_FLAGS: readonly FeatureFlag[] = ["agents.llm", "agents.keeper", "pack.onchain", "x402", "developer.signup"];

interface Overview {
  readonly version: string;
  readonly mode: string;
  readonly store: string;
  readonly packAgents: number;
  readonly deployments: number;
  readonly projects?: number;
  readonly developers?: number;
}

export default function LetoonPage() {
  const { params } = useRoute();
  const section: Section = SECTIONS.some((s) => s.id === params.section) ? (params.section as Section) : "council";
  const siwe = useSiwe();
  const council = useQuery({
    queryKey: ["council", siwe.session?.address],
    enabled: siwe.signedIn,
    retry: false,
    queryFn: ({ signal }) => apiGet<CouncilData>("/v1/admin/league", { signal }),
  });
  const denied = council.error instanceof ApiError && (council.error.status === 401 || council.error.status === 403);
  const admin = Boolean(council.data);
  const state = !siwe.signedIn ? "out" : council.isLoading ? "checking" : admin ? "in" : denied ? "denied" : "error";
  return (
    <div>
      <header className="m-wrap lt-head">
        <div className={cx("m-frame lt-door", admin && "lt-door--open")}>
          <TempleDoor open={admin} label={admin ? "The Letoon's doors open; light spills down the steps." : "The Letoon's doors are closed. Lyko keeps watch on the steps."} />
        </div>
        <div className="lt-head__text">
          <span className="m-kick">{"LETOON · TEAM CONSOLE"}</span>
          <h1 className="m-title" style={{ marginTop: 10 }}>{admin ? <>The council <em>is in session.</em></> : <>The sanctuary <em>where the League met.</em></>}</h1>
          <p className="m-sub" style={{ marginInline: 0 }}>
            {admin
              ? "Approve and pause cities, deploy and record contracts, switch flags, blow the Whistle, set up Circle and read the audit chain. Every action is checked on the server and recorded."
              : "This is the Lykia team's console. The doors open only for the team's addresses, and the server checks that on every call. Lyko keeps watch for everyone else."}
          </p>
          <div className="lt-head__acts">
            {state === "out" ? <Button onClick={() => void siwe.signIn()} disabled={siwe.busy}>{siwe.address ? "SIGN IN ON ARC" : "CONNECT A WALLET TO KNOCK"}</Button> : null}
            {state === "checking" ? <Tag tone="ghost">{"LYKO IS CHECKING…"}</Tag> : null}
            {state === "denied" ? <Tag tone="wolf">{"NOT ON THE TEAM · THE DOOR STAYS SHUT"}</Tag> : null}
            {state === "error" ? <Tag tone="bad">{describeError(council.error)}</Tag> : null}
            {state === "in" ? <Tag tone="ok">{`ADMIN · ${siwe.session?.address.slice(0, 6)}…${siwe.session?.address.slice(-4)}`}</Tag> : null}
          </div>
        </div>
      </header>

      {admin ? (
        <>
          <nav className="m-wrap lt-rail" aria-label="Letoon">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`/letoon/${s.id}`} className="lt-rail__tab" aria-current={s.id === section ? "page" : undefined} onClick={(e) => { e.preventDefault(); navigate(`/letoon/${s.id}`); }}>
                <span className="lt-rail__l">{s.label}</span>
                <span className="lt-rail__s">{s.sub}</span>
              </a>
            ))}
          </nav>
          <section className="m-wrap lt-section" key={section} style={{ marginTop: 20 }}>
            {section === "council" ? <Council data={council.data} /> : section === "contracts" ? <Contracts admin /> : section === "flags" ? <FlagsSection data={council.data} /> : section === "circle" ? <CircleSetupCard admin /> : section === "audit" ? <AuditLog enabled address={siwe.address ?? undefined} admin initialChain="platform" /> : <UsageSection data={council.data} />}
          </section>
        </>
      ) : null}
    </div>
  );
}

function FlagsSection({ data }: { readonly data: CouncilData | undefined }) {
  const qc = useQueryClient();
  const environment = useEnvironment();
  const flags = useQuery({ queryKey: ["flags"], queryFn: ({ signal }) => apiGet<Record<FeatureFlag, boolean>>("/v1/admin/flags", { signal }) });
  const status = useQuery({ queryKey: ["security-status", environment], queryFn: ({ signal }) => apiGet<SecurityStatus>("/v1/security/status", { signal, query: { environment } }) });
  const set = async (flag: FeatureFlag, value: boolean) => {
    try {
      await apiPut("/v1/admin/flags", { [flag]: value });
      void qc.invalidateQueries({ queryKey: ["flags"] });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  const live = (data?.cities ?? []).filter((c) => c.league.listed);
  return (
    <div className="m-grid-2" style={{ alignItems: "start" }}>
      <div style={{ display: "grid", gap: 20, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <KillSwitch status={status.data} />
        <Card title="Per-city pause" kicker="A PAUSED CITY ANSWERS READS ONLY">
          {live.length === 0 ? <p className="m-small m-muted m-center">{"No listed city."}</p> : <Council data={data ? { ...data, cities: live } : undefined} compact />}
        </Card>
      </div>
      <div style={{ display: "grid", gap: 20, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Card title="Flags" kicker="ADMIN · CHECKED ON THE SERVER">
          {DIRECT_FLAGS.map((k) => (
            <label key={k} className="m-row lt-flag">
              <span className="num m-small">{k}</span>
              <input type="checkbox" checked={flags.data?.[k] ?? false} disabled={!flags.data} onChange={(e) => void set(k, e.target.checked)} />
            </label>
          ))}
          <p className="m-small m-muted" style={{ marginTop: 8 }}>{`routing.halt is ${flags.data?.["routing.halt"] ? "ON" : "off"}: it is switched only with the Whistle, which asks for a reason and writes it to the audit chain.`}</p>
        </Card>
        <VenueBreakers status={status.data} />
      </div>
    </div>
  );
}

function UsageSection({ data }: { readonly data: CouncilData | undefined }) {
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: ({ signal }) => apiGet<Overview>("/v1/admin/overview", { signal }) });
  const cities = data?.cities ?? [];
  const requests = cities.reduce((n, c) => n + c.usage.last7Days.requests, 0);
  const plans = cities.reduce((n, c) => n + c.usage.last7Days.plans, 0);
  const o = overview.data;
  return (
    <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="m-grid-4">
        <Stat label="DEVELOPERS" value={o?.developers !== undefined ? String(o.developers) : "…"} hint="registered addresses" />
        <Stat label="PROJECTS" value={o?.projects !== undefined ? String(o.projects) : "…"} hint="cities and white-label apps" />
        <Stat label="AGENTS" value={o ? String(o.packAgents) : "…"} hint="in every Pack" />
        <Stat label="DEPLOYMENTS" value={o ? String(o.deployments) : "…"} hint="recorded contracts" />
      </div>
      <div className="m-grid-2">
        <Card title="The League this week" kicker={`${cities.length} ENTRIES`}>
          <div className="lg-live">
            <Stat label="REQUESTS" value={requests.toLocaleString("en-US")} hint="through city keys" />
            <Stat label="PLANS" value={plans.toLocaleString("en-US")} hint="built for cities" />
          </div>
        </Card>
        <Card title="This deployment" kicker="FROM GET /v1/admin/overview">
          <p className="m-small">{o ? `Version ${o.version} · ${o.mode} · store ${o.store}` : "…"}</p>
        </Card>
      </div>
    </div>
  );
}
