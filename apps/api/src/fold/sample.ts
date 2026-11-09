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

/**
 * `fixture: false` reads the live chain even for the sample address. Ask Lyko plans against
 * live balances, so every read in an Ask turn uses the chain; the fixture is for the Fold only.
 */
export async function foldPositions(ctx: AppContext, environment: ArcEnvironment, owner: Address, options: { readonly personal: boolean; readonly fixture?: boolean }): Promise<PositionsResponse> {
  if (isSampleOwner(owner) && options.fixture !== false) return samplePositions(ctx.clock.now(), environment);
  return readPositions(ctx, environment, owner, options);
}

export async function foldSnapshot(ctx: AppContext, environment: ArcEnvironment, owner: Address, options: { readonly fixture?: boolean } = {}): Promise<FlockSnapshot> {
  if (isSampleOwner(owner) && options.fixture !== false) return sampleSnapshot(ctx.clock.now(), environment);
  return services(ctx).flock.snapshot(environment, owner);
}
