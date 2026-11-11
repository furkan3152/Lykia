/**
 * Relay and Across deposits on their way to another chain, and aggregator
 * venues that hold nothing.
 *
 * Relay and Across: the owner's steps at that venue from their own Lykia
 * history (owner-only, like CCTP legs), from the last 24 hours. Each one's
 * fill status comes from the bridge's API by the Arc deposit transaction
 * hash (api.relay.link/requests/v2, app.across.to/api/deposit/status). A
 * filled deposit has left Arc and is no longer listed; a refunded one is
 * back in the wallet; a pending or unreadable one is listed as in flight,
 * never as zero.
 *
 * 0x: swaps settle in the wallet in the same transaction, so nothing is
 * ever held at 0x; the reader says so instead of reporting an empty venue
 * as a failure.
 */
import { classifyPosition, fromBaseUnits, type Address, type Position } from "@lykia/core";
import { acrossStatus } from "../engine/venues/across.js";
import { asset, finish, txLink, valued, type Reader, type ReadContext } from "./context.js";

import { tx, phrase } from "@lykia/core";
const RELAY_API = "https://api.relay.link";
const WINDOW_MS = 24 * 60 * 60_000;

type FillState = "filled" | "refunded" | "pending" | "unknown";

function stateOf(status: string | undefined): FillState {
  if (status === "success" || status === "filled") return "filled";
  if (status === "refund" || status === "refunded") return "refunded";
  if (status === "pending" || status === "waiting" || status === "submitted" || status === "delayed" || status === "expired") return "pending";
  return "unknown";
}

interface SolverBridge {
  readonly venue: string;
  readonly name: string;
  /** "Relay's solver", "an Across relayer". */
  readonly filler: string;
  readonly api: string;
  status(r: ReadContext, hash: string): Promise<string | undefined>;
}

const RELAY: SolverBridge = {
  venue: "relay",
  name: phrase("Relay"),
  filler: phrase("Relay's solver"),
  api: "api.relay.link",
  async status(r, hash) {
    // Relay retires the keyless /requests/v2 lookup on 2026-11-24; with RELAY_API_KEY set, /requests/v3 is used instead.
    const key = process.env.RELAY_API_KEY?.trim();
    const url = key ? `${RELAY_API}/requests/v3?hash=${hash}` : `${RELAY_API}/requests/v2?hash=${hash}`;
    const res = await r.ctx.fetch(url, { ...(key ? { headers: { "x-api-key": key } } : {}), signal: AbortSignal.timeout(3_000) });
    return res.ok ? ((await res.json()) as { requests?: Array<{ status?: string }> }).requests?.[0]?.status : undefined;
  },
};

const ACROSS: SolverBridge = {
  venue: "across",
  name: "Across",
  filler: phrase("an Across relayer"),
  api: "app.across.to/api/deposit/status",
  async status(r, hash) {
    return (await acrossStatus(r.ctx.fetch, hash))?.status;
  },
};

const solverReader = (bridge: SolverBridge): Reader => async (r, venue) => {
  const history = await r.history();
  const since = Date.parse(r.readAt) - WINDOW_MS;
  const legs = history
    .filter((g) => g.environment === r.environment && Date.parse(g.createdAt) >= since)
    .flatMap((g) => g.steps.filter((s) => s.venue === bridge.venue && (s.status === "submitted" || s.status === "settling" || s.status === "settled")).map((s) => ({ g, s })));
  const positions: Position[] = [];
  let filled = 0;
  for (const { g, s } of legs.slice(0, 12)) {
    const input = s.inputs.find((i) => i.symbol === "USDC") ?? s.inputs[0];
    if (!input) continue;
    const hash = s.references?.[s.references.length - 1] ?? null;
    let state: FillState = "unknown";
    if (hash) {
      try {
        state = stateOf(await bridge.status(r, hash));
      } catch {
        /* Lykia's own record stands */
      }
    }
    if (state === "filled") {
      filled += 1;
      continue;
    }
    if (state === "refunded") continue;
    const destination = s.outputs[0]?.symbol.split("@")[1] ?? tx("the destination");
    const v = valued(BigInt(input.amount), input.decimals, input.symbol === "USDC" ? "1" : null);
    const stage = !hash ? tx("Not sent yet") : state === "pending" ? tx("Deposited on Arc; {filler} is filling it on {destination}", { filler: bridge.filler, destination }) : tx("Deposited on Arc; {name}'s status could not be read", { name: bridge.name });
    positions.push(
      finish({
        id: `${bridge.venue}:${g.id}:${s.id}`,
        venue: venue.id,
        venueName: venue.name,
        venueKind: "bridge",
        label: tx("{name} · {value} {symbol} to {destination}", { name: bridge.name, value: fromBaseUnits(BigInt(input.amount), input.decimals), symbol: input.symbol, destination }),
        assets: [asset(input.symbol, input.token as Address, v.amount, v.valueUsd, "in-flight")],
        amount: v.amount,
        symbol: input.symbol,
        valueUsd: v.valueUsd,
        counts: "net",
        state: classifyPosition({ kind: "in-flight" }),
        facts: [{ label: tx("Stage"), value: stage }, { label: tx("Destination"), value: destination }, { label: tx("Started"), value: g.createdAt }, { label: "Cross-chain", value: tx("Delivered on the destination chain, not on Arc") }, ...(hash ? [{ label: tx("Deposit transaction"), value: `${hash.slice(0, 10)}…${hash.slice(-6)}` }] : [])],
        since: g.createdAt,
        actions: [],
        source: "history",
        readAt: r.readAt,
        block: null,
        explorer: hash ? txLink(r.environment, hash) : null,
      }),
    );
  }
  return { positions, block: null, method: `${bridge.name} steps in the owner's Lykia history (last 24 hours); fill status from ${bridge.api} by the deposit transaction.`, source: "history", ...(filled > 0 ? { coverage: tx("{filled} {name} transfer(s) already delivered on the destination chain.", { filled, name: bridge.name }) } : {}) };
};

export const readRelay: Reader = solverReader(RELAY);
export const readAcross: Reader = solverReader(ACROSS);

/** 0x holds nothing: swaps settle in the wallet within one transaction. */
export const readZeroX: Reader = async () => ({ positions: [], block: null, method: "0x swaps settle in the wallet in the same transaction; nothing is held at 0x.", source: "chain" });
