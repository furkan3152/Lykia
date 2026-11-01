# Errors

Every failure has the same body:

```json
{ "error": { "code": "RATE_LIMITED", "message": "This key allows 120 requests per minute.", "details": { "limit": 120 }, "requestId": "6f1c…" } }
```

Every response, success or not, carries `X-Request-Id` (send your own as
`X-Request-Id` and it is echoed if it looks like an id). Quote it to support,
or look it up with `GET /v1/logs/:requestId`. 5xx answers never contain
provider text, URLs or stack traces.

| Status | Codes | What to do |
|---|---|---|
| 400 | `INVALID_REQUEST` (`details.issues`), `INVALID_JSON`, `INVALID_API_VERSION`, `IDEMPOTENCY_KEY_REQUIRED` | Fix the request. |
| 401 | `UNAUTHORIZED` | Unknown, revoked or expired credentials. |
| 402 | `PAYMENT_REQUIRED` (with x402 `accepts`) | Pay over x402 or buy credits. |
| 403 | `FORBIDDEN` (`details.required` names the scope), `LIVE_MODE_REQUIRED`, `IP_NOT_ALLOWED`, `FENCE_DENIED` | Change key scopes, mode or IPs; or the Fence said no. |
| 404 | `NOT_FOUND` | |
| 409 | `IDEMPOTENCY_CONFLICT`, `CONFLICT`, `KEY_LIMIT`, `WEBHOOK_LIMIT` | Use a new Idempotency-Key, or wait for the first request. |
| 413 / 415 | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` | Bodies are JSON, at most 256 KB. |
| 422 | `NOT_UNDERSTOOD`, `URL_FORBIDDEN` | Rephrase, or use a public https URL. |
| 429 | `RATE_LIMITED`, `QUOTA_EXCEEDED`, `TOO_MANY_STREAMS` | Wait `Retry-After` seconds. |
| 5xx | `INTERNAL_ERROR`, `RPC_UNAVAILABLE`, `UPSTREAM_TIMEOUT`, … | Retry with backoff; retry POSTs with the same Idempotency-Key. |
