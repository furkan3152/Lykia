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

const money = (v: string | number) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** The figures of a draft as a row of stones: each one the owner's own. */
function Stones({ items }: { readonly items: readonly { readonly k: string; readonly v: string; readonly tone?: "terra" | "sea" | "ochre" | "olive" | "navy" }[] }) {
  return (
    <ul className="m-stones" aria-label="What it holds">
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
  const blocked = owner.sample ? "Connect a wallet first: this chat is a sample." : !owner.signedIn ? "Sign in with your wallet first (one message, no transaction)." : null;
  return { owner, blocked };
}

function LeashDraftCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "leash-draft" }> }) {
  const d = block.draft;
  const { owner, blocked } = useNeedsOwner();
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState(false);
  const qc = useQueryClient();
  const what = { "pay-invoices": "pays invoices", "trade-small": "trades small amounts", earn: "earns" }[d.template];
  return (
    <CardShell kind="leash-draft" tone="terra" kick="A LEASH · YOU REVIEW AND SIGN ONCE" title={block.title} icon={<LeashMark scale={2} />}>
      <p className="m-card2__note">{`${d.name} ${what}, inside a budget it cannot go past. Every figure below is yours.`}</p>
      <Stones items={[{ k: "a day", v: money(d.perDayUsd) }, { k: d.days === 1 ? "day" : "days", v: String(d.days), tone: "ochre" }, { k: "at most in all", v: money(Number(d.perDayUsd) * d.days), tone: "navy" }, ...(d.perStepUsd ? [{ k: "in one step", v: money(d.perStepUsd), tone: "sea" as const }] : []), { k: "spends from", v: d.spendFrom === "gateway" ? "Gateway" : "Arc", tone: "olive" }]}
      />
      {d.spendFrom === "gateway" ? <p className="m-small m-muted">{"From your Gateway balance through your own LykiaStile: it can pay on the chains you pick in the review."}</p> : null}
      {block.note ? <p className="m-small m-muted">{block.note}</p> : null}
      <div className="m-card2__acts">
        {made ? (
          <Link to="/app/fold/pack" className="m-mini">{"See it in the Pack"}</Link>
        ) : (
          <button type="button" className="m-mini m-mini--go" disabled={Boolean(blocked)} title={blocked ?? undefined} onClick={() => setOpen(true)}>{"REVIEW AND SIGN"}</button>
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
    <CardShell kind="autopilot-draft" tone="navy" kick="AUTOPILOT · YOU READ, ACCEPT AND SIGN ONCE" title="Lyko signs your own automations" icon={<PixelIcon name="pilot" size={20} />}>
      <p className="m-card2__note">{"Inside these limits only, on your own LykiaAccount. Stop ends it at once; the Whistle stops it too."}</p>
      <Stones items={[{ k: "a step at most", v: money(block.perStepUsd), tone: "navy" }, { k: "a day at most", v: money(block.perDayUsd), tone: "sea" }, { k: block.days === 1 ? "day" : "days", v: String(block.days), tone: "ochre" }, { k: "payees named", v: String(block.payees.length), tone: "olive" }]} />
      <p className="m-small m-muted">{`Beta ceilings: ${money(AUTOPILOT_BETA.perStepUsd)} a step, ${money(AUTOPILOT_BETA.perDayUsd)} a day.`}</p>
      <div className="m-card2__acts">
        <button type="button" className="m-mini m-mini--go" disabled={Boolean(blocked)} title={blocked ?? undefined} onClick={() => setOpen(true)}>{"REVIEW AND SIGN"}</button>
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
      toast.success("Added to Autopilot", { description: block.label, from: "LYKO" });
    } catch (e) {
      setState("idle");
      toast.error("Not added", { description: describeError(e), from: "LYKO" });
    }
  };
  return (
    <CardShell kind="autopilot-task" tone="sea" kick="AN AUTOMATION · AUTOPILOT SIGNS" title={block.label} icon={<PixelIcon name="repeat" size={20} />}>
      <Stones items={[{ k: "most per run", v: money(block.task.amountUsd ?? "0"), tone: "sea" }, ...(block.task.floor ? [{ k: "health floor", v: block.task.floor, tone: "terra" as const }] : []), ...(block.task.keepUsd ? [{ k: "stays put", v: money(block.task.keepUsd), tone: "olive" as const }] : []), ...(block.task.every ? [{ k: "every", v: block.task.every, tone: "ochre" as const }] : [])]} />
      {off ? <p className="m-small m-muted">{"Autopilot is not on yet. Turn it on first; this task waits in the chat."}</p> : null}
      <div className="m-card2__acts">
        {state === "done" ? (
          <Link to="/app/fold/herding?show=automations" className="m-mini">{"See it running"}</Link>
        ) : off ? (
          <button type="button" className="m-mini m-mini--go" onClick={() => actions.prefill?.("Turn on Autopilot with ")}>{"TURN ON AUTOPILOT FIRST"}</button>
        ) : (
          <button type="button" className="m-mini m-mini--go" disabled={Boolean(blocked) || state === "busy"} title={blocked ?? undefined} onClick={() => void add()}>{state === "busy" ? "ADDING…" : "ADD TO AUTOPILOT"}</button>
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
      toast.success(`${block.name} joined the Pack`, { description: `${money(block.dailyUsd)} a day, inside your Fence.`, from: "LYKO" });
    } catch (e) {
      setState("idle");
      toast.error("Not created", { description: describeError(e), from: "LYKO" });
    }
  };
  return (
    <CardShell kind="agent-draft" tone="olive" kick="AN AGENT · IT HOLDS A LEASH" title={block.name} icon={<PupIcon role={block.role} scale={2} />}>
      <p className="m-card2__note">{"Its own Fence sits inside yours and its budget is carved from yours. It proposes; you sign each plan."}</p>
      <Stones items={[{ k: "role", v: block.role.replace(/-/gu, " "), tone: "olive" }, { k: "a day at most", v: money(block.dailyUsd), tone: "terra" }]} />
      {block.mission ? <p className="m-small m-muted">{block.mission}</p> : null}
      <div className="m-card2__acts">
        {state === "done" ? (
          <Link to="/app/fold/pack" className="m-mini">{"See it in the Pack"}</Link>
        ) : (
          <button type="button" className="m-mini m-mini--go" disabled={Boolean(blocked) || state === "busy"} title={blocked ?? undefined} onClick={() => void create()}>{state === "busy" ? "CREATING…" : "CREATE THE AGENT"}</button>
        )}
        {blocked ? <span className="m-small m-muted">{blocked}</span> : null}
      </div>
    </CardShell>
  );
}

function YieldsCard({ block }: { readonly block: Extract<AnswerBlock, { kind: "yields" }> }) {
  const actions = useChatActions();
  const top = Math.max(1, ...block.rows.map((r) => Number(r.apyPercent ?? 0)));
  return (
    <CardShell kind="yields" tone="olive" kick={`LIVE RATES · ${block.token} ON ARC`} title={block.best ? `Greenest pen: ${block.best}` : `${block.token} rates`} icon={<PixelIcon name="spark" size={20} />} from={block.from}>
      {block.rows.length === 0 ? (
        <p className="m-card2__note">{"No rate can be read right now. Rates are read, never guessed."}</p>
      ) : (
        <ol className="m-pens" aria-label={`${block.token} rates, best first`}>
          {block.rows.map((r, i) => {
            const h = r.apyPercent === null ? 0 : Math.max(1, Math.round((Number(r.apyPercent) / top) * 8));
            return (
              <li key={r.venue} className={cx("m-pen", i === 0 && "is-best")} data-risk={r.risk}>
                <span className="m-pen__grass" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, k) => <i key={k} data-on={k < h} />)}
                </span>
                <b className="num m-pen__apy">{r.apyPercent === null ? "n/a" : `${r.apyPercent}%`}</b>
                <span className="m-pen__venue">{r.venue}</span>
                <span className="m-pen__meta">
                  <Tag tone={r.risk === "low" ? "ok" : r.risk === "medium" ? "ochre" : "bad"}>{`${r.risk} risk`}</Tag>
                  <small>{r.source}</small>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="m-small m-muted">{"APY is the yearly return if today's rate held. Risk follows each venue's depth. Lyko's plan uses the route search's winner within your Fence."}</p>
      <div className="m-card2__acts">
        <button type="button" className="m-mini m-mini--go" onClick={() => actions.prefill?.(`Put my idle ${block.token} to work at low risk`)}>{`PUT ${block.token} TO WORK`}</button>
        <button type="button" className="m-mini" onClick={() => actions.prefill?.(`Where can I earn on ${block.token === "USDC" ? "EURC" : "USDC"}?`)}>{`${block.token === "USDC" ? "EURC" : "USDC"} RATES`}</button>
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
