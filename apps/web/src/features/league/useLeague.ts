/** The League from the API: GET /v1/league and GET /v1/league/:slug. */
import type { LeagueCity } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../lib/api";

export function useLeague() {
  return useQuery({ queryKey: ["league"], staleTime: 30_000, retry: 1, queryFn: ({ signal }) => apiGet<{ cities: LeagueCity[] }>("/v1/league", { signal, timeoutMs: 15_000 }) });
}

export function useCity(slug: string | undefined) {
  return useQuery({ queryKey: ["league", slug], enabled: Boolean(slug), staleTime: 30_000, retry: 1, queryFn: ({ signal }) => apiGet<LeagueCity>(`/v1/league/${slug}`, { signal, timeoutMs: 15_000 }) });
}
