# CLI: `@lykia/cli`

```sh
npm install -g @lykia/cli
lykia login --key lk_test_…          # checks the key, saves it to ~/.config/lykia/config.json (0600)
```

| Command | Does |
|---|---|
| `lykia whoami` | Developer, plan, API |
| `lykia keys list` | Keys with mode and scopes |
| `lykia keys create --label ci --mode test --scopes read,quote --ips 203.0.113.0/24` | New key (shown once) |
| `lykia keys rotate ID --overlap 3600` / `lykia keys revoke ID` | Rotate with an overlap window / revoke |
| `lykia quote --from USDC --to EURC --amount 100 --env testnet` | Best route and the alternatives |
| `lykia plan "send 5 USDC to 0x…" --owner 0x… [--save]` | Plan a sentence (dry run unless `--save`) |
| `lykia webhooks listen --forward-to http://localhost:3000/hooks [--events a,b]` | Forward your events to localhost, signed with a session secret |
| `lykia webhooks test [--endpoint ID] [--type payout.sent]` / `deliveries` / `events` | Test events, delivery log, event feed |
| `lykia logs tail [--status error] [--key ID]` / `lykia logs list` | Follow or list request logs |
| `lykia leash create --template trade-small --per-day 50 --days 7 [--per-step 25] [--total 350] [--name NAME] [--recipient 0x…] [--signer 0x…]` | Put an agent on a leash: prints the session transaction to sign and the leash key (once). Without `--signer` it makes the agent's session key on your machine and writes it to `lykia-<leash>.session-key.json` (0600); only the address goes to the API. |
| `lykia leash ls` / `get ID` / `trail ID` / `revoke ID` / `bind ID --tx 0x…` | Leashes with today's and the total spend, one leash with its on-chain `spendable`, the trail with chain-proven marks, revoke (prints `revokeSession` to sign), bind the session once it landed |
| `lykia usage` / `lykia plan-info` / `lykia openapi` | Usage, plan, reference links |

`--json` prints raw JSON. `LYKIA_API_KEY`, `LYKIA_BASE_URL` and `LYKIA_CONFIG`
override the saved settings. Account commands need a key with the `admin`
scope (reads need `read`).
