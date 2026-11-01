/** Contract types: the language reader. */
import type { PlanAction } from "../actions.js";
import type { CommandWord, EasterEggWord } from "../lore.js";

export interface ParseResponse {
  readonly actions: readonly PlanAction[];
  readonly command: CommandWord | null;
  readonly easterEgg: EasterEggWord | null;
  /** Questions to ask before a plan can be made. */
  readonly clarify: readonly string[];
  /** One line in Lyko's voice. */
  readonly reply: string;
  readonly lang: "en" | "tr";
}
