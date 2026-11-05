/**
 * Mocked chain state for the offline evaluation: wallet balances, prices,
 * the venue facts from the knowledge rows, Lykia's 1% fee and the default
 * mainnet beta cap ($1000 per step, $5000 a day). Live runs send the same
 * balances as what-if balances, so amounts are comparable.
 */
import { KNOWLEDGE_ROWS, venueFactsFrom, type ProgramState } from "@lykia/core";
import type { EvalCase } from "./intents.js";

const EVAL_OWNER = "0x00000000000000000000000000000000000000aa";
/** Wednesday 4 November 2026, 12:00 UTC. */
const EVAL_NOW = Date.UTC(2026, 10, 4, 12);

export const PRESET_BALANCES: Readonly<Record<EvalCase["state"], Readonly<Record<string, string>>>> = {
  studio: { USDC: "2500", EURC: "0" },
  savings: { USDC: "1200", EURC: "0" },
  treasury: { USDC: "1800", EURC: "1200" },
  btc: { USDC: "1000", EURC: "0", cirBTC: "0.05", WETH: "0.5" },
  whale: { USDC: "50000", EURC: "0" },
  empty: { USDC: "0", EURC: "0" },
};

export function evalState(preset: EvalCase["state"]): ProgramState {
  return {
    owner: EVAL_OWNER,
    environment: "mainnet",
    balances: PRESET_BALANCES[preset],
    positions: [],
    prices: { USDC: "1", EURC: "1.1154", cirBTC: "77977.96", WETH: "3000", USYC: "1.08" },
    venues: venueFactsFrom(KNOWLEDGE_ROWS),
    feeBps: 100,
    beta: { perStepUsd: "1000", perDayUsd: "5000" },
    gasBufferUsdc: "1",
    timezone: "UTC",
    now: EVAL_NOW,
    contacts: [],
    hypothetical: true,
  };
}
