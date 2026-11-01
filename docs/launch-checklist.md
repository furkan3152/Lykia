# Launch checklist: from today to public beta

This is the owner's step-by-step list from the current state (contracts on
Arc mainnet, API and app on Vercel) to an open public beta. Each item says who
does it and how. Tick items in order inside each phase; phases can overlap
where noted.

"Owner" means the person holding the deployer and admin wallet
(`0x8c5281055b197443ff01dbbdfbf29fd63946ca1e` today). Secrets are entered only
in the hosting dashboards, never in the repository, chats or tickets.

## Where things stand

| Item | State |
|---|---|
| LykiaAccountFactory (mainnet) | Deployed: `0x810e8db89f4c4e8fa814ed3ed0d636d3416dd7f9` |
| LykiaRouter (mainnet) | Deployed: `0xc9c0ea4d22ddbef4504a634759fb78334efc5d18` |
| LykiaOrders (mainnet) | Not deployed yet |
| Router venue allowlist | Empty on mainnet |
| API | Vercel (serverless): https://lykia-api-akdogan1.vercel.app |
| App | Vercel: https://lykia-akdogan1.vercel.app |
| Audit | Not started. Mainnet beta cap is on (default 1,000 USD per step, 5,000 USD per day). |

## Phase 1: finish the contracts

1. **Deploy LykiaOrders.** Who: owner. How: open the app's **/owner** page
   signed in with the admin wallet on Arc mainnet. The deploy plan lists
   LykiaOrders after the router; press its deploy button and sign. The page
   records the address through `POST /v1/admin/deployments`.
2. **Allowlist the swap venues on the router.** Who: owner. How: on **/owner**,
   the "LykiaRouter venues" card lists the unsigned `setVenue(address,bool)`
   calls. Sign one for each:
   - Uniswap v3 SwapRouter02 `0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77`
   - Aerodrome Slipstream Metarouter `0x0fef9e88a7b76bcdbf451780c6774fe32965ee98`

   `GET /v1/admin/router` shows which calls are still missing.
3. **Record the new address in code.** Who: developer. How: add `LykiaOrders`
   to the mainnet entry in `packages/core/src/contracts/deployments.ts`, with
   the deploy block in the comment, then run the core tests and redeploy.
4. **Verify the source on the Arc explorer.** Who: developer. How: use the
   Hardhat setup in `packages/contracts`. Verified source is a precondition
   for the audit and for pilots.
5. **Move contract ownership to a multisig.** Who: owner. How: create a Safe
   (or equivalent) on Arc with at least two signers, then call
   `transferOwnership(safe)` on LykiaRouter and LykiaOrders. Both use
   two-step ownership, so the Safe must call `acceptOwnership()` to finish.
   Update `LYKIA_ADMIN_ADDRESSES` if the admin wallet changes.

## Phase 2: move the API to an always-on host

Serverless instances sleep, so the in-process schedulers (standing orders,
the intent receipt poller, alerts and the limit-order keeper) only run while
an instance is warm. Public beta needs a process that stays up.

6. **Create the Render service.** Who: owner. How: in Render, "New Blueprint"
   from the repository; `render.yaml` defines `lykia-api` (Starter plan,
   Frankfurt, health check `/health`). Fill every `sync: false` value in
   Render's Environment tab, copying from the current Vercel API project.
7. **Point the app at the new API.** Who: owner. How: in the Vercel web
   project set `VITE_API_URL` to the Render URL and redeploy.
8. **Update origins on the API.** Who: owner. How: in Render set
   `LYKIA_WEB_ORIGIN` to the app's URL and `LYKIA_SIWE_DOMAINS` to the app's
   host (add the custom domain later, see step 17).
9. **Update Circle's allowed domains.** Who: owner. How: in the Circle
   Console, add the app's domain to the Modular Wallets client key and the
   passkey relying-party settings. Without this, passkey sign-in fails on the
   new domain.
10. **Retire the old API.** Who: owner. How: once the app has run against
    Render for a day without errors, remove the Vercel API project's
    production alias or pause it, and tell pilots the new MCP URL
    (`<render-url>/v1/mcp`).

## Phase 3: background jobs and notifications

11. **Background jobs.** Who: owner. How: set a long random `CRON_SECRET` on
    the API either way.
    - While the API is still on Vercel, point an outside scheduler
      (cron-job.org or similar) at `/cron/standing`, `/cron/orders` and
      `/cron/alerts` every few minutes, with the header
      `Authorization: Bearer <CRON_SECRET>`. These paths exist only in the
      Vercel entry point (`apps/api/src/vercel.ts`).
    - On Render the schedulers run in-process every 30 seconds and the
      `/cron/*` paths are not served. Remove the outside pinger after the
      move. An optional backstop is `POST /v1/orders/keeper/tick` with the
      same Bearer secret.
12. **Keeper wallet (optional).** Who: owner. How: create a fresh wallet that
    holds only a little USDC for gas, and set `LYKIA_KEEPER_PRIVATE_KEY` on the
    API. It executes due conditional orders and earns the tip. Without it,
    anyone can execute orders through `/v1/orders/:hash/execute-tx`.
13. **Telegram bot.** Who: owner. How: create a bot with BotFather, set
    `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` on the API, then call
    `POST /v1/telegram/setup` once while signed in as an admin. Users link a
    chat with `/start <code>` from the Alerts page.
14. **Circle passkey wallets in the app.** Who: owner. How: in the Vercel web
    project set `VITE_CIRCLE_CLIENT_KEY` and `VITE_CIRCLE_CLIENT_URL` from the
    Circle Console (Modular Wallets) and redeploy. Passkey wallets stay hidden
    without them.

## Phase 4: prove it end to end

15. **First small real transaction.** Who: owner. How: with a fresh wallet
    holding about 20 USDC on Arc mainnet, run the demo in
    `docs/pitch/demo-script.md`: plan, sign and settle one send and one
    USDC-to-EURC conversion. Check on the explorer that each step carries an
    Arc Memo with its verdict digest and that the 1% fee reached
    `LYKIA_FEE_RECIPIENT`.
16. **Conditional order test.** Who: owner. How: sign one small limit order on
    the Orders page, let the keeper (or a manual `execute-tx`) fill it, and
    confirm the router swap and fee in the receipt.

## Phase 5: public surface

17. **Custom domain.** Who: owner. How: buy the domain, attach it to the
    Vercel web project (and optionally an `api.` subdomain to Render), then
    repeat steps 7 to 9 with the final hosts.
18. **Monitoring.** Who: owner. How: an uptime check on `/health` with alerts
    to the owner's phone; Render and Vercel log retention on; an alert on the
    keeper wallet's balance; a weekly look at `GET /v1/developers/usage`.
19. **Agent Marketplace listing.** Who: owner. How: apply through Circle's
    Agent Marketplace with the MCP URL, the Tag of the Lykia agent and a link
    to `docs/integrate-your-protocol.md`.
20. **Pilots.** Who: owner. How: send `docs/pilots/pilot-kit.md` to two or three
    teams once phases 1 to 4 are done.
21. **Grants and audit.** Who: owner. How: submit the drafts in `docs/grants/`
    and send `docs/security/audit-pack.md` to audit firms. These can start in
    parallel with phase 2.

## Before calling it public beta

- [ ] Every Lykia contract deployed on mainnet is verified and owned by the
      multisig.
- [ ] The API runs on the always-on host and `/health` has been green for a
      week.
- [ ] Standing orders, the keeper and Telegram alerts have each fired at least once.
- [ ] At least one pilot has settled a real step inside a Fence.
- [ ] `LYKIA_BETA_CAP_USD` is set deliberately (default `1000/5000`), and the
      app says plainly that the contracts are unaudited.
- [ ] `packages/contracts/SECURITY.md` names a working security contact.
- [ ] The bug bounty draft in `docs/security/audit-pack.md` has rewards and
      response times filled in, or is clearly marked as not yet open.
