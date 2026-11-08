# Hosting the API: Vercel or Render

The web app (`apps/web`) is a static Vite build and stays on Vercel either way.
This page is about the API (`apps/api`).

## How the API runs in each place

| | Vercel (today) | Render (`render.yaml`) |
|---|---|---|
| Process | Serverless function (`apps/api/api/index.js`, wraps `src/vercel.ts`), started per request, frozen between requests | One long-running Node process (`node apps/api/dist/index.js`) |
| Background schedulers | Run only while an instance is warm. Vercel Cron calls `/cron/standing`, `/cron/orders` and `/cron/alerts` once a day each (the Hobby plan allows daily crons only). A full pass (standing orders, orders, alerts, webhook retries, payouts, invoices, automations) also starts on API traffic, at most once every 5 minutes across instances. For schedules tighter than daily without traffic, point an external pinger at `POST /v1/reconcile/tick` with `Authorization: Bearer $CRON_SECRET`; nothing promises more often than that | Started once after `listen` (`startServer` → `startModules`): standing orders every 30 s, the intent receipt poller, alerts and the limit-order keeper keep running |
| SSE (`/v1/intents/:id/stream`, agent chat) | Cut at the function's max duration (300 s) | Open as long as the client stays connected; closed cleanly on SIGTERM |
| Cold starts | Yes, after idle time | No (on a paid instance type) |
| In-memory caches (prices, router allowlist, per-process rate limits) | Per instance, lost on freeze. Chat, `/ai/*` and compile routes also have a per-IP limit and a daily model-call budget counted in the shared store | Shared by every request on the instance |
| Deploys | Per push, preview URLs per branch | Per push; zero-downtime with the `/health` check |
| Database | Postgres via `LYKIA_DATABASE_URL` (Neon) | Same Postgres URL. Neon keeps working, or use Render Postgres |
| Cost model | Per invocation and duration | Flat monthly instance price |

## What moves when you switch

1. Create the service from the Blueprint (`render.yaml` at the repo root), or by hand
   using the same settings: root `.`, build `npm ci && npm run build:api`,
   start `node apps/api/dist/index.js`, health check `/health`, Node 22.12+.
2. Copy the environment from the Vercel API project into Render's dashboard. Values are
   never committed: the Blueprint lists the keys with `sync: false`.
   `RENDER_GIT_COMMIT` is read automatically as the build commit. Every variable the API
   reads is listed in [apps/api/README.md](../apps/api/README.md#environment) and
   [apps/api/.env.example](../apps/api/.env.example); set `LYKIA_ROOT_DOMAIN` (for
   example `lykiaai.com`) if cities run on their own subdomains.
3. In the web project, set `VITE_API_URL` to the Render URL (or a custom
   domain such as `api.<your domain>`), then redeploy the web app.
4. Add the web origin to `LYKIA_WEB_ORIGIN` and its host to `LYKIA_SIWE_DOMAINS` on
   Render, so CORS and sign-in still work.
5. Once Render answers `/health` and `/v1/health`, remove the Vercel Cron, or the API
   project entirely. Leaving both running is harmless: standing-order runs are idempotent
   per period, and intent steps are claimed in the database.

## What does not change

- No code changes: `src/index.ts` (server) and `src/vercel.ts` (serverless) share
  `createApp` and the same modules.
- On-chain behaviour, the protocol fee (`LYKIA_FEE_BPS`, `LYKIA_FEE_RECIPIENT`), Fence and
  bindings are identical. The server never holds user keys in either place.
- The free Render plan sleeps after 15 minutes without traffic, which stops the
  schedulers. Use at least the Starter plan for the API.

## Recommendation

Keep the web app on Vercel and run the API on Render once standing orders, limit orders
and alerts need to fire on time. Vercel remains fine for a demo where nothing has to run
between requests.
