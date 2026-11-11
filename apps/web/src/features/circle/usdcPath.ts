/**
 * Where USDC and Circle sit in Lykia: one USDC followed through a Lykia
 * step, and the Circle integrations that sit beside the router. The landing
 * draws this; README.md and docs/circle/README.md carry the same rows as a
 * table (a test keeps the three in step). Pure data: node tests import it.
 *
 * Every line here was checked against the code it names.
 */
import { t } from "../../i18n";

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
  { id: "wallet", title: t("circle.usdcPath.usdcInYourWallet"), primitives: [{ name: "USDC", by: "circle" }], line: t("circle.usdcPath.yourWalletOrYourAgentHolds") },
  { id: "fence", title: t("circle.usdcPath.theFenceChecksItInUsd"), primitives: [{ name: t("circle.usdcPath.usdCaps"), by: "lykia" }], line: t("circle.usdcPath.capsPerStepAndPerDay") },
  { id: "simulate", title: t("circle.usdcPath.theRouteIsSimulated"), primitives: [{ name: "eth_call", by: "arc" }], line: t("circle.usdcPath.routesAreScoredOnWhatYou") },
  { id: "send", title: t("circle.usdcPath.oneTransactionOneSignature"), primitives: [{ name: "Multicall3From", by: "arc" }, { name: t("circle.usdcPath.arcMemo"), by: "arc" }, { name: t("circle.usdcPath.gasInUsdc"), by: "arc" }], line: t("circle.usdcPath.approveActAndAMemoWith") },
  { id: "settle", title: t("circle.usdcPath.settledFinal"), primitives: [{ name: t("circle.usdcPath.deterministicFinality"), by: "arc" }], line: t("circle.usdcPath.finalWhenTheBlockIsIncluded") },
  { id: "out", title: t("circle.usdcPath.outToAnotherChain"), primitives: [{ name: "CCTP V2", by: "circle" }, { name: "Gateway", by: "circle" }], line: t("circle.usdcPath.burnedOnArcAndMintedOn"), optional: true },
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
  { by: "circle", place: "route", primitive: "EURC", line: t("circle.usdcPath.circleSEuroStablecoinUsdcTo") },
  { by: "circle", place: "route", primitive: t("circle.usdcPath.complianceEngine"), line: t("circle.usdcPath.withACircleKeyARecipient") },
  { by: "circle", place: "beside", primitive: t("circle.usdcPath.circleWallets"), line: t("circle.usdcPath.optionalOffByDefaultDeveloperControlled") },
  { by: "circle", place: "beside", primitive: t("circle.usdcPath.agentWalletPolicy"), line: t("circle.usdcPath.aFenceExportsAsACircle") },
  { by: "circle", place: "not-route", primitive: "StableFX", line: t("circle.usdcPath.rfqEndpointsForUsdcAndEurc") },
  { by: "circle", place: "not-route", primitive: t("circle.usdcPath.usycTeller"), line: t("circle.usdcPath.subscribeAndRedeemForWalletsCircle") },
  { by: "circle", place: "not-route", primitive: t("circle.usdcPath.x402Facilitator"), line: t("circle.usdcPath.settlesLykiaSPaidApiRoutes") },
  { by: "circle", place: "not-route", primitive: t("circle.usdcPath.agentMarketplace"), line: t("circle.usdcPath.agentsFindX402ServicesAndPay") },
  { by: "arc", place: "beside", primitive: "ERC-8004", line: t("circle.usdcPath.agentIdentitiesTagsInTheErc") },
];

/** The primitives a reader must find in README.md and docs/circle/README.md. */
export const PRIMITIVES: readonly string[] = [...USDC_PATH.flatMap((stop) => stop.primitives.map((p) => p.name)), ...BESIDE_ROUTER.map((b) => b.primitive)];
