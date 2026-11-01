/** Contract types: Scent token reports. */
import type { TokenTrust } from "../assets.js";
import type { Address } from "../contracts.js";
import type { ScentLevel } from "../fenceEvaluate.js";
import type { WolfKind } from "../lore.js";
import type { ArcEnvironment } from "../networks.js";

export interface ScentCheck {
  readonly id: "registry" | "bytecode" | "proxy" | "privileges" | "owner" | "simulation" | "blocklist" | "metadata";
  /** true = passed, false = red flag, null = could not run. */
  readonly ok: boolean | null;
  readonly detail: string;
}

export interface ScentReport {
  readonly token: Address;
  readonly environment: ArcEnvironment;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  readonly level: ScentLevel;
  readonly wolves: readonly WolfKind[];
  readonly checks: readonly ScentCheck[];
  readonly trust: TokenTrust;
  readonly at: string;
  /** True when served through the paid x402 route with the deeper checks. */
  readonly deep?: boolean;
}
