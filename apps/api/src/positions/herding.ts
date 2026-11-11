/**
 * Money already spoken for: open LykiaOrders orders (the sell amount stays in
 * the wallet behind an allowance until a keeper fills a slice, so it is an
 * overlay on the wallet, never added twice) and scheduled payments (standing
 * orders that send on a schedule). Both are owner-only: the order levels and
 * the payment recipients are personal.
 */
import { classifyPosition, fromBaseUnits, getToken, tokenByAddress, type Address, type Position } from "@lykia/core";
import { ordersService } from "../orders/service.js";
import { services } from "../services.js";
import { action, asset, finish, valued, type Reader } from "./context.js";

import { tx } from "@lykia/core";
const DAY = 86_400_000;

export const readOrders: Reader = async (r, venue) => {
  const orders = (await ordersService(r.ctx).list(r.environment, r.owner)).filter((o) => o.status === "open" || o.status === "waiting");
  const now = r.ctx.clock.now();
  const symbols = orders.map((o) => tokenByAddress(r.environment, o.order.tokenIn)?.symbol).filter((s): s is string => Boolean(s));
  const prices = await r.prices(symbols);
  const positions: Position[] = orders.slice(0, 24).map((o) => {
    const tin = tokenByAddress(r.environment, o.order.tokenIn);
    const tout = tokenByAddress(r.environment, o.order.tokenOut);
    const remaining = Math.max(0, o.order.executions - o.executed);
    const units = BigInt(o.order.amountIn) * BigInt(remaining);
    const v = valued(units, tin?.decimals ?? 6, tin ? (prices[tin.symbol]?.usd ?? null) : null);
    const trigger = Number(o.order.triggerPrice) / 1e8;
    const deadline = o.order.deadline * 1000;
    const expiresSoon = deadline - now < DAY;
    return finish({
      id: `lykia-orders:${o.hash}`,
      venue: venue.id,
      venueName: venue.name,
      venueKind: "orders",
      label: o.summary || `${o.kind} order`,
      assets: [asset(tin?.symbol ?? "TOKEN", o.order.tokenIn as Address, v.amount, v.valueUsd, "escrowed")],
      amount: v.amount,
      symbol: tin?.symbol ?? "TOKEN",
      valueUsd: v.valueUsd,
      counts: "overlay",
      state: classifyPosition({ kind: "escrow" }),
      since: o.createdAt,
      facts: [
        { label: tx("Kind"), value: o.kind },
        { label: tx("Status"), value: o.status },
        ...(Number.isFinite(trigger) && trigger > 0 ? [{ label: tx("Trigger"), value: `${o.order.triggerAbove ? tx("at or above") : tx("at or below")} ${trigger.toFixed(4)}` }] : []),
        { label: tx("Executions left"), value: `${remaining} of ${o.order.executions}` },
        { label: tx("Receives"), value: tout?.symbol ?? "token" },
        { label: tx("Expires"), value: new Date(deadline).toISOString() },
        ...(o.waitingFor ? [{ label: tx("Waiting for"), value: o.waitingFor }] : []),
        ...(expiresSoon ? [{ label: tx("Expiring"), value: tx("within a day") }] : []),
      ],
      actions: [action("cancel", tx("Cancel order"), tx("Cancel my order: {summary}", { summary: o.summary }), "ask")],
      source: "history",
      readAt: r.readAt,
      block: null,
      explorer: null,
    });
  });
  return { positions, block: null, method: "The owner's signed orders, with their state read from LykiaOrders on chain.", source: "history" };
};

export const readPayments: Reader = async (r, venue) => {
  const list = (await services(r.ctx).standing.list(r.owner)).filter((o) => o.environment === r.environment && o.status === "active" && o.trigger.kind === "schedule");
  const positions: Position[] = [];
  for (const o of list.slice(0, 24)) {
    const sends = o.actions.filter((a): a is Extract<typeof a, { verb: "send" }> => a.verb === "send" && "exact" in a.amount);
    if (sends.length === 0) continue;
    const symbol = sends[0]!.token;
    const total = sends.filter((s) => s.token === symbol).reduce((sum, s) => sum + Number((s.amount as { exact: string }).exact), 0);
    const priceUsd = (await r.prices([symbol]))[symbol]?.usd ?? null;
    const decimals = getToken(symbol)?.decimals ?? 6;
    const units = BigInt(Math.round(total * 10 ** decimals));
    const v = valued(units, decimals, priceUsd);
    const every = o.trigger.kind === "schedule" ? o.trigger.every : "day";
    positions.push(
      finish({
        id: `arc-transfer:${o.id}`,
        venue: venue.id,
        venueName: venue.name,
        venueKind: "payments",
        label: o.text,
        assets: [asset(symbol, null, v.amount, v.valueUsd, "committed")],
        amount: fromBaseUnits(units, decimals),
        symbol,
        valueUsd: v.valueUsd,
        counts: "overlay",
        state: classifyPosition({ kind: "commitment" }),
        since: o.createdAt,
        facts: [{ label: tx("Every"), value: every }, ...(o.nextRunAt ? [{ label: tx("Next run"), value: new Date(o.nextRunAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" }] : []), { label: tx("Sent so far"), value: `${o.fired} time${o.fired === 1 ? "" : "s"}` }],
        actions: [action("cancel", tx("Pause or change"), tx("Change my scheduled payment: {text}", { text: o.text }), "ask")],
        source: "history",
        readAt: r.readAt,
        block: null,
        explorer: null,
      }),
    );
  }
  return { positions, block: null, method: "The owner's active scheduled payments (standing orders on a schedule).", source: "history" };
};

