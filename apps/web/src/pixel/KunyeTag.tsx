import { useCallback } from "react";

import { cx } from "../ui/cx";
import { PixelCanvas } from "./PixelCanvas";
import { INK } from "./sprite";

const W = 96;
const H = 56;
const STEEL = "#D3DADF";
const STEEL_HI = "#F2F5F7";
const STEEL_SH = "#8E9BA3";

/** The tag's plate (pure): a stamped steel tag with stepped corners, a hole and a ring. */
function drawTagPlate(ctx: { fillStyle: string | CanvasGradient | CanvasPattern; fillRect(x: number, y: number, w: number, h: number): void; clearRect(x: number, y: number, w: number, h: number): void }): void {
  ctx.clearRect(0, 0, W, H);
  // ring
  ctx.fillStyle = STEEL_SH;
  ctx.fillRect(8, 2, 8, 2);
  ctx.fillRect(6, 4, 2, 6);
  ctx.fillRect(16, 4, 2, 6);
  // plate with stepped corners
  ctx.fillStyle = INK;
  ctx.fillRect(4, 8, W - 8, H - 12);
  ctx.fillRect(2, 10, W - 4, H - 16);
  ctx.fillStyle = STEEL;
  ctx.fillRect(5, 9, W - 10, H - 14);
  ctx.fillRect(3, 11, W - 6, H - 18);
  // bevel
  ctx.fillStyle = STEEL_HI;
  ctx.fillRect(5, 9, W - 10, 2);
  ctx.fillRect(3, 11, 2, H - 18);
  ctx.fillStyle = STEEL_SH;
  ctx.fillRect(5, H - 7, W - 10, 2);
  ctx.fillRect(W - 5, 11, 2, H - 18);
  // the hole
  ctx.fillStyle = INK;
  ctx.fillRect(10, 13, 4, 4);
  // stamped border dots
  ctx.fillStyle = STEEL_SH;
  for (let x = 20; x < W - 10; x += 4) {
    ctx.fillRect(x, 13, 1, 1);
    ctx.fillRect(x, H - 10, 1, 1);
  }
}

export interface KunyeTagProps {
  readonly agentId: string | null;
  readonly name: string;
  readonly fenceHash: string | null;
  readonly owner?: string | null;
  readonly className?: string;
}

/** A Künye: the agent's steel tag. The stamped text is real text over the pixel plate. */
export function KunyeTag({ agentId, name, fenceHash, owner, className }: KunyeTagProps) {
  const draw = useCallback((ctx: CanvasRenderingContext2D) => drawTagPlate(ctx), []);
  return (
    <figure className={cx("relative mx-auto w-full max-w-[420px]", className)} aria-label={`Künye ${agentId ? `#${agentId}` : "(draft)"} for ${name}`}>
      <PixelCanvas width={W} height={H} contain draw={draw} decorative />
      <figcaption className="absolute inset-0 flex flex-col justify-center gap-0.5 pl-[22%] pr-[8%] pt-[6%] text-[#1B1714]">
        <span className="font-tag text-[10px] uppercase tracking-[0.12em] opacity-70">Künye · ERC-8004 · Arc</span>
        <span className="truncate font-display text-[clamp(16px,4vw,26px)] font-bold leading-tight">{name || "Unnamed agent"}</span>
        <span className="font-mono text-[11px]">{agentId ? `#${agentId}` : "draft"}{owner ? ` · ${owner.slice(0, 6)}…${owner.slice(-4)}` : ""}</span>
        {fenceHash ? <span className="truncate font-mono text-[10px] opacity-70">fence {fenceHash.slice(7, 23)}…</span> : null}
      </figcaption>
    </figure>
  );
}
