/**
 * Which scope a route needs.
 *
 * Legacy keys (lk_sk_ / lk_pk_) keep the original mapping (`legacyScopeFor`,
 * read / plan / agents / webhooks) so no existing integration changes
 * behaviour. lk_live_ / lk_test_ keys use the fine-grained mapping below. A
 * route documented through `documentRoutes({ scope })` overrides the
 * built-in mapping, so new modules get enforcement by documenting their
 * routes.
 */
import { LEGACY_SCOPE_IMPLIES, type ApiKeyScope, type LegacyApiKeyScope } from "@lykia/core/api/platform";
import { documentedRoutes } from "./openapi/registry.js";

/** The original mapping, unchanged (paths are relative to /v1). */
export function legacyScopeFor(method: string, path: string): ApiKeyScope {
  if (path.startsWith("/developers/webhooks")) return "webhooks";
  if (path.startsWith("/pack") || path.startsWith("/agent")) return method === "GET" ? "read" : "agents";
  if (method !== "GET" && (path.startsWith("/intents") || path.startsWith("/language") || path.startsWith("/fence") || path.startsWith("/tags") || path.startsWith("/mcp"))) return "plan";
  return "read";
}

const QUOTE_PATHS = [/^\/quote$/u, /^\/x402\/quote$/u, /^\/routes\/search$/u, /^\/fence\/(?:evaluate|validate)$/u, /^\/x402\/fence\/evaluate$/u, /^\/language\/parse$/u, /^\/circle\/stablefx\/quote$/u, /^\/circle\/screen$/u, /^\/security\/check-address$/u, /^\/agent\/check$/u, /^\/orders\/draft$/u];
const ADMIN_PREFIXES = ["/developers", "/projects", "/billing", "/webhooks", "/keys", "/logs/", "/admin"];
const PAYOUT_PREFIXES = ["/payouts", "/invoices", "/treasury", "/payroll", "/payments"];
const AUTOMATION_PREFIXES = ["/agent/automations", "/standing", "/orders", "/alerts", "/watch", "/jobs"];
const AGENT_PREFIXES = ["/pack", "/agent"];

function startsWithAny(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`) || path.startsWith(`${p}?`));
}

interface Override {
  readonly method: string;
  readonly pattern: RegExp;
  readonly scope: ApiKeyScope;
}

let overrides: { readonly size: number; readonly list: readonly Override[] } = { size: -1, list: [] };

function templateToRegExp(path: string): RegExp {
  const relative = path.replace(/^\/v1(?=\/)/u, "");
  const escaped = relative.split("/").map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))).join("/");
  return new RegExp(`^${escaped}$`, "u");
}

function documentedOverrides(): readonly Override[] {
  const routes = documentedRoutes();
  if (routes.length !== overrides.size) {
    overrides = {
      size: routes.length,
      list: routes.filter((r) => r.scope).map((r) => ({ method: r.method.toUpperCase(), pattern: templateToRegExp(r.path), scope: r.scope as ApiKeyScope })),
    };
  }
  return overrides.list;
}

/** The fine-grained scope for lk_live_ / lk_test_ keys. */
export function fineScopeFor(method: string, path: string): ApiKeyScope {
  const m = method.toUpperCase();
  const documented = documentedOverrides().find((o) => o.method === m && o.pattern.test(path));
  if (documented) return documented.scope;
  const read = m === "GET" || m === "HEAD";
  if (read) {
    if (path.startsWith("/developers/keys") || path.startsWith("/developers/webhooks") || path.startsWith("/admin")) return "admin";
    return "read";
  }
  if (startsWithAny(path, ADMIN_PREFIXES)) return "admin";
  if (startsWithAny(path, PAYOUT_PREFIXES)) return "payouts";
  if (QUOTE_PATHS.some((p) => p.test(path))) return "quote";
  if (startsWithAny(path, AUTOMATION_PREFIXES)) return "automation";
  if (startsWithAny(path, AGENT_PREFIXES)) return "agents";
  if (/^\/intents\/[^/]+\/(?:steps\/[^/]+\/submit|stop)$/u.test(path)) return "execute";
  return "build";
}

/** Every fine-grained scope a key's stored scopes grant (legacy scopes expand). */
export function effectiveScopes(scopes: readonly ApiKeyScope[]): Set<ApiKeyScope> {
  const out = new Set<ApiKeyScope>();
  for (const scope of scopes) {
    out.add(scope);
    for (const implied of LEGACY_SCOPE_IMPLIES[scope as LegacyApiKeyScope] ?? []) out.add(implied);
  }
  return out;
}

/** Whether a key with `scopes` may call the route; `fine` selects the mapping. */
export function scopeAllows(scopes: readonly ApiKeyScope[], required: ApiKeyScope, fine: boolean, path = ""): boolean {
  if (!fine) return scopes.includes(required);
  const granted = effectiveScopes(scopes);
  if (granted.has(required)) return true;
  // The legacy webhooks scope still manages webhook endpoints on new keys.
  return required === "admin" && granted.has("webhooks") && path.startsWith("/developers/webhooks");
}
