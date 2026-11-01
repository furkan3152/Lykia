/**
 * The embed protocol (v1) between a `<lykia-*>` element on the host page
 * and Lykia's `/embed/*` page in its iframe. Zero imports: shared by the
 * element bundle and the embed pages.
 *
 *   host -> frame   window.postMessage({ type: "lykia:connect", v, ... }, frameOrigin, [port])
 *   frame -> host   port: { type: "ready" | "resize" | "event" | "wallet:request" }
 *   host -> frame   port: { type: "wallet:response" | "update" }
 */
export const EMBED_PROTOCOL_VERSION = 1;
export const CONNECT_MESSAGE = "lykia:connect";

export const EMBED_ROUTES = {
  "lykia-assistant": "chat",
  "lykia-chat": "chat",
  "lykia-send": "send",
  "lykia-swap": "swap",
  "lykia-earn": "earn",
  "lykia-bridge": "bridge",
  "lykia-fence": "fence",
  "lykia-scent": "scent",
  "lykia-flock": "flock",
  "lykia-pack": "pack",
  "lykia-outrun": "outrun",
} as const;

export type EmbedTag = keyof typeof EMBED_ROUTES;
export type EmbedRoute = (typeof EMBED_ROUTES)[EmbedTag];
export const EMBED_ROUTE_NAMES: readonly EmbedRoute[] = ["chat", "send", "swap", "earn", "bridge", "fence", "scent", "flock", "pack", "outrun"];

/** Events the frame reports; the element re-dispatches them as `lykia:<name>` CustomEvents. */
export type EmbedEventName = "ready" | "plan-created" | "step-signed" | "settled" | "error" | "resize";
export const EMBED_EVENTS: readonly EmbedEventName[] = ["ready", "plan-created", "step-signed", "settled", "error", "resize"];

export interface ConnectMessage {
  readonly type: typeof CONNECT_MESSAGE;
  readonly v: number;
  readonly project: string;
  readonly key?: string;
  readonly owner?: string;
  readonly prefill?: string;
  /** True when the host lends its wallet: the frame asks through `wallet:request`. */
  readonly hostWallet: boolean;
}

export type FrameMessage =
  | { readonly type: "ready"; readonly v: number }
  | { readonly type: "resize"; readonly height: number }
  | { readonly type: "event"; readonly name: EmbedEventName; readonly detail: unknown }
  | { readonly type: "wallet:request"; readonly id: number; readonly method: string; readonly params?: unknown };

export type HostMessage =
  | { readonly type: "wallet:response"; readonly id: number; readonly result?: unknown; readonly error?: string }
  | { readonly type: "update"; readonly owner?: string; readonly prefill?: string };

/** Wallet methods a frame may ask the host to run. Nothing else crosses. */
export const WALLET_METHODS: readonly string[] = ["eth_accounts", "eth_requestAccounts", "eth_chainId", "wallet_switchEthereumChain", "eth_sendTransaction"];

export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";
export const FRAME_ALLOW = "clipboard-write";
export const MIN_FRAME_HEIGHT = 240;
export const MAX_FRAME_HEIGHT = 1600;

export function clampHeight(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_FRAME_HEIGHT, Math.min(MAX_FRAME_HEIGHT, Math.round(n)));
}

const HEX = /^#[0-9a-fA-F]{6}$/u;
export const PROJECT_ID = /^prj_[a-z0-9]{12}$/u;
/** Publishable keys: lk_pk_<id>_<secret> (legacy) or lk_pk_live_ / lk_pk_test_ keys. */
export const PUBLISHABLE_KEY = /^lk_pk_(?:(?:live|test)_)?[a-z0-9]{12}_[A-Za-z0-9_-]{32}$/u;

/** Appearance attributes that reach the frame URL, each checked; anything invalid is dropped. */
export function appearanceParams(get: (name: string) => string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ["primary", "accent", "background", "foreground"]) {
    const v = get(name);
    if (v && HEX.test(v)) out[name] = v;
  }
  const scheme = get("scheme");
  if (scheme === "light" || scheme === "dark" || scheme === "auto") out.scheme = scheme;
  const radius = get("radius");
  if (radius !== null && /^\d{1,2}$/u.test(radius) && Number(radius) <= 24) out.radius = radius;
  const env = get("environment");
  if (env === "mainnet" || env === "testnet") out.environment = env;
  const mosaic = get("mosaic");
  if (mosaic === "on" || mosaic === "off") out.mosaic = mosaic;
  return out;
}

/** The frame URL for a route. The key never goes in the URL; it travels in the connect message. */
export function frameUrl(host: string, route: EmbedRoute, project: string, appearance: Record<string, string>): string {
  const url = new URL(`/embed/${route}`, host);
  url.searchParams.set("project", project);
  url.searchParams.set("v", String(EMBED_PROTOCOL_VERSION));
  for (const [k, v] of Object.entries(appearance)) url.searchParams.set(k, v);
  return url.toString();
}
