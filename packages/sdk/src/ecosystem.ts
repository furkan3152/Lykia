/** `@lykia/sdk/ecosystem`: what runs on Arc (venues, the ecosystem map, Scent and the Flock). */
import type { Address, ArcEnvironment } from "@lykia/core";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { VenueRow } from "@lykia/core/api/intents";
import type { ScentReport } from "@lykia/core/api/scent";
import { q, type LykiaTransport } from "./transport.js";

export function ecosystemApi(t: LykiaTransport) {
  return {
    map: (environment?: ArcEnvironment) => t.request<unknown>("GET", `/v1/ecosystem${q({ environment: t.env(environment) })}`),
    networks: () => t.request<unknown>("GET", "/v1/networks"),
    venues: (environment?: ArcEnvironment) => t.request<{ venues: VenueRow[] }>("GET", `/v1/venues${q({ environment: t.env(environment) })}`),
    flock: (address: Address, environment?: ArcEnvironment) => t.request<FlockSnapshot>("GET", `/v1/flock/${address}${q({ environment: t.env(environment) })}`),
    scent: (token: Address, environment?: ArcEnvironment) => t.request<ScentReport>("GET", `/v1/scent/${token}${q({ environment: t.env(environment) })}`),
  };
}

export type EcosystemApi = ReturnType<typeof ecosystemApi>;
export type { FlockSnapshot, ScentReport, VenueRow };
