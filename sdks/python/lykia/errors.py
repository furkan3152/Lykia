"""The API's error envelope as exceptions."""
from __future__ import annotations

from typing import Any, Optional


class LykiaError(Exception):
    """Raised for every non-2xx answer: { error: { code, message, details?, requestId } }."""

    def __init__(self, code: str, status: int, message: str, details: Any = None, request_id: Optional[str] = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message
        self.details = details
        self.request_id = request_id

    @property
    def retryable(self) -> bool:
        return self.status == 429 or self.status >= 500 or self.status == 0

    def __repr__(self) -> str:
        return f"LykiaError(code={self.code!r}, status={self.status}, request_id={self.request_id!r})"


class WebhookSignatureError(Exception):
    """The Lykia-Signature header does not match the body and secret, or is too old."""
