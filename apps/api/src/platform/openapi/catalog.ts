/**
 * Documentation for the routes that existed before the shared registry
 * (`documentRoutes`). The OpenAPI builder merges this list under
 * `documentedRoutes()`: a module that documents one of these routes itself
 * wins. Path parameters are derived from the path; request schemas are given
 * where they help integrators most.
 */
import { z } from "zod";
import { createSchema } from "../../modules/intents.js";
import { factsSchema } from "../../modules/fence.js";
import type { DocumentedRoute, HttpMethod } from "./registry.js";

const env = z.object({ environment: z.enum(["mainnet", "testnet"]).optional().describe("Arc network; defaults to the server's mode. Test keys are always testnet.") });
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);
const amount = z.string().regex(/^\d{1,18}(?:\.\d{1,18})?$/u);
const token = z.string().min(2).max(10);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/u);
const sentence = z.object({ text: z.string().min(1).max(500), environment: z.enum(["mainnet", "testnet"]).optional(), owner: z.string().optional() });

const quoteBody = z.union([
  z.object({ kind: z.literal("swap"), environment: z.enum(["mainnet", "testnet"]).optional(), from: token, to: token, amount }),
  z.object({ kind: z.literal("earn"), environment: z.enum(["mainnet", "testnet"]).optional(), token, maxRisk: z.enum(["low", "medium", "high"]).optional() }),
  z.object({ kind: z.literal("borrow"), environment: z.enum(["mainnet", "testnet"]).optional(), token, amount, collateral: token.optional(), collateralAmount: amount.optional(), minHealth: z.string().optional(), account: address }),
]);

type Auth = DocumentedRoute["auth"];
type Extra = Partial<Pick<DocumentedRoute, "query" | "body" | "response" | "description" | "idempotent" | "x402" | "scope">>;

function r(method: HttpMethod, path: string, tag: string, summary: string, auth: Auth = "public", extra: Extra = {}): DocumentedRoute {
  return { method, path: `/v1${path}`, tag, summary, auth, idempotent: method === "post" && !/\/(?:auth\/|mcp$|agent\/chat$)/u.test(path), ...extra };
}

export const EXISTING_ROUTES: readonly DocumentedRoute[] = [
  // Auth
  r("post", "/auth/nonce", "Auth", "A SIWE nonce and a ready EIP-4361 message for Arc", "public", { body: z.object({ address: address.optional(), chainId: z.number().int().optional() }) }),
  r("post", "/auth/verify", "Auth", "Verify a signed SIWE message and get a session token", "public", { body: z.object({ message: z.string(), signature: z.string() }) }),
  r("get", "/auth/session", "Auth", "The current session and its roles", "session"),
  r("post", "/auth/logout", "Auth", "Revoke the current session", "session"),
  // Developers
  r("post", "/developers/register", "Developers", "Become a developer", "session", { body: z.object({ name: z.string().min(1).max(64), website: z.string().url().nullable().optional() }) }),
  r("get", "/developers/me", "Developers", "Profile, fee settings and usage", "session"),
  r("put", "/developers/settings", "Developers", "Integrator fee (bps, capped) and its recipient", "session", { body: z.object({ integratorFeeBps: z.number().int().min(0).max(50), feeRecipient: address.nullable() }) }),
  r("get", "/developers/usage", "Developers", "Requests today, the last seven days and per key", "session"),
  // Projects
  r("get", "/projects", "Projects", "The developer's projects", "session"),
  r("post", "/projects", "Projects", "Create a white-label project", "session", { body: z.object({ name: z.string(), origins: z.array(z.string()).optional(), modules: z.array(z.string()).optional(), network: z.enum(["mainnet", "testnet"]).optional() }).passthrough() }),
  r("get", "/projects/:id", "Projects", "A project (owner view)", "session"),
  r("patch", "/projects/:id", "Projects", "Update a project", "session", { body: z.object({}).passthrough() }),
  r("delete", "/projects/:id", "Projects", "Delete a project", "session"),
  r("get", "/projects/:id/public", "Projects", "Brand, modules, network and fee: what embeds read"),
  r("get", "/projects/:id/fence", "Projects", "The project's default Fence"),
  r("post", "/projects/:id/origins/challenge", "Projects", "The DNS TXT or /.well-known value proving an origin", "session", { body: z.object({ origin: z.string() }) }),
  r("post", "/projects/:id/origins/verify", "Projects", "Check an origin proof", "session", { body: z.object({ origin: z.string(), method: z.enum(["dns", "well-known"]) }) }),
  r("get", "/projects/:id/keys", "Projects", "The project's publishable keys", "session"),
  r("post", "/projects/:id/keys", "Projects", "Issue a publishable key bound to the project's origins", "session", { body: z.object({ label: z.string().min(1).max(48) }) }),
  r("get", "/projects/:id/usage", "Projects", "Requests and plans per day", "session"),
  r("post", "/projects/:id/webhook", "Projects", "Register the project's webhook URL (secret shown once)", "session"),
  // System and Arc data
  r("get", "/health", "System", "Service health and features"),
  r("get", "/fees", "System", "Lykia's protocol fee and the beta caps"),
  r("get", "/networks", "Arc", "Arc mainnet and testnet"),
  r("get", "/tokens", "Arc", "Verified tokens per network", "public", { query: env }),
  r("get", "/contracts", "Arc", "Verified Circle and protocol contracts", "public", { query: env }),
  r("get", "/protocols", "Arc", "Every Arc protocol in the registry"),
  r("get", "/venues", "Arc", "Venues Lykia routes to, with live status", "public", { query: env }),
  r("get", "/arc/pulse", "Arc", "Latest block, gas and finality on Arc", "public", { query: env }),
  r("get", "/arc/pulse/stream", "Arc", "Server-sent events: Arc pulse", "public", { query: env }),
  r("get", "/oracles", "Arc", "Chainlink and Pyth reference prices", "public", { query: env }),
  r("get", "/deployments", "Arc", "Lykia's verified contract deployments"),
  // Flock
  r("get", "/flock/:address", "Flock", "One balance sheet: wallet, Gateway and venue positions, priced", "public", { query: env }),
  r("get", "/flock/:address/stream", "Flock", "Server-sent events: the Flock as it changes", "public", { query: env }),
  // Fence
  r("get", "/fence/templates", "Fence", "Fence templates"),
  r("get", "/fence/default", "Fence", "The default Fence"),
  r("post", "/fence/validate", "Fence", "Validate a Fence document (and diff it against a previous one)", "key", { scope: "quote", body: z.object({ fence: z.unknown(), previous: z.unknown().optional() }) }),
  r("post", "/fence/evaluate", "Fence", "Evaluate a planned move against a Fence: allow, confirm or deny with reasons", "key", { scope: "quote", body: z.object({ fence: z.unknown().optional(), facts: factsSchema }) }),
  // Language
  r("post", "/language/parse", "Language", "Read a sentence into typed actions", "key", { scope: "quote", body: sentence }),
  // Intents
  r("post", "/intents", "Intents", "Plan an outcome (a sentence or actions), checked against the Fence", "key", { scope: "build", body: createSchema, description: "Returns the intent graph, the Fence verdict, the Outrun and the Lykia fee per step. The server never signs." }),
  r("get", "/intents/:id", "Intents", "An intent and its Outrun", "key"),
  r("get", "/intents/:id/outrun", "Intents", "Where the money is: the Outrun", "key"),
  r("post", "/intents/:id/steps/:sid/prepare", "Intents", "Unsigned calls, binding and memo for one step", "key", { scope: "build", body: z.object({ confirm: z.boolean().optional() }) }),
  r("post", "/intents/:id/steps/:sid/submit", "Intents", "Record signed transaction hashes (or a userOpHash) for a step", "key", { scope: "execute", body: z.union([z.object({ hashes: z.array(hash).min(1).max(4) }), z.object({ userOpHash: hash })]) }),
  r("get", "/intents/:id/steps/:sid/attestation", "Intents", "The CCTP attestation of a bridge step", "key"),
  r("post", "/intents/:id/stop", "Intents", "Stop every step that has not started", "key", { scope: "execute" }),
  r("get", "/intents/:id/stream", "Intents", "Server-sent events: intent and Outrun updates", "key"),
  // Standing orders
  r("post", "/standing", "Standing", "Arm a standing order", "session", { scope: "automation", body: z.object({ owner: address, text: z.string().optional() }).passthrough() }),
  r("get", "/standing", "Standing", "Standing orders of an owner", "session", { query: z.object({ owner: address.optional() }).passthrough() }),
  r("get", "/standing/:id", "Standing", "A standing order", "session"),
  r("post", "/standing/:id/check", "Standing", "Check a standing order now", "session", { scope: "automation" }),
  r("post", "/standing/:id/pause", "Standing", "Pause a standing order", "session", { scope: "automation" }),
  r("post", "/standing/:id/resume", "Standing", "Resume a standing order", "session", { scope: "automation" }),
  r("delete", "/standing/:id", "Standing", "Cancel a standing order", "session", { scope: "automation" }),
  // Routes
  r("post", "/quote", "Routes", "Every live venue's option for a swap, earn or borrow, and the engine's pick", "key", { scope: "quote", body: quoteBody }),
  r("get", "/rates", "Routes", "Live yields and borrow rates on Arc"),
  r("post", "/cctp/inbound", "Routes", "USDC burned elsewhere: attestation and the unsigned receiveMessage on Arc", "key", { body: z.object({ environment: z.enum(["mainnet", "testnet"]).optional(), source: z.string(), txHash: hash, from: address.optional() }) }),
  r("post", "/routes/search", "Routes", "Search multi-hop routes across Arc venues, each checked against the Fence", "key", { scope: "quote", body: z.object({}).passthrough() }),
  // Knowledge
  r("get", "/knowledge", "Knowledge", "Lyko's knowledge of Arc venues, contracts and paths"),
  r("get", "/knowledge/venues/:venue", "Knowledge", "What Lykia knows about a venue"),
  r("get", "/knowledge/contracts/:address", "Knowledge", "What Lykia knows about a contract"),
  r("get", "/knowledge/paths", "Knowledge", "Known paths between assets"),
  // Scent
  r("get", "/scent/:token", "Scent", "What can be proven about a token before anyone touches it", "public", { query: env }),
  // Tags
  r("get", "/tags/cards/:digest", "Tags", "A Tag card by digest"),
  r("get", "/tags/verdicts/:hash", "Tags", "A filed Fence verdict"),
  r("get", "/tags/:agentId/policy-salt", "Tags", "The policy salt of a Tag"),
  r("get", "/tags/:agentId", "Tags", "An agent's Tag (ERC-8004 identity and Fence hash)", "public", { query: env }),
  r("post", "/tags/draft", "Tags", "Draft a Tag registration (unsigned)", "key", { scope: "build", body: z.object({}).passthrough() }),
  r("post", "/tags/attest", "Tags", "Draft an ERC-8354 attestation of a verdict (unsigned)", "key", { scope: "build", body: z.object({}).passthrough() }),
  // Agent
  r("post", "/agent/chat", "Agent", "Chat with Lyko (server-sent events)", "key", {
    scope: "agents",
    body: z.object({
      message: z.string().min(1).max(4_000).optional(),
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4_000) })).min(1).max(30).optional(),
      owner: address.optional(),
      environment: z.enum(["mainnet", "testnet"]).optional(),
      threadId: z.string().max(120).optional(),
      fence: z.unknown().optional(),
      origin: z.enum(["ask", "fold"]).optional(),
      context: z.string().max(1_000).optional(),
    }),
    description:
      "Streams Server-Sent Events: thread, notice, reading, task, tool, step (one step of Lyko at work: sent with state running when it starts and again with the same id, ok, warn or fail, the result and the measured ms when it ends), block (a typed answer card built from server data: gas, fence, balance, rate, herded or settled; the text stays the fallback), thinking-summary, proposal, clarify, draft, program, text, error and done. Send Accept: application/json to get the same events collected in one JSON document.",
  }),
  r("get", "/agent/threads", "Agent", "Conversation threads (the owner's session or a secret key with the agents scope)", "session", { query: z.object({ owner: address }) }),
  r("get", "/agent/threads/:id", "Agent", "One thread", "key"),
  r("post", "/agent/threads", "Agent", "Start a thread", "key", { scope: "agents" }),
  r("get", "/agent/insights", "Agent", "Insights about an owner's Flock", "key"),
  r("get", "/agent/automations", "Agent", "Agent automations (the owner's session or a secret key with the agents scope)", "session", { query: z.object({ owner: address }) }),
  r("post", "/agent/automations", "Agent", "Create an automation", "key", { scope: "agents", body: z.object({}).passthrough() }),
  r("post", "/agent/automations/:id/enable", "Agent", "Enable an automation", "key", { scope: "agents" }),
  r("post", "/agent/automations/:id/disable", "Agent", "Disable an automation", "key", { scope: "agents" }),
  r("post", "/agent/automations/run", "Agent", "Run due automations now", "key", { scope: "agents" }),
  r("post", "/agent/check", "Agent", "Check a proposed agent move", "key", { scope: "quote", body: z.object({}).passthrough() }),
  // Pack
  r("get", "/pack", "Pack", "An owner's Pack of agents", "key"),
  r("post", "/pack", "Pack", "Add an agent to the Pack", "key", { scope: "agents", body: z.object({ owner: address, name: z.string(), role: z.string() }).passthrough() }),
  r("post", "/pack/whistle", "Pack", "Blow the Whistle: stop all new risk", "key", { scope: "agents", body: z.object({ owner: address, reason: z.string().optional() }).passthrough() }),
  r("get", "/pack/account", "Pack", "The owner's LykiaAccount", "key"),
  r("get", "/pack/:id", "Pack", "One agent", "key"),
  r("get", "/pack/:id/budget", "Pack", "An agent's budget and spend", "key"),
  r("post", "/pack/:id/spawn", "Pack", "Spawn a sub-agent inside the parent's Fence", "key", { scope: "agents" }),
  r("post", "/pack/:id/revoke", "Pack", "Revoke an agent and its sub-agents", "key", { scope: "agents" }),
  r("post", "/pack/:id/pause", "Pack", "Pause an agent", "key", { scope: "agents" }),
  r("post", "/pack/:id/resume", "Pack", "Resume an agent", "key", { scope: "agents" }),
  r("post", "/pack/:id/session-tx", "Pack", "The unsigned sub-session transaction for an agent", "key", { scope: "agents" }),
  r("post", "/pack/:id/session", "Pack", "Record an agent's on-chain session", "key", { scope: "agents" }),
  // Personal (session)
  r("get", "/profile", "Personal", "The owner's profile", "session"),
  r("put", "/profile", "Personal", "Update the profile (never loosens a Fence)", "session", { body: z.object({}).passthrough() }),
  r("delete", "/profile", "Personal", "Reset the profile", "session"),
  r("get", "/memory", "Personal", "What Lyko remembers", "session"),
  r("get", "/memory/intents", "Personal", "Remembered plans", "session"),
  r("get", "/memory/export", "Personal", "Export memory", "session"),
  r("post", "/memory/forget", "Personal", "Forget intents, contacts or everything", "session", { body: z.object({ what: z.enum(["intents", "contacts", "all"]).optional() }) }),
  r("delete", "/memory/:id", "Personal", "Forget one item", "session"),
  r("get", "/contacts", "Personal", "Contacts", "session"),
  r("post", "/contacts", "Personal", "Add a contact", "session", { body: z.object({ name: z.string(), address, aliases: z.array(z.string()).optional(), note: z.string().optional() }) }),
  r("put", "/contacts/:id", "Personal", "Update a contact", "session", { body: z.object({ name: z.string(), address, aliases: z.array(z.string()).optional(), note: z.string().optional() }) }),
  r("delete", "/contacts/:id", "Personal", "Delete a contact", "session"),
  // Circle
  r("get", "/circle/status", "Circle", "Every Circle product live on Arc and how Lykia uses it"),
  r("get", "/circle/services", "Circle", "Circle Agent Marketplace services"),
  r("get", "/circle/cctp/fees", "Circle", "CCTP V2 fees", "public", { query: env }),
  r("post", "/circle/cctp/forward", "Circle", "Draft a CCTP forward", "key", { body: z.object({}).passthrough() }),
  r("post", "/circle/gateway/transfer/draft", "Circle", "Draft a Gateway transfer", "key", { body: z.object({}).passthrough() }),
  r("post", "/circle/gateway/transfer", "Circle", "Submit a Gateway transfer", "key", { body: z.object({}).passthrough() }),
  r("post", "/circle/gateway/transfer/attest", "Circle", "Attest a Gateway transfer", "key", { body: z.object({}).passthrough() }),
  r("get", "/circle/gateway/balance", "Circle", "Unified Gateway balance", "key"),
  r("get", "/circle/gateway/transfers/:id", "Circle", "Gateway's record of a transfer, forwarded mints included", "public", { query: env }),
  r("get", "/circle/cctp/status", "Circle", "A CCTP burn from Arc: attestation, forwarding state, destination mint", "public", { query: env }),
  r("get", "/circle/compliance/:address", "Circle", "Compliance screening of an address", "key"),
  r("post", "/circle/x402/prepare", "Circle", "Prepare an x402 payment", "key", { body: z.object({}).passthrough() }),
  r("post", "/circle/x402/pay", "Circle", "Pay an x402 resource", "key", { body: z.object({}).passthrough() }),
  r("post", "/circle/screen", "Circle", "Screen an address", "key", { scope: "quote", body: z.object({}).passthrough() }),
  r("post", "/circle/stablefx/quote", "Circle", "StableFX quote (USDC/EURC)", "key", { scope: "quote", body: z.object({}).passthrough() }),
  r("post", "/circle/stablefx/trade", "Circle", "StableFX trade", "key", { body: z.object({}).passthrough() }),
  r("get", "/circle/stablefx/trades/:id", "Circle", "A StableFX trade", "key"),
  r("post", "/circle/stablefx/funding/presign", "Circle", "StableFX taker funding: Permit2 typed data to sign", "key", { body: z.object({}).passthrough() }),
  r("post", "/circle/stablefx/fund", "Circle", "StableFX taker funding: hand over the signed Permit2 data", "key", { body: z.object({}).passthrough() }),
  r("post", "/circle/wallets/agent", "Circle", "Create a Circle agent wallet", "session", { body: z.object({}).passthrough() }),
  r("post", "/circle/agent-wallets", "Circle", "Create Circle agent wallets", "session", { body: z.object({}).passthrough() }),
  r("get", "/circle/wallets/:id/balances", "Circle", "Circle wallet balances", "session"),
  r("get", "/circle/usyc/eligibility", "Circle", "USYC entitlement of a wallet on Arc (Entitlements.canCall on the Teller)", "public", { query: env }),
  r("post", "/circle/usyc/prepare", "Circle", "USYC subscribe or redeem for an entitled wallet: Fence verdict and unsigned calls", "key", { body: z.object({}).passthrough() }),
  // Circle Agent Stack (modules/circleStack.ts)
  r("post", "/circle/policies/compile", "Circle", "Compile a Fence into a Circle Agent Wallet spending policy, with who enforces each rule", "public", { body: z.object({}).passthrough() }),
  r("post", "/circle/policies/apply", "Circle", "The owner's Circle CLI commands for a compiled policy (never applied by Lykia)", "public", { body: z.object({}).passthrough() }),
  r("get", "/circle/providers", "Circle", "Circle execution providers and controls, with status"),
  r("get", "/circle/marketplace/services", "Circle", "Agent Marketplace services payable on Arc"),
  r("get", "/circle/marketplace/listing", "Circle", "Lykia's Agent Marketplace listing package"),
  r("post", "/circle/mandates/draft", "Circle", "Arc typed-mandate draft from a Fence (status pending)", "public", { body: z.object({}).passthrough() }),
  r("post", "/circle/mandates/proof", "Circle", "Arc execution-proof draft from a verdict (status pending)", "public", { body: z.object({}).passthrough() }),
  r("get", "/x402/health", "x402", "Health of the paid x402 routes"),
  r("get", "/stats", "System", "Public aggregate traction numbers (no personal data)"),
  // Jobs
  r("get", "/jobs/:id", "Jobs", "An escrowed job", "key"),
  r("post", "/jobs/draft", "Jobs", "Draft an escrowed job", "key", { scope: "automation", body: z.object({}).passthrough() }),
  r("post", "/jobs/:id/fund", "Jobs", "Fund a job (unsigned)", "key", { scope: "automation" }),
  r("post", "/jobs/:id/complete", "Jobs", "Complete a job (unsigned)", "key", { scope: "automation" }),
  r("post", "/jobs/:id/reject", "Jobs", "Reject a job (unsigned)", "key", { scope: "automation" }),
  r("post", "/jobs/:id/refund", "Jobs", "Refund a job (unsigned)", "key", { scope: "automation" }),
  // Orders
  r("get", "/orders/config", "Orders", "Limit order configuration"),
  r("post", "/orders/draft", "Orders", "Draft a limit order for signing", "key", { scope: "quote", body: z.object({}).passthrough() }),
  r("post", "/orders", "Orders", "Place a signed limit order", "key", { scope: "automation", body: z.object({}).passthrough() }),
  r("get", "/orders", "Orders", "Limit orders of an owner", "key"),
  r("get", "/orders/:hash/cancel-tx", "Orders", "The unsigned cancel transaction", "key"),
  r("get", "/orders/:hash/execute-tx", "Orders", "The unsigned execute transaction", "key"),
  // Alerts
  r("get", "/alerts", "Alerts", "Alert rules", "session"),
  r("post", "/alerts", "Alerts", "Create an alert rule", "session", { body: z.object({}).passthrough() }),
  r("patch", "/alerts/:id", "Alerts", "Update an alert rule", "session", { body: z.object({}).passthrough() }),
  r("delete", "/alerts/:id", "Alerts", "Delete an alert rule", "session"),
  r("get", "/alerts/inbox", "Alerts", "Fired alerts", "session"),
  r("post", "/alerts/inbox/read", "Alerts", "Mark alerts read", "session"),
  r("post", "/alerts/check", "Alerts", "Check alert rules now", "session"),
  // Telegram
  r("post", "/telegram/link-code", "Telegram", "A one-time code to link Telegram", "session"),
  r("get", "/telegram/status", "Telegram", "Telegram link status", "session"),
  r("delete", "/telegram/link", "Telegram", "Unlink Telegram", "session"),
  r("post", "/telegram/setup", "Telegram", "Register the bot webhook (admin)", "session"),
  // Discover
  r("get", "/discover/launches", "Discover", "New token launches on Arc", "public", { query: env }),
  r("get", "/perps/markets", "Discover", "Perpetual markets"),
  r("get", "/perps/markets/:market", "Discover", "One perpetual market"),
  r("get", "/activity", "Discover", "Recent activity", "public", { query: env }),
  r("get", "/track/:hash", "Discover", "Track a transaction on Arc", "public", { query: env }),
  r("get", "/watch", "Discover", "Watched addresses", "session"),
  r("post", "/watch", "Discover", "Watch an address", "session", { body: z.object({ address }).passthrough() }),
  r("delete", "/watch/:address", "Discover", "Stop watching an address", "session"),
  // Ecosystem
  r("get", "/ecosystem", "Ecosystem", "Every Arc protocol, Circle product, TVL and value routed by Lykia", "public", { query: env }),
  r("get", "/openapi.json", "Platform", "This OpenAPI 3.1 document"),
  // Admin
  r("get", "/admin/deployments", "Admin", "Recorded deployments", "session"),
  r("post", "/admin/deployments", "Admin", "Record a deployment after checking it on chain", "session", { body: z.object({}).passthrough() }),
  r("get", "/admin/router", "Admin", "Router allowlist", "session"),
  r("get", "/admin/flags", "Admin", "Feature flags", "session"),
  r("put", "/admin/flags", "Admin", "Set feature flags", "session", { body: z.object({}).passthrough() }),
  r("post", "/admin/circle/entity-secret", "Admin", "Register the Circle entity secret", "session", { body: z.object({}).passthrough() }),
  r("get", "/admin/ownership", "Admin", "Unsigned ownership-hardening calls (Safe + timelock)", "session"),
  r("get", "/admin/overview", "Admin", "Operator overview", "session"),
  // Security
  r("get", "/security/status", "Security", "Security layer status"),
  r("get", "/security/audit", "Security", "Audit trail", "session"),
  r("post", "/security/halt", "Security", "Halt routing (admin)", "session", { body: z.object({}).passthrough() }),
  r("put", "/security/venues/:id", "Security", "Set a venue's security status (admin)", "session", { body: z.object({}).passthrough() }),
  r("get", "/security/approvals", "Security", "Token approvals of an owner", "public", { query: z.object({ owner: address.optional() }).passthrough() }),
  r("post", "/security/check-address", "Security", "Check an address before sending", "key", { scope: "quote", body: z.object({ address }).passthrough() }),
  r("get", "/security/alerts", "Security", "Security alerts", "session"),
  r("get", "/security/policy", "Security", "The owner's security policy", "session"),
  r("put", "/security/policy", "Security", "Update the security policy", "session", { body: z.object({}).passthrough() }),
  r("get", "/security/pauses", "Security", "Active pauses", "session"),
  r("post", "/security/pause", "Security", "Pause an agent, venue or owner", "session", { body: z.object({}).passthrough() }),
  r("post", "/security/resume", "Security", "Lift a pause", "session", { body: z.object({}).passthrough() }),
  // MCP
  r("post", "/mcp", "MCP", "Model Context Protocol (streamable HTTP): plan, Scent, Flock, Fence and more as tools", "key", { scope: "build", description: "Point Claude Code, the Claude Agent SDK, Cursor or any MCP client at /v1/mcp with a Lykia-Key header." }),
  r("get", "/mcp", "MCP", "MCP session stream", "key"),
  r("delete", "/mcp", "MCP", "Close an MCP session", "key"),
  // x402
  r("post", "/x402/fence/evaluate", "x402", "Fence check, paid per call in USDC on Arc", "public", { x402: true, body: z.object({ fence: z.unknown().optional(), facts: factsSchema }) }),
  r("get", "/x402/scent/:token", "x402", "Deep Scent report, paid per call", "public", { x402: true, query: env }),
  r("post", "/x402/quote", "x402", "Route quote, paid per call", "public", { x402: true, body: quoteBody }),
];

/** Mounted routes that are deliberately not in the reference (callbacks and operator triggers). */
export const UNDOCUMENTED_ROUTES: readonly string[] = ["POST /v1/telegram/webhook", "POST /v1/orders/keeper/tick"];
