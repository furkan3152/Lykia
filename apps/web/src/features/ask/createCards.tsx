/**
 * Cards for what Ask Lyko starts, and the answer cards that replaced pages.
 *
 *   leash-draft      the limits, laid as stones; REVIEW AND SIGN opens the
 *                    leash sheet (who, from, limits, review, keys)
 *   autopilot-draft  Autopilot's limits; REVIEW AND SIGN opens its sheet
 *                    (read what it holds, accept, sign once)
 *   autopilot-task   an automation Autopilot signs; ADD TO AUTOPILOT adds it
 *   agent-draft      an agent and the leash it holds; CREATE makes it
 *   yields           live rates for a token as pens of tesserae (grass
 *                    height is the rate, the stripe below is its risk)
 *
 * Nothing exists until the owner confirms on the card; then it is a row in
 * the Fold's Running list and, for agents and leashes, a card in the Pack.
 */
import type { AnswerBlock } from "@lykia/core/api/answer";
import { AUTOPILOT_BETA, type AutopilotTaskInput } from "@lykia/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Link } from "../../app/routes/Link";
import { PixelIcon } from "../../city/PixelIcon";
import { apiPost, describeError } from "../../lib/api";
import { LeashMark, PupIcon, Tag, cx, toast } from "../../mosaic";
import { useFoldOwner } from "../fold/data";
import { AutopilotSheet } from "../fold/autopilot/AutopilotSheet";
import { NewLeashSheet } from "../fold/leash/NewLeashSheet";
import { useChatActions } from "./actions";
import { CardShell } from "./cards";
import { formatUsd, t } from "../../i18n";

const money = (v: string | number) => formatUsd(Number(v), { min: 0 });

/** The figures of a draft as a row of stones: each one the owner's own. */
function Stones({ items }: { readonly items: readonly { readonly k: string; readonly v: string; readonly tone?: "terra" | "sea" | "ochre" | "olive" | "navy" }[] }) {
  return (
    <ul className="m-stones" aria-label={t("ask.createCards.whatItHolds")}>
      {items.map((i) => (
        <li key={i.k} className="m-stones__stone" data-tone={i.tone ?? "terra"}>
          <b className="num">{i.v}</b>
          <span>{i.k}</span>
        </li>
      ))}
    </ul>
  );
}

function useNeedsOwner() {
  const owner = useFoldOwner();
  const blocked = owner.sample ? t("ask.createCards.connectAWalletFirstThisChat") : !owner.signedIn ? t("ask.createCards.signInWithYourWalletFirst") : null;
  return { owner, blocked };
}

function LeashDraftCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "leash-draft" }> }) {
  const d = block.draft;
  const { owner, blocked } = useNeedsOwner();
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState(false);
  const qc = useQueryClient();
  const what = { "pay-invoices": t("ask.createCards.paysInvoices"), "trade-small": t("ask.createCards.tradesSmallAmounts"), earn: "earns" }[d.template];
  return (
    <CardShell kind="leash-draft" tone="terra" kick={null} title={block.title} icon={<LeashMark scale={2} />}>
      <p className="m-card2__note">{t("ask.createCards.insideABudgetItCannotGo", { name: d.name, what })}</p>
      <Stones items={[{ k: t("ask.createCards.aDay"), v: money(d.perDayUsd) }, { k: d.days === 1 ? "day" : "days", v: String(d.days), tone: "ochre" }, { k: t("ask.createCards.atMostInAll"), v: money(Number(d.perDayUsd) * d.days), tone: "navy" }, ...(d.perStepUsd ? [{ k: t("ask.createCards.inOneStep"), v: money(d.perStepUsd), tone: "sea" as const }] : []), { k: t("ask.createCards.spendsFrom"), v: d.spendFrom === "gateway" ? "Gateway" : "Arc", tone: "olive" }]}
      />
      {d.spendFrom === "gateway" ? <p className="m-small m-muted">{t("ask.createCards.fromYourGatewayBalanceThroughYour")}</p> : null}
      {block.note ? <p className="m-small m-muted">{block.note}</p> : null}
      <div className="m-card2__acts">
        {made ? (
          <Link to="/app/fold/pack" className="m-mini">{t("ask.createCards.seeItInThePack")}</Link>
        ) : (
          <button type="button" className="m-mini m-mini--go" disabled={Boolean(blocked)} title={blocked ?? undefined} onClick={() => setOpen(true)}>{t("ask.createCards.reviewAndSign")}</button>
        )}
        {blocked ? <span className="m-small m-muted">{blocked}</span> : null}
      </div>
      {open ? (
        <NewLeashSheet
          open
          owner={owner}
          draft={{ name: d.name, template: d.template, perDayUsd: d.perDayUsd, days: d.days, ...(d.perStepUsd ? { perStepUsd: d.perStepUsd } : {}), ...(d.recipients ? { recipients: d.recipients as `0x${string}`[] } : {}) }}
          {...(d.spendFrom ? { spendFrom: d.spendFrom } : {})}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setMade(true);
            for (const k of ["leashes", "fold-instructions", "pack"]) void qc.invalidateQueries({ queryKey: [k] });
          }}
        />
      ) : null}
    </CardShell>
  );
}

function AutopilotDraftCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "autopilot-draft" }> }) {
  const { owner, blocked } = useNeedsOwner();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  return (
    <CardShell kind="autopilot-draft" tone="navy" kick={null} title={t("ask.createCards.lykoSignsYourOwnAutomations")} icon={<PixelIcon name="pilot" size={20} />}>
      <p className="m-card2__note">{t("ask.createCards.insideTheseLimitsOnlyOnYour")}</p>
      <Stones items={[{ k: t("ask.createCards.aStepAtMost"), v: money(block.perStepUsd), tone: "navy" }, { k: t("ask.createCards.aDayAtMost"), v: money(block.perDayUsd), tone: "sea" }, { k: block.days === 1 ? "day" : "days", v: String(block.days), tone: "ochre" }, { k: t("ask.createCards.payeesNamed"), v: String(block.payees.length), tone: "olive" }]} />
      <p className="m-small m-muted">{t("ask.createCards.betaCeilingsAStepADay", { money: money(AUTOPILOT_BETA.perStepUsd), money2: money(AUTOPILOT_BETA.perDayUsd) })}</p>
      <div className="m-card2__acts">
        <button type="button" className="m-mini m-mini--go" disabled={Boolean(blocked)} title={blocked ?? undefined} onClick={() => setOpen(true)}>{t("ask.createCards.reviewAndSign")}</button>
        {blocked ? <span className="m-small m-muted">{blocked}</span> : null}
      </div>
      {open ? (
        <AutopilotSheet
          owner={owner}
          offer={undefined}
          initial={{ perStepUsd: block.perStepUsd, perDayUsd: block.perDayUsd, days: String(block.days), payees: block.payees.join("\n") }}
          onClose={() => setOpen(false)}
          onDone={() => {
            for (const k of ["autopilot", "fold-instructions"]) void qc.invalidateQueries({ queryKey: [k] });
          }}
        />
      ) : null}
    </CardShell>
  );
}

function AutopilotTaskCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "autopilot-task" }> }) {
  const { blocked } = useNeedsOwner();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const qc = useQueryClient();
  const actions = useChatActions();
  const off = block.autopilot === "off" || block.autopilot === "pending";
  const add = async () => {
    setState("busy");
    try {
      await apiPost("/v1/autopilot/tasks", { environment: block.environment, task: block.task as unknown as AutopilotTaskInput });
      setState("done");
      for (const k of ["autopilot", "fold-instructions"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success(t("ask.createCards.addedToAutopilot"), { description: block.label, from: "LYKO" });
    } catch (e) {
      setState("idle");
      toast.error(t("ask.createCards.notAdded"), { description: describeError(e), from: "LYKO" });
    }
  };
  return (
    <CardShell kind="autopilot-task" tone="sea" kick="AUTOPILOT" title={block.label} icon={<PixelIcon name="repeat" size={20} />}>
      <Stones items={[{ k: t("ask.createCards.mostPerRun"), v: money(block.task.amountUsd ?? "0"), tone: "sea" }, ...(block.task.floor ? [{ k: t("ask.createCards.healthFloor"), v: block.task.floor, tone: "terra" as const }] : []), ...(block.task.keepUsd ? [{ k: t("ask.createCards.staysPut"), v: money(block.task.keepUsd), tone: "olive" as const }] : []), ...(block.task.every ? [{ k: "every", v: block.task.every, tone: "ochre" as const }] : [])]} />
      {off ? <p className="m-small m-muted">{t("ask.createCards.autopilotIsNotOnYetTurn")}</p> : null}
      <div className="m-card2__acts">
        {state === "done" ? (
          <Link to="/app/fold/herding?show=automations" className="m-mini">{t("ask.createCards.seeItRunning")}</Link>
        ) : off ? (
          <button type="button" className="m-mini m-mini--go" onClick={() => actions.prefill?.(t("ask.createCards.turnOnAutopilotWith"))}>{t("ask.createCards.turnOnAutopilotFirst")}</button>
        ) : (
          <button type="button" className="m-mini m-mini--go" disabled={Boolean(blocked) || state === "busy"} title={blocked ?? undefined} onClick={() => void add()}>{state === "busy" ? "ADDING…" : t("ask.createCards.addToAutopilot")}</button>
        )}
      </div>
    </CardShell>
  );
}

function AgentDraftCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "agent-draft" }> }) {
  const { owner, blocked } = useNeedsOwner();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const qc = useQueryClient();
  const create = async () => {
    setState("busy");
    try {
      // Its leash is its own Fence: the role's template with the daily budget the owner gave, carved from the owner's.
      await apiPost("/v1/pack", { owner: owner.address, environment: block.environment, name: block.name, role: block.role, ...(block.mission ? { mission: block.mission } : {}), fence: { schema: "lykia.fence/v1", label: block.name, caps: { dailyUsd: block.dailyUsd } } });
      setState("done");
      for (const k of ["pack", "fold-instructions", "fold-summary"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success(t("ask.createCards.joinedThePack", { name: block.name }), { description: t("ask.createCards.aDayInsideYourFence", { money: money(block.dailyUsd) }), from: "LYKO" });
    } catch (e) {
      setState("idle");
      toast.error(t("ask.createCards.notCreated"), { description: describeError(e), from: "LYKO" });
    }
  };
  return (
    <CardShell kind="agent-draft" tone="olive" kick={null} title={block.name} icon={<PupIcon role={block.role} scale={2} />}>
      <p className="m-card2__note">{t("ask.createCards.itsOwnFenceSitsInsideYours")}</p>
      <Stones items={[{ k: "role", v: block.role.replace(/-/gu, " "), tone: "olive" }, { k: t("ask.createCards.aDayAtMost"), v: money(block.dailyUsd), tone: "terra" }]} />
      {block.mission ? <p className="m-small m-muted">{block.mission}</p> : null}
      <div className="m-card2__acts">
        {state === "done" ? (
          <Link to="/app/fold/pack" className="m-mini">{t("ask.createCards.seeItInThePack")}</Link>
        ) : (
          <button type="button" className="m-mini m-mini--go" disabled={Boolean(blocked) || state === "busy"} title={blocked ?? undefined} onClick={() => void create()}>{state === "busy" ? "CREATING…" : "CREATE THE AGENT"}</button>
        )}
        {blocked ? <span className="m-small m-muted">{blocked}</span> : null}
      </div>
    </CardShell>
  );
}

/** A venue as "Name · 0xabcd…1234": the name may end in an ellipsis, the address keeps its own line. */
function PenVenue({ venue }: { readonly venue: string }) {
  const at = venue.lastIndexOf(" · 0x");
  const name = at > 0 ? venue.slice(0, at) : venue;
  const address = at > 0 ? venue.slice(at + 3) : null;
  return (
    <span className="m-pen__venue" title={venue}>
      <span className="m-pen__name">{name}</span>
      {address ? <span className="num m-pen__addr">{address}</span> : null}
    </span>
  );
}

function YieldsCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "yields" }> }) {
  const actions = useChatActions();
  const top = Math.max(1, ...block.rows.map((r) => Number(r.apyPercent ?? 0)));
  return (
    <CardShell kind="yields" tone="olive" kick={null} title={block.best ? t("ask.createCards.greenestPen", { best: block.best }) : `${block.token} rates`} icon={<PixelIcon name="spark" size={20} />} from={block.from}>
      {block.rows.length === 0 ? (
        <p className="m-card2__note">{t("ask.createCards.noRateCanBeReadRight")}</p>
      ) : (
        <ol className="m-pens" aria-label={t("ask.createCards.ratesBestFirst", { token: block.token })}>
          {block.rows.map((r, i) => {
            const h = r.apyPercent === null ? 0 : Math.max(1, Math.round((Number(r.apyPercent) / top) * 8));
            return (
              <li key={r.venue} className={cx("m-pen", i === 0 && "is-best")} data-risk={r.risk}>
                <span className="m-pen__grass" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, k) => <i key={k} data-on={k < h} />)}
                </span>
                <b className="num m-pen__apy">{r.apyPercent === null ? "n/a" : `${r.apyPercent}%`}</b>
                <PenVenue venue={r.venue} />
                <span className="m-pen__meta">
                  <Tag tone={r.risk === "low" ? "ok" : r.risk === "medium" ? "ochre" : "bad"}>{`${r.risk} risk`}</Tag>
                  <small>{r.source}</small>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="m-small m-muted">{t("ask.createCards.apyIsTheYearlyReturnIf")}</p>
      <div className="m-card2__acts">
        <button type="button" className="m-mini m-mini--go" onClick={() => actions.prefill?.(t("ask.createCards.putMyIdleToWorkAt", { token: block.token }))}>{t("ask.createCards.putToWork", { token: block.token })}</button>
        <button type="button" className="m-mini" onClick={() => actions.prefill?.(t("ask.createCards.whereCanIEarnOn", { token: block.token === "USDC" ? "EURC" : "USDC" }))}>{t("ask.createCards.tokenRates", { token: block.token === "USDC" ? "EURC" : "USDC" })}</button>
      </div>
    </CardShell>
  );
}

/** The cards for what Ask starts and the answers that replaced pages; null for any other block. */
export function CreateCard({ block }: { readonly block: AnswerBlock }) {
  switch (block.kind) {
    case "leash-draft":
      return <LeashDraftCard block={block} />;
    case "autopilot-draft":
      return <AutopilotDraftCard block={block} />;
    case "autopilot-task":
      return <AutopilotTaskCard block={block} />;
    case "agent-draft":
      return <AgentDraftCard block={block} />;
    case "yields":
      return <YieldsCard block={block} />;
    default:
      return null;
  }
}
