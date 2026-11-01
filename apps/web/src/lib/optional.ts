/**
 * Endpoints that are still being built answer 404 / NOT_FOUND / 501. Pages
 * treat those as "coming soon" instead of an error, and a missing key
 * (503 with a "needs key" code) as "needs key".
 */
import { ApiError } from "./apiErrors";

export type Availability = "ok" | "soon" | "needs-key" | "auth" | "error";

export function availabilityOf(error: unknown): Availability {
  if (!(error instanceof ApiError)) return "error";
  if (error.status === 404 || error.status === 501 || error.code === "NOT_FOUND" || error.code === "NOT_IMPLEMENTED") return "soon";
  if (error.status === 401 || error.status === 403 || error.code === "UNAUTHORIZED") return "auth";
  if (/KEY|CREDENTIAL|CONFIG/u.test(error.code)) return "needs-key";
  return "error";
}
