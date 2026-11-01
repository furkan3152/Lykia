# Embed protocol (v1)

How a `<lykia-*>` element (from `@lykia/embed`) talks to Lykia's
`/embed/<module>` page in its iframe. The types live in
`@lykia/embed/protocol`.

1. The element creates
   `<iframe sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox">`
   with `src = <host>/embed/<module>?project=<id>&v=1&<appearance>`. The key
   is not in the URL.
2. On `load` the element posts
   `{ type: "lykia:connect", v: 1, project, key?, owner?, prefill?, hostWallet }`
   to the frame with `targetOrigin = <host>` and transfers a
   `MessagePort`. It retries a few times while the page boots.
3. The page accepts the message only from `window.parent`, reads the
   parent's origin from the event, loads `GET /v1/projects/:id/public` and
   refuses to run unless the parent is in `frameAncestors` (the verified
   origins). It answers `{ type: "ready", v: 1 }` on the port.
4. From then on the page sends, on the port:
   - `{ type: "resize", height }` whenever its content changes size;
   - `{ type: "event", name, detail }` for `plan-created`, `step-signed`,
     `settled` and `error`;
   - `{ type: "wallet:request", id, method, params }` when `hostWallet` is
     true.
5. The element re-dispatches events as `lykia:<name>` CustomEvents, clamps
   the height between 240 and 1600 px, and answers wallet requests with
   `{ type: "wallet:response", id, result | error }`, only for
   `eth_accounts`, `eth_requestAccounts`, `eth_chainId`,
   `wallet_switchEthereumChain` and `eth_sendTransaction`.
6. When `owner` or `prefill` change, the element sends
   `{ type: "update", owner?, prefill? }`.

API calls from the page carry the project's key and
`Lykia-Embed-Parent: <parent origin>`; see [projects.md](projects.md).
