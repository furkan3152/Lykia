# SDK in Node

The whole loop with `@lykia/sdk` and viem:

1. **Plan** a sentence. Lykia compares every Arc venue and puts its 1% fee
   inside the step's own transaction.
2. **Verdict**: the Fence answers allow, confirm or deny, one reason per rule.
3. **Prepare** the unsigned calls (approve + act + memo, batched into one
   Arc transaction through Multicall3From).
4. **Simulate** each call with `eth_call`, then **sign** in your own wallet
   and **submit** the hash so Lykia verifies the receipt on Arc.

```bash
npm run build -w @lykia/core -w @lykia/sdk
node examples/sdk-node/index.mjs                         # plan, prepare and simulate; nothing signed
SENTENCE="put 50 USDC to work" node examples/sdk-node/index.mjs
PRIVATE_KEY=0x… EXECUTE=1 node examples/sdk-node/index.mjs  # real, from your own wallet
```

The key never leaves your machine; Lykia's server never signs your plans. While Lykia's
contracts are unaudited, mainnet moves are capped at $1,000 per step and
$5,000 per day for everyone (`GET /v1/fees`).
