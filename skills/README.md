# Lykia skills

Agent skills in the Circle Skills format (one folder per skill, a `SKILL.md`
with `name`, `description` and `requirements`). They pair with Circle's own
skills (https://github.com/circlefin/skills) and with Circle's MCP server
for documentation; Lykia's MCP server does the planning and Fence checks.

| Skill | Use it when |
|---|---|
| [lykia-fence-preflight](skills/lykia-fence-preflight/SKILL.md) | An agent with a Circle wallet is about to move value |
| [lykia-circle-policy](skills/lykia-circle-policy/SKILL.md) | Setting spending limits on a Circle Agent Wallet from a Fence |
| [lykia-plan-and-route](skills/lykia-plan-and-route/SKILL.md) | Turning an intent into a plan across Arc venues |
| [lykia-pay-marketplace-service](skills/lykia-pay-marketplace-service/SKILL.md) | Paying for an x402 service from the Agent Marketplace |

Install in an assistant that reads this plugin format: `/plugin marketplace add ./skills` then
`/plugin install lykia-skills@lykia`. Lykia is built on Arc Network and
Circle's products; it is not affiliated with or endorsed by Circle.
