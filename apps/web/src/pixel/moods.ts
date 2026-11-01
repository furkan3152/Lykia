/**
 * Lyko's moods (pure drawing). The moods come from core `lykoMood`; each is
 * a trait set for the portrait plus a small effect loop: watching blinks,
 * herding pants, alert lifts the ears with a "!", growling shakes and shows
 * teeth, proud makes the Künye shine, resting holds still with the whistle,
 * sleeping breathes z's. Every effect changes at most 2.5 times a second,
 * under the 3 Hz flash limit.
 */
import type { LykoMood } from "@lykia/core";

import { drawGrid } from "./draw";
import { lykoHead, type LykoTraits } from "./lyko";
import { INK, SUN, WHITE } from "./sprite";

export const LYKO_MOODS: readonly LykoMood[] = ["watching", "herding", "alert", "growling", "proud", "resting", "sleeping"];

export const MOOD_W = 40;
export const MOOD_H = 42;

export const MOOD_TRAITS: Readonly<Record<LykoMood, LykoTraits>> = {
  watching: { eye: "open", mouth: "closed" },
  herding: { eye: "open", mouth: "tongue" },
  alert: { eye: "wide", mouth: "open", earsUp: true },
  growling: { eye: "fierce", mouth: "teeth", earsUp: true },
  proud: { eye: "happy", mouth: "tongue", shine: true },
  resting: { eye: "half", mouth: "closed" },
  sleeping: { eye: "closed", mouth: "closed" },
};

export const MOOD_MEANING: Readonly<Record<LykoMood, { readonly en: string; readonly tr: string }>> = {
  watching: { en: "On watch", tr: "Nöbette" },
  herding: { en: "Herding", tr: "Sürüyü güdüyor" },
  alert: { en: "Alert", tr: "Tetikte" },
  growling: { en: "Growling", tr: "Hırlıyor" },
  proud: { en: "Proud", tr: "Gururlu" },
  resting: { en: "Holding (whistle)", tr: "Bekliyor (düdük)" },
  sleeping: { en: "Asleep", tr: "Uyuyor" },
};

interface MoodSurface {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
}

export interface MoodFrame {
  readonly mood: LykoMood;
  readonly seconds: number;
  readonly still?: boolean;
  readonly clear?: boolean;
}

/** Paints one frame of a mood on a 40 x 42 canvas. */
export function drawLykoMood(ctx: MoodSurface, frame: MoodFrame): void {
  const { mood, still = false } = frame;
  const T = still ? 0.6 : frame.seconds;
  if (frame.clear !== false) ctx.clearRect(0, 0, MOOD_W, MOOD_H);
  let traits: LykoTraits = MOOD_TRAITS[mood];
  let dx = 4;
  let dy = 5;
  switch (mood) {
    case "watching": {
      if (!still && Math.floor(T * 10) % 40 === 0) traits = { ...traits, eye: "closed" };
      if (!still) dy += Math.floor(T * 1.5) % 2;
      break;
    }
    case "herding": {
      if (!still) dy += Math.floor(T * 2.5) % 2;
      break;
    }
    case "alert": {
      ctx.fillStyle = SUN;
      ctx.fillRect(36, 2, 2, 6);
      ctx.fillRect(36, 10, 2, 2);
      break;
    }
    case "growling": {
      if (!still) dx = 4 + (Math.floor(T * 6) % 3 === 0 ? 1 : 0);
      ctx.fillStyle = INK;
      for (let i = 0; i < 3; i += 1) ctx.fillRect(0, 22 + i * 3, 2 + (still ? 1 : Math.floor(T * 2 + i) % 2), 1);
      break;
    }
    case "proud": {
      const sparkle = still ? 0 : Math.floor(T * 2.5) % 2;
      ctx.fillStyle = SUN;
      ctx.fillRect(28 + sparkle, 34, 1, 1);
      ctx.fillRect(9 - sparkle, 3, 1, 3);
      ctx.fillRect(8 - sparkle, 4, 3, 1);
      ctx.fillStyle = WHITE;
      ctx.fillRect(33, 6 + sparkle, 1, 1);
      break;
    }
    case "resting": {
      // the whistle, hanging still
      ctx.fillStyle = INK;
      ctx.fillRect(33, 8, 5, 3);
      ctx.fillRect(32, 9, 1, 1);
      ctx.fillStyle = SUN;
      ctx.fillRect(34, 9, 3, 1);
      break;
    }
    case "sleeping": {
      ctx.fillStyle = INK;
      const z = still ? 3 : (T * 3) % 12;
      for (const [ox, phase] of [
        [33, 0],
        [36, 6],
      ] as const) {
        const k = (z + phase) % 12;
        const zy = 12 - Math.round(k);
        ctx.fillRect(ox, zy, 3, 1);
        ctx.fillRect(ox + 1, zy + 1, 1, 1);
        ctx.fillRect(ox, zy + 2, 3, 1);
      }
      if (!still) dy += Math.floor(T * 1) % 2;
      break;
    }
    default:
      break;
  }
  drawGrid(ctx, lykoHead(traits), dx, dy - 4, 1);
}
