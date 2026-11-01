"""Verifying Lykia webhooks.

The ``Lykia-Signature`` header is ``t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>``.
Pass the raw request body exactly as received. During a secret rotation the
header may carry several ``v1`` entries; any match is accepted.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional, Union

from .errors import WebhookSignatureError

TOLERANCE_SECONDS = 300

Body = Union[str, bytes]


def _text(body: Body) -> str:
    return body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else body


def sign(secret: str, body: Body, timestamp: Optional[int] = None) -> str:
    """Signs a body the way Lykia does (for tests of your receiver)."""
    t = int(time.time()) if timestamp is None else timestamp
    mac = hmac.new(secret.encode("utf-8"), f"{t}.{_text(body)}".encode("utf-8"), hashlib.sha256).hexdigest()
    return f"t={t},v1={mac}"


def verify(secret: str, body: Body, header: Optional[str], now: Optional[int] = None, tolerance: int = TOLERANCE_SECONDS) -> bool:
    """True when the header was made with ``secret`` for ``body`` within ``tolerance`` seconds."""
    if not header:
        return False
    pairs = [part.strip().split("=", 1) for part in header.split(",")]
    timestamps = [v for k, v in (p for p in pairs if len(p) == 2) if k == "t"]
    signatures = [v for k, v in (p for p in pairs if len(p) == 2) if k == "v1" and v]
    if not timestamps or not signatures:
        return False
    try:
        t = int(timestamps[0])
    except ValueError:
        return False
    current = int(time.time()) if now is None else now
    if abs(current - t) > tolerance:
        return False
    expected = hmac.new(secret.encode("utf-8"), f"{t}.{_text(body)}".encode("utf-8"), hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(s, expected) for s in signatures)


def construct_event(secret: str, body: Body, header: Optional[str], now: Optional[int] = None, tolerance: int = TOLERANCE_SECONDS) -> Dict[str, Any]:
    """Verifies a delivery and returns the parsed event, or raises WebhookSignatureError."""
    if not verify(secret, body, header, now=now, tolerance=tolerance):
        raise WebhookSignatureError("The Lykia-Signature header does not match this body and secret.")
    return json.loads(_text(body))
