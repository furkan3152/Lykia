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
import { intlLocale, t } from "../../../i18n";

const roleTitle = (role: PackRole) => (role === "custom" ? t("fold.tabs.packTab.custom") : role === "orchestrator" ? "Lyko" : ROLE_TEMPLATES[role].title.en);

function Meter({ share, used, cap, label }: { readonly share: number; readonly used: number; readonly cap: number | null; readonly label: string }) {
  const n = 12;
  const filled = Math.round(share * n);
  return (
    <div className="fd-meter" data-tone={share >= 0.95 ? "bad" : share >= 0.8 ? "warn" : "ok"}>
      <div className="fd-meter__row" role="meter" aria-valuemin={0} aria-valuemax={cap ?? 0} aria-valuenow={used} aria-label={cap ? t("common.usedOfLabel", { used: usd(used, 0), cap: usd(cap, 0), label }) : t("fold.tabs.packTab.noBudgetCap")}>
        {Array.from({ length: n }, (_, i) => <i key={i} data-f={i < filled} />)}
      </div>
      <div className="fd-meter__legend">
        <span className="num">{cap ? t("fold.tabs.packTab.usedLabel", { amount: usd(used, 0), label }) : t("fold.tabs.packTab.noCap")}</span>
        <span className="num">{cap ? t("fold.foldBar.left", { amount: usd(Math.max(0, cap - used), 0) }) : ""}</span>
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
          <span className="m-kick">{t("fold.tabs.packTab.roleLeashOnLykia", { role: `${roleTitle(a.role)}${a.depth > 1 ? t("fold.tabs.packTab.pup") : ""}` })}</span>
        </div>
        <Tag tone={paused ? "ghost" : a.status === "revoked" ? "bad" : "ok"}>{a.status}</Tag>
      </header>
      <Meter {...m} />
      <dl className="fd-agent__facts">
        <div><dt>{t("fold.tabs.packTab.budget")}</dt><dd className="num">{a.budget.caps.dailyUsd ? t("fold.tabs.packTab.aDay", { usd: usd(Number(a.budget.caps.dailyUsd), 0) }) : t("fold.tabs.packTab.noCap")}</dd></div>
        <div><dt>{t("fold.tabs.packTab.canItSign")}</dt><dd>{a.session ? t("fold.tabs.packTab.yesWithinItsLeash") : t("fold.tabs.packTab.noItProposesYouSign")}</dd></div>
        <div><dt>{t("fold.tabs.packTab.idCardTag")}</dt><dd>{a.agentId ? <Link to={`/app/tag/${a.agentId}`}>{`#${a.agentId}`}</Link> : <span className="m-muted">{t("fold.tabs.packTab.noneYet")}</span>}</dd></div>
        <div><dt>{t("fold.tabs.packTab.since")}</dt><dd className="num">{new Date(a.createdAt).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" })}</dd></div>
      </dl>
      <footer className="fd-agent__acts">
        <Button size="sm" tone="ghost" disabled={sample || busy || a.status === "revoked"} onClick={() => onPause(a)}>{paused ? "RESUME" : "PAUSE"}</Button>
        <Button size="sm" tone="navy" disabled={sample || busy || a.status === "revoked"} onClick={() => onRevoke(a)}>{t("fold.tabs.packTab.revoke")}</Button>
        <button type="button" className="fd-run__ask" onClick={() => onAsk(a)}>{t("fold.tabs.packTab.changeInAskLyko")}</button>
      </footer>
    </article>
  );
}

/** The one way to start something in the Pack: Ask Lyko, with the request filled in. */
export function AskTile({ onAsk }: { readonly onAsk: (text: string, context: string) => void }) {
  return (
    <div className="fd-pk__ask m-frame m-frame--thin">
      <span className="fd-pk__askmark" aria-hidden="true"><PupIcon role="orchestrator" scale={3} /></span>
      <b>{t("fold.tabs.packTab.aNewAgentOrLeashStarts")}</b>
      <span className="m-small m-muted">{t("fold.tabs.packTab.sayWhoItIsForWhat")}</span>
      <div className="fd-pk__asks">
        <button type="button" className="m-chip" onClick={() => onAsk(t("fold.tabs.packTab.giveMyBot"), t("fold.tabs.packTab.aNewLeashFromThePack"))}>{t("fold.tabs.packTab.giveMyBotADay")}</button>
        <button type="button" className="m-chip" onClick={() => onAsk(t("fold.tabs.packTab.createSeed"), t("fold.tabs.packTab.aNewAgentFromThePack"))}>{t("fold.tabs.packTab.createAnAgent")}</button>
      </div>
      <Button size="sm" tone="terra" onClick={() => onAsk(t("fold.tabs.packTab.giveMyBot"), t("fold.tabs.packTab.aNewLeashFromThePack"))}>{t("fold.tabs.packTab.askLyko")}</Button>
    </div>
  );
}
