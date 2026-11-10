/**
 * The capability map for a network, built from the code that executes: the
 * engine's executable venues, the Gateway chain table and the routable
 * adapter manifests. Nothing here is written by hand; core's
 * buildCapabilityMap shapes it (core/capabilities.ts). With a context, the
 * map's limits and fees are this deployment's own (its fee, its beta cap)
 * and its flags say what is switched off here.
 */
import { buildCapabilityMap, type ArcEnvironment, type CapabilityMap, type StepKind } from "@lykia/core";
import type { AppContext } from "../context.js";
import { GATEWAY_CHAINS } from "../circle/chains.js";
import { EXECUTABLE_VENUES } from "../engine/adapters.js";
import { routableManifests } from "../integrations/registry.js";
import { flags } from "../platform/admin.js";

/** What this deployment sets: its fee and its mainnet beta cap, so the map quotes the figures that are enforced. */
function deployment(ctx: AppContext): { feeBps: number; beta: { perStepUsd: string; perDayUsd: string } | null } {
  return { feeBps: ctx.config.fee.bps, beta: ctx.config.beta };
}

/** The map from the static tables only (no store reads): what the deterministic reader and the evals use. */
export function capabilityMap(environment: ArcEnvironment, ctx?: AppContext): CapabilityMap {
  return buildCapabilityMap({ environment, executable: EXECUTABLE_VENUES[environment], gatewayChains: GATEWAY_CHAINS.map((c) => ({ key: c.key, name: c.name })), ...(ctx ? deployment(ctx) : {}) });
}

/** The map with routable adapter manifests and the deployment's flags merged in. */
export async function liveCapabilityMap(ctx: AppContext, environment: ArcEnvironment): Promise<CapabilityMap> {
  const manifests = await routableManifests(ctx, environment).catch(() => []);
  const deploymentFlags = await flags(ctx).catch(() => null);
  return buildCapabilityMap({
    environment,
    executable: EXECUTABLE_VENUES[environment],
    gatewayChains: GATEWAY_CHAINS.map((c) => ({ key: c.key, name: c.name })),
    manifests: manifests.map((m) => ({ protocol: m.protocol.id, name: m.protocol.name, verbs: [...new Set(m.capabilities.map((c) => c.verb as StepKind))] })),
    ...deployment(ctx),
    ...(deploymentFlags ? { flags: deploymentFlags } : {}),
  });
}
