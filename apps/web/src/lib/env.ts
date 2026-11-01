import { resolveApiBase } from "./config";

const api = resolveApiBase(import.meta.env.VITE_API_URL);
if (api.warning && import.meta.env.DEV) console.warn(`[lykia] ${api.warning}`);

/** Origin of the Lykia API (VITE_API_URL, default http://localhost:3002). */
export const API_BASE = api.base;
