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
| `lykia usage` / `lykia plan-info` / `lykia openapi` | Usage, plan, reference links |

`--json` prints raw JSON. `LYKIA_API_KEY`, `LYKIA_BASE_URL` and `LYKIA_CONFIG`
override the saved settings. Account commands need a key with the `admin`
scope (reads need `read`).
