import type { LykoMood } from "@lykia/core";
import { useCallback } from "react";

import { drawLykoMood, MOOD_H, MOOD_MEANING, MOOD_W } from "./moods";
import { PixelCanvas } from "./PixelCanvas";

export interface LykoProps {
  /** Lyko's mood (core `lykoMood`); default watching. */
  readonly mood?: LykoMood;
  /** Height in CSS px (default 84: 2 px per pixel). Rounded to whole device pixels. */
  readonly size?: number;
  /** Accessible name; default "Lyko: <mood>". Pass null when the text beside it says it. */
  readonly label?: string | null;
  /** Freeze on the end pose even with motion on. */
  readonly still?: boolean;
  readonly className?: string;
}

/** Lyko, the pixel shepherd dog, in one of his moods. Animated on the shared ticker; reduced motion shows the end pose. */
export function Lyko({ mood = "watching", size = 84, label, still = false, className }: LykoProps) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawLykoMood(ctx, { mood, seconds: info.seconds, still: info.still }),
    [mood],
  );
  return (
    <PixelCanvas
      width={MOOD_W}
      height={MOOD_H}
      scale={size / MOOD_H}
      draw={draw}
      animate={!still}
      fps={12}
      label={label === null ? undefined : (label ?? `Lyko: ${MOOD_MEANING[mood].en.toLowerCase()}`)}
      decorative={label === null}
      redrawKey={mood}
      className={className}
    />
  );
}
