/**
 * Circle execution providers for the aggregator (engine/providers.ts).
 *
 * Each provider is a Circle-native way to carry out an action the engine
 * has already planned and the Fence has already judged. Lykia does not
 * duplicate what Circle runs: where Circle exposes a server-side API or a
 * contract (CCTP V2 with the Forwarding Service, Gateway, StableFX,
 * Compliance Engine, developer-controlled wallets, Gas Station), Lykia
 * calls it; where Circle ships only a client SDK (App Kit send / swap /
 * bridge / earn, Onramp Kit), the provider is listed with status
 * "client-sdk" and never pretends to execute.
 *
 * Every quote and build carries `poweredBy: "Circle"` and the aggregator
 * shows it as "Powered by Circle". Nothing here signs or broadcasts:
 * on-chain paths return unsigned transactions (simulated and security-checked
 * by the aggregator), off-chain paths return a handle the owner finishes.
 */
import { randomBytes } from "node:crypto";
import { findCctpDestination, toBaseUnitsBig, type ActionAmount, type Address, type PlanAction } from "@lykia/core";
import type { AppContext } from "../context.js";
import { registerProvider, type ExecutionProvider, type ProviderActionKind, type ProviderBuild, type ProviderQuote, type ProviderRequest } from "../engine/providers.js";
import { typedCollection } from "../platform/typed.js";
import { CCTP_STANDARD, cctpFees, cctpProtocolFee, forwardedBridge } from "./cctp.js";
import { gatewayChain } from "./chains.js";
import { draftGatewayTransferEstimated, gatewayMaxFee } from "./gateway.js";
import { stablefxQuote } from "./stablefx.js";

export type CircleCapabilityStatus = "live" | "needs-key" | "client-sdk" | "console-only" | "not-yet-available";

/** One Circle product as Lykia uses it: the execution providers plus the controls around them. */
export interface CircleCapability {
  readonly id: string;
  readonly product: string;
  readonly role: "executor" | "signer" | "sponsor" | "screening" | "settlement" | "discovery";
  readonly kinds: readonly ProviderActionKind[];
  readonly status: CircleCapabilityStatus;
  readonly needs?: readonly string[];
  readonly how: string;
  readonly docs: string;
  readonly poweredBy: "Circle";
}

function bridgeAction(request: ProviderRequest): Extract<PlanAction, { verb: "bridge" }> | null {
  const a = request.actions.find((x) => x.verb === "bridge");
  return a && a.verb === "bridge" ? a : null;
}

function exactUnits(amount: ActionAmount, decimals: number): bigint | null {
  if ("exact" in amount) {
    try {
      return toBaseUnitsBig(amount.exact, decimals);
    } catch {
      return null;
    }
  }
  return null;
}

const usdc6 = (units: bigint): string => {
  const s = units.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/u, "") || "0";
};

/* ------------------------------------------------------- CCTP V2 + forwarding */

export const circleCctpProvider: ExecutionProvider = {
  id: "circle-cctp",
  label: "Circle CCTP V2 (Forwarding Service)",
  poweredBy: "Circle",
  kinds: ["bridge"],
  environments: ["mainnet", "testnet"],
  available: () => true,
  async quote(ctx, request): Promise<ProviderQuote | null> {
    const action = bridgeAction(request);
    if (!action || action.token.toUpperCase() !== "USDC") return null;
    const dest = findCctpDestination(action.destination);
    const units = exactUnits(action.amount, 6);
    if (!dest || dest.vm !== "evm" || !dest.forwarding || units === null) return null;
    const fees = await cctpFees(ctx.fetch, request.environment, dest.domain, true);
    // Arc is the source: Fast Transfer is N/A (Arc attests in ~0.5 s), so the standard row is the one that applies.
    const standard = fees.find((f) => f.finalityThreshold === CCTP_STANDARD) ?? fees[0];
    if (!standard) return null;
    const protocol = cctpProtocolFee(units, standard.minimumFeeBps);
    const forward = standard.forwardFee ? BigInt(standard.forwardFee.med) : 0n;
    return {
      provider: "circle-cctp",
      label: `CCTP V2 to ${dest.name} (Forwarding Service)`,
      poweredBy: "Circle",
      buy: [{ symbol: "USDC", units: units.toString(), minimumUnits: units.toString() }],
      feeUsd: usdc6(protocol + forward),
      gasUsdc: null,
      expiresAt: null,
      notes: ["Burned on Arc, minted natively on the destination; Circle's Forwarding Service pays the destination mint, so the recipient needs no gas there."],
    };
  },
  async build(ctx, request): Promise<ProviderBuild | null> {
    const action = bridgeAction(request);
    if (!action || action.token.toUpperCase() !== "USDC") return null;
    const dest = findCctpDestination(action.destination);
    const units = exactUnits(action.amount, 6);
    if (!dest || units === null) return null;
    const recipient = (action.recipient && /^0x[0-9a-fA-F]{40}$/u.test(action.recipient) ? action.recipient : request.taker) as Address;
    const built = await forwardedBridge(ctx.fetch, { environment: request.environment, owner: request.taker, recipient, destination: dest.key, amountUnits: units, fast: false });
    return { provider: "circle-cctp", poweredBy: "Circle", transactions: built.transactions, notes: [`Burn ${usdc6(BigInt(built.burn))} USDC (max fee ${usdc6(BigInt(built.maxFee))}); the recipient receives the amount asked.`] };
  },
};

/* --------------------------------------------------------------- Gateway */

export const circleGatewayProvider: ExecutionProvider = {
  id: "circle-gateway",
  label: "Circle Gateway (unified USDC balance)",
  poweredBy: "Circle",
  kinds: ["bridge"],
  environments: ["mainnet", "testnet"],
  available: () => true,
  async quote(_ctx, request): Promise<ProviderQuote | null> {
    const action = bridgeAction(request);
    if (!action || action.token.toUpperCase() !== "USDC") return null;
    const dest = gatewayChain(action.destination);
    const units = exactUnits(action.amount, 6);
    if (!dest || units === null) return null;
    const maxFee = gatewayMaxFee(units, dest.key !== "arc", "0.0035");
    return {
      provider: "circle-gateway",
      label: `Gateway transfer to ${dest.name}`,
      poweredBy: "Circle",
      buy: [{ symbol: "USDC", units: units.toString(), minimumUnits: units.toString() }],
      feeUsd: usdc6(maxFee),
      gasUsdc: null,
      expiresAt: null,
      notes: ["Spends the depositor's Gateway balance: sign one burn intent, Gateway attests in under a second, then mint on the destination.", "Needs a funded Gateway balance (deposits are a Lykia 'unify' step)."],
    };
  },
  async build(ctx, request): Promise<ProviderBuild | null> {
    const action = bridgeAction(request);
    if (!action || action.token.toUpperCase() !== "USDC") return null;
    const units = exactUnits(action.amount, 6);
    if (units === null || !gatewayChain(action.destination)) return null;
    const recipient = action.recipient && /^0x[0-9a-fA-F]{40}$/u.test(action.recipient) ? (action.recipient as Address) : undefined;
    const draft = await draftGatewayTransferEstimated(ctx.fetch, { environment: request.environment, depositor: request.taker, ...(recipient ? { recipient } : {}), destination: action.destination, valueUnits: units });
    const transferId = `gwd_${randomBytes(9).toString("base64url")}`;
    // Same store and shape as POST /v1/circle/gateway/transfer, so /transfer/attest finishes it.
    await typedCollection<{ environment: "mainnet" | "testnet"; destination: string; burnIntent: unknown; owner: string }>(ctx, "gateway_drafts").put(transferId, { environment: request.environment, destination: action.destination, burnIntent: draft.burnIntents[0], owner: request.taker.toLowerCase() }, { ttlMs: 30 * 60_000 });
    return { provider: "circle-gateway", poweredBy: "Circle", execution: { id: transferId, status: "awaiting-signature", url: "/v1/circle/gateway/transfer/attest" }, notes: ["Sign the burn intent (GET it again with POST /v1/circle/gateway/transfer/draft) and POST the signature with this transferId to /v1/circle/gateway/transfer/attest for the unsigned gatewayMint."] };
  },
};

/* --------------------------------------------------------------- StableFX */

export const circleStablefxProvider: ExecutionProvider = {
  id: "circle-stablefx",
  label: "Circle StableFX (USDC / EURC RFQ)",
  poweredBy: "Circle",
  kinds: ["fx", "swap"],
  environments: ["mainnet", "testnet"],
  available: (ctx) => ctx.config.stablefxApiKey !== null,
  async quote(ctx, request): Promise<ProviderQuote | null> {
    const a = request.actions.find((x) => x.verb === "fx" || x.verb === "swap");
    if (!a || (a.verb !== "fx" && a.verb !== "swap") || !ctx.config.stablefxApiKey) return null;
    const pair = [a.from.toUpperCase(), a.to.toUpperCase()];
    if (!(pair.includes("USDC") && pair.includes("EURC")) || pair[0] === pair[1]) return null;
    const amount = "exact" in a.amount ? a.amount.exact : null;
    if (!amount) return null;
    const q = (await stablefxQuote(ctx.fetch, ctx.config.stablefxApiKey, { from: pair[0] as "USDC" | "EURC", to: pair[1] as "USDC" | "EURC", amount, side: "from", type: "reference", tenor: "instant", environment: request.environment })) as { to?: { amount?: string }; expiresAt?: string; fee?: { amount?: string } };
    const out = q.to?.amount;
    if (!out) return null;
    return {
      provider: "circle-stablefx",
      label: "StableFX reference quote",
      poweredBy: "Circle",
      buy: [{ symbol: pair[1]!, units: toBaseUnitsBig(out, 6).toString() }],
      feeUsd: q.fee?.amount ?? null,
      gasUsdc: null,
      expiresAt: q.expiresAt ?? null,
      notes: ["Reference rate. A tradable quote is signed by the taker (Permit2) through /v1/circle/stablefx/quote and /trade, funded through /funding/presign and /fund, and settles in FxEscrow on Arc."],
    };
  },
};

/* ------------------------------------------------- Circle wallets as signer */

export const circleWalletsProvider: ExecutionProvider = {
  id: "circle-wallets",
  label: "Circle developer-controlled wallet (signer)",
  poweredBy: "Circle",
  kinds: ["transfer", "swap", "fx", "deposit", "withdraw", "supply", "repay", "bridge"],
  environments: ["mainnet", "testnet"],
  available: (ctx) => ctx.config.circle.apiKey !== null && ctx.config.circle.entitySecret !== null,
  async quote(): Promise<ProviderQuote | null> {
    return {
      provider: "circle-wallets",
      label: "Sign with a Circle wallet",
      poweredBy: "Circle",
      buy: [],
      feeUsd: null,
      gasUsdc: null,
      expiresAt: null,
      notes: ["The same Fence-checked steps, signed by a Circle SCA wallet your server controls; a Gas Station policy in the Circle Console can sponsor its gas.", "Lykia never submits on the wallet's behalf: your server calls Circle's contract-execution API with its own entity secret."],
    };
  },
};

/* --------------------------------------------------------- App Kit (client) */

/** App Kit runs in the integrator's app (@circle-fin/app-kit); Circle publishes no server endpoint, so this never executes here. */
export const circleAppKitProvider: ExecutionProvider = {
  id: "circle-app-kit",
  label: "Circle App Kit (send / swap / bridge / earn)",
  poweredBy: "Circle",
  kinds: ["transfer", "swap", "bridge", "deposit"],
  environments: ["mainnet", "testnet"],
  available: () => false,
};

/** Every Circle execution provider, in the aggregator's order of preference. */
export const circleProviders: readonly ExecutionProvider[] = [circleCctpProvider, circleGatewayProvider, circleStablefxProvider, circleWalletsProvider, circleAppKitProvider];

let registered = false;
/** Registers the Circle providers with the aggregator once (idempotent). */
export function registerCircleProviders(): void {
  if (registered) return;
  for (const p of circleProviders) registerProvider(p);
  registered = true;
}

/** What each Circle product does inside Lykia, with honest status, for GET /v1/circle/providers. */
export function circleCapabilities(ctx: AppContext): CircleCapability[] {
  const key = ctx.config.circle.apiKey !== null;
  const wallets = key && ctx.config.circle.entitySecret !== null;
  const fx = ctx.config.stablefxApiKey !== null;
  const c = (x: Omit<CircleCapability, "poweredBy">): CircleCapability => ({ ...x, poweredBy: "Circle" });
  return [
    c({ id: "circle-cctp", product: "CCTP V2 + Forwarding Service", role: "executor", kinds: ["bridge"], status: "live", how: "approve + depositForBurnWithHook (standard threshold: Fast Transfer is N/A from Arc), fees from Circle's Iris API; Circle's Forwarding Service mints on the destination. The intent engine's bridge step uses the same hook.", docs: "https://developers.circle.com/cctp/concepts/forwarding-service" }),
    c({ id: "circle-gateway", product: "Gateway", role: "executor", kinds: ["bridge"], status: "live", how: "maxFee from Gateway's /v1/estimate, burn intent (EIP-712) signed by the depositor, attestation from Gateway's API, then an unsigned gatewayMint or Circle's Forwarding Service.", docs: "https://developers.circle.com/gateway" }),
    c({ id: "circle-usyc", product: "USYC (Teller)", role: "executor", kinds: ["deposit", "withdraw"], status: "live", how: "Entitled wallets only: Entitlements.canCall is read first, then approve + Teller.deposit or Teller.redeem with the Teller's preview, judged by the Fence.", docs: "https://developers.circle.com/tokenized/usyc/subscribe-and-redeem" }),
    c({ id: "circle-stablefx", product: "StableFX", role: "executor", kinds: ["fx"], status: fx ? "live" : "needs-key", ...(fx ? {} : { needs: ["CIRCLE_API_KEY with StableFX access"] }), how: "RFQ quote, taker signs Permit2, trade settles in FxEscrow on Arc.", docs: "https://developers.circle.com/stablefx" }),
    c({ id: "circle-wallets", product: "Developer-controlled wallets", role: "signer", kinds: ["transfer", "swap", "fx", "deposit", "withdraw", "supply", "repay", "bridge"], status: wallets ? "live" : "needs-key", ...(wallets ? {} : { needs: ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"] }), how: "SCA agent wallets on Arc as the signer of Fence-checked steps (default agent path).", docs: "https://developers.circle.com/wallets/dev-controlled" }),
    c({ id: "circle-agent-wallets", product: "Agent Wallets (Agent Stack)", role: "signer", kinds: ["transfer"], status: "console-only", how: "Circle CLI wallets with native spending policies; POST /v1/circle/policies/compile turns a Fence into that policy.", docs: "https://developers.circle.com/agent-stack/agent-wallets" }),
    c({ id: "circle-gas-station", product: "Gas Station", role: "sponsor", kinds: [], status: wallets ? "live" : "needs-key", ...(wallets ? {} : { needs: ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"] }), how: "Sponsors gas for SCA wallets; policies live in the Circle Console.", docs: "https://developers.circle.com/wallets/gas-station" }),
    c({ id: "circle-compliance", product: "Compliance Engine", role: "screening", kinds: [], status: key ? "live" : "needs-key", ...(key ? {} : { needs: ["CIRCLE_API_KEY"] }), how: "External recipients are screened before planning; DENIED becomes a Fence deny, an unscreened recipient is reported (never read as approved). Needs Compliance Engine access on the key.", docs: "https://developers.circle.com/wallets/compliance-engine" }),
    c({ id: "circle-x402-facilitator", product: "x402 Facilitator", role: "settlement", kinds: [], status: "live", how: "Settles Lykia's paid routes on Arc; seller proofs signed by a Circle wallet when CIRCLE_X402_SELLER_WALLET_ID is set.", docs: "https://developers.circle.com/facilitator-service" }),
    c({ id: "circle-agent-marketplace", product: "Agent Marketplace Discovery API", role: "discovery", kinds: [], status: "live", how: "Agents find x402 services and pay them inside the Fence (/v1/circle/marketplace/*).", docs: "https://developers.circle.com/agent-stack/agent-marketplace/discovery-api" }),
    c({ id: "circle-app-kit", product: "App Kit (send / swap / bridge / earn)", role: "executor", kinds: ["transfer", "swap", "bridge", "deposit"], status: "client-sdk", how: "Runs in your front end (@circle-fin/app-kit). Use it beside Lykia's Fence preflight: check the plan with POST /v1/fence/evaluate, then call kit.send/swap/bridge.", docs: "https://docs.arc.io/app-kit" }),
    c({ id: "circle-onramp-kit", product: "Onramp Kit", role: "executor", kinds: [], status: "client-sdk", how: "Fiat on-ramp in the integrator's app; Lykia does not touch fiat.", docs: "https://docs.arc.io/app-kit" }),
  ];
}
