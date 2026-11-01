# Example adapter manifest

`manifest.json` is a complete `lykia.adapter/v1` document for an ERC-4626
USDC vault. It points at the Morpho Galaxy USDC vault on Arc mainnet so it
validates on chain as is. Replace every field with your protocol's facts.

```sh
curl -X POST "$LYKIA_API/v1/integrations/adapters" \
  -H "Lykia-Key: $LYKIA_SECRET_KEY" -H "content-type: application/json" \
  -d "{\"manifest\": $(cat manifest.json), \"validate\": true}"
```

See [docs/integrate-your-protocol.md](../../docs/integrate-your-protocol.md)
and [docs/platform/integrations.md](../../docs/platform/integrations.md).
