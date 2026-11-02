/**
 * Recorded deployments of Lykia's own contracts on Arc. Hand-maintained: fill in an address only
 * after the owner console has deployed it and the post-deploy checks passed. Empty means "not
 * deployed"; nothing in Lykia assumes a deployment that is not listed here.
 */
import type { Address } from "../contracts.js";
import type { ArcEnvironment } from "../networks.js";
import type { LykiaDeployable } from "./manifest.js";

export const LYKIA_DEPLOYMENTS: Readonly<Record<ArcEnvironment, Readonly<Partial<Record<LykiaDeployable, Address>>>>> = Object.freeze({
  // Deployed from 0x8c5281055b197443ff01dbbdfbf29fd63946ca1e on 2026-11-01 (blocks 29017527, 29017551);
  // LykiaOrders from the same wallet on 2026-11-02 (block 29120103).
  // Code verified against the artifacts by the owner console and the admin registry.
  mainnet: Object.freeze({
    LykiaAccountFactory: "0x810e8db89f4c4e8fa814ed3ed0d636d3416dd7f9",
    LykiaRouter: "0xc9c0ea4d22ddbef4504a634759fb78334efc5d18",
    LykiaOrders: "0xdcefebb3d449b7f8965c5f1ae3bba836f30ae6cc",
  }),
  testnet: Object.freeze({}),
});

export function deployedAddress(environment: ArcEnvironment, name: LykiaDeployable): Address | null {
  return LYKIA_DEPLOYMENTS[environment][name] ?? null;
}
