import React from "react";

import { Frame, MosaicCanvas, Tag, cx } from "../../mosaic";
import type { Buffer } from "../../mosaic/tessera";

export interface SceneLabel {
  /** Percent of the scene width / height. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly tone?: "ochre" | "ok" | "bad" | "sea" | "ghost" | "wolf";
}

/**
 * A data-driven mosaic scene in the stone frame, with HTML labels pinned in
 * percent so they stay crisp and readable at every width.
 */
export function SceneFrame({ build, width, height, labels = [], label, tile = 6, fps = 8, dataKey, assembleKey, night, className, footer, vt }: { build: (t: number) => Buffer; width: number; height: number; labels?: readonly SceneLabel[]; label: string; tile?: number; fps?: number; dataKey?: unknown; assembleKey?: unknown; night?: boolean; className?: string; footer?: React.ReactNode; vt?: boolean }) {
  return (
    <Frame tone={night ? "night" : "terra"} className={cx(className)} style={{ padding: 0 }}>
      <div className={cx("m-scene", vt && "vt-scene")}>
        <MosaicCanvas build={build} width={width} height={height} tile={tile} fps={fps} dataKey={dataKey} assembleKey={assembleKey} label={label} />
        {labels.map((l, i) => (
          <span key={`${l.text}-${i}`} className="m-scene__label" style={{ left: `${l.x}%`, top: `${l.y}%`, animationDelay: `${300 + i * 60}ms` }}>
            <Tag tone={l.tone}>{l.text}</Tag>
          </span>
        ))}
      </div>
      {footer}
    </Frame>
  );
}
