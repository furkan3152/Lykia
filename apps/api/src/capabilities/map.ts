/**
 * The capability map for a network, built from the code that executes: the
 * engine's executable venues, the Gateway chain table and the routable
 * adapter manifests. Nothing here is written by hand; core's
 * buildCapabilityMap shapes it (core/capabilities.ts).
 */
import { buildCapabilityMap, type ArcEnvironment, type CapabilityMap, type StepKind } from "@lykia/core";
import type { AppContext } from "../context.js";
import { GATEWAY_CHAINS } from "../circle/chains.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { routableManifests } from "../integrations/registry.js";

/** The map from the static tables only (no store reads): what the deterministic reader and the evals use. */
export function capabilityMap(environment: ArcEnvironment): CapabilityMap {
  return buildCapabilityMap({ environment, executable: EXECUTABLE_VENUES[environment], gatewayChains: GATEWAY_CHAINS.map((c) => ({ key: c.key, name: c.name })) });
}

/** The map with routable adapter manifests merged in (they join the route search at runtime). */
export async function liveCapabilityMap(ctx: AppContext, environment: ArcEnvironment): Promise<CapabilityMap> {
  const manifests = await routableManifests(ctx, environment).catch(() => []);
  return buildCapabilityMap({
    environment,
    executable: EXECUTABLE_VENUES[environment],
    gatewayChains: GATEWAY_CHAINS.map((c) => ({ key: c.key, name: c.name })),
    manifests: manifests.map((m) => ({ protocol: m.protocol.id, name: m.protocol.name, verbs: [...new Set(m.capabilities.map((c) => c.verb as StepKind))] })),
  });
}
