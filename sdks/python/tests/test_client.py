"""Offline tests: every request goes to an httpx.MockTransport."""
import asyncio
import json

import httpx
import pytest

from lykia import AsyncLykia, Lykia, LykiaError, OPERATIONS, operation_path


def make(handler, **kwargs):
    return Lykia("lk_test_abcdefabcdef_" + "A" * 32, base_url="https://api.test/", http=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _s: None, **kwargs)


def test_sends_key_version_and_one_idempotency_key_across_retries():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if len(seen) < 3:
            return httpx.Response(503 if len(seen) == 1 else 429, json={"error": {"code": "RATE_LIMITED", "message": "slow"}}, headers={"retry-after": "0"})
        return httpx.Response(201, json={"intent": {"id": "out_abc123"}})

    client = make(handler, api_version="2026-11-01")
    out = client.intents.create(owner="0x" + "1" * 40, text="send 1 usdc", environment="testnet")
    assert out["intent"]["id"] == "out_abc123"
    assert len(seen) == 3
    assert {r.headers["idempotency-key"] for r in seen} == {seen[0].headers["idempotency-key"]}
    assert seen[0].headers["lykia-key"].startswith("lk_test_")
    assert seen[0].headers["lykia-version"] == "2026-11-01"
    assert json.loads(seen[0].content)["environment"] == "testnet"


def test_raises_the_error_envelope():
    def handler(request):
        return httpx.Response(403, json={"error": {"code": "LIVE_MODE_REQUIRED", "message": "Test keys only work on testnet.", "requestId": "req_1"}})

    with pytest.raises(LykiaError) as raised:
        make(handler).get("/v1/venues", {"environment": "mainnet"})
    assert raised.value.code == "LIVE_MODE_REQUIRED"
    assert raised.value.status == 403
    assert raised.value.request_id == "req_1"
    assert not raised.value.retryable


def test_paginates_logs_and_calls_operations_by_id():
    def handler(request):
        if request.url.path == "/v1/logs":
            if request.url.params.get("cursor") == "c2":
                return httpx.Response(200, json={"data": [{"requestId": "r3"}], "nextCursor": None})
            return httpx.Response(200, json={"data": [{"requestId": "r1"}, {"requestId": "r2"}], "nextCursor": "c2"})
        return httpx.Response(200, json={"path": request.url.path, "query": str(request.url.query, "ascii") if isinstance(request.url.query, bytes) else request.url.query})

    client = make(handler)
    assert [e["requestId"] for e in client.logs.iterate(statusClass="error")] == ["r1", "r2", "r3"]
    assert "postIntents" in OPERATIONS and OPERATIONS["postIntents"].idempotent
    assert operation_path("/v1/intents/{id}/steps/{sid}/prepare", {"id": "out_x1", "sid": "s1"}) == "/v1/intents/out_x1/steps/s1/prepare"
    out = client.call("getVenues", query={"environment": "testnet"})
    assert out["path"] == "/v1/venues"
    with pytest.raises(ValueError):
        operation_path("/v1/intents/{id}")


def test_keys_rotate_and_webhook_test():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    client = make(handler)
    client.keys.rotate("abcdefabcdef", overlap_seconds=60)
    client.webhooks.test(event_type="payout.sent")
    assert seen[0].url.path == "/v1/developers/keys/abcdefabcdef/rotate"
    assert json.loads(seen[0].content) == {"overlapSeconds": 60}
    assert json.loads(seen[1].content) == {"type": "payout.sent"}


def test_network_errors_retry_then_raise():
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ConnectError("down")

    with pytest.raises(LykiaError) as raised:
        make(handler, retries=1).get("/v1/health")
    assert raised.value.code == "NETWORK_ERROR"
    assert len(calls) == 2


def test_async_client():
    async def run():
        def handler(request):
            return httpx.Response(200, json={"data": [{"id": "evt_1"}], "nextCursor": None})

        client = AsyncLykia("lk_test_x", base_url="https://api.test", http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        items = [e async for e in client.paginate("/v1/events")]
        await client.aclose()
        return items

    assert asyncio.run(run()) == [{"id": "evt_1"}]


def test_leashes_call_the_documented_routes_and_surface_denials():
    seen = []
    leash = "lsh_0123456789ab"

    def handler(request):
        seen.append((request.method, request.url.raw_path.decode(), json.loads(request.content) if request.content else None))
        if request.url.path.endswith("/plan"):
            return httpx.Response(422, json={"error": {"code": "LEASH_DENIED", "message": "Over the cap.", "details": {"reasons": [{"code": "fence.caps.step", "message": "Over the cap."}], "remaining": {"stepUsd": "20.00", "dayUsd": "20.00", "totalUsd": "140.00"}}}})
        return httpx.Response(200, json={"ok": True})

    client = make(handler, environment="mainnet")
    client.leashes.create(agent={"name": "Invoice bot", "signer": "0x" + "7" * 40}, template="pay-invoices", budget={"perStepUsd": "20", "perDayUsd": "20", "totalUsd": "140"}, expires_at="2026-11-15T00:00:00Z", recipients=["0x" + "2" * 40])
    client.leashes.list()
    client.leashes.get(leash)
    client.leashes.trail(leash)
    client.leashes.revoke(leash)
    client.leashes.renew(leash, expires_at="2026-11-22T00:00:00Z")
    client.leashes.submit(leash, "out_abcdefgh", "s1", "0x" + "b" * 64)
    with pytest.raises(LykiaError) as raised:
        client.leashes.plan(leash, "pay 30 USDC to 0x" + "2" * 40)
    assert raised.value.code == "LEASH_DENIED"
    assert raised.value.details["reasons"][0]["code"] == "fence.caps.step"
    assert raised.value.details["remaining"]["dayUsd"] == "20.00"
    routes = [f"{m} {p}" for m, p, _ in seen]
    assert routes[:7] == [
        "POST /v1/leashes",
        "GET /v1/leashes?environment=mainnet",
        f"GET /v1/leashes/{leash}",
        f"GET /v1/leashes/{leash}/trail",
        f"POST /v1/leashes/{leash}/revoke",
        f"POST /v1/leashes/{leash}/renew",
        f"POST /v1/leashes/{leash}/submit",
    ]
    assert seen[0][2]["expiresAt"] == "2026-11-15T00:00:00Z"
    assert seen[0][2]["environment"] == "mainnet"
    assert seen[5][2] == {"expiresAt": "2026-11-22T00:00:00Z"}
