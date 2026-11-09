/**
 * Where USDC and Circle sit in Lykia: one USDC followed through a Lykia
 * step, and the Circle integrations that sit beside the router. The landing
 * draws this; README.md and docs/circle/README.md carry the same rows as a
 * table (a test keeps the three in step). Pure data: node tests import it.
 *
 * Every line here was checked against the code it names.
 */

/** Whose primitive it is: Circle's, Arc's, or Lykia's own. */
export type Provider = "circle" | "arc" | "lykia";

export interface Primitive {
  readonly name: string;
  readonly by: Provider;
}

export interface PathStop {
  readonly id: string;
  /** What happens to the USDC, in a few words. */
  readonly title: string;
  /** The Circle, Arc or Lykia primitives the stop uses, as its tags show them. */
  readonly primitives: readonly Primitive[];
  /** One short sentence. */
  readonly line: string;
  /** Optional stops are drawn dashed. */
  readonly optional?: boolean;
}

/** One USDC through a Lykia step, in order. */
export const USDC_PATH: readonly PathStop[] = [
  { id: "wallet", title: "USDC in your wallet", primitives: [{ name: "USDC", by: "circle" }], line: "Your wallet or your agent holds it. Lykia never holds keys." },
  { id: "fence", title: "The Fence checks it in USD", primitives: [{ name: "USD caps", by: "lykia" }], line: "Caps per step and per day, recipients, tokens. Beta: $1,000 a step, $5,000 a day." },
  { id: "simulate", title: "The route is simulated", primitives: [{ name: "eth_call", by: "arc" }], line: "Routes are scored on what you end up with after fee, gas and slippage; the winner runs on Arc first." },
  { id: "send", title: "One transaction, one signature", primitives: [{ name: "Multicall3From", by: "arc" }, { name: "Arc Memo", by: "arc" }, { name: "Gas in USDC", by: "arc" }], line: "Approve, act and a Memo with the Fence verdict go out together." },
  { id: "settle", title: "Settled, final", primitives: [{ name: "Deterministic finality", by: "arc" }], line: "Final when the block is included: no confirmations to wait for." },
  { id: "out", title: "Out to another chain", primitives: [{ name: "CCTP V2", by: "circle" }, { name: "Gateway", by: "circle" }], line: "Burned on Arc and minted on the destination, or held as one unified USDC balance.", optional: true },
];

export const PROVIDER_LABEL: Readonly<Record<Provider, string>> = { circle: "Circle", arc: "Arc", lykia: "Lykia" };

/** Where a product sits: in the step itself, beside it, or not a route at all (a reference or a payment rail). */
export type BesidePlace = "route" | "beside" | "not-route";

export interface BesideItem {
  readonly primitive: string;
  readonly by: Provider;
  readonly line: string;
  readonly place: BesidePlace;
}

/** The rest of Circle and Arc in Lykia, beside the router: EURC is a token routes convert to; none of the others is a route. */
export const BESIDE_ROUTER: readonly BesideItem[] = [
  { by: "circle", place: "route", primitive: "EURC", line: "Circle's euro stablecoin: USDC to EURC conversions route on Arc, checked against the FX band." },
  { by: "circle", place: "route", primitive: "Compliance Engine", line: "With a Circle key, a recipient it denies becomes a Fence deny. Unscreened is never read as approved." },
  { by: "circle", place: "beside", primitive: "Circle Wallets", line: "Optional, off by default: developer-controlled wallets, bound to the address that created them." },
  { by: "circle", place: "beside", primitive: "Agent Wallet policy", line: "A Fence exports as a Circle spending policy; the owner applies it with the Circle CLI." },
  { by: "circle", place: "not-route", primitive: "StableFX", line: "RFQ endpoints for USDC and EURC, with Circle StableFX access. A reference quote, not a route." },
  { by: "circle", place: "not-route", primitive: "USYC Teller", line: "Subscribe and redeem for wallets Circle has entitled; Lykia checks the entitlement first." },
  { by: "circle", place: "not-route", primitive: "x402 facilitator", line: "Settles Lykia's paid API routes in USDC through Circle's facilitator." },
  { by: "circle", place: "not-route", primitive: "Agent Marketplace", line: "Agents find x402 services and pay them in USDC, inside their Fence caps." },
  { by: "arc", place: "beside", primitive: "ERC-8004", line: "Agent identities (Tags) in the ERC-8004 registries on Arc, each pinning the hash of its Fence." },
];

/** The primitives a reader must find in README.md and docs/circle/README.md. */
export const PRIMITIVES: readonly string[] = [...USDC_PATH.flatMap((stop) => stop.primitives.map((p) => p.name)), ...BESIDE_ROUTER.map((b) => b.primitive)];
