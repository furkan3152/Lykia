# lykia (Python)

Python client for the Lykia API, built on Arc Network. Typed, built on httpx,
with retries, idempotency keys, pagination and webhook verification.

```python
from lykia import Lykia, construct_event

lykia = Lykia("lk_test_…", base_url="https://api.lykiaai.com", environment="testnet")
plan = lykia.intents.create("0xOwner", "send 5 USDC to 0xFriend")
event = construct_event(secret, raw_body, headers["Lykia-Signature"])

# A leash: a budget an outside agent cannot exceed.
created = lykia.leashes.create(agent={"name": "Invoice bot", "signer": agent_address}, template="pay-invoices",
                               budget={"perStepUsd": "20", "perDayUsd": "20", "totalUsd": "140"},
                               expires_at="2026-11-15T00:00:00Z", recipients=[payee])
agent = Lykia(created["apiKey"]["secret"], base_url="https://api.lykiaai.com")
plan = agent.leashes.plan(created["leash"]["id"], f"pay 12 USDC to {payee}")  # LykiaError LEASH_DENIED outside it
```

Tests run offline: `pip install -e '.[test]' && pytest`. See
[docs/platform/sdks.md](../../docs/platform/sdks.md).
