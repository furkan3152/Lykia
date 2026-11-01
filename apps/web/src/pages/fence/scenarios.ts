/**
 * Try-evaluate scenarios for the Fence playground (pure): small fact sets
 * that exercise the common rules, so an owner can see what their Fence
 * would say before any agent asks.
 */
import type { Address, FenceFacts } from "@lykia/core";

const OWNER: Address = "0x1111111111111111111111111111111111111111";
const STRANGER: Address = "0x2222222222222222222222222222222222222222";
const USDC: Address = "0x3600000000000000000000000000000000000000";
const EURC: Address = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const WOLF: Address = "0x9999999999999999999999999999999999999999";

export type ScenarioKey = "deposit" | "big" | "stranger" | "wolf" | "borrow" | "fx" | "repay";

export interface Scenario {
  readonly key: ScenarioKey;
  readonly en: string;
  readonly tr: string;
  readonly facts: (signer: "wallet" | "agent", now: number) => FenceFacts;
}

const usdc = (acquired: boolean) => ({ symbol: "USDC", address: USDC, listed: true, acquired });

export const SCENARIOS: readonly Scenario[] = [
  { key: "deposit", en: "Deposit $200 into a vault", tr: "Bir kasaya 200$ yatır", facts: (signer, now) => ({ environment: "testnet", signer, owner: OWNER, steps: [{ id: "s1", kind: "deposit", venue: "morpho", usd: "200", tokens: [usdc(false)] }], spent: { dayUsd: "0", weekUsd: "0" }, now }) },
  { key: "big", en: "Move $8,000 in one go", tr: "Tek seferde 8.000$ taşı", facts: (signer, now) => ({ environment: "testnet", signer, owner: OWNER, steps: [{ id: "s1", kind: "deposit", venue: "aave", usd: "8000", tokens: [usdc(false)] }], spent: { dayUsd: "0", weekUsd: "0" }, now }) },
  { key: "stranger", en: "Pay a stranger $50", tr: "Tanımadığın birine 50$ öde", facts: (signer, now) => ({ environment: "testnet", signer, owner: OWNER, steps: [{ id: "s1", kind: "transfer", venue: "arc-transfer", usd: "50", tokens: [usdc(false)], recipient: STRANGER }], spent: { dayUsd: "0", weekUsd: "0" }, now }) },
  { key: "wolf", en: "Buy a new token calling itself USDC", tr: "Kendine USDC diyen yeni bir token al", facts: (signer, now) => ({ environment: "testnet", signer, owner: OWNER, steps: [{ id: "s1", kind: "swap", venue: "uniswap", usd: "100", slippageBps: 300, tokens: [usdc(false), { symbol: "USDC", address: WOLF, listed: false, acquired: true, scent: "danger" }] }], spent: { dayUsd: "0", weekUsd: "0" }, now }) },
  { key: "borrow", en: "Borrow until health factor 1.2", tr: "Sağlık faktörü 1.2'ye inene kadar borçlan", facts: (signer, now) => ({ environment: "testnet", signer, owner: OWNER, steps: [{ id: "s1", kind: "borrow", venue: "aave", usd: "300", tokens: [usdc(true)], healthFactorAfter: "1.2" }], spent: { dayUsd: "0", weekUsd: "0" }, now }) },
  { key: "fx", en: "Convert $500 to EURC, quote 80 bps off", tr: "500$'ı EURC'ye çevir, teklif 80 bps sapmalı", facts: (signer, now) => ({ environment: "testnet", signer, owner: OWNER, steps: [{ id: "s1", kind: "fx", venue: "stablefx", usd: "500", fxDeviationBps: 80, tokens: [usdc(false), { symbol: "EURC", address: EURC, listed: true, acquired: true }] }], spent: { dayUsd: "0", weekUsd: "0" }, now }) },
  { key: "repay", en: "Repay a loan and withdraw home", tr: "Borcu öde ve eve çek", facts: (signer, now) => ({ environment: "testnet", signer, owner: OWNER, steps: [{ id: "s1", kind: "repay", venue: "aave", usd: "300", tokens: [usdc(false)] }, { id: "s2", kind: "withdraw", venue: "morpho", usd: "300", tokens: [usdc(true)], recipient: OWNER }], spent: { dayUsd: "0", weekUsd: "0" }, now }) },
];
