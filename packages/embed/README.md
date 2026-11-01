# @lykia/embed

Lykia as web components, built on Arc Network. One script tag, any stack.

```html
<script type="module" src="https://unpkg.com/@lykia/embed"></script>

<lykia-assistant project="prj_…" key="lk_pk_…"></lykia-assistant>
<lykia-swap project="prj_…" key="lk_pk_…" primary="#0f766e"></lykia-swap>
```

Each element is a sandboxed iframe of Lykia's `/embed/<module>` page:

- it follows the project's brand, modules and assistant name;
- it runs only on the project's verified origins;
- it resizes to its content;
- it fires `lykia:ready`, `lykia:plan-created`, `lykia:step-signed`,
  `lykia:settled`, `lykia:error` and `lykia:resize` on the element (they
  bubble).

The key goes to the frame over a private `MessageChannel`, never in the
URL, and only to Lykia's origin. Secret keys are refused.

## Elements

`lykia-assistant` (alias `lykia-chat`), `lykia-send`, `lykia-swap`,
`lykia-earn`, `lykia-bridge`, `lykia-fence`, `lykia-scent`, `lykia-flock`,
`lykia-pack`, `lykia-outrun`.

## Attributes

`project` (required), `key`, `owner`, `prefill`, `primary`, `accent`,
`background`, `foreground`, `scheme` (`light`, `dark`, `auto`), `radius`
(0 to 24), `mosaic` (`on`, `off`), `environment`, `height` (fixed height),
`wallet` (`host`), `host` (self-hosted Lykia web origin).

## Signing with the host page's wallet

```html
<lykia-swap project="prj_…" key="lk_pk_…" wallet="host"></lykia-swap>
<script type="module">
  document.querySelector("lykia-swap").provider = window.ethereum;
</script>
```

Only `eth_accounts`, `eth_requestAccounts`, `eth_chainId`,
`wallet_switchEthereumChain` and `eth_sendTransaction` cross the boundary.

## Builds

- `dist/index.js`: an ES module (also exports the protocol helpers).
- `dist/lykia-embed.js`: a classic script for `<script src>` without
  `type="module"`.
- `@lykia/embed/protocol`: the message types, for custom hosts.

MIT licensed.
