# Circle MCP + Lykia MCP, and Lykia skills

Circle's MCP server answers documentation and code-generation questions
(SDK signatures, contract addresses, chain ids). It does not execute
anything. Arc's docs MCP is the same kind of tool. Lykia's MCP server plans
and checks: it returns Fence verdicts, routes and unsigned plans, and never
signs. Use them side by side.

## One config for both

```json
{
  "mcpServers": {
    "circle": { "url": "https://api.circle.com/v1/codegen/mcp" },
    "lykia": { "url": "https://lykia-api-akdogan1.vercel.app/v1/mcp" }
  }
}
```

| Question | Server |
|---|---|
| "What is the CCTP TokenMessengerV2 address on Arc?" "How do I call kit.bridge()?" | circle |
| "Is this plan inside my Fence?" "Best route for 100 USDC to EURC on Arc?" "Plan: put half my USDC to work" | lykia |

## Skills

Circle Skills (https://github.com/circlefin/skills) are Claude Code plugin
skills: one folder per skill with a `SKILL.md` whose front matter has
`name`, `description` and `requirements`. Lykia publishes its own skills in
the same format under [`skills/`](../../skills) (plugin manifest
`skills/.claude-plugin/plugin.json`, MCP config `skills/.mcp.json`):

| Skill | What it teaches an agent |
|---|---|
| `lykia-fence-preflight` | Check every step against a Fence before a Circle wallet signs |
| `lykia-circle-policy` | Compile a Fence into a Circle Agent Wallet spending policy and hand the owner the CLI commands |
| `lykia-plan-and-route` | Turn an intent into a Fence-checked plan across Arc venues |
| `lykia-pay-marketplace-service` | Discover Agent Marketplace services and pay them inside the Fence |

Install in Claude Code from a clone of this repository:

```shell
/plugin marketplace add ./skills
/plugin install lykia-skills@lykia
```
