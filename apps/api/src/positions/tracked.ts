/**
 * Two kinds the Fold tracks beside money: watches Lyko on watch keeps for
 * the owner, and step-by-step plans with steps still to sign. Neither moves
 * money on its own, so both are overlays (the money is already counted in
 * the wallet). Their detail is drawn with the generic blocks. Owner-only.
 */
import { intlTag } from "../i18n/format.js";
import { classifyPosition, deriveIntentStatus, type Position } from "@lykia/core";
import { autopilotService } from "../autopilot/service.js";
import { instructionsFor } from "../fold/instructions.js";
import { action, finish, sumUsd, type Reader } from "./context.js";

const DAY = 86_400_000;

function thenFact(sentence: string | undefined, stepCap: string) {
  return sentence ? [{ label: "Then Autopilot", value: sentence, meaning: `When the watch is met on your LykiaAccount, Lyko signs this inside your Autopilot leash (at most $${stepCap} a step).` }] : [];
}

export const readWatches: Reader = async (r, venue) => {
  const list = (await instructionsFor(r.ctx, r.owner)).filter((i) => i.source === "watch" && (i.environment === null || i.environment === r.environment) && i.status !== "cancelled" && i.status !== "done");
  // A watch can end in an Autopilot action: say what Lyko then does.
  const autopilot = await autopilotService(r.ctx).get(r.owner, r.environment).catch(() => null);
  const then = new Map((autopilot && autopilot.status !== "stopped" ? autopilot.tasks : []).filter((t) => t.when.kind === "condition" && t.when.watchId).map((t) => [(t.when as { watchId: string }).watchId, t.sentence]));
  const stepCap = autopilot?.limits.perStepUsd ?? "0";
  const positions: Position[] = list.slice(0, 24).map((w) =>
    finish({
      id: `watches:${w.id}`,
      venue: venue.id,
      venueName: venue.name,
      venueKind: "watch",
      label: w.name,
      assets: [],
      amount: "0",
      symbol: "",
      valueUsd: "0",
      counts: "overlay",
      state: w.status === "paused" ? "idle" : "watching",
      blocks: [{ type: "facts", items: [{ label: "Watching for", value: w.trigger, meaning: "When this happens, Lyko on watch tells you in the Fold, with a move ready if there is one." }, { label: "Last check", value: w.lastResult ?? "not checked yet" }, { label: "Status", value: w.status === "paused" ? "paused" : "on" }, ...thenFact(then.get(w.id), stepCap)] }],
      actions: [action("cancel", "Remove the watch", `Stop watching: ${w.name}`, "ask")],
      source: "history",
      readAt: r.readAt,
      block: null,
      explorer: null,
    }),
  );
  return { positions, block: null, method: "Watches handed to Lyko on watch from Ask Lyko.", source: "history" };
};

export const readPlans: Reader = async (r, venue) => {
  const since = r.ctx.clock.now() - 7 * DAY;
  const intents = (await r.history()).filter((g) => {
    if (Date.parse(g.createdAt) < since || g.steps.length < 2) return false;
    const status = deriveIntentStatus(g);
    if (status === "settled" || status === "failed" || status === "stopped") return false;
    // In progress: something already settled or sent, and something still to sign.
    return g.steps.some((s) => s.status === "settled" || s.status === "submitted" || s.status === "settling") && g.steps.some((s) => s.status === "ready" || s.status === "blocked" || s.status === "awaiting-signature");
  });
  const positions: Position[] = intents.slice(0, 12).map((g) => {
    const open = g.steps.filter((s) => s.status !== "settled");
    const value = sumUsd(open.flatMap((s) => s.inputs.slice(0, 1).map((a) => a.usd))) ?? "0";
    const done = g.steps.filter((s) => s.status === "settled").length;
    return finish({
      id: `plans:${g.id}`,
      venue: venue.id,
      venueName: venue.name,
      venueKind: "plan",
      label: g.source.length > 80 ? `${g.source.slice(0, 78)}…` : g.source,
      assets: [],
      amount: "0",
      symbol: "",
      valueUsd: value,
      counts: "overlay",
      state: classifyPosition({ kind: "commitment" }),
      blocks: [
        { type: "timeline", label: "Steps", steps: g.steps.map((s) => ({ label: s.summary, at: null, done: s.status === "settled" })), meaning: "Each next step is rebuilt from what the previous one delivered, and checked by your Fence again before you sign." },
        { type: "facts", items: [{ label: "Done", value: `${done} of ${g.steps.length} steps` }, { label: "Still to move", value: `$${Number(value).toLocaleString(intlTag(), { maximumFractionDigits: 2 })}`, meaning: "Still in your wallet until you sign the next step." }] },
      ],
      since: g.createdAt,
      actions: [action("cancel", "Continue or stop it", `Show me my plan "${g.source.slice(0, 120)}" so I can sign the next step or stop it`, "ask")],
      source: "history",
      readAt: r.readAt,
      block: null,
      explorer: null,
    });
  });
  return { positions, block: null, method: "The owner's Lykia plans from the last 7 days with steps still to sign.", source: "history" };
};
