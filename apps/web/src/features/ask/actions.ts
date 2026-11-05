/** What the chat's cards can do where they are shown (Ask Lyko, Lyko on watch, the chat kit). */
import type { AgentProposal } from "@lykia/core/api/agents";
import type { ArcEnvironment } from "@lykia/core";
import { createContext, useContext } from "react";

export interface ChatActions {
  /** Drop a sentence into the composer without sending it. */
  readonly prefill?: (text: string) => void;
  /** Send a sentence now (clarify chips). */
  readonly ask?: (text: string) => void;
  /** Ask the last question again (trouble state). */
  readonly retry?: () => void;
  /** Open a proposal's route (the artifact panel). */
  readonly openRoute?: (p: AgentProposal) => void;
  readonly environment: ArcEnvironment;
}

export const ChatActionsContext = createContext<ChatActions>({ environment: "mainnet" });
export const useChatActions = () => useContext(ChatActionsContext);
