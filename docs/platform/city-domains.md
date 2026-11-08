# City domains

Every city of the League can run on its own subdomain:
`pay.<domain>`, `agents.<domain>`, `perps.<domain>`.
Until a domain is bought, the same cities open on the current site:

- `https://lykiaai.com/c/pay`
- `https://lykiaai.com/?city=agents`

Nothing below is needed for those two to work.

## How it works

- Each project has a unique **slug** (3 to 24 lowercase letters, digits
  and dashes). Official cities are `pay`, `agents` and `perps`. Words such
  as `www`, `api`, `app`, `admin`, `letoon` and `mint` are refused.
- The web app reads the host. On `<slug>.<root domain>` it boots in
  **city mode**: it loads `GET /v1/league/by-slug/:slug` and shows the
  city's own app, not the full Lykia app.
- A project's **verified custom domain** (proved in The Mint) maps to its
  city the same way, through `GET /v1/league/by-host?host=`.
- The API allows CORS from `https://<slug>.<root domain>` only for
  **listed** cities. Sign-in (SIWE) on a city names the city's own host.

## What you do once the domain is bought

Example: the domain is `lykiaai.com`. Do it from a laptop if you can; each
step is also possible from the phone.

### 1. Point the domain at Vercel

In your registrar, set the **nameservers** to Vercel's:

```
ns1.vercel-dns.com
ns2.vercel-dns.com
```

A wildcard domain on Vercel needs Vercel's nameservers. A plain CNAME is
not enough for `*.lykiaai.com`.

### 2. Add the domains to the web project

Vercel → the **web** project → Settings → Domains → Add:

```
lykiaai.com
*.lykiaai.com
```

Vercel issues the certificates itself (a wildcard certificate for
`*.lykiaai.com`). Wait until both show **Valid**.

### 3. Give the API its own name (optional)

Vercel → the **API** project → Settings → Domains → Add `api.lykiaai.com`.
`api` is reserved, so no city can take it.

### 4. Set the variables

Web project → Settings → Environment Variables:

```
VITE_LYKIA_ROOT_DOMAIN = lykiaai.com
VITE_API_URL           = https://api.lykiaai.com   (if you did step 3)
```

API project → Settings → Environment Variables:

```
LYKIA_ROOT_DOMAIN  = lykiaai.com
LYKIA_WEB_ORIGIN   = https://lykiaai.com   (keep the vercel.app origin too, comma-separated)
```

Redeploy both projects (the web variable is read at build time).

### 5. Check

The official cities are being launched and are not listed yet. Once a city
is listed in the League:

- `https://pay.lykiaai.com` shows Lykia Pay.
- `https://agents.lykiaai.com` shows Lykia Agents.
- `https://perps.lykiaai.com` shows the coming page.
- `https://lykiaai.com` shows the full Lykia app.
- `https://nothing.lykiaai.com` says "No city lives here".

## A city on its own domain

A developer can run their city on their own domain too:

1. In The Mint, add the domain as an origin of the project and prove it
   (DNS TXT or a `/.well-known` file).
2. Point the domain at the Lykia web project (a CNAME to
   `cname.vercel-dns.com`), and add it under the web project's Domains.
3. Once the city is listed in the League, the domain opens the city.

## Notes

- Cities that are not listed (requested, rejected, delisted) do not open on
  a subdomain, and their subdomain gets no CORS headers from the API.
- A paused city still opens; its keys answer reads only until the team
  resumes it in Letoon.
- The content security policy in `apps/web/vercel.json` already allows
  `connect-src https:`, so no change is needed there.
