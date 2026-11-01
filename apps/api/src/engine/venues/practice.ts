/**
 * Practice venues on Arc testnet: Lykia's own PracticeVault (ERC-4626),
 * PracticeSwap (USDC/EURC at an owner-set rate) and PracticeLending
 * (cirBTC collateral, USDC debt). Arc testnet has none of the mainnet DeFi
 * venues, so these let every flow run end to end on testnet. Not audited;
 * testnet only.
 *
 * Addresses come from the contracts package's deployment manifest
 * (`@lykia/core/contracts/index`). Until they are deployed, every practice
 * venue reports "not deployed yet" and nothing routes to it.
 *
 * Expected manifest shape (any of these is read): an export whose testnet
 * entry (key "testnet", "arc-testnet" or "5042002") maps contract names
 * (PracticeVault / PracticeVaultEurc / PracticeSwap / PracticeLending,
 * any case) to addresses, either directly or as `{ address }`.
 */
import type { Address, ArcEnvironment } from "@lykia/core";

export type PracticeKey = "vaultUsdc" | "vaultEurc" | "swap" | "lending";

export interface PracticeVenues {
  readonly vaultUsdc: Address | null;
  readonly vaultEurc: Address | null;
  readonly swap: Address | null;
  readonly lending: Address | null;
  readonly source: string;
}

const NONE: PracticeVenues = { vaultUsdc: null, vaultEurc: null, swap: null, lending: null, source: "not deployed yet" };
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

let cached: { at: number; venues: PracticeVenues } | null = null;
let override: PracticeVenues | null = null;

/** Tests and operators can pin practice addresses (e.g. right after a deploy). */
export function setPracticeVenues(venues: Partial<PracticeVenues> | null): void {
  override = venues ? { ...NONE, ...venues, source: venues.source ?? "configured" } : null;
  cached = null;
}

function addressOf(value: unknown): Address | null {
  if (typeof value === "string" && ADDRESS.test(value)) return value as Address;
  if (typeof value === "object" && value !== null && typeof (value as { address?: unknown }).address === "string" && ADDRESS.test((value as { address: string }).address)) return (value as { address: Address }).address;
  return null;
}

/** Walks a module's exports looking for a testnet entry with practice contract names. */
export function findPracticeAddresses(mod: Record<string, unknown>): PracticeVenues | null {
  const seen = new Set<unknown>();
  const visit = (node: unknown, depth: number, inTestnet: boolean): PracticeVenues | null => {
    if (typeof node !== "object" || node === null || seen.has(node) || depth > 5) return null;
    seen.add(node);
    const entries = Object.entries(node as Record<string, unknown>);
    const pick = (pattern: RegExp) => {
      for (const [k, v] of entries) if (pattern.test(k)) {
        const a = addressOf(v);
        if (a) return a;
      }
      return null;
    };
    if (inTestnet) {
      const swap = pick(/^practice[-_]?swap$/iu);
      const lending = pick(/^practice[-_]?lending$/iu);
      const vaultEurc = pick(/^practice[-_]?vault[-_]?eurc$/iu);
      const vaultUsdc = pick(/^practice[-_]?vault(?:[-_]?usdc)?$/iu);
      if (swap || lending || vaultUsdc || vaultEurc) return { vaultUsdc, vaultEurc, swap, lending, source: "contracts manifest" };
    }
    for (const [k, v] of entries) {
      const testnet = inTestnet || /^(?:testnet|arc[-_]?testnet|5042002)$/iu.test(k);
      const found = visit(v, depth + 1, testnet);
      if (found) return found;
    }
    return null;
  };
  return visit(mod, 0, false);
}

export async function practiceVenues(environment: ArcEnvironment, now = Date.now()): Promise<PracticeVenues> {
  if (environment !== "testnet") return { ...NONE, source: "testnet only" };
  if (override) return override;
  if (cached && now - cached.at < 60_000) return cached.venues;
  let venues: PracticeVenues;
  try {
    const specifier = "@lykia/core/contracts/index";
    const mod = (await import(specifier)) as Record<string, unknown>;
    venues = findPracticeAddresses(mod) ?? NONE;
  } catch {
    venues = NONE;
  }
  cached = { at: now, venues };
  return venues;
}
