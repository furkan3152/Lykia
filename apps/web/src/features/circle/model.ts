/** Circle products as Lykia shows them (pure). */
import { t } from "../../i18n";
export type CircleStatus = "live" | "keyless" | "needs-key" | "unavailable" | "unknown";

export interface CircleProduct {
  readonly id: string;
  readonly name: string;
  readonly status: CircleStatus;
  readonly docs?: string;
  readonly note?: string;
}

/** What we show before /v1/circle/status answers (everything "unknown", with Circle's docs). */
export const CIRCLE_CATALOG: readonly CircleProduct[] = [
  { id: "wallets", name: t("circle.model.wallets"), status: "unknown", docs: "https://developers.circle.com/wallets" },
  { id: "agent-stack", name: t("circle.model.agentStackMarketplace"), status: "unknown", docs: "https://www.circle.com/agent-stack" },
  { id: "gateway", name: "Gateway", status: "unknown", docs: "https://developers.circle.com/gateway" },
  { id: "cctp", name: t("circle.model.cctpV2FastHooks"), status: "unknown", docs: "https://developers.circle.com/cctp" },
  { id: "stablefx", name: "StableFX", status: "unknown", docs: "https://developers.circle.com/stablefx" },
  { id: "paymaster", name: t("circle.model.paymasterGasStation"), status: "unknown", docs: "https://developers.circle.com/paymaster" },
  { id: "compliance", name: t("circle.model.complianceScreening"), status: "unknown", docs: "https://developers.circle.com" },
  { id: "nanopayments", name: t("circle.model.nanopaymentsX402"), status: "unknown", docs: "https://www.circle.com/nanopayments" },
  { id: "usyc", name: "USYC", status: "unknown", docs: "https://developers.circle.com" },
];

const STATUSES: readonly CircleStatus[] = ["live", "keyless", "needs-key", "unavailable", "unknown"];

/** Accepts `{ products: [...] }` or a bare array; merges onto the catalogue so the grid is always complete. */
export function normalizeCircle(raw: unknown): CircleProduct[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { products?: unknown }).products) ? (raw as { products: unknown[] }).products : [];
  const byId = new Map<string, CircleProduct>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "");
    if (!id) continue;
    byId.set(id, { id, name: String(o.name ?? id), status: STATUSES.includes(o.status as CircleStatus) ? (o.status as CircleStatus) : "unknown", ...(typeof o.docs === "string" ? { docs: o.docs } : {}), ...(typeof o.note === "string" ? { note: o.note } : {}) });
  }
  const merged = CIRCLE_CATALOG.map((c) => ({ ...c, ...(byId.get(c.id) ?? {}) }));
  for (const [id, p] of byId) if (!CIRCLE_CATALOG.some((c) => c.id === id)) merged.push(p);
  return merged;
}

export const STATUS_LABEL: Record<CircleStatus, { en: string; tone: "ok" | "sea" | "ochre" | "ghost" | "bad" }> = {
  live: { en: "live", tone: "ok" },
  keyless: { en: t("circle.model.liveNoKey"), tone: "sea" },
  "needs-key": { en: t("circle.model.needsAKey"), tone: "ochre" },
  unavailable: { en: "unavailable", tone: "bad" },
  unknown: { en: "checking…", tone: "ghost" },
};
