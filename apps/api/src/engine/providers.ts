/**
 * Execution providers: the pluggable side of the aggregator's quote -> build
 * pipeline.
 *
 * Lykia's own engine (the planner and router over every executable Arc
 * venue) is always there. A provider adds another way to execute the same
 * action, for example Circle-native paths: Circle App Kit send / swap /
 * bridge / earn, Circle Gateway, CCTP, StableFX, or Circle developer-
 * controlled and Agent Wallets as the signer. Providers are first-class:
 * their quotes are listed beside the engine's (with `poweredBy: "Circle"`
 * shown as "Powered by Circle"), and a build may name one with
 * `provider: "<id>"`.
 *
 * The rules do not change for a provider. The aggregator plans the action
 * first, so the Fence (beta caps included) judges it before a provider is
 * asked; a provider build that returns transactions is simulated and run
 * through the security layer like any other build (fail closed). A provider
 * that executes off chain (a Circle wallet that signs) returns an
 * `execution` handle instead, and never receives anything the Fence denied.
 *
 * Adding one is additive: export it from its own module and register it,
 *
 *   import { registerProvider } from "../engine/providers.js";
 *   registerProvider(circleAppKitProvider);
 *
 * or append it to EXTRA_PROVIDERS below. Nothing here signs.
 */
import type { Address, ArcEnvironment, IntentGraph, PlanAction, UnsignedTransaction } from "@lykia/core";
import type { AppContext } from "../context.js";

export type ProviderActionKind = "transfer" | "swap" | "fx" | "bridge" | "deposit" | "withdraw" | "supply" | "borrow" | "repay" | "batch";

/** What a provider is asked: the normalized action plus the Fence-checked plan the engine made for it. */
export interface ProviderRequest {
  readonly kind: ProviderActionKind;
  readonly environment: ArcEnvironment;
  readonly taker: Address;
  readonly actions: readonly PlanAction[];
  /** The engine's dry-run plan with the Fence verdict (never a deny when a build is asked). */
  readonly graph: IntentGraph;
  readonly slippageBps?: number;
}

export interface ProviderQuote {
  readonly provider: string;
  readonly label: string;
  readonly poweredBy?: "Circle";
  /** What arrives, per token: base units and the guaranteed minimum. */
  readonly buy: readonly { readonly symbol: string; readonly units: string; readonly minimumUnits?: string }[];
  /** Fees the provider charges besides Lykia's, in USD. */
  readonly feeUsd: string | null;
  readonly gasUsdc: string | null;
  readonly expiresAt: string | null;
  readonly notes: readonly string[];
}

export interface ProviderBuild {
  readonly provider: string;
  readonly poweredBy?: "Circle";
  /** On-chain path: what the taker signs, in order. Simulated and security-checked by the aggregator. */
  readonly transactions?: readonly UnsignedTransaction[];
  /** Off-chain path (a Circle wallet executes): an opaque handle the integrator follows. */
  readonly execution?: { readonly id: string; readonly status: string; readonly url?: string };
  readonly notes: readonly string[];
}

export interface ExecutionProvider {
  /** Unique, kebab-case: "circle-app-kit", "circle-gateway", "circle-wallets". */
  readonly id: string;
  readonly label: string;
  readonly poweredBy?: "Circle";
  readonly kinds: readonly ProviderActionKind[];
  readonly environments: readonly ArcEnvironment[];
  /** False when the provider is not configured (missing credentials); it is then skipped quietly. */
  available(ctx: AppContext): boolean;
  quote?(ctx: AppContext, request: ProviderRequest): Promise<ProviderQuote | null>;
  build?(ctx: AppContext, request: ProviderRequest, options: { readonly account: "eoa" | "smart" }): Promise<ProviderBuild | null>;
}

/** Providers registered by other modules at import time (Circle adapters append here). */
export const EXTRA_PROVIDERS: ExecutionProvider[] = [];

export function registerProvider(provider: ExecutionProvider): void {
  const at = EXTRA_PROVIDERS.findIndex((p) => p.id === provider.id);
  if (at >= 0) EXTRA_PROVIDERS.splice(at, 1, provider);
  else EXTRA_PROVIDERS.push(provider);
}

/** Providers that can serve `kind` on `environment` right now. */
function providersFor(ctx: AppContext, kind: ProviderActionKind, environment: ArcEnvironment): ExecutionProvider[] {
  return EXTRA_PROVIDERS.filter((p) => p.kinds.includes(kind) && p.environments.includes(environment) && safeAvailable(p, ctx));
}

function safeAvailable(p: ExecutionProvider, ctx: AppContext): boolean {
  try {
    return p.available(ctx);
  } catch {
    return false;
  }
}

/** Every provider's quote, each bounded in time; a failing provider is reported, never fatal. */
export async function providerQuotes(ctx: AppContext, request: ProviderRequest, timeoutMs = 8_000): Promise<{ quotes: ProviderQuote[]; errors: { provider: string; message: string }[] }> {
  const quotes: ProviderQuote[] = [];
  const errors: { provider: string; message: string }[] = [];
  await Promise.all(
    providersFor(ctx, request.kind, request.environment)
      .filter((p) => p.quote)
      .map(async (p) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const q = await Promise.race([p.quote!(ctx, request), new Promise<null>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)))]);
          if (q) quotes.push({ ...q, provider: p.id, label: q.label || p.label, ...(p.poweredBy ? { poweredBy: p.poweredBy } : {}) });
        } catch (error) {
          errors.push({ provider: p.id, message: error instanceof Error ? error.message : String(error) });
        } finally {
          if (timer) clearTimeout(timer);
        }
      }),
  );
  return { quotes, errors };
}

/** The display line for a provider's origin. */
export function poweredByLabel(p: { readonly poweredBy?: "Circle" }): string | null {
  return p.poweredBy === "Circle" ? "Powered by Circle" : null;
}
