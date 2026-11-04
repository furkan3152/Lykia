/**
 * Lykia Agents (Xanthos): your agents as cards with budget meters (their
 * Fence caps) and Tag status, a "New agent" flow, recent decisions, and the
 * Whistle that pauses every agent at once.
 */
import type { LeagueCity } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";
import type { AuditEntry } from "@lykia/core/security/index";
import { LykiaTransport } from "@lykia/sdk";
import { LykiaProvider, Pack } from "@lykia/widget";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useSiwe } from "../features/session/useSiwe";
import { useLykiaWallet } from "../features/wallet/useLykiaWallet";
import { apiGet, apiPost, describeError } from "../lib/api";
import { API_BASE } from "../lib/env";
import { useLykiaStore, whistleOn } from "../lib/lykiaStore";
import { Button, EmptyState, PupIcon, Skeleton, Tag, cx, toast } from "../mosaic";
import { CityFrame, type CityTab } from "./CityFrame";
import { PixelIcon } from "./PixelIcon";
import { budgetUsed } from "./model";
import { Sheet } from "./Sheet";

type Tab = "agents" | "activity" | "whistle";

const TABS: readonly CityTab<Tab>[] = [
  { id: "agents", label: "Agents", icon: "agents" },
  { id: "activity", label: "Activity", icon: "list" },
  { id: "whistle", label: "Whistle", icon: "whistle" },
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
          <span className="m-small m-muted">{agent.role.replace(/-/gu, " ")}{agent.depth > 0 ? ` · sub-agent` : ""}</span>
        </div>
        <Tag tone={agent.status === "active" ? "ok" : "bad"}>{agent.status.toUpperCase()}</Tag>
      </div>
      <Meter used={used} label={`${agent.name}: ${Math.round(used * 100)}% of today's budget used`} />
      <div className="ct-agent__foot">
        <span className="m-small num">{cap ? `$${Number(spent).toFixed(2)} of $${cap} today` : "No daily cap"}</span>
        <Tag tone={agent.agentId ? "sea" : "ghost"}>{agent.agentId ? `TAG #${agent.agentId}` : "NO TAG YET"}</Tag>
      </div>
      <span className="m-small m-muted num" title={agent.fenceHash}>{`Fence ${agent.fenceHash.slice(7, 15)}`}</span>
    </li>
  );
}

export function AgentsShell({ city, home }: { readonly city: LeagueCity; readonly home: string }) {
  const [tab, setTab] = useState<Tab>("agents");
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const wallet = useLykiaWallet();
  const siwe = useSiwe();
  const qc = useQueryClient();
  const env = city.project.network;
  const owner = wallet.address;
  const whistle = useLykiaStore((s) => whistleOn(s.fence));
  const setWhistle = useLykiaStore((s) => s.setWhistle);
  const transport = useMemo(() => new LykiaTransport({ baseUrl: new URL(API_BASE).origin, environment: env }), [env]);
  const agents = useQuery({ queryKey: ["city-pack", owner, env], enabled: Boolean(owner), queryFn: ({ signal }) => apiGet<{ agents: PackAgentView[] }>("/v1/pack", { query: { owner, environment: env }, signal }) });
  const audit = useQuery({ queryKey: ["city-audit", owner], enabled: siwe.signedIn, queryFn: ({ signal }) => apiGet<{ entries: AuditEntry[] }>("/v1/security/audit", { query: { limit: 30 }, signal }) });
  const list = agents.data?.agents ?? [];
  const blow = async () => {
    try {
      if (!whistle && owner && siwe.signedIn) await apiPost("/v1/pack/whistle", { owner, environment: env, reason: "Paused from Lykia Agents" });
      setWhistle(!whistle);
      toast.success(whistle ? "Whistle released: agents may work again" : "Whistle blown: every agent stops", { from: "LYKO" });
      setConfirm(false);
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };

  return (
    <CityFrame city={city} home={home} tab={tab} tabs={TABS} onTab={(t) => (t === "whistle" ? setConfirm(true) : setTab(t))} action={tab === "agents" ? <Button className="ct-action__btn" onClick={() => setCreating(true)}>{"NEW AGENT"}</Button> : undefined}>
      <div className={cx("ct-whistle", whistle && "is-on")} role="status">
        <span className="ct-whistle__lamp" aria-hidden="true" />
        <span className="m-small">{whistle ? "The Whistle is blown: every agent is stopped. Moves that bring value home still pass." : `${list.filter((a) => a.status === "active").length} agents working inside your Fence.`}</span>
        <button type="button" className="ct-whistle__btn ct-wide-only" onClick={() => setConfirm(true)}><PixelIcon name="whistle" size={16} />{whistle ? "RELEASE" : "WHISTLE"}</button>
      </div>
      {tab === "agents" ? (
        !owner ? (
          <EmptyState mood="happy" title="Connect a wallet to meet your agents">{"Each agent gets a budget carved from yours and a Fence inside your Fence."}</EmptyState>
        ) : agents.isLoading ? (
          <div className="ct-agents">{[0, 1, 2].map((i) => <Skeleton key={i} h={170} />)}</div>
        ) : list.length === 0 ? (
          <div className="ct-empty ct-empty--big">
            <EmptyState mood="watching" title="No agents yet">{"Start with one: a name, a role and a daily budget. It can never spend more than you give it."}</EmptyState>
            <Button className="ct-wide-only" onClick={() => setCreating(true)}>{"CREATE YOUR FIRST AGENT"}</Button>
            <ol className="ct-steps" aria-label="How an agent is held">
              <li><PixelIcon name="spark" size={22} /><div><b>{"A budget carved from yours"}</b><span className="m-small m-muted">{`Daily caps up to $${city.project.fence.caps.dailyUsd ?? "250"} in this city.`}</span></div></li>
              <li><PixelIcon name="shield" size={22} /><div><b>{"A Fence inside your Fence"}</b><span className="m-small m-muted">{"It can only be tighter than your own rules."}</span></div></li>
              <li><PixelIcon name="agents" size={22} /><div><b>{"A Tag on chain"}</b><span className="m-small m-muted">{"An ERC-8004 identity that pins the Fence it obeys."}</span></div></li>
            </ol>
          </div>
        ) : (
          <ul className="ct-agents">{list.map((a) => <AgentCard key={a.id} agent={a} />)}</ul>
        )
      ) : (
        <section className="ct-card m-frame m-frame--thin" aria-labelledby="ag-activity">
          <div className="ct-card__head"><h2 id="ag-activity">{"Decisions"}</h2><span className="m-kick">{"HASH-CHAINED AUDIT LOG"}</span></div>
          {!siwe.signedIn ? (
            <div className="ct-empty"><p className="m-small m-muted">{"Sign in to read every plan, verdict and stop your agents made."}</p><Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy || !owner}>{owner ? "SIGN IN" : "CONNECT A WALLET FIRST"}</Button></div>
          ) : (audit.data?.entries ?? []).length === 0 ? <p className="m-small m-muted ct-empty">{"Nothing recorded yet."}</p> : (
            <ul className="ct-list">
              {[...(audit.data?.entries ?? [])].reverse().slice(0, 12).map((e) => (
                <li key={e.seq}><span className={`ct-dot ct-dot--${e.kind === "blocked" || e.kind === "halt" ? "bad" : "invoice"}`} aria-hidden="true" /><div className="ct-list__t"><b>{e.kind}</b><span className="m-small m-muted">{`${new Date(e.at).toLocaleString("en-US")} · ${e.subject.slice(0, 18)}`}</span></div></li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Sheet open={creating} onClose={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ["city-pack"] }); }} title="New agent">
        <LykiaProvider transport={transport} brand={city.project.brand} modules={city.project.modules} assistantName={city.project.assistantName} environment={env} {...(owner ? { owner } : {})}>
          <Pack />
        </LykiaProvider>
      </Sheet>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title={whistle ? "Release the Whistle?" : "Blow the Whistle?"}>
        <div className="ct-form">
          <p className="m-small">{whistle ? "Your agents may plan and spend again, inside their budgets and your Fence." : "Every agent stops at once: no new plans, no new spending. Repaying and withdrawing home still work. You can release it any time."}</p>
          <Button className="ct-form__go" tone={whistle ? "sea" : "terra"} onClick={() => void blow()}>{whistle ? "RELEASE THE WHISTLE" : "STOP EVERY AGENT"}</Button>
        </div>
      </Sheet>
    </CityFrame>
  );
}
