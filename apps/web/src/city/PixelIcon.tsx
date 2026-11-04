/** Small icons drawn as Mosaic pixels (9 x 9 stones) in the current text colour. */
import { useMemo } from "react";

export type PixelIconName = "home" | "list" | "ask" | "in" | "out" | "agents" | "whistle" | "swap" | "shield" | "spark";

const ART: Readonly<Record<PixelIconName, readonly string[]>> = {
  home: ["....k....", "...kkk...", "..kkkkk..", ".kkkkkkk.", "kkkkkkkkk", ".kk...kk.", ".kk.k.kk.", ".kk.k.kk.", ".kkkkkkk."],
  list: [".........", "kk.kkkkkk", "kk.kkkkkk", ".........", "kk.kkkkkk", "kk.kkkkkk", ".........", "kk.kkkkkk", "kk.kkkkkk"],
  ask: [".kkkkkkk.", "kkkkkkkkk", "kk.....kk", "kk.k.k.kk", "kk.....kk", "kkkkkkkkk", ".kkkkkkk.", "..kk.....", ".k......."],
  in: ["....k....", "....k....", "....k....", "....k....", "k...k...k", ".k..k..k.", "..k.k.k..", "...kkk...", "kkkkkkkkk"],
  out: ["kkkkkkkkk", "...kkk...", "..k.k.k..", ".k..k..k.", "k...k...k", "....k....", "....k....", "....k....", "....k...."],
  agents: [".k.....k.", ".kk...kk.", ".kkkkkkk.", "kkkkkkkkk", "kk.kkk.kk", "kkkkkkkkk", ".kkk.kkk.", "..kkkkk..", "...kkk..."],
  whistle: [".......kk", "......kk.", "kkkkkkk..", "kkkkkkkk.", "kk...kkk.", "k.....kk.", "k.....k..", "kk...kk..", ".kkkkk..."],
  swap: ["......k..", "kkkkkkkk.", "......k..", ".........", "..k......", ".kkkkkkkk", "..k......", ".........", "........."],
  shield: ["kkkkkkkkk", "kkkkkkkkk", "kk.....kk", "kk.....kk", "kk.....kk", ".kk...kk.", "..kk.kk..", "...kkk...", "....k...."],
  spark: ["....k....", "....k....", "...kkk...", "kkkk.kkkk", "...kkk...", "....k....", "....k....", ".........", "........."],
};

export function PixelIcon({ name, size = 18, label }: { readonly name: PixelIconName; readonly size?: number; readonly label?: string }) {
  const rects = useMemo(() => ART[name].flatMap((row, y) => [...row].map((c, x) => (c === "k" ? `M${x} ${y}h1v1h-1z` : "")).filter(Boolean)).join(""), [name]);
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" shapeRendering="crispEdges" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ display: "block", flex: "none" }}>
      <path d={rects} fill="currentColor" />
    </svg>
  );
}
