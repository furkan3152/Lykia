# Next.js + @lykia/widget

Lykia's assistant, send and swap inside a Next.js app, in your brand. The
files follow the App Router layout (`app/page.tsx`, a client component in
`components/`), but they import nothing from Next, so the example
typechecks and renders with plain React too.

## Run it in your app

```bash
npm install @lykia/widget
```

1. Strike a project in The Mint (`/mint`), add your origin and prove it
   (DNS TXT or `/.well-known/lykia-verify.txt`), then issue a browser key.
2. Put the project id and key in `.env.local`:

   ```bash
   NEXT_PUBLIC_LYKIA_PROJECT=prj_…
   NEXT_PUBLIC_LYKIA_KEY=lk_pk_…
   ```

3. Copy `components/LykiaWallet.tsx` and render it from a page.

The widget reads the project's brand, modules and assistant name, so a
change in The Mint shows up without a deploy. Pass `wagmiConfig`,
`walletClient` or `provider` to `LykiaProvider` to sign with the wallet your
app already has; without one, the widget finds an injected wallet.

## Check it here

```bash
node --test examples/nextjs-widget/test
```

The test typechecks the example with `tsc` (no Next installed) and renders
the page on the server.
