/**
 * The wallet and USYC.
 *
 * Wallet: native USDC (Arc's gas token, 18 decimals) and every registry
 * token's ERC-20 balance in one Multicall3 round trip. Native USDC and the
 * ERC-20 USDC are the same money seen through two interfaces, so USDC is one
 * row (the ERC-20 face) with the gas balance as a fact, never added twice.
 *
 * USYC: the token balance, valued at Circle's USYC oracle NAV. Its yield is
 * the NAV's own growth: the latest round against the oldest of the last 30
 * rounds (at least a week apart), compounded to a year. No round history, no
 * APY: never a guess.
 */
import { classifyPosition, fromBaseUnits, getProtocol, nativeUsdcToErc20, TOKENS, tokenAddress, type Address, type Position } from "@lykia/core";
import { CHAINLINK_ROUNDS_ABI, ERC20_META_ABI } from "./abis.js";
import { action, addressLink, asset, finish, sentenceAmount, valued, VenueUnavailable, type Reader } from "./context.js";
import { navApyPercent } from "./math.js";

import { tx } from "@lykia/core";
export const readWallet: Reader = async (r, venue) => {
  const tokens = TOKENS.filter((t) => t.symbol !== "USYC").map((t) => ({ token: t, address: tokenAddress(t, r.environment) })).filter((t): t is { token: (typeof TOKENS)[number]; address: Address } => t.address !== null);
  const result = await r.ctx.chains.getBalances(r.environment, r.owner, ["native", ...tokens.map((t) => t.address)]);
  const [native, ...rest] = result.balances;
  const failed = tokens.filter((_, i) => rest[i]?.balance === null || rest[i]?.balance === undefined);
  if (failed.length === tokens.length) throw new VenueUnavailable("The token balances could not be read from Arc.");
  const held = tokens.map((t, i) => ({ ...t, units: rest[i]?.balance ?? null })).filter((t): t is typeof t & { units: bigint } => t.units !== null && t.units > 0n);
  const prices = await r.prices(held.map((h) => h.token.symbol));
  const block = result.blockNumber?.toString() ?? null;
  const gas = native?.balance ?? null;
  const positions: Position[] = held.map((h) => {
    const price = prices[h.token.symbol]?.usd ?? null;
    const v = valued(h.units, h.token.decimals, price);
    const facts: { label: string; value: string }[] = [{ label: tx("Price source"), value: prices[h.token.symbol]?.source ?? "none" }];
    if (h.token.symbol === "USDC" && gas !== null) {
      facts.unshift({ label: tx("Gas balance (native USDC)"), value: `${fromBaseUnits(nativeUsdcToErc20(gas, "floor"), 6)} USDC` });
    }
    const amount = Number(v.amount);
    const usd = v.valueUsd === null ? null : Number(v.valueUsd);
    const actions =
      h.token.symbol === "USDC"
        ? usd !== null && usd - r.liquidityFloorUsd >= 1
          ? [action("put-to-work", tx("Put to work"), tx("Put {value} USDC to work", { value: sentenceAmount(usd - r.liquidityFloorUsd) }))]
          : []
        : h.token.symbol === "EURC"
          ? [action("convert", tx("Convert half to USDC"), tx("Convert {value} EURC to USDC", { value: sentenceAmount(amount / 2) }))]
          : [action("convert", tx("Convert to USDC"), tx("Convert {amount} {symbol} to USDC", { amount: sentenceAmount(amount), symbol: h.token.symbol }))];
    if (h.token.symbol === "USDC" && usd !== null && usd > r.liquidityFloorUsd) facts.push({ label: tx("Above your liquidity floor"), value: `$${(usd - r.liquidityFloorUsd).toFixed(2)}` });
    return finish({
      id: `wallet:${h.address.toLowerCase()}`,
      venue: venue.id,
      venueName: venue.name,
      venueKind: "wallet",
      label: h.token.symbol,
      assets: [asset(h.token.symbol, h.address, v.amount, v.valueUsd, "held")],
      amount: v.amount,
      symbol: h.token.symbol,
      valueUsd: v.valueUsd,
      counts: "net",
      state: classifyPosition({ kind: "held" }),
      facts,
      actions,
      source: "chain",
      readAt: r.readAt,
      block,
      explorer: addressLink(r.environment, h.address),
    });
  });
  // A token that did not answer is named in the coverage line, never shown as zero.
  return { positions, block, method: "Multicall3: native balance and every registry token's balanceOf in one call.", source: "chain", ...(failed.length > 0 ? { coverage: tx("Not read this time: {value}.", { value: failed.map((f) => f.token.symbol).join(", ") }) } : {}) };
};

export const readUsyc: Reader = async (r, venue) => {
  const usyc = TOKENS.find((t) => t.symbol === "USYC");
  const token = usyc ? tokenAddress(usyc, r.environment) : null;
  const oracle = getProtocol("usyc-teller")?.deployments[r.environment]?.contracts.oracle ?? null;
  if (!usyc || !token) throw new VenueUnavailable("USYC is not listed on this network.");
  const client = r.ctx.chains.client(r.environment);
  const [balance, block] = await Promise.all([client.readContract({ address: token, abi: ERC20_META_ABI, functionName: "balanceOf", args: [r.owner] }), client.getBlockNumber()]);
  if (balance === 0n) return { positions: [], block: block.toString(), method: "USYC balanceOf, valued at the USYC oracle NAV.", source: "chain" };
  if (!oracle) throw new VenueUnavailable("No USYC oracle on this network, so the holding cannot be valued.");
  const [decimals, latest] = await Promise.all([client.readContract({ address: oracle as Address, abi: CHAINLINK_ROUNDS_ABI, functionName: "decimals" }), client.readContract({ address: oracle as Address, abi: CHAINLINK_ROUNDS_ABI, functionName: "latestRoundData" })]);
  const nav = latest[1] > 0n ? latest[1] : null;
  const navString = nav === null ? null : fromBaseUnits(nav, decimals);
  const v = valued(balance, usyc.decimals, navString);
  // NAV growth over up to 30 rounds back (rounds are business days).
  let apy: number | null = null;
  let apyWindow = "";
  if (nav !== null) {
    for (const back of [30n, 20n, 10n, 5n]) {
      if (latest[0] <= back) continue;
      try {
        const then = await client.readContract({ address: oracle as Address, abi: CHAINLINK_ROUNDS_ABI, functionName: "getRoundData", args: [latest[0] - back] });
        const seconds = Number(latest[3] - then[3]);
        const a = navApyPercent(nav, then[1], seconds);
        if (a !== null && seconds >= 7 * 86_400) {
          apy = a;
          apyWindow = tx("{value} days of NAV", { value: Math.round(seconds / 86_400) });
          break;
        }
      } catch {
        /* older rounds may not be retrievable: try a shorter window */
      }
    }
  }
  const amount = Number(v.amount);
  const position = finish({
    id: `usyc:${token.toLowerCase()}`,
    venue: venue.id,
    venueName: venue.name,
    venueKind: "treasury",
    label: tx("USYC · tokenized US Treasury fund"),
    assets: [asset("USYC", token, v.amount, v.valueUsd, "held")],
    amount: v.amount,
    symbol: "USYC",
    valueUsd: v.valueUsd,
    counts: "net",
    state: classifyPosition({ kind: "vault", apyPercent: apy }),
    ...(apy !== null ? { apy: { percent: apy.toFixed(2), kind: "nav" as const, source: `USYC oracle, ${apyWindow}` } } : {}),
    facts: [
      { label: tx("NAV per USYC"), value: navString === null ? "unreadable" : `$${Number(navString).toFixed(6)}` },
      { label: tx("NAV updated"), value: new Date(Number(latest[3]) * 1000).toISOString() },
      { label: tx("Price source"), value: tx("Circle USYC oracle (business days)") },
    ],
    actions: [action("withdraw", tx("Redeem to USDC"), tx("Redeem {amount} USYC to USDC", { amount: sentenceAmount(amount) }))],
    source: "chain",
    readAt: r.readAt,
    block: block.toString(),
    explorer: addressLink(r.environment, token),
  });
  return { positions: [position], block: block.toString(), method: "USYC balanceOf, valued at the USYC oracle NAV; APY from the NAV's growth over its recent rounds.", source: "chain" };
};
