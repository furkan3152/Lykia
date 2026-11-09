/**
 * Pack · your agents and their leashes. The cards for an agent whose leash
 * is its budget on Lykia's side (its Fence inside yours, a daily cap carved
 * from yours), and the one tile that starts something new: Ask Lyko. The
 * leash cards for outside bots live in leash/LeashSection.tsx; both sit in
 * the same grid.
 */
import { ROLE_TEMPLATES, type PackRole } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";

import { Link } from "../../../app/routes/Link";
import { Button, PupIcon, Tag } from "../../../mosaic";
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

/** An agent with no outside leash: its leash is its budget on Lykia's side (a Fence inside yours, a daily cap carved from yours). */
export function AgentCard({ a, sample, busy, onPause, onAsk, onRevoke }: { readonly a: PackAgentView; readonly sample: boolean; readonly busy: boolean; readonly onPause: (a: PackAgentView) => void; readonly onAsk: (a: PackAgentView) => void; readonly onRevoke: (a: PackAgentView) => void }) {
  const m = agentMeter(a);
  const paused = a.status === "paused";
  return (
    <article className="fd-pk__card fd-agent m-frame m-frame--thin" data-status={a.status} data-tone="sea">
      <header className="fd-agent__head">
        <span className="fd-agent__icon"><PupIcon role={a.role} scale={3} /></span>
        <div>
          <h3>{a.name}</h3>
          <span className="m-kick">{`${roleTitle(a.role)}${a.depth > 1 ? " · PUP" : ""} · LEASH ON LYKIA`}</span>
        </div>
        <Tag tone={paused ? "ghost" : a.status === "revoked" ? "bad" : "ok"}>{a.status}</Tag>
      </header>
      <Meter {...m} />
      <dl className="fd-agent__facts">
        <div><dt>{"Budget"}</dt><dd className="num">{a.budget.caps.dailyUsd ? `${usd(Number(a.budget.caps.dailyUsd), 0)} a day` : "no cap"}</dd></div>
        <div><dt>{"Can it sign?"}</dt><dd>{a.session ? "yes, within its leash" : "no, it proposes; you sign"}</dd></div>
        <div><dt>{"ID card (Tag)"}</dt><dd>{a.agentId ? <Link to={`/app/tag/${a.agentId}`}>{`#${a.agentId}`}</Link> : <span className="m-muted">{"none yet"}</span>}</dd></div>
        <div><dt>{"Since"}</dt><dd className="num">{new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</dd></div>
      </dl>
      <footer className="fd-agent__acts">
        <Button size="sm" tone="ghost" disabled={sample || busy || a.status === "revoked"} onClick={() => onPause(a)}>{paused ? "RESUME" : "PAUSE"}</Button>
        <Button size="sm" tone="navy" disabled={sample || busy || a.status === "revoked"} onClick={() => onRevoke(a)}>{"REVOKE"}</Button>
        <button type="button" className="fd-run__ask" onClick={() => onAsk(a)}>{"Change in Ask Lyko"}</button>
      </footer>
    </article>
  );
}

/** The one way to start something in the Pack: Ask Lyko, with the request filled in. */
export function AskTile({ onAsk }: { readonly onAsk: (text: string, context: string) => void }) {
  return (
    <div className="fd-pk__ask m-frame m-frame--thin">
      <span className="fd-pk__askmark" aria-hidden="true"><PupIcon role="orchestrator" scale={3} /></span>
      <b>{"A new agent or leash starts in Ask Lyko"}</b>
      <span className="m-small m-muted">{"Say who it is for, what it may spend a day and for how long. Lyko drafts it, you review and sign once there, and it shows up here."}</span>
      <div className="fd-pk__asks">
        <button type="button" className="m-chip" onClick={() => onAsk("Give my bot ", "A new leash from the Pack.")}>{"Give my bot $… a day"}</button>
        <button type="button" className="m-chip" onClick={() => onAsk("Create a ", "A new agent from the Pack.")}>{"Create an agent"}</button>
      </div>
      <Button size="sm" tone="terra" onClick={() => onAsk("Give my bot ", "A new leash from the Pack.")}>{"ASK LYKO"}</Button>
    </div>
  );
}
