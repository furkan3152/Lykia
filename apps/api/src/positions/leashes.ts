/**
 * Leash budgets as positions: each live leash is money an outside bot may
 * spend from the owner's wallet, within caps on chain. The money still sits
 * in the wallet, so a leash is an overlay (never added twice). Its detail is
 * drawn with the generic blocks: today's budget and the whole budget as
 * gauges, the end date as a countdown. Owner-only.
 */
import { intlTag } from "../i18n/format.js";
import { classifyPosition, LEASH_TEMPLATES, type Position } from "@lykia/core";
import { leashService } from "../leash/service.js";
import { action, finish, type Reader } from "./context.js";

import { tx } from "@lykia/core";
const money = (v: string | number) => `$${Number(v).toLocaleString(intlTag(), { maximumFractionDigits: 2 })}`;

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
        { type: "gauge", label: tx("Used today"), value: Number(day.spentUsd), min: 0, max: Number(day.capUsd) || 1, display: `${money(day.spentUsd)} of ${money(day.capUsd)}`, threshold: { at: Number(day.capUsd), label: tx("today's cap ({amount})", { amount: money(day.capUsd) }), danger: "above" }, meaning: tx("{agentName} can spend {amount} more today; past the cap the chain refuses.", { agentName: l.agentName, amount: money(day.remainingUsd) }) },
        { type: "gauge", label: tx("Used in total"), value: Number(total.spentUsd), min: 0, max: Number(total.capUsd) || 1, display: `${money(total.spentUsd)} of ${money(total.capUsd)}`, threshold: { at: Number(total.capUsd), label: tx("the whole budget ({amount})", { amount: money(total.capUsd) }), danger: "above" } },
        { type: "facts", items: [{ label: tx("Per step"), value: money(l.usage.perStepUsd), meaning: tx("The most it can move in one go.") }, { label: tx("Spends from"), value: l.spendFrom === "gateway" ? tx("your Gateway balance (LykiaStile)") : tx("your Arc wallet (LykiaAccount)"), meaning: l.spendFrom === "gateway" ? tx("Gateway asks your LykiaStile before every transfer; it answers only inside this leash's caps.") : tx("Your LykiaAccount holds the caps on chain.") }, { label: tx("Status"), value: l.status === "pending" ? tx("waiting for your signature") : "active" }] },
        { type: "countdown", label: tx("Ends"), until: l.expiresAt, ends: true, meaning: tx("After this date the bot's key stops working on its own.") },
      ],
      actions: [action("cancel", tx("Revoke"), tx("Revoke {agentName}'s leash", { agentName: l.agentName }), "ask")],
      source: "history",
      readAt: r.readAt,
      block: l.usage.block,
      explorer: null,
    });
  });
  return { positions, block: null, method: "The owner's leashes, with usage read from the LykiaAccount or LykiaStile on chain.", source: "history" };
};
