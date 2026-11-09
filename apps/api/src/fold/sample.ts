/**
 * Reads for the Fold and for Lyko: the live chain for a real address, the
 * core sample fixture for the sample address. Signed out, the web shows the
 * same fixture, so Lyko on watch, the Fold bar, the Flock tab and the Stress
 * test all show one net worth.
 */
import { isSampleOwner, samplePositions, sampleSnapshot, type Address, type ArcEnvironment, type PositionsResponse } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { AppContext } from "../context.js";
import { readPositions } from "../positions/service.js";
import { services } from "../services.js";

export async function foldPositions(ctx: AppContext, environment: ArcEnvironment, owner: Address, options: { readonly personal: boolean }): Promise<PositionsResponse> {
  if (isSampleOwner(owner)) return samplePositions(ctx.clock.now(), environment);
  return readPositions(ctx, environment, owner, options);
}

export async function foldSnapshot(ctx: AppContext, environment: ArcEnvironment, owner: Address): Promise<FlockSnapshot> {
  if (isSampleOwner(owner)) return sampleSnapshot(ctx.clock.now(), environment);
  return services(ctx).flock.snapshot(environment, owner);
}
