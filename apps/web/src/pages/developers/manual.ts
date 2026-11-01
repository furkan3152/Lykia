/** The developer manual's data (pure): routes and snippets. */

export interface RouteDoc {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly what: string;
}

export const ROUTE_GROUPS: ReadonlyArray<{ readonly title: string; readonly routes: readonly RouteDoc[] }> = [
  {
    title: "Arc",
    routes: [
      { method: "GET", path: "/v1/health", what: "Version, environment, RPC reachability and enabled features." },
      { method: "GET", path: "/v1/networks · /v1/tokens · /v1/contracts", what: "Arc mainnet and testnet, the verified token registry and Circle's contracts (each address checked on-chain)." },
      { method: "GET", path: "/v1/protocols · /v1/venues", what: "The venue registry and what the engine can execute today." },
      { method: "GET", path: "/v1/arc/pulse · /v1/arc/pulse/stream", what: "Head block, block interval, gas in USDC; SSE event `pulse`." },
    ],
  },
  {
    title: "Intents and Outruns",
    routes: [
      { method: "POST", path: "/v1/language/parse", what: "A sentence (EN/TR) to plan actions, commands and clarifying questions." },
      { method: "POST", path: "/v1/intents", what: "Text or typed actions + owner + Fence → IntentGraph with its Fence verdict and Outrun." },
      { method: "GET", path: "/v1/intents/:id · /v1/intents/:id/outrun", what: "The graph and where the money is." },
      { method: "POST", path: "/v1/intents/:id/steps/:sid/prepare", what: "Unsigned transactions, the binding hash and the Arc Memo the step carries." },
      { method: "POST", path: "/v1/intents/:id/steps/:sid/submit", what: "Transaction hashes only; the server verifies receipts (deterministic finality)." },
      { method: "GET", path: "/v1/intents/:id/stream", what: "SSE events `intent` and `outrun`." },
    ],
  },
  {
    title: "Fence, Künye, Scent, Flock",
    routes: [
      { method: "GET", path: "/v1/fence/templates · /v1/fence/default", what: "Lamb, Shepherd, Treasury and Caravan." },
      { method: "POST", path: "/v1/fence/validate · /v1/fence/evaluate", what: "Validate and hash a Fence; evaluate facts into a verdict." },
      { method: "GET", path: "/v1/kunye/:agentId", what: "An ERC-8004 identity on Arc, its pinned Fence hash, reputation and validations." },
      { method: "POST", path: "/v1/kunye/draft · /v1/kunye/attest", what: "Build the agent card + registration tx; file a verdict to the ValidationRegistry." },
      { method: "GET", path: "/v1/scent/:token", what: "Token report: registry, bytecode, proxies, privileges, owner, simulated buy and sell. Never “safe”." },
      { method: "GET", path: "/v1/flock/:address · /stream", what: "Wallet, Gateway unified balance and venue positions in one sheet." },
    ],
  },
];

export const CURL_PLAN = `curl -s "$LYKIA/v1/intents" \\
  -H "content-type: application/json" \\
  -d '{
    "text": "convert 200 USDC to EURC",
    "owner": "0xYourAddress",
    "environment": "testnet",
    "signer": "agent"
  }'`;

export const CURL_SCENT = `curl -s "$LYKIA/v1/scent/0xTokenAddress?environment=mainnet"`;

export const MCP_CONFIG = `{
  "mcpServers": {
    "lykia": {
      "type": "http",
      "url": "https://your-lykia-api.example/v1/mcp"
    }
  }
}`;

export const X402_FLOW = `GET /v1/scent/0xToken?deep=1
→ 402 Payment Required
  { "accepts": [{ "scheme": "exact", "network": "eip155:5042",
                  "asset": "USDC", "maxAmountRequired": "1000", ... }] }
GET /v1/scent/0xToken?deep=1
  X-PAYMENT: <EIP-3009 authorization signed by the agent>
→ 200 { "level": "no-red-flags", "deep": true, ... }`;

export const ARC_FEATURES: ReadonlyArray<readonly [string, string]> = [
  ["USDC gas", "Fees are paid in USDC; agents hold one balance. Native USDC has 18 decimals, the ERC-20 face 6: Lykia converts exactly."],
  ["Deterministic finality", "A receipt is final in under a second, so an Outrun advances on receipts, not confirmations."],
  ["Arc Memo", "Every value-moving call carries the outrun id, step id and Fence verdict digest."],
  ["Multicall3From", "Approve and act in one transaction while keeping msg.sender."],
  ["CCTP V2", "Burn on Arc, mint native USDC on Base, Ethereum, Arbitrum, Solana and more."],
  ["Gateway", "One unified USDC balance across chains; the Flock reads it."],
  ["StableFX", "RFQ FX between USDC and EURC, settled by FxEscrow; the Fence checks the band."],
  ["ERC-8004", "Agent identity, reputation and validation; the Künye lives here."],
];
