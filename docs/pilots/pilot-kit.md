# Lykia pilot kit

This kit is for the first two or three teams that build on Lykia during the
public beta. It gets an agent or an app talking to Lykia in minutes, explains
the limits that apply while the contracts are unaudited, and sets out what we
ask in return.

Fields marked **[OWNER]** must be filled in before the kit is sent.

## What a pilot gets

- An agent that can hold USDC on Arc Network and move it inside a Fence: hard
  limits it cannot argue its way past, checked on every step.
- One integration point for the Arc and Circle stack: USDC and EURC, StableFX,
  CCTP V2, Gateway, ERC-8004 identity and validation, Arc Memo and
  Multicall3From batching.
- A Tag for each agent: its ERC-8004 identity plus the hash of the Fence it
  follows, so anyone can check afterwards that it stayed inside its rules.
- Direct support from the developer during the pilot (see Support; Lykia is a one-person project).

## Five-minute setup: MCP

Lykia exposes a stateless Streamable HTTP MCP server.

- Endpoint: `https://lykia-api-akdogan1.vercel.app/v1/mcp`
  (this URL changes when the API moves to its always-on host; we will send the
  new one).

Add it to any MCP client as a remote HTTP server. For example, in a client that
reads a JSON config:

```json
{
  "mcpServers": {
    "lykia": { "type": "http", "url": "https://lykia-api-akdogan1.vercel.app/v1/mcp" }
  }
}
```

Then ask the agent to list Lykia's tools. You should see:

| Tool | What it does |
|---|---|
| `lykia_venues` | Venues on Arc and which ones Lykia executes. |
| `lykia_flock` | Balance sheet of an address: tokens, vaults, Gateway balance, USD values. |
| `lykia_scent` | What can be proven about a token: registry, proxy, privileges, owner, a transfer simulation. It never says "safe". |
| `lykia_plan` | Turns a sentence into a plan, judged by the Fence. Returns unsigned steps; it never signs. |
| `lykia_outrun` | Where the money is for a planned intent. |
| `lykia_fence_evaluate` | Evaluates a Fence against plan facts: allow, confirm or deny, with reasons and a verdict digest. |
| `lykia_pack`, `lykia_pack_plan` | The owner's agent tree with Fence hashes and budgets, and planning on behalf of a sub-agent. |
| `lykia_insights` | Idle cash, FX exposure, concentration, health and low gas on the owner's Flock. |
| `lykia_memory`, `lykia_contacts`, `lykia_profile` | The owner's preferences and contacts (needs the owner's session token). |
| `lykia_fees` | The fees that apply to a plan. |
| `lykia_circle_status`, `lykia_circle_services` | Which Circle services are live and how Lykia uses them. |
| `lykia_orders` | Conditional orders (limit, stop, standing). |
| `lykia_launches`, `lykia_perps_markets`, `lykia_dev_tools` | Discovery and developer helpers. |

A good first prompt: *"Using Lykia, show the Flock of 0x… on Arc mainnet and
plan: keep 50 USDC liquid and put the rest to work."* The plan comes back with
a Fence verdict and unsigned transactions; nothing moves until the owner signs.

## SDK setup

`@lykia/sdk` is a typed client that runs anywhere `fetch` and Web Crypto exist.
It is **not yet published to npm**. Until it is, build it from the repository:

```sh
git clone [OWNER: repository URL or access instructions]
cd lykia && npm ci && npm run build -w @lykia/core -w @lykia/sdk
npm pack -w @lykia/core -w @lykia/sdk   # produces two .tgz files
# in your project:
npm install /path/to/lykia-core-*.tgz /path/to/lykia-sdk-*.tgz
```

```ts
import { Lykia } from "@lykia/sdk";

const lykia = new Lykia({
  baseUrl: "https://lykia-api-akdogan1.vercel.app",
  apiKey: process.env.LYKIA_KEY,  // lk_sk_… on servers, lk_pk_… in browsers
  environment: "mainnet",         // or "testnet" for Arc testnet
});
```

The plan, sign and submit loop is documented in `packages/sdk/README.md`. The
server never signs: it plans, the Fence judges, the API returns unsigned
transactions, the owner's wallet signs and the SDK submits the hashes.

### API keys

1. Open the app at https://lykia-akdogan1.vercel.app and sign in with your wallet.
2. Go to **Build** and create a key. It is shown once; Lykia stores only an
   HMAC of it.
3. Send it in the `Lykia-Key` header (the SDK does this for you).

- `lk_sk_…` secret keys are for servers.
- `lk_pk_…` publishable keys are limited to read and plan, and work only from
  the origins you allow.

Each key has scopes and its own per-minute and per-day quota. Keys can be
rotated or revoked from the same page.

## Choosing a Fence

Start from a template and tighten it. Loosening a Fence later needs the
owner's wallet.

| Template | Use it when |
|---|---|
| `lamb` | You are evaluating. Dry-run only: everything is planned, nothing is signed. |
| `shepherd` | The default for a person with an agent. Careful caps, agents allowed, strangers refused. |
| `treasury` | A business treasury. USDC and EURC only, named payees, office hours, a tight FX band. |
| `caravan` | An autonomous agent that pays for services. Small caps, no lending, no bridges, agent signer only. |

Field reference: `docs/fence.md`. We recommend every pilot begins on `lamb`
for at least one session before going live.

## Pack patterns

A Pack is a tree of agents. Each sub-agent's Fence must be a strict subset of
its parent's, and its caps must fit in the parent's free budget
(`SUB_FENCE_VIOLATION` and `BUDGET_EXCEEDED` otherwise). Common shapes:

- **Treasurer and payers.** A `treasury` parent with one sub-agent per payee
  group, each with its own daily cap.
- **Researcher and executor.** A read-only sub-agent (dry-run) that proposes
  plans, and an executor whose proposals need the owner's confirmation.
- **Service buyer.** A `caravan` sub-agent with a small weekly cap that pays
  for APIs on the owner's behalf.

See `docs/pack.md`.

## Fees

- Lykia protocol fee: 1% of each value-moving step (100 bps). It is shown in
  every plan, counted by the Fence against your caps, and capped at 3% in
  configuration. Repaying debt, withdrawing home, approvals, revokes and Tag
  steps are free. `GET /v1/fees` (or `lykia_fees`) returns the live policy.
- Integrator fee: you may set your own fee of up to 0.5% (50 bps) on your API
  keys from the Build page.
- Gas on Arc is paid in USDC.
- **[OWNER]** Any fee waiver or reduction offered to pilots, and its duration.

## Beta limits

The contracts have not had a paid audit (there is no budget; see
`docs/security/self-review.md`). Because of that, the mainnet API applies a
beta cap above every Fence:

- Default: 1,000 USD per step and 5,000 USD per day.
- **[OWNER]** Any different cap agreed for a specific pilot.

Use amounts you are prepared to lose. Testnet (5042002) has no cap and is the
right place for load and edge-case testing.

## Support

- Channel: **[OWNER: Telegram group, Discord channel or email]**
- Response target during the pilot: **[OWNER: best effort, for example within two days]**
- Security reports: follow `packages/contracts/SECURITY.md`, not the public
  channel.

## What we ask in return

1. A short kickoff call and a weekly 20-minute check-in.
2. Feedback through the form below, at the end of week 1 and at the end of the
   pilot.
3. Permission to name you as a pilot, only if you agree in writing.
   **[OWNER]** consent wording.

## Success criteria

Agreed per pilot at kickoff. Suggested defaults, all of them targets:

- An agent signs and settles at least one real mainnet step inside a Fence.
- At least one Fence denial or confirmation is triggered and understood.
- The team can explain the verdict digest in the Arc Memo of a step.
- Time from first contact to first settled step: **[OWNER: target]**.

## Feedback form outline

1. What did you build, and for whom?
2. How long did setup take, and where did you get stuck?
3. Which tools or endpoints did you use most? Which were missing?
4. Did the Fence ever stop something it should have allowed, or allow
   something it should have stopped?
5. Were the plans and verdicts clear enough for a non-developer to approve?
6. What would make you keep using Lykia after the pilot?
7. Anything you would tell the Circle or Arc teams about your experience?
8. May we quote you? (yes / no / anonymously)
