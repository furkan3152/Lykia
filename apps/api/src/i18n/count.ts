/** "3 positions" in the request's language: a count and the noun it counts. */
import { phrase, tx } from "@lykia/core";

const COUNTS = {
  position: phrase("{n, plural, one {# position} other {# positions}}"),
  venue: phrase("{n, plural, one {# venue} other {# venues}}"),
  step: phrase("{n, plural, one {# step} other {# steps}}"),
  thing: phrase("{n, plural, one {# thing} other {# things}}"),
  "other option": phrase("{n, plural, one {# other option} other {# other options}}"),
  loan: phrase("{n, plural, one {# loan} other {# loans}}"),
  holding: phrase("{n, plural, one {# holding} other {# holdings}}"),
  action: phrase("{n, plural, one {# action} other {# actions}}"),
  "settled step": phrase("{n, plural, one {# settled step} other {# settled steps}}"),
  "liquidity or Gateway position": phrase("{n, plural, one {# liquidity or Gateway position} other {# liquidity or Gateway positions}}"),
} as const;

export type Counted = keyof typeof COUNTS;

export function count(n: number, word: Counted): string {
  return tx(COUNTS[word], { n });
}
