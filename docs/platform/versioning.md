# Versioning

The API is versioned by date. Send

```http
Lykia-Version: 2026-11-01
```

- Known versions: `GET /v1/versions` (`2026-06-01`, `2026-11-01`).
- An unknown version is `400 INVALID_API_VERSION`.
- Without the header a key's pinned version is used; keys are pinned to the
  latest version when created (choose another with `apiVersion`, change it
  with `PATCH /v1/developers/keys/:id`). Requests without a key get the latest.
- Every response carries the `Lykia-Version` it was served under.

Additive changes (new routes, new optional fields, new event types) ship
without a new version. Anything that could break a client gets a new date,
and older dates keep their behaviour. Modules read the version with
`apiVersionOf(req)` (platform/requestState.ts).

See [changelog.md](changelog.md).
