/**
 * The Fold's reads, with one explicit switch for the sample fixture.
 *
 * The fixture (core sampleFold) is what the Fold shows when nobody is signed
 * in, so the Fold bar, the Flock tab, the Stress test and Lyko on watch all
 * show one net worth. It is used only when the caller says the read is for
 * the Fold (`fixture: "fold"`) and the owner is the sample address. Ask Lyko
 * never passes it: an Ask turn always reads the chain, also for the sample
 * address, and labels the answer as a sample.
 */
import { isSampleOwner, samplePositions, sampleSnapshot, type Address, type ArcEnvironment, type PositionsResponse } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { AppContext } from "../context.js";
import { readPositions } from "../positions/service.js";
import { services } from "../services.js";

/** "fold": the Fold's own surfaces, which show the fixture to a signed-out visitor. "chain": always read Arc. */
export type FixtureScope = "fold" | "chain";

/** True when this read may be answered from the fixture: a Fold read for the sample address, and nothing else. */
export function usesFixture(owner: string | null | undefined, scope: FixtureScope): boolean {
  return scope === "fold" && isSampleOwner(owner);
}

export async function foldPositions(ctx: AppContext, environment: ArcEnvironment, owner: Address, options: { readonly personal: boolean; readonly fixture: FixtureScope }): Promise<PositionsResponse> {
  if (usesFixture(owner, options.fixture)) return samplePositions(ctx.clock.now(), environment);
  return readPositions(ctx, environment, owner, options);
}

export async function foldSnapshot(ctx: AppContext, environment: ArcEnvironment, owner: Address, options: { readonly fixture: FixtureScope }): Promise<FlockSnapshot> {
  if (usesFixture(owner, options.fixture)) return sampleSnapshot(ctx.clock.now(), environment);
  return services(ctx).flock.snapshot(environment, owner);
}
