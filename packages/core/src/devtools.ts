/**
 * Circle and Arc developer tools Lykia builds with or points builders to.
 * Every link is from Arc's own documentation index (docs.arc.io/llms.txt,
 * read 2026-11-01) or Circle's skills repository.
 */
export interface DevTool {
  readonly id: string;
  readonly name: string;
  readonly kind: "sdk" | "skill" | "mcp" | "docs" | "tooling";
  readonly summary: string;
  readonly url: string;
  /** How Lykia relates to it. */
  readonly inLykia: string;
  readonly install?: string;
}

export const DEV_TOOLS: readonly DevTool[] = [
  { id: "app-kit", name: "Circle App Kits", kind: "sdk", summary: "Bridge, Swap, Unified Balance, Onramp, Earn and Borrow kits in one SDK over CCTP; Borrow Kit lends USDC against cirBTC on Arc.", url: "https://docs.arc.io/app-kit.md", inLykia: "An alternative execution path next to Lykia's router: the same Fence check applies to whatever the kit is asked to do.", install: "npm i @circle-fin/app-kit @circle-fin/adapter-viem-v2" },
  { id: "circle-skills", name: "Circle Skills", kind: "skill", summary: "Open-source agent skills: use-arc, use-usdc, use-gateway, wallets and the smart contract platform.", url: "https://docs.arc.io/ai/skills.md", inLykia: "Recommended context for any agent building against Lykia's API on Arc.", install: "npx skills add circlefin/skills" },
  { id: "arc-mcp", name: "Arc docs MCP server", kind: "mcp", summary: "Search and full-page retrieval of Arc's documentation from AI coding tools.", url: "https://docs.arc.io/ai/mcp.md", inLykia: "Pair it with Lykia's own MCP server (/v1/mcp): Arc's for the docs, Lykia's for plans, Fence verdicts and Scent." },
  { id: "arc-foundry", name: "Arc Foundry", kind: "tooling", summary: "Arc's fork of Foundry (arc-forge, arc-cast, arc-anvil) that handles USDC gas and Arc's EVM differences.", url: "https://docs.arc.io/arc/tutorials/install-arc-foundry.md", inLykia: "Lykia's contracts build with Hardhat; Arc Foundry is the way to replay or fork-test them against Arc." },
  { id: "evm-differences", name: "Arc EVM differences", kind: "docs", summary: "Native USDC with 18 decimals, the system Transfer emitter, the 20 gwei fee floor, address(0) sends revert.", url: "https://docs.arc.io/arc/references/evm-differences.md", inLykia: "Lykia's balance reads and decimals follow it: native face 18, ERC-20 face 6." },
  { id: "contract-addresses", name: "Arc contract addresses", kind: "docs", summary: "Stablecoins, CCTP, Gateway, StableFX and ERC-8004 on mainnet and testnet.", url: "https://docs.arc.io/arc/references/contract-addresses.md", inLykia: "The source for Lykia's token and Circle registry." },
  { id: "agentic-economy", name: "Agentic economy on Arc", kind: "docs", summary: "How agents coordinate, contract and settle value in real time on Arc.", url: "https://docs.arc.io/build/agentic-economy.md", inLykia: "Lykia's Pack, Tag (ERC-8004) and x402 endpoints implement this for agents under a Fence." },
  { id: "erc8004-tutorial", name: "Register your first AI agent", kind: "docs", summary: "ERC-8004 identity, reputation and credentials on Arc testnet.", url: "https://docs.arc.io/arc/tutorials/register-your-first-ai-agent.md", inLykia: "Tag licences are ERC-8004 identities that pin the Fence an agent obeys." },
  { id: "arc-studio", name: "Arc Studio CLI", kind: "tooling", summary: "Write, audit and deploy on-chain code from the terminal or a coding agent.", url: "https://docs.arc.io/ai/arc-studio-cli.md", inLykia: "Useful for builders shipping venues that Lykia can later route to." },
  { id: "circle-dev-docs", name: "Circle developer docs", kind: "docs", summary: "Wallets, Gateway, CCTP, StableFX, compliance and nanopayments across Circle's platform.", url: "https://developers.circle.com/llms.txt", inLykia: "Lykia's Circle page uses Gateway, CCTP, StableFX, compliance screening and nanopayments from here." },
];
