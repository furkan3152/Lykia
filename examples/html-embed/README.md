# HTML embed: one script tag

Lykia's assistant and swap on any page (plain HTML, WordPress, Vue,
Svelte), in your brand:

```html
<script type="module" src="https://unpkg.com/@lykia/embed"></script>
<lykia-assistant project="prj_…" key="lk_pk_…"></lykia-assistant>
<lykia-swap project="prj_…" key="lk_pk_…" primary="#0f766e"></lykia-swap>
```

Each element is a sandboxed iframe of Lykia's `/embed/<module>` page. It:

- follows the project's brand, modules and assistant name (attributes such
  as `primary`, `accent`, `scheme`, `radius` and `mosaic` override them);
- runs only on the project's verified origins;
- resizes to its content;
- fires DOM events: `lykia:ready`, `lykia:plan-created`,
  `lykia:step-signed`, `lykia:settled`, `lykia:error`, `lykia:resize`.

The key travels to the frame over a private `MessageChannel`, never in the
URL. Only publishable keys (`lk_pk_…`) are accepted; an element given a
secret key refuses to load.

## Elements

`lykia-assistant` (or `lykia-chat`), `lykia-send`, `lykia-swap`,
`lykia-earn`, `lykia-bridge`, `lykia-fence`, `lykia-scent`, `lykia-flock`,
`lykia-pack`, `lykia-outrun`.

## Attributes

| Attribute | Meaning |
|---|---|
| `project` | Your project id (`prj_…`). Required. |
| `key` | A browser key (`lk_pk_…`) of that project. |
| `owner` | The user's address, if your page knows it. |
| `prefill` | Text to start the assistant with. |
| `primary`, `accent`, `background`, `foreground` | Hex colours. |
| `scheme` | `light`, `dark` or `auto`. |
| `radius` | Corner radius in pixels, 0 to 24. |
| `mosaic` | `on` or `off`. |
| `environment` | `mainnet` or `testnet` (default: the project's network). |
| `wallet` | `host` to sign with your page's wallet: set `element.provider` to any EIP-1193 provider. |
| `height` | A fixed height in pixels (turns off auto-resize). |
| `host` | Another Lykia web origin (self-hosting). |

## Check it here

```bash
node --test examples/html-embed/test
```
