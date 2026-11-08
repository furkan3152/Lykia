"""The Lykia client (sync and async), built on httpx.

Retries rate limits and transient failures with backoff (GETs always; other
methods only when the server never processed them: 429, 502, 503, 504, or a
network error), sends one Idempotency-Key per logical POST (the same key on
every retry), pins ``Lykia-Version`` when asked, and raises ``LykiaError``
with the API's stable error code and request id.
"""
from __future__ import annotations

import random
import time
import uuid
from typing import Any, AsyncIterator, Callable, Dict, Iterator, List, Mapping, Optional
from urllib.parse import quote, urlencode

import httpx

from ._operations import OPERATIONS
from .errors import LykiaError

DEFAULT_BASE_URL = "http://localhost:3002"
RETRY_STATUSES = {429, 502, 503, 504}
Json = Any


def _backoff(attempt: int) -> float:
    return min(0.25 * (2**attempt), 4.0) + random.random() * 0.1


def _query(params: Optional[Mapping[str, Any]]) -> str:
    if not params:
        return ""
    items = [(k, str(v).lower() if isinstance(v, bool) else str(v)) for k, v in params.items() if v is not None]
    return f"?{urlencode(items)}" if items else ""


def operation_path(path: str, params: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> str:
    """Fills {name} placeholders of an OpenAPI path and appends the query."""
    out = path
    for name, value in (params or {}).items():
        out = out.replace("{" + name + "}", quote(str(value), safe=""))
    if "{" in out:
        raise ValueError(f"Missing path parameters in {out}")
    return out + _query(query)


def _error_from(response: httpx.Response) -> LykiaError:
    try:
        body = response.json()
    except ValueError:
        body = {}
    error = body.get("error", {}) if isinstance(body, dict) else {}
    return LykiaError(
        code=error.get("code") or ("RATE_LIMITED" if response.status_code == 429 else "HTTP_ERROR"),
        status=response.status_code,
        message=error.get("message") or f"HTTP {response.status_code}",
        details=error.get("details"),
        request_id=error.get("requestId") or response.headers.get("x-request-id"),
    )


class _Base:
    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        session: Optional[str] = None,
        api_version: Optional[str] = None,
        environment: Optional[str] = None,
        retries: int = 2,
        timeout: float = 30.0,
        headers: Optional[Mapping[str, str]] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.session = session
        self.api_version = api_version
        self.environment = environment
        self.retries = retries
        self.timeout = timeout
        self.extra_headers = dict(headers or {})

    def _headers(self, method: str, idempotency_key: Optional[str], extra: Optional[Mapping[str, str]]) -> Dict[str, str]:
        h = {"accept": "application/json", **self.extra_headers}
        if self.api_key:
            h["Lykia-Key"] = self.api_key
        if self.session:
            h["Lykia-Session"] = self.session
        if self.api_version:
            h["Lykia-Version"] = self.api_version
        if method != "GET" and idempotency_key:
            h["Idempotency-Key"] = idempotency_key
        h.update(extra or {})
        return h

    def _env(self, query: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if self.environment and (query is None or "environment" not in query):
            return {**(query or {}), "environment": self.environment}
        return query

    @staticmethod
    def _retry_after(response: httpx.Response, attempt: int) -> float:
        raw = response.headers.get("retry-after")
        if raw and raw.isdigit() and int(raw) > 0:
            return min(int(raw), 10)
        return _backoff(attempt)


class Lykia(_Base):
    """Synchronous client.

    >>> lykia = Lykia("lk_test_...", base_url="https://api.example")
    >>> venues = lykia.get("/v1/venues", query={"environment": "testnet"})
    """

    def __init__(self, api_key: Optional[str] = None, *, http: Optional[httpx.Client] = None, sleep: Callable[[float], None] = time.sleep, **kwargs: Any) -> None:
        super().__init__(api_key, **kwargs)
        self._http = http or httpx.Client(timeout=self.timeout)
        self._sleep = sleep
        self.keys = _Keys(self)
        self.webhooks = _Webhooks(self)
        self.events = _Events(self)
        self.logs = _Logs(self)
        self.billing = _Billing(self)
        self.intents = _Intents(self)
        self.leashes = _Leashes(self)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Lykia":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def request(self, method: str, path: str, *, body: Json = None, query: Optional[Dict[str, Any]] = None, idempotency_key: Optional[str] = None, headers: Optional[Mapping[str, str]] = None) -> Json:
        method = method.upper()
        key = idempotency_key or (uuid.uuid4().hex if method == "POST" else None)
        url = f"{self.base_url}{path}{_query(query)}"
        attempt = 0
        while True:
            try:
                response = self._http.request(method, url, headers=self._headers(method, key, headers), **({"json": body} if body is not None else {}))
            except httpx.TransportError as error:
                if attempt >= self.retries:
                    raise LykiaError("NETWORK_ERROR", 0, str(error)) from error
                self._sleep(_backoff(attempt))
                attempt += 1
                continue
            if response.is_success:
                return None if response.status_code == 204 or not response.content else response.json()
            if response.status_code in RETRY_STATUSES and attempt < self.retries:
                self._sleep(self._retry_after(response, attempt))
                attempt += 1
                continue
            raise _error_from(response)

    def get(self, path: str, query: Optional[Dict[str, Any]] = None) -> Json:
        return self.request("GET", path, query=self._env(query))

    def post(self, path: str, body: Json = None, idempotency_key: Optional[str] = None) -> Json:
        return self.request("POST", path, body={} if body is None else body, idempotency_key=idempotency_key)

    def call(self, operation_id: str, *, params: Optional[Mapping[str, Any]] = None, query: Optional[Dict[str, Any]] = None, body: Json = None, idempotency_key: Optional[str] = None) -> Json:
        """Calls any documented route by its OpenAPI operationId (see lykia._operations)."""
        op = OPERATIONS[operation_id]
        return self.request(op.method, operation_path(op.path, params, query), body=body if body is not None or op.method in ("GET", "DELETE") else {}, idempotency_key=idempotency_key)

    def paginate(self, path: str, query: Optional[Dict[str, Any]] = None, max_pages: int = 100) -> Iterator[Json]:
        """Yields every item of a cursor-paginated list ({ data, nextCursor })."""
        cursor: Optional[str] = None
        for _ in range(max_pages):
            page = self.get(path, {**(query or {}), **({"cursor": cursor} if cursor else {})})
            for item in page.get("data", []):
                yield item
            cursor = page.get("nextCursor")
            if not cursor:
                return


class AsyncLykia(_Base):
    """Asynchronous client with the same behaviour as ``Lykia``."""

    def __init__(self, api_key: Optional[str] = None, *, http: Optional[httpx.AsyncClient] = None, **kwargs: Any) -> None:
        super().__init__(api_key, **kwargs)
        self._http = http or httpx.AsyncClient(timeout=self.timeout)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def request(self, method: str, path: str, *, body: Json = None, query: Optional[Dict[str, Any]] = None, idempotency_key: Optional[str] = None, headers: Optional[Mapping[str, str]] = None) -> Json:
        import asyncio

        method = method.upper()
        key = idempotency_key or (uuid.uuid4().hex if method == "POST" else None)
        url = f"{self.base_url}{path}{_query(query)}"
        attempt = 0
        while True:
            try:
                response = await self._http.request(method, url, headers=self._headers(method, key, headers), **({"json": body} if body is not None else {}))
            except httpx.TransportError as error:
                if attempt >= self.retries:
                    raise LykiaError("NETWORK_ERROR", 0, str(error)) from error
                await asyncio.sleep(_backoff(attempt))
                attempt += 1
                continue
            if response.is_success:
                return None if response.status_code == 204 or not response.content else response.json()
            if response.status_code in RETRY_STATUSES and attempt < self.retries:
                await asyncio.sleep(self._retry_after(response, attempt))
                attempt += 1
                continue
            raise _error_from(response)

    async def get(self, path: str, query: Optional[Dict[str, Any]] = None) -> Json:
        return await self.request("GET", path, query=self._env(query))

    async def post(self, path: str, body: Json = None, idempotency_key: Optional[str] = None) -> Json:
        return await self.request("POST", path, body={} if body is None else body, idempotency_key=idempotency_key)

    async def paginate(self, path: str, query: Optional[Dict[str, Any]] = None, max_pages: int = 100) -> AsyncIterator[Json]:
        cursor: Optional[str] = None
        for _ in range(max_pages):
            page = await self.get(path, {**(query or {}), **({"cursor": cursor} if cursor else {})})
            for item in page.get("data", []):
                yield item
            cursor = page.get("nextCursor")
            if not cursor:
                return


class _Part:
    def __init__(self, client: Lykia) -> None:
        self._c = client


class _Intents(_Part):
    def create(self, owner: str, text: Optional[str] = None, *, actions: Optional[List[Json]] = None, environment: Optional[str] = None, idempotency_key: Optional[str] = None, **extra: Any) -> Json:
        body: Dict[str, Any] = {"owner": owner, **extra}
        if text is not None:
            body["text"] = text
        if actions is not None:
            body["actions"] = actions
        if environment or self._c.environment:
            body["environment"] = environment or self._c.environment
        return self._c.post("/v1/intents", body, idempotency_key)

    def get(self, intent_id: str) -> Json:
        return self._c.request("GET", f"/v1/intents/{quote(intent_id, safe='')}")

    def prepare(self, intent_id: str, step_id: str, confirm: bool = False) -> Json:
        return self._c.post(f"/v1/intents/{quote(intent_id, safe='')}/steps/{quote(step_id, safe='')}/prepare", {"confirm": True} if confirm else {})

    def submit(self, intent_id: str, step_id: str, hashes: List[str]) -> Json:
        return self._c.post(f"/v1/intents/{quote(intent_id, safe='')}/steps/{quote(step_id, safe='')}/submit", {"hashes": hashes})


class _Leashes(_Part):
    """A budget an outside agent cannot exceed.

    The owner creates, lists, revokes and renews (a session, or a secret key
    with the agents scope). The agent plans and submits with its own leash
    key (``lk_leash_...``), which can do nothing else. A plan outside the
    leash raises ``LykiaError`` with code ``LEASH_DENIED``; its ``details``
    carry the reason codes and the remaining budget.
    """

    def _path(self, leash_id: str, rest: str = "") -> str:
        return f"/v1/leashes/{quote(leash_id, safe='')}{rest}"

    def templates(self) -> Json:
        return self._c.request("GET", "/v1/leashes/templates")

    def create(self, *, budget: Dict[str, str], expires_at: str, agent: Optional[Dict[str, Any]] = None, parent_agent_id: Optional[str] = None, template: Optional[str] = None, recipients: Optional[List[str]] = None, venues: Optional[List[str]] = None, environment: Optional[str] = None, idempotency_key: Optional[str] = None, **extra: Any) -> Json:
        body: Dict[str, Any] = {"budget": budget, "expiresAt": expires_at, **extra}
        if agent is not None:
            body["agent"] = agent
        if parent_agent_id is not None:
            body["parentAgentId"] = parent_agent_id
        if template is not None:
            body["template"] = template
        if recipients is not None:
            body["recipients"] = recipients
        if venues is not None:
            body["venues"] = venues
        if environment or self._c.environment:
            body["environment"] = environment or self._c.environment
        return self._c.post("/v1/leashes", body, idempotency_key)

    def list(self, owner: Optional[str] = None, environment: Optional[str] = None) -> Json:
        return self._c.request("GET", "/v1/leashes", query={"owner": owner, "environment": environment or self._c.environment})

    def get(self, leash_id: str) -> Json:
        return self._c.request("GET", self._path(leash_id))

    def revoke(self, leash_id: str) -> Json:
        return self._c.post(self._path(leash_id, "/revoke"), {})

    def renew(self, leash_id: str, *, expires_at: str, budget: Optional[Dict[str, str]] = None, **extra: Any) -> Json:
        body: Dict[str, Any] = {"expiresAt": expires_at, **extra}
        if budget is not None:
            body["budget"] = budget
        return self._c.post(self._path(leash_id, "/renew"), body)

    def trail(self, leash_id: str) -> Json:
        return self._c.request("GET", self._path(leash_id, "/trail"))

    def bind_session(self, leash_id: str, tx_hash: Optional[str] = None) -> Json:
        return self._c.post(self._path(leash_id, "/session"), {"txHash": tx_hash} if tx_hash else {})

    def plan(self, leash_id: str, text: Optional[str] = None, *, actions: Optional[List[Json]] = None, dry_run: bool = False) -> Json:
        body: Dict[str, Any] = {"text": text} if text is not None else {"actions": actions or []}
        if dry_run:
            body["dryRun"] = True
        return self._c.post(self._path(leash_id, "/plan"), body)

    def submit(self, leash_id: str, intent_id: str, step_id: str, tx_hash: str) -> Json:
        return self._c.post(self._path(leash_id, "/submit"), {"intentId": intent_id, "stepId": step_id, "hash": tx_hash})


class _Keys(_Part):
    def list(self) -> Json:
        return self._c.request("GET", "/v1/developers/keys")["keys"]

    def create(self, label: str, *, mode: str = "test", kind: str = "secret", scopes: Optional[List[str]] = None, allowed_ips: Optional[List[str]] = None, **extra: Any) -> Json:
        body: Dict[str, Any] = {"label": label, "mode": mode, "kind": kind, **extra}
        if scopes is not None:
            body["scopes"] = scopes
        if allowed_ips is not None:
            body["allowedIps"] = allowed_ips
        return self._c.post("/v1/developers/keys", body)

    def update(self, key_id: str, **patch: Any) -> Json:
        return self._c.request("PATCH", f"/v1/developers/keys/{key_id}", body=patch)

    def rotate(self, key_id: str, overlap_seconds: Optional[int] = None) -> Json:
        return self._c.post(f"/v1/developers/keys/{key_id}/rotate", {} if overlap_seconds is None else {"overlapSeconds": overlap_seconds})

    def revoke(self, key_id: str) -> Json:
        return self._c.post(f"/v1/developers/keys/{key_id}/revoke", {})


class _Webhooks(_Part):
    def list(self) -> Json:
        return self._c.request("GET", "/v1/developers/webhooks")

    def create(self, url: str, events: Optional[List[str]] = None, **extra: Any) -> Json:
        return self._c.post("/v1/developers/webhooks", {"url": url, **({"events": events} if events else {}), **extra})

    def deliveries(self, **query: Any) -> Json:
        return self._c.request("GET", "/v1/developers/webhooks/deliveries", query=query)["deliveries"]

    def replay(self, delivery_id: str) -> Json:
        return self._c.post(f"/v1/developers/webhooks/deliveries/{delivery_id}/replay", {})

    def test(self, endpoint_id: Optional[str] = None, event_type: Optional[str] = None) -> Json:
        return self._c.post("/v1/developers/webhooks/test", {**({"endpointId": endpoint_id} if endpoint_id else {}), **({"type": event_type} if event_type else {})})

    def catalogue(self) -> Json:
        return self._c.request("GET", "/v1/webhooks/events")["events"]


class _Events(_Part):
    def list(self, **query: Any) -> Json:
        return self._c.request("GET", "/v1/events", query=query)

    def iterate(self, **query: Any) -> Iterator[Json]:
        return self._c.paginate("/v1/events", query)


class _Logs(_Part):
    def list(self, **query: Any) -> Json:
        return self._c.request("GET", "/v1/logs", query=query)

    def iterate(self, **query: Any) -> Iterator[Json]:
        return self._c.paginate("/v1/logs", query)

    def get(self, request_id: str) -> Json:
        return self._c.request("GET", f"/v1/logs/{quote(request_id, safe='')}")


class _Billing(_Part):
    def plan(self) -> Json:
        return self._c.request("GET", "/v1/billing/plan")

    def set_plan(self, plan: str) -> Json:
        return self._c.request("PUT", "/v1/billing/plan", body={"plan": plan})

    def usage(self, days: Optional[int] = None) -> Json:
        return self._c.request("GET", "/v1/billing/usage", query={"days": days})
