import { useQuery } from "@tanstack/react-query";

import { apiGet } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";

export function useCircleStatus() {
  const environment = useEnvironment();
  return useQuery({ queryKey: ["circle-status", environment], retry: false, queryFn: ({ signal }) => apiGet<unknown>("/v1/circle/status", { query: { environment }, signal }) });
}

