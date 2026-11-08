/**
 * Relay deposits on their way to another chain, and aggregator venues that
 * hold nothing.
 *
 * Relay: the owner's Relay steps from their own Lykia history (owner-only,
 * like CCTP legs), from the last 24 hours. Each one's fill status comes from
 * Relay's API by the Arc deposit transaction hash. A filled request has left
 * Arc and is no longer listed; a refunded one is back in the wallet; a
 * pending or unreadable one is listed as in flight, never as zero.
 *
 * 0x: swaps settle in the wallet in the same transaction, so nothing is
 * ever held at 0x; the reader says so instead of reporting an empty venue
 * as a failure.
 */
import { classifyPosition, fromBaseUnits, type Address, type Position } from "@lykia/core";
import { asset, finish, txLink, valued, type Reader } from "./context.js";

const RELAY_API = "https://api.relay.link";
const WINDOW_MS = 24 * 60 * 60_000;

type RelayState = "filled" | "refunded" | "pending" | "unknown";

function stateOf(status: string | undefined): RelayState {
  if (status === "success") return "filled";
  if (status === "refund" || status === "refunded") return "refunded";
  if (status === "pending" || status === "waiting" || status === "submitted" || status === "delayed") return "pending";
  return "unknown";
}

export const readRelay: Reader = async (r, venue) => {
  const history = await r.history();
  const since = Date.parse(r.readAt) - WINDOW_MS;
  const legs = history
    .filter((g) => g.environment === r.environment && Date.parse(g.createdAt) >= since)
    .flatMap((g) => g.steps.filter((s) => s.venue === "relay" && (s.status === "submitted" || s.status === "settling" || s.status === "settled")).map((s) => ({ g, s })));
  const positions: Position[] = [];
  let filled = 0;
  for (const { g, s } of legs.slice(0, 12)) {
    const input = s.inputs.find((i) => i.symbol === "USDC") ?? s.inputs[0];
    if (!input) continue;
    const hash = s.references?.[s.references.length - 1] ?? null;
    let state: RelayState = "unknown";
    if (hash) {
      try {
        const res = await r.ctx.fetch(`${RELAY_API}/requests/v2?hash=${hash}`, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) state = stateOf(((await res.json()) as { requests?: Array<{ status?: string }> }).requests?.[0]?.status);
      } catch {
        /* Lykia's own record stands */
      }
    }
    if (state === "filled") {
      filled += 1;
      continue;
    }
    if (state === "refunded") continue;
    const destination = s.outputs[0]?.symbol.split("@")[1] ?? "the destination";
    const v = valued(BigInt(input.amount), input.decimals, input.symbol === "USDC" ? "1" : null);
    const stage = !hash ? "Not sent yet" : state === "pending" ? `Deposited on Arc; Relay's solver is filling it on ${destination}` : `Deposited on Arc; Relay's status could not be read`;
    positions.push(
      finish({
        id: `relay:${g.id}:${s.id}`,
        venue: venue.id,
        venueName: venue.name,
        venueKind: "bridge",
        label: `Relay · ${fromBaseUnits(BigInt(input.amount), input.decimals)} ${input.symbol} to ${destination}`,
        assets: [asset(input.symbol, input.token as Address, v.amount, v.valueUsd, "in-flight")],
        amount: v.amount,
        symbol: input.symbol,
        valueUsd: v.valueUsd,
        counts: "net",
        state: classifyPosition({ kind: "in-flight" }),
        facts: [{ label: "Stage", value: stage }, { label: "Destination", value: destination }, { label: "Started", value: g.createdAt }, { label: "Cross-chain", value: "Delivered on the destination chain, not on Arc" }, ...(hash ? [{ label: "Deposit transaction", value: `${hash.slice(0, 10)}…${hash.slice(-6)}` }] : [])],
        since: g.createdAt,
        actions: [],
        source: "history",
        readAt: r.readAt,
        block: null,
        explorer: hash ? txLink(r.environment, hash) : null,
      }),
    );
  }
  return { positions, block: null, method: "Relay steps in the owner's Lykia history (last 24 hours); fill status from api.relay.link by the deposit transaction.", source: "history", ...(filled > 0 ? { coverage: `${filled} Relay transfer(s) already delivered on the destination chain.` } : {}) };
};

/** 0x holds nothing: swaps settle in the wallet within one transaction. */
export const readZeroX: Reader = async () => ({ positions: [], block: null, method: "0x swaps settle in the wallet in the same transaction; nothing is held at 0x.", source: "chain" });
