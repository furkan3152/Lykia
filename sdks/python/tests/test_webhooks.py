import hashlib
import hmac
import json

import pytest

from lykia import WebhookSignatureError, construct_event, sign, verify


def test_matches_the_server_scheme():
    body = json.dumps({"id": "evt_1", "type": "payout.sent", "data": {"amount": "5"}})
    t = 1_800_000_000
    expected = hmac.new(b"whsec_x", f"{t}.{body}".encode(), hashlib.sha256).hexdigest()
    assert sign("whsec_x", body, t) == f"t={t},v1={expected}"
    assert verify("whsec_x", body, sign("whsec_x", body, t), now=t + 5)


def test_refuses_tampering_staleness_and_garbage():
    body = '{"id":"evt_1"}'
    header = sign("whsec_x", body, 100)
    assert not verify("whsec_x", body + " ", header, now=100)
    assert not verify("whsec_x", body, header, now=100 + 301)
    assert not verify("whsec_other", body, header, now=100)
    assert not verify("whsec_x", body, "garbage", now=100)
    assert not verify("whsec_x", body, None, now=100)


def test_construct_event_accepts_rotated_secrets_and_bytes():
    body = b'{"id":"evt_2","type":"invoice.paid"}'
    t = 500
    old = sign("whsec_old", body, t).split("v1=")[1]
    new = sign("whsec_new", body, t).split("v1=")[1]
    event = construct_event("whsec_new", body, f"t={t},v1={old},v1={new}", now=t)
    assert event["type"] == "invoice.paid"
    with pytest.raises(WebhookSignatureError):
        construct_event("whsec_new", body, f"t={t},v1={old}", now=t)
