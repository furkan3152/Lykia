/**
 * Leash budgets as positions: each live leash is money an outside bot may
 * spend from the owner's wallet, within caps on chain. The money still sits
 * in the wallet, so a leash is an overlay (never added twice). Its detail is
 * drawn with the generic blocks: today's budget and the whole budget as
 * gauges, the end date as a countdown. Owner-only.
 */
import { classifyPosition, LEASH_TEMPLATES, type Position } from "@lykia/core";
import { leashService } from "../leash/service.js";
import { action, finish, type Reader } from "./context.js";

const money = (v: string | number) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export const readLeashes: Reader = async (r, venue) => {
  const list = (await leashService(r.ctx).list(r.owner, r.environment)).filter((l) => l.status === "active" || l.status === "pending");
  const positions: Position[] = list.slice(0, 24).map((l) => {
    const day = l.usage.day;
    const total = l.usage.total;
    return finish({
      id: `leashes:${l.id}`,
      venue: venue.id,
      venueName: venue.name,
      venueKind: "leash",
      label: `${l.agentName} · ${LEASH_TEMPLATES[l.template].title}`,
      assets: [{ symbol: "USDC", token: null, amount: total.remainingUsd, valueUsd: total.remainingUsd, role: "committed" }],
      amount: total.remainingUsd,
      symbol: "USDC",
      valueUsd: total.remainingUsd,
      counts: "overlay",
      state: classifyPosition({ kind: "commitment" }),
      blocks: [
        { type: "gauge", label: "Used today", value: Number(day.spentUsd), min: 0, max: Number(day.capUsd) || 1, display: `${money(day.spentUsd)} of ${money(day.capUsd)}`, threshold: { at: Number(day.capUsd), label: `today's cap (${money(day.capUsd)})`, danger: "above" }, meaning: `${l.agentName} can spend ${money(day.remainingUsd)} more today; past the cap the chain refuses.` },
        { type: "gauge", label: "Used in total", value: Number(total.spentUsd), min: 0, max: Number(total.capUsd) || 1, display: `${money(total.spentUsd)} of ${money(total.capUsd)}`, threshold: { at: Number(total.capUsd), label: `the whole budget (${money(total.capUsd)})`, danger: "above" } },
        { type: "facts", items: [{ label: "Per step", value: money(l.usage.perStepUsd), meaning: "The most it can move in one go." }, { label: "Spends from", value: l.spendFrom === "gateway" ? "your Gateway balance (LykiaStile)" : "your Arc wallet (LykiaAccount)", meaning: l.spendFrom === "gateway" ? "Gateway asks your LykiaStile before every transfer; it answers only inside this leash's caps." : "Your LykiaAccount holds the caps on chain." }, { label: "Status", value: l.status === "pending" ? "waiting for your signature" : "active" }] },
        { type: "countdown", label: "Ends", until: l.expiresAt, ends: true, meaning: "After this date the bot's key stops working on its own." },
      ],
      actions: [action("cancel", "Revoke", `Revoke ${l.agentName}'s leash`, "ask")],
      source: "history",
      readAt: r.readAt,
      block: l.usage.block,
      explorer: null,
    });
  });
  return { positions, block: null, method: "The owner's leashes, with usage read from the LykiaAccount or LykiaStile on chain.", source: "history" };
};
