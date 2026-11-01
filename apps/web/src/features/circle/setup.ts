/** What the owner console shows about Circle credentials (pure). */

export type Readiness = "configured" | "missing" | "unknown";

export interface CircleSetup {
  readonly apiKey: Readiness;
  readonly entitySecret: Readiness;
  readonly stablefx: Readiness;
}

const KEYS = { apiKey: "CIRCLE_API_KEY", entitySecret: "CIRCLE_ENTITY_SECRET", stablefx: "STABLEFX_API_KEY" } as const;

/**
 * Reads /v1/circle/status. An explicit `credentials` map wins; otherwise a
 * key counts as configured when a product that needs it is configured or
 * live, and as missing when a product that needs only that key is waiting
 * for it. Anything else stays unknown rather than guessed.
 */
export function circleSetup(raw: unknown): CircleSetup {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const creds = o.credentials && typeof o.credentials === "object" ? (o.credentials as Record<string, unknown>) : null;
  const products = Array.isArray(o.products) ? (o.products as Record<string, unknown>[]) : [];
  const read = (env: string): Readiness => {
    if (creds && typeof creds[env] === "boolean") return creds[env] ? "configured" : "missing";
    const needing = products.filter((p) => Array.isArray(p.needs) && (p.needs as unknown[]).includes(env));
    const state = (p: Record<string, unknown>) => String(p.state ?? p.status ?? "");
    if (needing.some((p) => state(p) === "configured" || state(p) === "live")) return "configured";
    if (needing.some((p) => (state(p) === "needs-key") && (p.needs as unknown[]).length === 1)) return "missing";
    return "unknown";
  };
  return { apiKey: read(KEYS.apiKey), entitySecret: read(KEYS.entitySecret), stablefx: read(KEYS.stablefx) };
}

export interface EntitySecretResult {
  readonly secret: string;
  readonly recovery: string | null;
  readonly filename: string;
}

/** Accepts the API's entity-secret answer in the shapes it may use. */
export function parseEntitySecret(raw: unknown, now = new Date()): EntitySecretResult | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const secret = [o.entitySecret, o.secret, o.entity_secret].find((v): v is string => typeof v === "string" && v.length > 0);
  if (!secret) return null;
  const recovery = [o.recoveryFile, o.recoveryFileContent, o.recovery_file, o.recovery].find((v): v is string => typeof v === "string" && v.length > 0) ?? null;
  const filename = typeof o.recoveryFileName === "string" && /^[\w.-]{1,80}$/u.test(o.recoveryFileName) ? o.recoveryFileName : `circle-recovery-${now.toISOString().slice(0, 10)}.dat`;
  return { secret, recovery, filename };
}

/** The recovery file as bytes: the API sends it base64-encoded; plain text passes through unchanged. */
export function recoveryBytes(recovery: string): Uint8Array<ArrayBuffer> {
  const compact = recovery.replace(/\s+/gu, "");
  if (/^[A-Za-z0-9+/]+={0,2}$/u.test(compact) && compact.length % 4 === 0) {
    try {
      const bin = atob(compact);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      // not base64 after all
    }
  }
  return new Uint8Array(new TextEncoder().encode(recovery));
}
