import React from "react";

import { Frame, MosaicCanvas, Tag, cx } from "../../mosaic";
import type { Buffer } from "../../mosaic/tessera";

export interface SceneLabel {
  /** Percent of the scene width / height. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly tone?: "ochre" | "ok" | "bad" | "sea" | "ghost" | "wolf";
  /** Which labels survive when space is short: higher first. Defaults by tone. */
  readonly priority?: number;
}

function labelPriority(l: SceneLabel, index: number): number {
  if (l.priority !== undefined) return l.priority;
  if (l.tone === "ok" || l.tone === "bad") return 4;
  if (l.y < 10) return 3;
  if (l.tone === "wolf") return 2;
  return 1 - index / 100;
}

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const GAP = 4;
const overlaps = (a: Box, b: Box) => a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP;

/**
 * Lays labels out inside the scene: each is nudged to stay within the frame,
 * then labels are kept greedily by priority and any that would collide with
 * a kept one are hidden. Re-runs whenever the scene resizes.
 */
function useLabelLayout(ref: React.RefObject<HTMLDivElement | null>, labels: readonly SceneLabel[]) {
  React.useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    const layout = () => {
      const spans = [...host.querySelectorAll<HTMLElement>("[data-scene-label]")];
      const width = host.clientWidth;
      const order = spans.map((el, i) => ({ el, i, p: labelPriority(labels[i]!, i) })).sort((a, b) => b.p - a.p || a.i - b.i);
      const kept: Box[] = [];
      for (const { el } of order) {
        el.style.setProperty("--nudge", "0px");
        el.hidden = false;
        // The span is a zero-size anchor; the tag inside carries the size.
        const r = (el.firstElementChild ?? el).getBoundingClientRect();
        const h = host.getBoundingClientRect();
        let left = r.left - h.left;
        let nudge = 0;
        if (left < GAP) nudge = GAP - left;
        else if (left + r.width > width - GAP) nudge = width - GAP - (left + r.width);
        left += nudge;
        const box = { left, right: left + r.width, top: r.top - h.top, bottom: r.bottom - h.top };
        if (r.width > width - 2 * GAP || kept.some((k) => overlaps(k, box))) {
          el.hidden = true;
          continue;
        }
        el.style.setProperty("--nudge", `${nudge}px`);
        kept.push(box);
      }
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(host);
    // Pixel fonts change label widths once they load.
    let alive = true;
    void document.fonts?.ready.then(() => alive && layout());
    const late = window.setTimeout(layout, 900);
    return () => {
      alive = false;
      window.clearTimeout(late);
      ro.disconnect();
    };
  }, [ref, labels]);
}

/**
 * A data-driven mosaic scene in the stone frame, with HTML labels pinned in
 * percent so they stay crisp and readable at every width; labels that would
 * collide or spill out on small screens are culled by priority.
 */
export function SceneFrame({ build, width, height, labels = [], label, tile = 6, fps = 8, dataKey, assembleKey, night, className, footer, vt }: { build: (t: number) => Buffer; width: number; height: number; labels?: readonly SceneLabel[]; label: string; tile?: number; fps?: number; dataKey?: unknown; assembleKey?: unknown; night?: boolean; className?: string; footer?: React.ReactNode; vt?: boolean }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const key = labels.map((l) => `${l.text}@${l.x},${l.y}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content so a new array with the same labels does not re-run layout
  const stable = React.useMemo(() => labels, [key]);
  useLabelLayout(ref, stable);
  return (
    <Frame tone={night ? "night" : "terra"} className={cx(className)} style={{ padding: 0 }}>
      <div ref={ref} className={cx("m-scene", vt && "vt-scene")}>
        <MosaicCanvas build={build} width={width} height={height} tile={tile} fps={fps} dataKey={dataKey} assembleKey={assembleKey} label={label} />
        {stable.map((l, i) => (
          <span key={`${l.text}-${i}`} data-scene-label="" className="m-scene__label" style={{ left: `${l.x}%`, top: `${l.y}%`, animationDelay: `${300 + i * 60}ms` }}>
            <Tag tone={l.tone}>{l.text}</Tag>
          </span>
        ))}
      </div>
      {footer}
    </Frame>
  );
}
