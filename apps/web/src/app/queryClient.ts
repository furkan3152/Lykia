import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "../lib/apiErrors";

/**
 * One react-query client for the whole app (site routes and the deck share
 * it; the wallet stack reuses it). Retries only failures worth retrying.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => failureCount < 2 && (!(error instanceof ApiError) || error.retryable),
    },
  },
});
