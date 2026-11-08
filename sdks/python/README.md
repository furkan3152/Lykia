# lykia (Python)

Python client for the Lykia API, built on Arc Network. Typed, built on httpx,
with retries, idempotency keys, pagination and webhook verification.

```python
from lykia import Lykia, construct_event

lykia = Lykia("lk_test_…", base_url="https://api.lykiaai.com", environment="testnet")
plan = lykia.intents.create("0xOwner", "send 5 USDC to 0xFriend")
event = construct_event(secret, raw_body, headers["Lykia-Signature"])
```

Tests run offline: `pip install -e '.[test]' && pytest`. See
[docs/platform/sdks.md](../../docs/platform/sdks.md).
