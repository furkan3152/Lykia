# Rate limits and quotas

| Layer | Default | Answer when exceeded |
|---|---|---|
| Per IP (anonymous and keyed) | 600/min, heavy routes 60/min | 429 `RATE_LIMITED` |
| Per key | 120/min, 20,000/day (set per key, up to 6,000/min) | 429 `RATE_LIMITED` |
| Per project | the plan's per-minute and per-day limits, lowered with `PUT /v1/projects/:id/limits` | 429 `RATE_LIMITED` |
| Per account, per month (live keys) | the plan's included requests | Free: 429 `QUOTA_EXCEEDED`. Pay as you go: credits or x402, else 402 |

Requests refused for a missing scope still count. Test-key requests count
against key and project limits but never against the monthly quota.

## Headers

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` | The key's per-minute window (reset in seconds) |
| `X-Daily-Quota-Limit`, `X-Daily-Quota-Remaining` | The key's day |
| `X-Monthly-Quota-Limit`, `X-Monthly-Quota-Used` | The account's month (live keys) |
| `RateLimit`, `RateLimit-Policy` | IETF draft fields, one entry per policy (`"default"`, `"key"`, `"key-day"`, `"project"`) |
| `Retry-After` | Seconds to wait, on 429 |

The SDKs and the CLI honour `Retry-After` automatically.
