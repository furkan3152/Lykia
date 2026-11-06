/**
 * Circle positions: the Gateway unified balance and USDC in flight.
 *
 * Gateway: Circle's Gateway API (POST /v1/balances) for the address on every
 * supported domain; each domain with a balance is listed. When the API does
 * not answer, the venue is unavailable (never zero).
 *
 * In flight: CCTP and Gateway legs from the owner's own Lykia history that
 * have not settled. The burn's stage comes from the step's status and, for
 * CCTP, from Circle's Iris API by the burn transaction hash: burned and
 * waiting for the attestation, or attested and waiting for the mint on the
 * destination. Owner-only: Lykia's records are personal.
 */
import { classifyPosition, fromBaseUnits, tokenAddress, TOKENS, type Address, type IntentStep, type Position } from "@lykia/core";
import { IRIS_API } from "../engine/adapters.js";
import { GATEWAY_API } from "../flock/flock.js";
import { asset, finish, txLink, valued, VenueUnavailable, type Reader } from "./context.js";

/** Circle Gateway domains and their chains (developers.circle.com, CCTP domain list). */
export const GATEWAY_DOMAINS: Readonly<Record<number, string>> = { 0: "Ethereum", 1: "Avalanche", 2: "OP Mainnet", 3: "Arbitrum", 6: "Base", 7: "Polygon PoS", 10: "Unichain", 26: "Arc" };

export const readGateway: Reader = async (r, venue) => {
  let body: { balances?: Array<{ domain?: number; balance?: string }> };
  try {
    const response = await r.ctx.fetch(`${GATEWAY_API[r.environment]}/v1/balances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "USDC", sources: Object.keys(GATEWAY_DOMAINS).map((domain) => ({ domain: Number(domain), depositor: r.owner })) }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new VenueUnavailable(`Circle's Gateway API answered ${response.status}.`);
    body = (await response.json()) as typeof body;
  } catch (error) {
    if (error instanceof VenueUnavailable) throw error;
    throw new VenueUnavailable("Circle's Gateway API did not answer.");
  }
  if (!Array.isArray(body.balances)) throw new VenueUnavailable("Circle's Gateway API returned no balances.");
  const usdc = TOKENS.find((t) => t.symbol === "USDC")!;
  const positions: Position[] = [];
  for (const entry of body.balances) {
    if (typeof entry.balance !== "string" || !/^\d+(?:\.\d+)?$/u.test(entry.balance) || Number(entry.balance) <= 0) continue;
    const [w = "0", f = ""] = entry.balance.split(".");
    const micros = BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6) || "0");
    const v = valued(micros, 6, "1");
    const chain = GATEWAY_DOMAINS[entry.domain ?? -1] ?? `domain ${entry.domain}`;
    positions.push(
      finish({
        id: `gateway:${entry.domain}`,
        venue: venue.id,
        venueName: venue.name,
        venueKind: "gateway",
        label: `Gateway unified USDC · deposited on ${chain}`,
        assets: [asset("USDC", tokenAddress(usdc, r.environment), v.amount, v.valueUsd, "held")],
        amount: v.amount,
        symbol: "USDC",
        valueUsd: v.valueUsd,
        counts: "net",
        state: classifyPosition({ kind: "held" }),
        facts: [{ label: "Domain", value: `${entry.domain} (${chain})` }, { label: "Spendable on", value: "every Gateway chain, in one signature" }],
        actions: [],
        source: "api",
        readAt: r.readAt,
        block: null,
        explorer: null,
      }),
    );
  }
  return { positions, block: null, method: "Circle Gateway API /v1/balances for the address on every supported domain.", source: "api" };
};

const IN_FLIGHT: readonly IntentStep["status"][] = ["submitted", "settling"];

export const readInFlight: Reader = async (r, venue) => {
  const history = await r.history();
  const legs = history.flatMap((g) => g.steps.filter((s) => s.settlement.kind !== "receipt" && IN_FLIGHT.includes(s.status) && g.environment === r.environment).map((s) => ({ g, s })));
  const positions: Position[] = [];
  for (const { g, s } of legs.slice(0, 12)) {
    const input = s.inputs.find((i) => i.symbol === "USDC") ?? s.inputs[0];
    if (!input) continue;
    const v = valued(BigInt(input.amount), input.decimals, input.symbol === "USDC" ? "1" : null);
    const hash = s.references?.[s.references.length - 1] ?? null;
    const destination = s.settlement.kind === "receipt" ? "" : s.settlement.destination;
    const expected = s.settlement.kind === "receipt" ? 0 : s.settlement.expectedSeconds;
    let stage = s.status === "submitted" ? `Burn sent on Arc, waiting for its receipt` : `Burned on Arc, awaiting attestation (~${Math.max(1, Math.round(expected / 60))} min)`;
    if (s.settlement.kind === "cctp" && hash && s.status === "settling") {
      try {
        const res = await r.ctx.fetch(`${IRIS_API[r.environment]}/v2/messages/26?transactionHash=${hash}`, { signal: AbortSignal.timeout(3_000) });
        if (res.ok) {
          const body = (await res.json()) as { messages?: Array<{ status?: string; forwardState?: string }> };
          const m = body.messages?.[0];
          if (m?.status === "complete") stage = `Attested by Circle, waiting for the mint on ${destination}`;
          else if (m?.status) stage = `Burned on Arc, awaiting attestation (~${Math.max(1, Math.round(expected / 60))} min)`;
        }
      } catch {
        /* the stage from Lykia's own record stands */
      }
    }
    if (s.settlement.kind === "gateway") stage = `Gateway transfer to ${destination}, waiting for the mint`;
    positions.push(
      finish({
        id: `inflight:${g.id}:${s.id}`,
        venue: venue.id,
        venueName: venue.name,
        venueKind: "bridge",
        label: `${s.settlement.kind === "cctp" ? "CCTP" : "Gateway"} · ${fromBaseUnits(BigInt(input.amount), input.decimals)} ${input.symbol} to ${destination}`,
        assets: [asset(input.symbol, input.token as Address, v.amount, v.valueUsd, "in-flight")],
        amount: v.amount,
        symbol: input.symbol,
        valueUsd: v.valueUsd,
        counts: "net",
        state: classifyPosition({ kind: "in-flight" }),
        facts: [{ label: "Stage", value: stage }, { label: "Destination", value: destination }, { label: "Started", value: g.createdAt }, ...(hash ? [{ label: "Burn transaction", value: `${hash.slice(0, 10)}…${hash.slice(-6)}` }] : [])],
        since: g.createdAt,
        actions: [],
        source: "history",
        readAt: r.readAt,
        block: null,
        explorer: hash ? txLink(r.environment, hash) : null,
      }),
    );
  }
  return { positions, block: null, method: "Unsettled CCTP and Gateway legs in the owner's Lykia history; CCTP stage from Circle's Iris API.", source: "history" };
};
