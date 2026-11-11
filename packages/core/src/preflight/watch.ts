/**
 * Lyko on watch's side of preflight: the wallet state the owner may already
 * be in, after a plan went through. Each condition has one primary fix,
 * and a fix that would need gas the wallet does not have is never offered
 * as if it could be signed.
 */
import { decimalsOf, feePerGasWei, gasUsdcUnits, show, showUp } from "./ledger.js";
import type { Finding, FindingFix, Obligation, Reading } from "./types.js";

import { tx, coreIntlTag } from "../i18n/index.js";
/** Gas of a plain ERC-20 transfer plus Multicall3From overhead: the cheapest thing the wallet could send. */
export const ONE_TX_GAS = 125_000;
/** Gas of a swap through a pool plus the overhead: what swapping a token back to USDC would need. */
export const SWAP_GAS = 310_000;

export interface WatchState {
  readonly now: number;
  readonly owner: string;
  /** USDC the wallet holds (6 decimals): Arc's gas tank. */
  readonly usdc: string;
  readonly read: Reading;
  /** Other tokens in the wallet itself. */
  readonly holdings: readonly { readonly symbol: string; readonly units: string; readonly decimals: number; readonly usd: string | null }[];
  readonly gasReserveUsdc: string;
  readonly gas: { readonly priceWei: string; readonly read: Reading } | null;
  readonly minFeeGwei: number;
  readonly obligations: readonly Obligation[];
  /** Cross-chain steps still settling, with when they were sent. */
  readonly inFlight: readonly { readonly intentId: string; readonly stepId: string; readonly summary: string; readonly destination: string; readonly sentAt: string | null; readonly expectedSeconds: number }[];
}

const units = (s: string) => {
  try {
    return BigInt(s);
  } catch {
    return 0n;
  }
};

function toUnits(decimal: string, decimals: number): bigint {
  const [w = "0", f = ""] = decimal.split(".");
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function watchFindings(w: WatchState): Finding[] {
  const out: Finding[] = [];
  const usdc = units(w.usdc);
  const reserve = toUnits(w.gasReserveUsdc, 6);
  const oneTx = gasUsdcUnits(ONE_TX_GAS, feePerGasWei(w));
  const swapTx = gasUsdcUnits(SWAP_GAS, feePerGasWei(w));
  const gasRead = w.gas?.read ?? { source: `Arc fee floor (${w.minFeeGwei} gwei)`, readAt: null };
  const addUsdc: FindingFix = { id: "add-funds", kind: "add-funds", label: tx("Add USDC to this wallet"), detail: tx("Send USDC on Arc to {value}…{value2} from an exchange or another wallet; this wallet pays nothing to receive it.", { value: w.owner.slice(0, 6), value2: w.owner.slice(-4) }), address: w.owner, needsGas: false };
  const others = w.holdings.filter((h) => h.symbol !== "USDC" && units(h.units) > 0n);
  const worth = others.filter((h) => Number(h.usd ?? 0) >= 1);

  // Gas nearly empty: USDC under the reserve.
  // An empty wallet (nothing at all) is a new one, not a stranded one: nothing to warn about.
  if (usdc < reserve && (usdc > 0n || others.length > 0)) {
    const empty = usdc < oneTx;
    out.push({
      id: "gas-empty",
      check: "gas-reserve",
      family: "gas",
      severity: empty ? "block" : "warn",
      title: tx("Gas is nearly empty: {value} USDC left", { value: show(usdc, 6) }),
      why: empty
        ? tx("On Arc the network fee is paid in USDC, and one transaction needs up to {value} USDC. You can't send anything until you add USDC{value2}.", { value: showUp(oneTx, 6), value2: worth.length > 0 ? tx(", not even to swap your {value} back", { value: new Intl.ListFormat(coreIntlTag(), { type: "disjunction" }).format(worth.map((h) => h.symbol)) }) : "" })
        : tx("On Arc the network fee is paid in USDC. You have {value} USDC, under your {gasReserveUsdc} USDC reserve, so a plan may stop halfway.{value2}", { value: show(usdc, 6), gasReserveUsdc: w.gasReserveUsdc, value2: worth.length > 0 && usdc < swapTx ? tx(" Swapping your {symbol} back needs up to {value} USDC itself, more than the wallet holds.", { symbol: worth[0]!.symbol, value: showUp(swapTx, 6) }) : "" }),
      say: empty ? tx("Gas is nearly empty: {value} USDC left. You can't send anything until you add USDC.", { value: show(usdc, 6) }) : tx("Gas is low: {value} USDC, under your {gasReserveUsdc} USDC reserve.", { value: show(usdc, 6), gasReserveUsdc: w.gasReserveUsdc }),
      figures: [
        { label: tx("USDC for gas"), value: `${show(usdc, 6)} USDC`, source: w.read.source, readAt: w.read.readAt },
        { label: tx("One transaction needs (up to)"), value: `${showUp(oneTx, 6)} USDC`, source: gasRead.source, readAt: gasRead.readAt },
        { label: tx("Your network fee reserve"), value: `${w.gasReserveUsdc} USDC`, source: "Your Lyko", readAt: null },
      ],
      change: { label: tx("USDC for gas"), before: show(usdc, 6), after: `${w.gasReserveUsdc} wanted` },
      // A swap back would itself need gas: offered only when one transaction still fits.
      fixes: usdc < swapTx || worth.length === 0 ? [addUsdc] : [addUsdc, { id: "swap-back", kind: "replan", label: tx("Convert {symbol} to USDC", { symbol: worth[0]!.symbol }), sentence: tx("Convert all my {symbol} to USDC", { symbol: worth[0]!.symbol }), actions: [{ verb: "swap", from: worth[0]!.symbol, to: "USDC", amount: { all: true } }], needsGas: true }],
    });
  }

  // Stranded tokens: value in the wallet that cannot move for want of gas.
  if (usdc < oneTx && worth.length > 0) {
    const total = worth.reduce((n, h) => n + Number(h.usd ?? 0), 0);
    out.push({
      id: "stranded",
      check: "gas-reserve",
      family: "gas",
      severity: "warn",
      title: tx("${value} in {value2} can't move without gas", { value: total.toFixed(2), value2: worth.map((h) => h.symbol).join(", ") }),
      why: tx("Every transaction on Arc pays its fee in USDC, swaps and sends included. Adding a little USDC frees them."),
      say: tx("Your {value} can't move until the wallet has USDC for gas.", { value: new Intl.ListFormat(coreIntlTag(), { type: "conjunction" }).format(worth.map((h) => h.symbol)) }),
      figures: worth.slice(0, 4).map((h) => ({ label: h.symbol, value: `${show(units(h.units), h.decimals, 4)} ${h.symbol} · $${Number(h.usd).toFixed(2)}`, source: w.read.source, readAt: w.read.readAt })),
      fixes: [addUsdc],
    });
  }

  // Dust: crumbs worth less than moving them.
  const crumbs = others.filter((h) => h.usd !== null && Number(h.usd) > 0 && Number(h.usd) < 0.05);
  if (crumbs.length > 0) {
    out.push({
      id: "dust",
      check: "dust",
      family: "money",
      severity: "note",
      title: `${crumbs.length === 1 ? `${show(units(crumbs[0]!.units), crumbs[0]!.decimals, 6)} ${crumbs[0]!.symbol} is` : tx("{length} tokens are", { length: crumbs.length })} dust`,
      why: tx("Worth less than the fee to move it. Leave it, or sweep it into a bigger move next time."),
      say: tx("A few crumbs of tokens sit in the wallet, worth less than moving them."),
      figures: crumbs.slice(0, 4).map((h) => ({ label: h.symbol, value: `${show(units(h.units), h.decimals, 6)} ${h.symbol} · $${Number(h.usd).toFixed(4)}`, source: w.read.source, readAt: w.read.readAt })),
      fixes: [],
    });
  }

  // Obligations in the next 7 days the wallet would not cover.
  const soon = w.obligations.filter((o) => o.dueAt === null || Date.parse(o.dueAt) - w.now <= 7 * 86_400_000);
  for (const symbol of new Set(soon.map((o) => o.symbol))) {
    const due = soon.filter((o) => o.symbol === symbol);
    const total = due.reduce((n, o) => n + units(o.units), 0n);
    const have = symbol === "USDC" ? usdc : units(w.holdings.find((h) => h.symbol === symbol)?.units ?? "0");
    if (have >= total) continue;
    const d = decimalsOf(symbol);
    const paused = due.find((o) => o.pause);
    out.push({
      id: `obligations-${symbol}`,
      check: "obligations",
      family: "time",
      severity: "warn",
      title: tx("{value} {symbol} is due this week; the wallet has {value2}", { value: show(total, d), symbol, value2: show(have, d) }),
      why: tx("{value} {value2} in the next 7 days. Without {value3} {symbol} more, {value4}.", { value: due.map((o) => o.name).slice(0, 3).join(", "), value2: due.length === 1 ? "runs" : "run", value3: show(total - have, d), symbol, value4: due.length === 1 ? tx("it fails") : tx("some fail") }),
      say: tx("{value} {symbol} is due this week and the wallet has {value2}.", { value: show(total, d), symbol, value2: show(have, d) }),
      figures: due.slice(0, 4).map((o) => ({ label: `${o.kind}: ${o.name}`.slice(0, 80), value: `${show(units(o.units), o.decimals)} ${symbol}${o.dueAt ? ` · ${o.dueAt.slice(0, 10)}` : ""}`, source: "Herding", readAt: new Date(w.now).toISOString() })),
      fixes: [
        ...(symbol === "USDC" ? [addUsdc] : []),
        ...(paused ? [{ id: `pause:${paused.id}`, kind: "pause" as const, label: tx("Pause {value}", { value: paused.name.slice(0, 40) }), path: paused.pause!.path, method: paused.pause!.method, ...(paused.pause!.body ? { body: paused.pause!.body } : {}), needsGas: false }] : []),
      ],
    });
  }

  // A bridge taking far longer than expected.
  for (const f of w.inFlight) {
    if (!f.sentAt) continue;
    const age = (w.now - Date.parse(f.sentAt)) / 1000;
    const limit = Math.max(20 * 60, f.expectedSeconds * 3);
    if (!Number.isFinite(age) || age <= limit) continue;
    out.push({
      id: `bridge-stuck-${f.intentId}-${f.stepId}`,
      check: "bridge-destination",
      family: "bridge",
      severity: "warn",
      title: tx("The bridge to {destination} is taking longer than expected", { destination: f.destination }),
      why: tx("It was sent {value} min ago; it usually lands in {value2} min. The USDC is not lost: Circle's attestation or the mint on {destination} is still pending.", { value: Math.round(age / 60), value2: Math.max(1, Math.round(f.expectedSeconds / 60)), destination: f.destination }),
      say: tx("The bridge to {destination} has been in flight for {value} min.", { destination: f.destination, value: Math.round(age / 60) }),
      figures: [{ label: tx("Sent"), value: f.sentAt, source: "Arc chain · receipt", readAt: f.sentAt }, { label: tx("Usually takes"), value: `${Math.max(1, Math.round(f.expectedSeconds / 60))} min`, source: "Circle CCTP", readAt: null }],
      fixes: [{ id: "open-plan", kind: "open", label: tx("Open the plan"), path: `/app/outrun/${f.intentId}`, needsGas: false }],
    });
  }
  return out;
}
