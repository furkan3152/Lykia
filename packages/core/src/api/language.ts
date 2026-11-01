/** Contract types: the language reader. */
import type { PlanAction } from "../actions.js";
import type { CommandWord, EasterEggWord } from "../lore.js";
import type { StandingOrderDraft } from "../standing.js";

/** A question with ready answers the UI can offer as buttons. */
export interface ClarifyChoice {
  readonly question: string;
  /** Each choice is a phrase that, appended to the sentence, answers the question. */
  readonly choices: readonly string[];
}

export interface ParseResponse {
  readonly actions: readonly PlanAction[];
  readonly command: CommandWord | null;
  readonly easterEgg: EasterEggWord | null;
  /** Questions to ask before a plan can be made. */
  readonly clarify: readonly string[];
  /** The same questions with suggested answers, when the reader has some. */
  readonly clarifyChoices?: readonly ClarifyChoice[];
  /**
   * Conditional or scheduled parts ("if EURC/USD goes above 1.12 …",
   * "every friday …"): arm them with POST /v1/standing; they plan a new
   * intent when they fire and never sign.
   */
  readonly standing?: readonly StandingOrderDraft[];
  /** How memory shaped the reading: a repeated or undone plan, contacts resolved, a usual venue. */
  readonly memory?: {
    readonly kind: "repeat" | "undo" | "contacts" | "usual-venue" | "more-than-last";
    readonly explanation: string;
    readonly from?: string;
    readonly contacts?: readonly { readonly name: string; readonly address: string; readonly trusted: boolean }[];
  };
  /** One line in Lyko's voice. */
  readonly reply: string;
}
