/**
 * Recorded deployments of Lykia's own contracts on Arc. Hand-maintained: fill in an address only
 * after the owner console has deployed it and the post-deploy checks passed. Empty means "not
 * deployed"; nothing in Lykia assumes a deployment that is not listed here.
 */
import type { Address } from "../contracts.js";
import type { ArcEnvironment } from "../networks.js";
import type { LykiaDeployable } from "./manifest.js";

export const LYKIA_DEPLOYMENTS: Readonly<Record<ArcEnvironment, Readonly<Partial<Record<LykiaDeployable, Address>>>>> = Object.freeze({
  mainnet: Object.freeze({}),
  testnet: Object.freeze({}),
});

export function deployedAddress(environment: ArcEnvironment, name: LykiaDeployable): Address | null {
  return LYKIA_DEPLOYMENTS[environment][name] ?? null;
}
