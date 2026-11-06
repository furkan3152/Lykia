/**
 * Hand-drawn pixel marks for the position map: one per state (9×9, drawn in
 * the state's colour) and one per kind of venue (10×10, on the venue's own
 * tile). Text and pixels only: no partner logos.
 */
import type { PositionState, PositionVenueKind } from "@lykia/core";

import { PixelArt } from "../../../mosaic/PixelArt";
import { STATE_COLOR } from "../positionsModel";

const STATE_ART: Readonly<Record<PositionState, readonly string[]>> = {
  // A sprout: money that grows.
  earning: [".........", ".kk...kk.", "kkkk.kkkk", ".kkk.kkk.", "...kkk...", "....k....", "....k....", "..kkkkk..", ".kkkkkkk."],
  // A crescent moon: resting.
  idle: ["...kkkk..", "..kk.....", ".kk......", ".kk......", ".kk......", ".kk......", "..kk.....", "...kkkk..", "........."],
  // An arrow leaving the tray: money owed.
  borrowing: ["....k....", "....k....", "..k.k.k..", "...kkk...", "....k....", ".........", "k.......k", "k.......k", "kkkkkkkkk"],
  // A warning triangle.
  "at-risk": ["....k....", "...kkk...", "...k.k...", "..kk.kk..", "..k.k.k..", ".kk.k.kk.", ".k.....k.", "kk..k..kk", "kkkkkkkkk"],
  // A band with the price outside it.
  "out-of-range": [".........", "kk...kk..", "k.....k..", "k.....k.k", "k.....k.k", "k.....k..", "kk...kk..", ".........", "........."],
  // An hourglass.
  pending: ["kkkkkkkkk", ".k.....k.", "..k...k..", "...k.k...", "....k....", "...k.k...", "..k.k.k..", ".k.kkk.k.", "kkkkkkkkk"],
  // A padlock.
  escrowed: ["...kkk...", "..k...k..", "..k...k..", ".kkkkkkk.", ".kkk.kkk.", ".kkk.kkk.", ".kkkkkkk.", ".kkkkkkk.", "........."],
  // A calendar page.
  committed: [".k.....k.", "kkkkkkkkk", "k.......k", "kkkkkkkkk", "k.k.k.k.k", "k.......k", "k.k.k.k.k", "k.......k", "kkkkkkkkk"],
};

export function StateIcon({ state, size = 11, color }: { readonly state: PositionState; readonly size?: number; readonly color?: string }) {
  return <PixelArt art={STATE_ART[state]} palette={{ k: color ?? STATE_COLOR[state] }} size={size} />;
}

const KIND_ART: Readonly<Record<PositionVenueKind, readonly string[]>> = {
  // A purse with a clasp.
  wallet: ["...wwww...", "..w....w..", "wwwwwwwwww", "w........w", "w.....wwww", "w.....w.ww", "w.....wwww", "w........w", "wwwwwwwwww", ".........."],
  // A temple: lending pools.
  lending: ["....ww....", "..wwwwww..", "wwwwwwwwww", "..........", "w.w.ww.w.w", "w.w.ww.w.w", "w.w.ww.w.w", "w.w.ww.w.w", "wwwwwwwwww", "wwwwwwwwww"],
  // An amphora: a vault.
  vault: ["..wwwwww..", "...wwww...", "w..w..w..w", "ww.w..w.ww", ".wwwwwwww.", "wwwwwwwwww", "wwwwwwwwww", ".wwwwwwww.", "..wwwwww..", "...wwww..."],
  // Scales: a lending market.
  market: ["....ww....", "wwwwwwwwww", "w...ww...w", "w...ww...w", "ww..ww..ww", "wwwwwwwwww", "....ww....", "....ww....", "..wwwwww..", ".wwwwwwww."],
  // Two overlapping coins: liquidity.
  lp: ["..wwww....", ".w....w...", "w..wwwwww.", "w.w....w.w", "w.w.ww.w.w", ".ww.ww.w.w", "..w....w.w", "..wwwwww.w", "....w....w", ".....wwww."],
  // A gate: Circle Gateway.
  gateway: ["wwwwwwwwww", "w..wwww..w", "w.w....w.w", "w.w....w.w", "w.w....w.w", "w.w....w.w", "w.w....w.w", "w.w....w.w", "w.w....w.w", "www....www"],
  // A bridge: money crossing chains.
  bridge: ["..........", "wwwwwwwwww", "w..wwww..w", "w.w....w.w", "ww......ww", "w........w", "w........w", "w........w", "~~~~~~~~~~", ".~~~~~~~~."],
  // A scroll: a treasury fund.
  treasury: [".wwwwwwww.", "w.w....w.w", ".ww....ww.", "..w.ww.w..", "..w....w..", "..w.ww.w..", "..w....w..", ".ww....ww.", "w.w....w.w", ".wwwwwwww."],
  // A target: orders that wait for a price.
  orders: ["...wwww...", ".ww....ww.", ".w..ww..w.", "w..w..w..w", "w.w.ww.w.w", "w.w.ww.w.w", "w..w..w..w", ".w..ww..w.", ".ww....ww.", "...wwww..."],
  // A sealed letter: payments on a schedule.
  payments: ["..........", "wwwwwwwwww", "ww......ww", "w.w....w.w", "w..w..w..w", "w...ww...w", "w........w", "w........w", "wwwwwwwwww", ".........."],
};

/** Each venue's tile colour (Mosaic earth tones, not brand colours). */
const VENUE_TILE: Readonly<Record<string, string>> = {
  wallet: "#1e8fa3",
  "aave-v4": "#6d4f8f",
  "morpho-vaults": "#2f5f8f",
  "morpho-blue": "#24486f",
  "uniswap-v3": "#b2456e",
  "uniswap-v4": "#93365a",
  "aerodrome-slipstream": "#2e6e8a",
  usyc: "#5f8a3a",
  gateway: "#13233a",
  cctp: "#146f80",
  "lykia-orders": "#a8763e",
  "arc-transfer": "#8f3420",
  "lykia-practice": "#7a8696",
};

function venueTone(venue: string): string {
  return VENUE_TILE[venue] ?? "#4a5a6e";
}

/** The venue's tile: its colour, the kind's pixel mark and a two-letter monogram. */
export function VenueTile({ venue, kind, name, size = 40 }: { readonly venue: string; readonly kind: PositionVenueKind; readonly name: string; readonly size?: number }) {
  const mono = name
    .replace(/[^A-Za-z0-9 ]/gu, "")
    .split(/\s+/u)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="ps-vtile" style={{ width: size, height: size, ["--vt" as string]: venueTone(venue) }} aria-hidden="true">
      <PixelArt art={KIND_ART[kind]} palette={{ w: "#fff6de", "~": "rgba(255,246,222,0.55)" }} size={Math.round(size * 0.5)} />
      <i>{mono}</i>
    </span>
  );
}

/** A token as a small stone with its ticker's first letters. */
export function AssetStone({ symbol, size = 22 }: { readonly symbol: string; readonly size?: number }) {
  const hue = TOKEN_TONE[symbol] ?? "#7a8696";
  return (
    <span className="ps-stone" style={{ width: size, height: size, ["--st" as string]: hue }} title={symbol} aria-hidden="true">
      {symbol.replace(/^cir/u, "").slice(0, size < 20 || symbol.length > 4 ? 2 : 3).toUpperCase()}
    </span>
  );
}

const TOKEN_TONE: Readonly<Record<string, string>> = { USDC: "#2775ca", EURC: "#1d4f91", USYC: "#5f8a3a", cirBTC: "#d08a2a", WETH: "#5b6478" };
