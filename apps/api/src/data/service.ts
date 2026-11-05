/**
 * Data and security as a service: the registry, prices, protocols,
 * portfolios, address screening and transaction explanations, served from
 * the same readers the app uses. Each read is cached in memory for a short
 * TTL (serverless instances keep it while warm; nothing relies on a timer).
 */
import { fromBaseUnits, getToken, isLive, PROTOCOLS, tokenAddress, tokensFor, usdMicros, type Address, type ArcEnvironment } from "@lykia/core";
import type { Hex } from "viem";
import type { AppContext } from "../context.js";
import { ecosystem } from "../ecosystem/ecosystem.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { LykiaHttpError } from "../http/errors.js";
import { decodeData, explainCalls, knownAt, simulateBatch } from "../integrations/contracts.js";
import { liveAdapters } from "../integrations/registry.js";
import { checkRecipient } from "../security/recipients.js";
import { decodeTransactions } from "../security/decode.js";
import { services } from "../services.js";
import { screenAddress } from "../circle/compliance.js";

const MEMO = new WeakMap<AppContext, Map<string, { at: number; value: Promise<unknown> }>>();

/** Memoises a read per context for `ttlMs`; failures are not kept. */
function cached<T>(ctx: AppContext, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  let map = MEMO.get(ctx);
  if (!map) MEMO.set(ctx, (map = new Map()));
  const now = ctx.clock.now();
  const hit = map.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  if (map.size > 300) for (const [k, v] of map) if (now - v.at >= ttlMs) map.delete(k);
  const value = load().catch((error: unknown) => {
    map!.delete(key);
    throw error;
  });
  map.set(key, { at: now, value });
  return value;
}

export async function dataPrices(ctx: AppContext, environment: ArcEnvironment, symbols?: readonly string[]) {
  const list = symbols && symbols.length > 0 ? symbols : tokensFor(environment).map((t) => t.symbol);
  const unknown = list.filter((s) => !getToken(s));
  if (unknown.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, `Not registry tokens: ${unknown.join(", ")}.`);
  const prices = await cached(ctx, `prices:${[...list].sort().join(",")}`, 15_000, () => services(ctx).prices.prices(list));
  return {
    environment,
    unit: "USD",
    prices: list.map((s) => {
      const p = prices[getToken(s)!.symbol] ?? prices[s];
      return { symbol: getToken(s)!.symbol, usd: p?.usd ?? null, source: p?.source ?? "unknown", updatedAt: p?.updatedAt ?? null };
    }),
    note: "USDC is the unit of account. A token without a live feed is unpriced (null), never zero.",
    at: new Date(ctx.clock.now()).toISOString(),
  };
}

export async function dataTokens(ctx: AppContext, environment: ArcEnvironment) {
  const prices = await dataPrices(ctx, environment);
  return {
    environment,
    tokens: tokensFor(environment).map((t) => {
      const p = prices.prices.find((x) => x.symbol === t.symbol);
      return { symbol: t.symbol, name: t.name, address: tokenAddress(t, environment), decimals: t.decimals, issuer: t.issuer, peg: t.peg, pricing: t.pricing, priceUsd: p?.usd ?? null, priceSource: p?.source ?? null };
    }),
    sources: { evidence: "Every token's name, symbol and decimals were read on chain; addresses checked with eth_getCode.", prices: "Chainlink feeds on Arc, fiat pegs through Chainlink fiat feeds, USYC at NAV." },
    at: prices.at,
  };
}

export async function dataProtocols(ctx: AppContext, environment: ArcEnvironment) {
  return cached(ctx, `protocols:${environment}`, 60_000, async () => {
    const [eco, rates, adapters] = await Promise.all([ecosystem(ctx, environment).catch(() => null), services(ctx).yields.rates(environment).catch(() => null), liveAdapters(ctx).catch(() => [])]);
    const apyOf = (id: string) => {
      if (!rates) return null;
      if (id === "morpho-vaults") return rates.vaults.map((v) => ({ name: v.name, asset: v.asset, apy: v.apy, tvlUsd: v.tvlUsd }));
      if (id === "aave-v4") return rates.reserves.map((r) => ({ name: `${r.spokeName} ${r.symbol}`, asset: r.symbol, apy: r.supplyApy, borrowApy: r.borrowApy }));
      if (id === "morpho-blue") return rates.markets.map((m) => ({ name: `${m.collateral ?? "idle"}/${m.loan}`, asset: m.loan, apy: m.supplyApy, borrowApy: m.borrowApy, utilization: m.utilization }));
      return null;
    };
    const protocols = (eco?.protocols ?? PROTOCOLS.filter((p) => p.deployments[environment]).map((p) => ({ id: p.id, name: p.name, category: p.category, summary: p.summary, website: p.website ?? null, status: isLive(p, environment) ? "verified" : "announced", evidence: null, lykia: EXECUTABLE_VENUES[environment].has(p.id) ? "routes" : "lists", verbs: p.verbs, tvlUsd: null, routed: { steps: 0, usd: "0" } }))).map((p) => ({ ...p, rates: apyOf(p.id), source: "registry" as const }));
    const extra = adapters.map((a) => ({ id: a.id, name: a.manifest.protocol.name, category: a.manifest.protocol.category, summary: a.manifest.protocol.summary, website: a.manifest.protocol.website ?? null, status: a.status, evidence: a.manifest.evidence, lykia: a.status === "routable" ? "routes" : "lists", verbs: a.manifest.capabilities.map((c) => c.verb), tvlUsd: null, routed: { steps: 0, usd: "0" }, rates: null, source: "adapter-manifest" as const }));
    return {
      environment,
      protocols: [...protocols, ...extra],
      totals: eco?.totals ?? null,
      sources: { tvl: eco?.sources.tvl ?? "DefiLlama (unavailable)", tvlAt: eco?.sources.tvlAt ?? null, rates: rates ? rates.sources : null, ratesAt: rates?.at ?? null },
      at: new Date(ctx.clock.now()).toISOString(),
    };
  });
}

export async function dataPortfolio(ctx: AppContext, environment: ArcEnvironment, address: Address) {
  const s = services(ctx);
  const snapshot = await cached(ctx, `flock:${environment}:${address.toLowerCase()}`, 10_000, () => s.flock.snapshot(environment, address));
  // Positions at routable adapter manifests, through their position reads.
  const adapterHoldings: { symbol: string; amount: string; where: string; kind: "supply"; usd: string | null }[] = [];
  for (const token of tokensFor(environment).slice(0, 4)) {
    for (const p of await s.router.adapterPositions(environment, token.symbol, address).catch(() => [])) {
      const price = snapshot.prices[token.symbol]?.usd ?? (token.symbol === "USDC" ? "1" : null);
      const amount = fromBaseUnits(p.max, token.decimals);
      adapterHoldings.push({ symbol: token.symbol, amount, where: p.venue, kind: "supply", usd: price === null ? null : String(Number(amount) * Number(price)) });
    }
  }
  const all = [...snapshot.holdings, ...adapterHoldings];
  const byVenue = new Map<string, { venue: string; usd: bigint; unpriced: boolean; items: number }>();
  for (const h of all) {
    const row = byVenue.get(h.where) ?? { venue: h.where, usd: 0n, unpriced: false, items: 0 };
    row.items += 1;
    if (h.usd === null) row.unpriced = true;
    else row.usd += (h.kind === "debt" ? -1n : 1n) * usdMicros(Number(h.usd).toFixed(6));
    byVenue.set(h.where, row);
  }
  return {
    ...snapshot,
    holdings: all,
    venues: [...byVenue.values()].map((v) => ({ venue: v.venue, items: v.items, usd: v.unpriced ? null : (Number(v.usd) / 1e6).toFixed(2) })),
  };
}

/** Address screening: Lykia's address protection (blocklist, look-alikes, contract Scent) plus Circle Compliance when configured. */
export async function screenAddressReport(ctx: AppContext, environment: ArcEnvironment, address: Address, owner: Address | null) {
  const tokens = ["USDC", "EURC"].map((s) => tokenAddress(getToken(s)!, environment)).filter((a): a is Address => a !== null);
  const check = await checkRecipient(ctx, { environment, owner: owner ?? ("0x0000000000000000000000000000000000000001" as Address), recipient: address, tokens });
  const apiKey = ctx.config.circle.apiKey;
  const circle = apiKey ? await screenAddress(ctx.fetch, apiKey, environment, address, ctx.clock.now()).catch(() => null) : null;
  const decision = check.findings.some((f) => f.severity === "block") ? "block" : check.findings.some((f) => f.severity === "warn") ? "warn" : "pass";
  return {
    environment,
    address,
    kind: check.kind,
    known: knownAt(address, environment),
    decision,
    findings: check.findings,
    circleCompliance: circle ? { result: circle.result, ...(circle.ruleName ? { rule: circle.ruleName } : {}) } : { result: "not-configured" },
    checkedAt: new Date(ctx.clock.now()).toISOString(),
  };
}

/** A plain-English explanation of a mined transaction (by hash) or of an unsigned one (decoded and simulated). */
export async function explainTransaction(ctx: AppContext, environment: ArcEnvironment, input: { readonly hash?: Hex; readonly transaction?: { readonly from: Address; readonly to: Address; readonly data: Hex; readonly value?: string } }) {
  if (input.hash) {
    const [tx, receipt] = await Promise.all([ctx.chains.getTransaction(environment, input.hash), ctx.chains.getTxReceipt(environment, input.hash)]);
    if (!tx) throw new LykiaHttpError("NOT_FOUND", 404, `Arc ${environment} does not know ${input.hash}.`);
    const decoded = await decodeData(ctx, environment, { ...(tx.to ? { to: tx.to as Address } : {}), data: tx.input as Hex, value: tx.value.toString(), logs: (receipt?.logs ?? []).map((l) => ({ address: l.address as Address, topics: l.topics as Hex[], data: l.data as Hex })) });
    const status = receipt ? (receipt.status === "success" ? "succeeded" : "reverted") : "pending";
    const target = tx.to ? (knownAt(tx.to, environment) ?? tx.to) : "a new contract";
    const summary = `${tx.from} called ${target}; the transaction ${status}${receipt ? ` in block ${receipt.blockNumber.toString()}` : ""}.`;
    return { environment, hash: input.hash, status, from: tx.from, to: tx.to, summary, steps: decoded.lines, calls: decoded.calls, events: decoded.events, gasUsed: receipt?.gasUsed.toString() ?? null, note: "Arc finality is deterministic: a successful receipt is final." };
  }
  if (!input.transaction) throw new LykiaHttpError("INVALID_REQUEST", 400, "Send a hash or an unsigned transaction.");
  const t = input.transaction;
  const calls = decodeTransactions([{ chainId: 0, from: t.from, to: t.to, data: t.data, value: t.value ?? "0", label: "" }]);
  const sim = await simulateBatch(ctx, environment, { from: t.from, calls: [{ to: t.to, data: t.data, ...(t.value ? { value: t.value } : {}) }] });
  const lines = explainCalls(calls, environment);
  const moves = sim.balanceChanges.map((b) => `${BigInt(b.diff) < 0n ? "sends" : "receives"} ${fromBaseUnits(BigInt(b.diff) < 0n ? -BigInt(b.diff) : BigInt(b.diff), getToken(b.symbol ?? "")?.decimals ?? 18)} ${b.symbol ?? b.token}`);
  const summary = `If ${t.from} signs this, it ${lines.length > 0 ? lines.join("; then ") : `calls ${knownAt(t.to, environment) ?? t.to}`}.${moves.length > 0 ? ` The account ${moves.join(" and ")}.` : ""} ${sim.ok ? "The simulation passes on Arc now." : `It would revert: ${sim.reason}.`}`;
  return { environment, status: "unsigned", summary, steps: lines, calls, simulation: { ok: sim.ok, block: sim.block, ...(sim.reason ? { reason: sim.reason } : {}) }, balanceChanges: sim.balanceChanges, security: sim.security };
}
