/**
 * Lyko on watch's side of preflight: the wallet state the owner may already
 * be in, after a plan went through. Each condition has one primary fix,
 * and a fix that would need gas the wallet does not have is never offered
 * as if it could be signed.
 */
import { decimalsOf, feePerGasWei, gasUsdcUnits, show, showUp } from "./ledger.js";
import type { Finding, FindingFix, Obligation, Reading } from "./types.js";

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
  const addUsdc: FindingFix = { id: "add-funds", kind: "add-funds", label: "Add USDC to this wallet", detail: `Send USDC on Arc to ${w.owner.slice(0, 6)}…${w.owner.slice(-4)} from an exchange or another wallet; this wallet pays nothing to receive it.`, address: w.owner, needsGas: false };
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
      title: `Gas is nearly empty: ${show(usdc, 6)} USDC left`,
      why: empty
        ? `On Arc the network fee is paid in USDC, and one transaction needs up to ${showUp(oneTx, 6)} USDC. You can't send anything until you add USDC${worth.length > 0 ? `, not even to swap your ${worth.map((h) => h.symbol).join(" or ")} back` : ""}.`
        : `On Arc the network fee is paid in USDC. You have ${show(usdc, 6)} USDC, under your ${w.gasReserveUsdc} USDC reserve, so a plan may stop halfway.${worth.length > 0 && usdc < swapTx ? ` Swapping your ${worth[0]!.symbol} back needs up to ${showUp(swapTx, 6)} USDC itself, more than the wallet holds.` : ""}`,
      say: empty ? `Gas is nearly empty: ${show(usdc, 6)} USDC left. You can't send anything until you add USDC.` : `Gas is low: ${show(usdc, 6)} USDC, under your ${w.gasReserveUsdc} USDC reserve.`,
      figures: [
        { label: "USDC for gas", value: `${show(usdc, 6)} USDC`, source: w.read.source, readAt: w.read.readAt },
        { label: "One transaction needs (up to)", value: `${showUp(oneTx, 6)} USDC`, source: gasRead.source, readAt: gasRead.readAt },
        { label: "Your network fee reserve", value: `${w.gasReserveUsdc} USDC`, source: "Your Lyko", readAt: null },
      ],
      change: { label: "USDC for gas", before: show(usdc, 6), after: `${w.gasReserveUsdc} wanted` },
      // A swap back would itself need gas: offered only when one transaction still fits.
      fixes: usdc < swapTx || worth.length === 0 ? [addUsdc] : [addUsdc, { id: "swap-back", kind: "replan", label: `Convert ${worth[0]!.symbol} to USDC`, sentence: `Convert all my ${worth[0]!.symbol} to USDC`, actions: [{ verb: "swap", from: worth[0]!.symbol, to: "USDC", amount: { all: true } }], needsGas: true }],
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
      title: `$${total.toFixed(2)} in ${worth.map((h) => h.symbol).join(", ")} can't move without gas`,
      why: "Every transaction on Arc pays its fee in USDC, swaps and sends included. Adding a little USDC frees them.",
      say: `Your ${worth.map((h) => h.symbol).join(" and ")} can't move until the wallet has USDC for gas.`,
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
      title: `${crumbs.length === 1 ? `${show(units(crumbs[0]!.units), crumbs[0]!.decimals, 6)} ${crumbs[0]!.symbol} is` : `${crumbs.length} tokens are`} dust`,
      why: "Worth less than the fee to move it. Leave it, or sweep it into a bigger move next time.",
      say: "A few crumbs of tokens sit in the wallet, worth less than moving them.",
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
      title: `${show(total, d)} ${symbol} is due this week; the wallet has ${show(have, d)}`,
      why: `${due.map((o) => o.name).slice(0, 3).join(", ")} ${due.length === 1 ? "runs" : "run"} in the next 7 days. Without ${show(total - have, d)} ${symbol} more, ${due.length === 1 ? "it fails" : "some fail"}.`,
      say: `${show(total, d)} ${symbol} is due this week and the wallet has ${show(have, d)}.`,
      figures: due.slice(0, 4).map((o) => ({ label: `${o.kind}: ${o.name}`.slice(0, 80), value: `${show(units(o.units), o.decimals)} ${symbol}${o.dueAt ? ` · ${o.dueAt.slice(0, 10)}` : ""}`, source: "Herding", readAt: new Date(w.now).toISOString() })),
      fixes: [
        ...(symbol === "USDC" ? [addUsdc] : []),
        ...(paused ? [{ id: `pause:${paused.id}`, kind: "pause" as const, label: `Pause ${paused.name.slice(0, 40)}`, path: paused.pause!.path, method: paused.pause!.method, ...(paused.pause!.body ? { body: paused.pause!.body } : {}), needsGas: false }] : []),
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
      title: `The bridge to ${f.destination} is taking longer than expected`,
      why: `It was sent ${Math.round(age / 60)} min ago; it usually lands in ${Math.max(1, Math.round(f.expectedSeconds / 60))} min. The USDC is not lost: Circle's attestation or the mint on ${f.destination} is still pending.`,
      say: `The bridge to ${f.destination} has been in flight for ${Math.round(age / 60)} min.`,
      figures: [{ label: "Sent", value: f.sentAt, source: "Arc chain · receipt", readAt: f.sentAt }, { label: "Usually takes", value: `${Math.max(1, Math.round(f.expectedSeconds / 60))} min`, source: "Circle CCTP", readAt: null }],
      fixes: [{ id: "open-plan", kind: "open", label: "Open the plan", path: `/app/outrun/${f.intentId}`, needsGas: false }],
    });
  }
  return out;
}
