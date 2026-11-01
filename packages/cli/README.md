# @lykia/cli

The Lykia API from your terminal, built on Arc Network. No dependencies.

```sh
npm install -g @lykia/cli
lykia login --key lk_test_…
lykia plan "send 5 USDC to 0x…" --owner 0x… --env testnet
lykia webhooks listen --forward-to http://localhost:3000/hooks
lykia logs tail --status error
```

See [docs/platform/cli.md](../../docs/platform/cli.md) for every command.
