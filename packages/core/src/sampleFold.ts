/**
 * The signed-out sample Fold: one fixture that every widget reads (the Fold
 * bar, the Flock tab, the Stress test, Lyko on watch on the web and on the
 * API), so a visitor sees one consistent flock. Nothing in it was read from
 * Arc, so it carries no block number; every surface labels it "sample".
 * The Flock snapshot is derived from the position map, so totals agree.
 */
import { knownTree } from "./i18n/index.js";
import type { FlockHolding, FlockSnapshot } from "./api/flock.js";
import type { Address } from "./contracts.js";
import type { ArcEnvironment } from "./networks.js";
import { POSITION_VENUES, positionDoing, summarizePositions, type Position, type PositionsResponse, type VenueRead } from "./positions.js";


/** The address sample plans and the sample Fold are shown for. */
export const SAMPLE_OWNER = "0x000000000000000000000000000000000000dEaD" as Address;

export function isSampleOwner(address: string | null | undefined): boolean {
  return typeof address === "string" && address.toLowerCase() === SAMPLE_OWNER.toLowerCase();
}




/** A believable position map for signed-out visitors, always labelled "sample". Same shape as the API's answer. */
export function samplePositions(now: number, environment: ArcEnvironment = "mainnet"): PositionsResponse {
  const at = new Date(now).toISOString();
  // A sample has no block: nothing here was read from Arc, so no block number is shown.
  const block = null;
  const p = (x: Omit<Position, "doing" | "readAt" | "block" | "source" | "explorer"> & { source?: Position["source"] }): Position => {
    // The sample's words are shown in the interface language before its line is composed from them.
    const full = knownTree({ ...x, source: x.source ?? ("chain" as const), readAt: at, block, explorer: null });
    return { ...full, doing: positionDoing(full) };
  };
  const health = { factor: "1.38", liquidationAtPercent: "78.00", ltvPercent: "56.52", floor: "1.5" };
  const read = (venue: string, positions: Position[]): VenueRead => {
    const info = POSITION_VENUES.mainnet.find((v) => v.id === venue) ?? POSITION_VENUES[environment].find((v) => v.id === venue)!;
    return { venue, venueName: info.name, venueKind: info.kind, status: "ok", positions, source: positions[0]?.source ?? "chain", method: "Sample", readAt: at, block, ms: 0 };
  };
  const venues: VenueRead[] = [
    read("wallet", [
      p({ id: "s-wallet-usdc", venue: "wallet", venueName: "Wallet", venueKind: "wallet", label: "USDC", assets: [{ symbol: "USDC", token: null, amount: "3820.40", valueUsd: "3820.40", role: "held" }], amount: "3820.40", symbol: "USDC", valueUsd: "3820.40", counts: "net", state: "idle", facts: [{ label: "Above your liquidity floor", value: "$3,320.40" }], actions: [{ kind: "put-to-work", label: "Put to work", sentence: "Put 3320 USDC to work", mode: "draft" }] }),
      p({ id: "s-wallet-eurc", venue: "wallet", venueName: "Wallet", venueKind: "wallet", label: "EURC", assets: [{ symbol: "EURC", token: null, amount: "1610.00", valueUsd: "1795.80", role: "held" }], amount: "1610.00", symbol: "EURC", valueUsd: "1795.80", counts: "net", state: "idle", actions: [{ kind: "convert", label: "Convert half to USDC", sentence: "Convert 805 EURC to USDC", mode: "draft" }] }),
    ]),
    read("aave-v4", [
      p({ id: "s-aave-cirbtc", venue: "aave-v4", venueName: "Aave V4", venueKind: "lending", label: "Aave V4 Main Spoke · cirBTC supplied", assets: [{ symbol: "cirBTC", token: null, amount: "0.0153", valueUsd: "1062.00", role: "collateral" }], amount: "0.0153", symbol: "cirBTC", valueUsd: "1062.00", counts: "net", state: "at-risk", apy: { percent: "0.0003", kind: "supply", source: "Aave API" }, health, collateral: true, actions: [{ kind: "withdraw", label: "Withdraw", sentence: "Withdraw 0.005 cirBTC from Aave V4 Main Spoke", mode: "draft" }] }),
      p({ id: "s-aave-usdc-debt", venue: "aave-v4", venueName: "Aave V4", venueKind: "lending", label: "Aave V4 Main Spoke · USDC borrowed", assets: [{ symbol: "USDC", token: null, amount: "600.00", valueUsd: "600.00", role: "borrowed" }], amount: "600.00", symbol: "USDC", valueUsd: "-600.00", counts: "net", state: "at-risk", apy: { percent: "3.37", kind: "borrow", source: "Aave API" }, health, actions: [{ kind: "repay", label: "Repay a quarter", sentence: "Repay 150 USDC on aave-v4", mode: "draft" }, { kind: "add-collateral", label: "Add collateral", sentence: "How much cirBTC should I add as collateral on Aave V4 Main Spoke to lift my health factor above 1.5?", mode: "ask" }] }),
      p({ id: "s-aave-usdc", venue: "aave-v4", venueName: "Aave V4", venueKind: "lending", label: "Aave V4 Forex Spoke · USDC supplied", assets: [{ symbol: "USDC", token: null, amount: "2400.00", valueUsd: "2400.00", role: "supplied" }], amount: "2400.00", symbol: "USDC", valueUsd: "2400.00", counts: "net", state: "earning", apy: { percent: "2.40", kind: "supply", source: "Aave API" }, earned: { usd: "18.20", since: new Date(now - 41 * 86_400_000).toISOString(), method: "Sample" }, actions: [{ kind: "withdraw", label: "Withdraw", sentence: "Withdraw 1200 USDC from Aave V4 Forex Spoke", mode: "draft" }, { kind: "move-rate", label: "Move to a better rate", sentence: "Withdraw 2400 USDC from Aave V4 Forex Spoke and put it to work at low risk", mode: "draft" }] }),
    ]),
    read("morpho-vaults", [p({ id: "s-galaxy", venue: "morpho-vaults", venueName: "Morpho Vaults", venueKind: "vault", label: "Galaxy USDC", assets: [{ symbol: "USDC", token: null, amount: "4200.00", valueUsd: "4200.00", role: "supplied" }], amount: "4200.00", symbol: "USDC", valueUsd: "4200.00", counts: "net", state: "earning", apy: { percent: "6.10", kind: "vault", source: "Morpho API (net of fees)" }, facts: [{ label: "Curator", value: "Galaxy" }, { label: "Lykia risk class", value: "Low (by vault size)" }], actions: [{ kind: "withdraw", label: "Withdraw half", sentence: "Withdraw 2100 USDC from Morpho galaxyUsdc", mode: "draft" }] })]),
    read("morpho-blue", []),
    read("uniswap-v3", []),
    read("uniswap-v4", [p({ id: "s-v4", venue: "uniswap-v4", venueName: "Uniswap v4", venueKind: "lp", label: "Uniswap v4 #321603 USDC/EURC 0.05%", assets: [{ symbol: "USDC", token: null, amount: "0", valueUsd: "0", role: "liquidity" }, { symbol: "EURC", token: null, amount: "529.10", valueUsd: "590.14", role: "liquidity" }], amount: "529.10", symbol: "EURC", valueUsd: "590.14", counts: "net", state: "out-of-range", range: { tickLower: -1210, tickUpper: -1090, tick: -1083, lower: "0.8860", upper: "0.8967", price: "0.8974", quote: "EURC per USDC", inRange: false }, fees: { assets: [], valueUsd: "0", method: "Sample" }, actions: [{ kind: "rebalance-range", label: "Rebalance range", sentence: "My Uniswap v4 position #321603 (USDC/EURC) is out of range. What range should I move it to?", mode: "ask" }] })]),
    read("aerodrome-slipstream", [p({ id: "s-aero", venue: "aerodrome-slipstream", venueName: "Aerodrome Slipstream", venueKind: "lp", label: "Aerodrome Slipstream #3529 USDC/EURC tick spacing 1", assets: [{ symbol: "USDC", token: null, amount: "410.20", valueUsd: "410.20", role: "liquidity" }, { symbol: "EURC", token: null, amount: "377.00", valueUsd: "420.50", role: "liquidity" }], amount: "377.00", symbol: "EURC", valueUsd: "834.07", counts: "net", state: "earning", range: { tickLower: -1120, tickUpper: -1060, tick: -1088, lower: "0.8940", upper: "0.8994", price: "0.8968", quote: "EURC per USDC", inRange: true }, fees: { assets: [{ symbol: "USDC", token: null, amount: "1.92", valueUsd: "1.92", role: "fees" }, { symbol: "EURC", token: null, amount: "1.28", valueUsd: "1.43", role: "fees" }], valueUsd: "3.35", method: "Sample" }, actions: [{ kind: "collect-fees", label: "Collect fees", sentence: "Collect the fees on my Aerodrome Slipstream position #3529 (USDC/EURC)", mode: "ask" }] })]),
    read("usyc", [p({ id: "s-usyc", venue: "usyc", venueName: "USYC", venueKind: "treasury", label: "USYC · tokenized US Treasury fund", assets: [{ symbol: "USYC", token: null, amount: "873.30", valueUsd: "998.00", role: "held" }], amount: "873.30", symbol: "USYC", valueUsd: "998.00", counts: "net", state: "earning", apy: { percent: "3.71", kind: "nav", source: "USYC oracle, 42 days of NAV" }, actions: [] })]),
    read("gateway", []),
    read("cctp", [p({ id: "s-cctp", venue: "cctp", venueName: "CCTP transfers", venueKind: "bridge", label: "CCTP · 250 USDC to Base", assets: [{ symbol: "USDC", token: null, amount: "250", valueUsd: "250", role: "in-flight" }], amount: "250", symbol: "USDC", valueUsd: "250", counts: "net", state: "pending", source: "history", facts: [{ label: "Stage", value: "Burned on Arc, awaiting attestation (~2 min)" }], actions: [] })]),
    read("lykia-orders", [p({ id: "s-order", venue: "lykia-orders", venueName: "LykiaOrders", venueKind: "orders", label: "Buy EURC when EUR/USD ≤ 1.09", assets: [{ symbol: "USDC", token: null, amount: "500", valueUsd: "500", role: "escrowed" }], amount: "500", symbol: "USDC", valueUsd: "500", counts: "overlay", state: "escrowed", source: "history", facts: [{ label: "Waiting for", value: "the price condition" }], actions: [] })]),
    read("arc-transfer", [p({ id: "s-rent", venue: "arc-transfer", venueName: "Scheduled payments", venueKind: "payments", label: "Pay 1,200 USDC rent to @landlord on the 1st", assets: [{ symbol: "USDC", token: null, amount: "1200", valueUsd: "1200", role: "committed" }], amount: "1200", symbol: "USDC", valueUsd: "1200", counts: "overlay", state: "committed", source: "history", facts: [{ label: "Next run", value: "in 9 days" }], actions: [] })]),
  ];
  const ends = new Date(now + 5 * 86_400_000).toISOString();
  venues.push(read("leashes", [p({ id: "s-leash", venue: "leashes", venueName: "Leash budgets", venueKind: "leash", label: "Invoice bot · Pay invoices", assets: [{ symbol: "USDC", token: null, amount: "112", valueUsd: "112", role: "committed" }], amount: "112", symbol: "USDC", valueUsd: "112", counts: "overlay", state: "committed", source: "history", blocks: [{ type: "gauge", label: "Used today", value: 8, min: 0, max: 20, display: "$8 of $20", threshold: { at: 20, label: "today's cap ($20)", danger: "above" }, meaning: "Invoice bot can spend $12 more today; past the cap the chain refuses." }, { type: "gauge", label: "Used in total", value: 28, min: 0, max: 140, display: "$28 of $140", threshold: { at: 140, label: "the whole budget ($140)", danger: "above" } }, { type: "facts", items: [{ label: "Per step", value: "$10", meaning: "The most it can move in one go." }, { label: "Pays", value: "2 approved payees" }] }, { type: "countdown", label: "Ends", until: ends, ends: true, meaning: "After this date the bot's key stops working on its own." }], actions: [{ kind: "cancel", label: "Revoke", sentence: "Revoke Invoice bot's leash", mode: "ask" }] })]));
  venues.push(read("across", [p({ id: "s-across", venue: "across", venueName: "Across transfers", venueKind: "bridge", label: "Across · 120 USDC to Arbitrum", assets: [{ symbol: "USDC", token: null, amount: "120", valueUsd: "120", role: "in-flight" }], amount: "120", symbol: "USDC", valueUsd: "120", counts: "net", state: "pending", source: "history", facts: [{ label: "Stage", value: "Deposited on Arc, waiting for a relayer to pay on Arbitrum (usually under a minute)" }], blocks: [{ type: "timeline", label: "Transfer", steps: [{ label: "Deposited on Arc", at: new Date(now - 40_000).toISOString(), done: true }, { label: "Paid on Arbitrum by a relayer", at: null, done: false }], meaning: "If no relayer pays before the deadline, Across refunds the USDC on Arc." }], actions: [] })]));
  venues.push(read("plans", [p({ id: "s-plan", venue: "plans", venueName: "Plans in progress", venueKind: "plan", label: "Swap 500 USDC to EURC, then deposit it into Morpho", assets: [], amount: "0", symbol: "", valueUsd: "500", counts: "overlay", state: "committed", source: "history", blocks: [{ type: "timeline", label: "Steps", steps: [{ label: "Swap 500 USDC to EURC on Uniswap v4", at: null, done: true }, { label: "Deposit the EURC into Morpho Galaxy EURC", at: null, done: false }], meaning: "The next step is rebuilt from what the swap delivered, and checked by your Fence again before you sign." }, { type: "facts", items: [{ label: "Done", value: "1 of 2 steps" }, { label: "Still to move", value: "448 EURC", meaning: "Still in your wallet until you sign the next step." }] }], actions: [{ kind: "cancel", label: "Continue or stop it", sentence: "Show me my plan to swap 500 USDC to EURC and deposit it into Morpho so I can sign the next step", mode: "ask" }] })]));
  venues.push(read("watches", [p({ id: "s-watch", venue: "watches", venueName: "Watches", venueKind: "watch", label: "Health factor below 1.5 on Aave V4", assets: [], amount: "0", symbol: "", valueUsd: "0", counts: "overlay", state: "watching", source: "history", blocks: [{ type: "facts", items: [{ label: "Watching for", value: "loan health under 1.5", meaning: "When this happens, Lyko on watch tells you in the Fold, with a move ready if there is one." }, { label: "Last check", value: "1.38: under it, flagged" }, { label: "Status", value: "on" }] }], actions: [{ kind: "cancel", label: "Remove the watch", sentence: "Stop watching: Health factor below 1.5 on Aave V4", mode: "ask" }] })]));
  // Every venue answers in the sample: the ones without a position are empty, never left "reading".
  for (const info of POSITION_VENUES[environment]) if (!venues.some((v) => v.venue === info.id)) venues.push({ venue: info.id, venueName: info.name, venueKind: info.kind, status: "ok", positions: [], source: "chain", method: "Sample", readAt: at, block, ms: 0 });
  // Built in English; shown in the interface language like the API's own answers.
  return knownTree({ address: SAMPLE_OWNER, environment, at, block, venues, summary: summarizePositions(venues), personal: true, healthFloor: "1.5" });
}

const KIND_OF: Readonly<Record<string, FlockHolding["kind"]>> = { lending: "supply", vault: "vault", market: "supply" };

/**
 * The sample's Flock snapshot, derived from the position map: every position that counts toward net worth becomes a
 * holding, so the snapshot's total equals the map's net, to the cent.
 */
export function sampleSnapshot(now: number, environment: ArcEnvironment = "mainnet"): FlockSnapshot {
  const map = samplePositions(now, environment);
  const holdings: FlockHolding[] = map.venues.flatMap((v) =>
    v.positions
      .filter((p) => p.counts === "net" && p.valueUsd !== null)
      .map((p) => {
        const debt = Number(p.valueUsd) < 0;
        const kind: FlockHolding["kind"] = debt ? "debt" : p.venue === "wallet" ? "token" : (KIND_OF[p.venueKind] ?? "token");
        const symbol = p.venue === "morpho-vaults" ? p.label : p.venueKind === "lp" ? `${p.assets.map((a) => a.symbol).join("/")} LP` : p.symbol;
        return { symbol, token: "0x0000000000000000000000000000000000000000" as Address, amount: p.amount, usd: p.valueUsd, where: p.venue, kind };
      }),
  );
  const net = map.summary.netUsd ?? map.summary.pricedNetUsd;
  const health = map.summary.lowestHealth ? [{ venue: map.summary.lowestHealth.venue, healthFactor: map.summary.lowestHealth.factor }] : [];
  const usdc = holdings.find((h) => h.where === "wallet" && h.symbol === "USDC")?.amount ?? "0";
  return knownTree({
    address: SAMPLE_OWNER,
    environment,
    at: map.at,
    block: null,
    totalUsd: net,
    holdings,
    gateway: { unifiedUsdc: "0" },
    health,
    native: { usdc18: `${usdc.replace(".", "").replace(/^0+(?=\d)/u, "")}${"0".repeat(18 - (usdc.split(".")[1]?.length ?? 0))}` },
    prices: { EURC: { usd: "1.1154", source: "sample" } },
    notes: ["A sample flock: nothing here was read from Arc."],
  });
}
