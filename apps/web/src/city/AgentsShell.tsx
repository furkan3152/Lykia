/**
 * Lykia Agents (Xanthos): a window onto your agents, as cards with budget
 * meters (their Fence caps) and Tag status, recent decisions, and the
 * Whistle that pauses every agent at once. Agents live in Lykia's Fold
 * (Pack · your agents and their leashes) and start in Ask Lyko: this city
 * points there instead of keeping a creation flow of its own.
 */
import type { LeagueCity } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";
import type { AuditEntry } from "@lykia/core/security/index";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useSiwe } from "../features/session/useSiwe";
import { useLykiaWallet } from "../features/wallet/useLykiaWallet";
import { apiGet, apiPost, describeError } from "../lib/api";
import { useLykiaStore, whistleOn } from "../lib/lykiaStore";
import { Button, EmptyState, PupIcon, Skeleton, Tag, cx, toast } from "../mosaic";
import { CityFrame, type CityTab } from "./CityFrame";
import { PixelIcon } from "./PixelIcon";
import { budgetUsed } from "./model";
import {Sheet} from "./Sheet";
import { intlLocale, formatUsd, t as msg } from "../i18n";

type Tab = "agents" | "activity" | "whistle";

/** Shown, labelled "sample", before a wallet is connected. */
const sampleAgent = (id: string, name: string, role: PackAgentView["role"], cap: string, spent: string, tag?: string) =>
  ({ id, name, role, status: "active", depth: 0, agentId: tag, fenceHash: "sha256:0000000000000000", fence: { caps: { dailyUsd: cap } }, budget: { caps: { dailyUsd: cap }, allocated: {}, free: {}, spent: { dayUsd: spent, weekUsd: spent } } }) as unknown as PackAgentView;
const SAMPLE_AGENTS: readonly PackAgentView[] = [sampleAgent("s1", msg("city.agentsShell.payroll"), "payroll", "250", "120", "1842"), sampleAgent("s2", msg("city.agentsShell.yieldKeeper"), "yield-keeper", "250", "214"), sampleAgent("s3", msg("city.agentsShell.billPayer"), "bill-payer", "100", "18")];
const SAMPLE_FEED = [
  { id: "f1", kind: "plan", at: msg("city.agentsShell.nov40912"), what: msg("city.agentsShell.payroll4Payouts") },
  { id: "f2", kind: "verdict", at: msg("city.agentsShell.nov40912"), what: msg("city.agentsShell.allowInsideBudget") },
  { id: "f3", kind: "blocked", at: msg("city.agentsShell.nov40830"), what: msg("city.agentsShell.yieldKeeperOverCap") },
  { id: "f4", kind: "submit", at: msg("city.agentsShell.nov31705"), what: msg("city.agentsShell.billPayerElectricity") },
];

const TABS: readonly CityTab<Tab>[] = [
  { id: "agents", label: msg("city.agentsShell.agents"), icon: "agents" },
  { id: "activity", label: msg("city.agentsShell.activity"), icon: "list" },
  { id: "whistle", label: msg("city.agentsShell.stopAll"), icon: "whistle" },
];

function Meter({ used, label }: { readonly used: number; readonly label: string }) {
  const stones = 12;
  const lit = Math.round(used * stones);
  return (
    <div className="ct-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-label={label}>
      {Array.from({ length: stones }, (_, i) => <span key={i} className={cx(i < lit && "is-on", i < lit && used > 0.85 && "is-hot")} />)}
    </div>
  );
}

function AgentCard({ agent }: { readonly agent: PackAgentView }) {
  const cap = agent.budget.caps.dailyUsd ?? agent.fence.caps?.dailyUsd;
  const spent = agent.budget.spent.dayUsd;
  const used = budgetUsed(spent, cap);
  return (
    <li className={cx("ct-agent m-frame m-frame--thin", agent.status !== "active" && "is-off")}>
      <div className="ct-agent__head">
        <PupIcon role={agent.role} scale={3} />
        <div style={{ minWidth: 0 }}>
          <b>{agent.name}</b>
          <span className="m-small m-muted">{agent.role.replace(/-/gu, " ")}{agent.depth > 0 ? msg("city.agentsShell.subAgent") : ""}</span>
        </div>
        <Tag tone={agent.status === "active" ? "ok" : "bad"}>{agent.status.toUpperCase()}</Tag>
      </div>
      <Meter used={used} label={msg("city.agentsShell.ofTodaySBudgetUsed", { name: agent.name, Math: Math.round(used * 100) })} />
      <div className="ct-agent__foot">
        <span className="m-small num">{cap ? msg("city.agentsShell.ofToday", { value: Number(spent).toFixed(2), cap }) : msg("city.agentsShell.noDailyCap")}</span>
        <Tag tone={agent.agentId ? "sea" : "ghost"}>{agent.agentId ? msg("city.agentsShell.tag", { agentId: agent.agentId }) : msg("city.agentsShell.noTagYet")}</Tag>
      </div>
      <span className="m-small m-muted num" title={agent.fenceHash}>{`Fence ${agent.fenceHash.slice(7, 15)}`}</span>
    </li>
  );
}

export function AgentsShell({ city, home }: { readonly city: LeagueCity; readonly home: string }) {
  const [tab, setTab] = useState<Tab>("agents");
  const [confirm, setConfirm] = useState(false);
  const wallet = useLykiaWallet();
  const siwe = useSiwe();
  const env = city.project.network;
  const owner = wallet.address;
  const whistle = useLykiaStore((s) => whistleOn(s.fence));
  const setWhistle = useLykiaStore((s) => s.setWhistle);
  // A new agent starts in Ask Lyko, with the request filled in; it then shows here and in the Fold's Pack.
  const newAgent = `${home}/app?intent=${encodeURIComponent(msg("city.agentsShell.newAgentSeed"))}`;
  const agents = useQuery({
    queryKey: ["city-pack", owner, env, siwe.signedIn],
    enabled: Boolean(owner),
    // Names, Fences and budgets come back only for the signed-in owner; a redacted answer lists nothing here.
    queryFn: async ({ signal }) => {
      const r = await apiGet<{ agents: PackAgentView[]; redacted?: boolean }>("/v1/pack", { query: { owner, environment: env }, signal });
      return { agents: r.redacted ? [] : r.agents };
    },
  });
  const audit = useQuery({ queryKey: ["city-audit", owner], enabled: siwe.signedIn, queryFn: ({ signal }) => apiGet<{ entries: AuditEntry[] }>("/v1/security/audit", { query: { limit: 30 }, signal }) });
  const list = agents.data?.agents ?? [];
  const blow = async () => {
    try {
      if (!whistle && owner && siwe.signedIn) await apiPost("/v1/pack/whistle", { owner, environment: env, reason: "Paused from Lykia Agents" });
      setWhistle(!whistle);
      toast.success(whistle ? msg("city.agentsShell.whistleReleasedAgentsMayWorkAgain") : msg("city.agentsShell.whistleBlownEveryAgentStops"), { from: "LYKO" });
      setConfirm(false);
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };

  return (
    <CityFrame city={city} home={home} tab={tab} tabs={TABS} onTab={(t) => (t === "whistle" ? setConfirm(true) : setTab(t))} action={tab === "agents" ? <a className="m-btn ct-action__btn" href={newAgent}>{msg("city.agentsShell.newAgent")}</a> : undefined}>
      <div className={cx("ct-whistle", whistle && "is-on")} role="status">
        <span className="ct-whistle__lamp" aria-hidden="true" />
        <span className="m-small">{whistle ? msg("city.agentsShell.theWhistleIsBlownEveryAgent") : msg("city.agentsShell.agentsWorkingInsideYourFence", { length: list.filter((a) => a.status === "active").length })}</span>
        <button type="button" className="ct-whistle__btn ct-wide-only" onClick={() => setConfirm(true)}><PixelIcon name="whistle" size={16} />{whistle ? "RELEASE" : "WHISTLE"}</button>
      </div>
      {tab === "agents" ? (
        <div className="ctd-ag">
        <div className="ctd-ag__main">
        {!owner ? (
          <>
            <EmptyState mood="happy" title={msg("city.agentsShell.connectAWalletToMeetYour")}>{msg("city.agentsShell.eachAgentGetsABudgetCarved")}</EmptyState>
            <div className="ct-desk-only">
              <div className="ctd-samplehead ctd-samplehead--row"><Tag tone="ochre">{msg("city.agentsShell.sample")}</Tag><span className="m-small m-muted">{msg("city.agentsShell.whatYourAgentsLookLikeHere")}</span></div>
              <ul className="ct-agents">{SAMPLE_AGENTS.map((a) => <AgentCard key={a.id} agent={a} />)}</ul>
            </div>
          </>
        ) : agents.isLoading ? (
          <div className="ct-agents">{[0, 1, 2].map((i) => <Skeleton key={i} h={170} />)}</div>
        ) : list.length === 0 ? (
          <div className="ct-empty ct-empty--big">
            <EmptyState mood="watching" title={msg("city.agentsShell.noAgentsYet")}>{msg("city.agentsShell.startWithOneANameA")}</EmptyState>
            <a className="m-btn ct-wide-only" href={newAgent}>{"CREATE YOUR FIRST AGENT IN ASK LYKO"}</a>
            <ol className="ct-steps" aria-label={msg("city.agentsShell.howAnAgentIsHeld")}>
              <li><PixelIcon name="spark" size={22} /><div><b>{msg("city.agentsShell.aBudgetCarvedFromYours")}</b><span className="m-small m-muted">{msg("city.agentsShell.dailyCapsUpTo", { amount: formatUsd(Number(city.project.fence.caps.dailyUsd ?? "250"), { min: 0 }) })}</span></div></li>
              <li><PixelIcon name="shield" size={22} /><div><b>{msg("city.agentsShell.itsOwnSpendingRules")}</b><span className="m-small m-muted">{msg("city.agentsShell.itCanOnlyBeTighterThan")}</span></div></li>
              <li><PixelIcon name="agents" size={22} /><div><b>{msg("city.agentsShell.aPublicIdCardTag")}</b><span className="m-small m-muted">{msg("city.agentsShell.anOnChainIdentityErc8004")}</span></div></li>
            </ol>
          </div>
        ) : (
          <ul className="ct-agents">{list.map((a) => <AgentCard key={a.id} agent={a} />)}</ul>
        )}
        <a className="ct-fold" href={`${home}/app/fold/pack`}>
          <PixelIcon name="agents" size={22} />
          <span><b>{msg("city.agentsShell.manageThemInTheFold")}</b><span className="m-small m-muted">{msg("city.agentsShell.packYourAgentsAndTheirLeashes")}</span></span>
          <span aria-hidden="true">{"›"}</span>
        </a>
        </div>
        <aside className="ctd-ag__side ct-desk-only" aria-label={msg("city.agentsShell.activity")}>
          <section className="ct-card m-frame m-frame--thin">
            <div className="ct-card__head"><h2>{msg("city.agentsShell.today")}</h2><span className="m-kick">{owner ? msg("city.agentsShell.yourPack") : msg("ask.cards.sampleBadge")}</span></div>
            <dl className="ctd-today__grid">
              <div><dt>{msg("city.agentsShell.working")}</dt><dd className="num">{owner ? list.filter((a) => a.status === "active").length : 3}</dd></div>
              <div><dt>{msg("city.agentsShell.spentToday")}</dt><dd className="num">{`$${(owner ? list.reduce((x, a) => x + Number(a.budget.spent.dayUsd || 0), 0) : 184.2).toFixed(2)}`}</dd></div>
            </dl>
            <a className="m-btn" href={newAgent}>{msg("city.agentsShell.newAgent")}</a>
          </section>
          <section className="ct-card m-frame m-frame--thin ctd-ag__feed">
            <div className="ct-card__head"><h2>{msg("city.agentsShell.activity")}</h2><span className="m-kick">{siwe.signedIn ? msg("city.agentsShell.auditLog") : "SAMPLE"}</span></div>
            <ul className="ct-list">
              {(siwe.signedIn ? [...(audit.data?.entries ?? [])].reverse().slice(0, 8).map((e) => ({ id: String(e.seq), kind: e.kind, at: new Date(e.at).toLocaleString(intlLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }), what: e.subject.slice(0, 22) })) : SAMPLE_FEED).map((e) => (
                <li key={e.id}><span className={`ct-dot ct-dot--${e.kind === "blocked" || e.kind === "halt" ? "bad" : "invoice"}`} aria-hidden="true" /><div className="ct-list__t"><b>{e.kind}</b><span className="m-small m-muted">{`${e.at} · ${e.what}`}</span></div></li>
              ))}
            </ul>
            {siwe.signedIn && (audit.data?.entries ?? []).length === 0 ? <p className="m-small m-muted">{msg("city.agentsShell.nothingRecordedYetEveryPlanVerdict")}</p> : null}
            {!siwe.signedIn ? <Button size="sm" tone="ghost" onClick={() => void siwe.signIn()} disabled={siwe.busy || !owner}>{owner ? msg("city.agentsShell.signInForYours") : msg("city.agentsShell.connectAWallet")}</Button> : null}
          </section>
        </aside>
        </div>
      ) : (
        <section className="ct-card m-frame m-frame--thin" aria-labelledby="ag-activity">
          <div className="ct-card__head"><h2 id="ag-activity">{msg("city.agentsShell.decisions")}</h2><span className="m-kick">{msg("city.agentsShell.hashChainedAuditLog")}</span></div>
          {!siwe.signedIn ? (
            <div className="ct-empty"><p className="m-small m-muted">{msg("city.agentsShell.signInToReadEveryPlan")}</p><Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy || !owner}>{owner ? msg("city.agentsShell.signIn") : msg("city.agentsShell.connectAWalletFirst")}</Button></div>
          ) : (audit.data?.entries ?? []).length === 0 ? <p className="m-small m-muted ct-empty">{msg("city.agentsShell.nothingRecordedYet")}</p> : (
            <ul className="ct-list">
              {[...(audit.data?.entries ?? [])].reverse().slice(0, 12).map((e) => (
                <li key={e.seq}><span className={`ct-dot ct-dot--${e.kind === "blocked" || e.kind === "halt" ? "bad" : "invoice"}`} aria-hidden="true" /><div className="ct-list__t"><b>{e.kind}</b><span className="m-small m-muted">{`${new Date(e.at).toLocaleString(intlLocale(), { timeZoneName: "short" })} · ${e.subject.slice(0, 18)}`}</span></div></li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Sheet open={confirm} onClose={() => setConfirm(false)} title={whistle ? msg("city.agentsShell.releaseTheWhistle") : msg("city.agentsShell.blowTheWhistle")}>
        <div className="ct-form">
          <p className="m-small">{whistle ? msg("city.agentsShell.yourAgentsMayPlanAndSpend") : msg("city.agentsShell.everyAgentStopsAtOnceNo")}</p>
          <Button className="ct-form__go" tone={whistle ? "sea" : "terra"} onClick={() => void blow()}>{whistle ? msg("city.agentsShell.releaseTheWhistle2") : msg("city.agentsShell.stopEveryAgent")}</Button>
        </div>
      </Sheet>
    </CityFrame>
  );
}
