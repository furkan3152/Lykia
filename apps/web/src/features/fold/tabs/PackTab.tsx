/**
 * Pack · agents. Each agent with its budget meter (Fence caps used and
 * left), its Tag, what it may do, and a Whistle of its own. New agents are
 * made by asking Lyko.
 */
import { ROLE_TEMPLATES, type PackRole } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";

import { Link } from "../../../app/routes/Link";
import { Button, EmptyState, PupIcon, Tag } from "../../../mosaic";
import { agentMeter, usd } from "../model";

const roleTitle = (role: PackRole) => (role === "custom" ? "Custom" : role === "orchestrator" ? "Lyko" : ROLE_TEMPLATES[role].title.en);

function Meter({ share, used, cap, label }: { readonly share: number; readonly used: number; readonly cap: number | null; readonly label: string }) {
  const n = 12;
  const filled = Math.round(share * n);
  return (
    <div className="fd-meter" data-tone={share >= 0.95 ? "bad" : share >= 0.8 ? "warn" : "ok"}>
      <div className="fd-meter__row" role="meter" aria-valuemin={0} aria-valuemax={cap ?? 0} aria-valuenow={used} aria-label={cap ? `${usd(used, 0)} of ${usd(cap, 0)} ${label}` : "No budget cap"}>
        {Array.from({ length: n }, (_, i) => <i key={i} data-f={i < filled} />)}
      </div>
      <div className="fd-meter__legend">
        <span className="num">{cap ? `${usd(used, 0)} used ${label}` : "no cap"}</span>
        <span className="num">{cap ? `${usd(Math.max(0, cap - used), 0)} left` : ""}</span>
      </div>
    </div>
  );
}

export function PackTab({ agents, sample, busyId, onWhistle, onNew, onAsk }: { readonly agents: readonly PackAgentView[] | undefined; readonly sample: boolean; readonly busyId: string | null; readonly onWhistle: (a: PackAgentView) => void; readonly onNew: () => void; readonly onAsk: (a: PackAgentView) => void }) {
  if (!agents) return <div className="fd-agents">{[0, 1, 2].map((i) => <div key={i} className="m-skel" style={{ height: 220 }} />)}</div>;
  return (
    <div className="fd-agents">
      {agents.map((a) => {
        const m = agentMeter(a);
        const paused = a.status === "paused";
        return (
          <article key={a.id} className="fd-agent m-frame m-frame--thin" data-status={a.status}>
            <header className="fd-agent__head">
              <span className="fd-agent__icon"><PupIcon role={a.role} scale={3} /></span>
              <div>
                <h3>{a.name}</h3>
                <span className="m-kick">{roleTitle(a.role)}{a.depth > 1 ? " · PUP" : ""}</span>
              </div>
              <Tag tone={paused ? "ghost" : a.status === "revoked" ? "bad" : "ok"}>{a.status}</Tag>
            </header>
            <Meter {...m} />
            <dl className="fd-agent__facts">
              <div><dt>{"Tag"}</dt><dd>{a.agentId ? <Link to={`/app/tag/${a.agentId}`}>{`#${a.agentId}`}</Link> : <span className="m-muted">{"no Tag yet"}</span>}</dd></div>
              <div><dt>{"May"}</dt><dd>{a.capabilities.slice(0, 3).join(", ")}{a.capabilities.length > 3 ? " …" : ""}</dd></div>
              <div><dt>{"Session"}</dt><dd>{a.session ? "on chain" : "proposals only"}</dd></div>
              <div><dt>{"Since"}</dt><dd className="num">{new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</dd></div>
            </dl>
            <footer className="fd-agent__acts">
              <Button size="sm" tone="ghost" onClick={() => onAsk(a)}>{"ASK ABOUT IT"}</Button>
              {sample ? null : <Link to={`/app/pack/${encodeURIComponent(a.id)}`} className="m-btn m-btn--ghost m-btn--sm">{"DETAILS"}</Link>}
              <Button size="sm" tone={paused ? "ochre" : "navy"} disabled={sample || busyId === a.id || a.status === "revoked"} onClick={() => onWhistle(a)}>{paused ? "RELEASE" : "WHISTLE"}</Button>
            </footer>
          </article>
        );
      })}
      <button type="button" className="fd-agent fd-agent--new m-frame m-frame--thin" onClick={onNew}>
        <span className="fd-agent__plus" aria-hidden="true">+</span>
        <b>{"New agent"}</b>
        <span className="m-small m-muted">{"Tell Lyko what it should do and its budget. Its Fence stays inside yours."}</span>
      </button>
      {agents.length === 0 ? (
        <div className="fd-agents__empty">
          <EmptyState mood="resting" title="No agents yet">{"An agent gets a budget carved from yours and a Fence inside yours. It proposes; you, or its on-chain session, sign."}</EmptyState>
        </div>
      ) : null}
    </div>
  );
}
