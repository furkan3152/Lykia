# The intent compiler

Lykia reads a single concrete sentence ("convert 200 USDC to EURC") with its
language reader. People do not talk about money like that. They say "keep
three months of payroll liquid, put the rest somewhere safe, hedge a third
into euros and pay my contractors on the first of every month", or "be
defensive with my savings". Such a request has several goals, a time
dimension and abstract words, and a one-shot action list cannot hold it.

The intent compiler turns that kind of request into something Lykia can
execute and anyone can verify:

```
words ──read──▶ lykia.program/v1 ──resolve──▶ amounts, assumptions, questions
      ──compile──▶ one plan for now + drafts for later + why
      ──check──▶ route search, Fence verdicts, sentence round trips, pinned digests
```

Nothing is signed or broadcast. The plan for now is a proposal the owner
signs in their own wallet; drafts are saved only for an owner who proved
control of the address, and only as proposals the Fence checks each time
they fire.

## 1. The program format: `lykia.program/v1`

A program is the typed intermediate representation between the owner's words
and Lykia's artifacts: goals, constraints and time, never transactions.
Types and the validator live in `packages/core/src/program.ts`.

| Field | Meaning |
|---|---|
| `text` | The owner's words. |
| `language` | ISO 639-1 code. |
| `goals` | The goals in a few English words each. |
| `elements` | What should happen, in the owner's order (below). |
| `preferences` | `risk` (low, medium, high), `liquidityHours` ("out within a day" = 24), `leverage` (false for "no leverage" or "defensive"), `hedge` (`{ currency: "EUR" }` for "protect against a weaker dollar"), `venues` allow/deny, `maxSlippageBps`, `timezone`. |
| `conflicts` | Pairs of wishes that pull apart ("max yield" and "zero risk") with the safer reading. |
| `questions` | Hard facts the reader would not guess. |
| `untrusted` | The text tried to override Lykia's rules. |

Every element carries `id`, `quote` (the owner's own words, for the
rationale) and optionally `assumed` (why the reader chose it as a default).

| Kind | Fields | Example |
|---|---|---|
| `reserve` | token, quantity, purpose | "keep 3 months of 400 USDC payroll liquid" |
| `earn` | token, quantity, venue? | "put the rest to work" |
| `convert` | from, to, quantity, purpose (hedge, trade, take-profit, stop-loss), when? | "move about a third into euros as a hedge" |
| `pay` | token, quantity per recipient, recipients (address or contact name), memo?, when? | "pay my two contractors 50 USDC each" |
| `bridge` | quantity, destination (CCTP chain), recipient?, when? | "send 300 USDC to 0x… on Arbitrum" |
| `unify` | quantity | "keep 500 USDC in Gateway" |
| `withdraw`, `repay` | token, quantity | "repay 500 USDC if my health drops below 1.5" |
| `sweep` | token, keep, when (schedule or balance) | "every Friday sweep idle USDC above 500" |
| `dca` | sell, buy, amount per execution, every, executions? | "buy 50 USDC of cirBTC every week for 10 weeks" |
| `alert` | when (price, health, balance) | "tell me if bitcoin falls below 70000" |
| `budget` | agent?, perDayUsd?, perWeekUsd? | "let my research agent spend 20 USDC a day" |
| `action` | a plain plan action (borrow, supply, rebalance) | "borrow 500 USDC against my cirBTC" |
| `refuse` | code, detail | an override attempt, an unknown venue, a guaranteed yield |

A **quantity** is one of `exact` ("400"), `share` (basis points of what is
available after the reserves, or of the total: "a third" = 3333, `approx` for
"about"), `rest`, `all`, `runway` (perPeriod × periods: "3 months of 400"),
or `unspecified`. **When** is absent (now), a `schedule` (day, week or month,
weekday, day of month, time, IANA zone, count), a `price` trigger on a
Chainlink feed, a `balance` trigger or a `health` floor.

`validateProgram` refuses unknown fields (a model cannot smuggle extra
instructions), unregistered tokens, shortened addresses, unknown CCTP chains
and malformed schedules. `programHash` is the sha256 of the canonical JSON.

## 2. Reading: the model, or the lexicon

**With a model** (`ANTHROPIC_API_KEY`, model from `LYKIA_AGENT_MODEL`), any
language in. The model answers through one structured tool call,
`propose_program` (`apps/api/src/compiler/llm.ts`). Its output is untrusted
until it passes three checks:

1. `validateProgram`;
2. grounding: every address must appear in the owner's words or in a
   confirmed contact, and every venue must be one Lykia knows, so the model
   can invent neither a recipient nor a protocol;
3. the deterministic guard: override attempts in the text become refusals
   and mark the program untrusted even when the model missed them.

When a check fails, the issues go back to the model once as a tool error and
it repairs its program. If the repair fails too, the compiler asks the owner
to restate the request instead of guessing.

**Without a model**, the abstract-concept lexicon (`apps/api/src/compiler/lexicon.ts`)
reads English goal language deterministically. It splits the text into
clauses without breaking address lists ("0x… and 0x… 50 USDC each"), keeps a
condition with its action ("whenever X, do Y") and a leading schedule with
its action ("every Friday, sweep…"), and recognises these templates:

| Template | Phrases |
|---|---|
| Reserve and runway | keep … liquid, set aside, never drop below, N months of X payroll, "our payroll is 600 a month … keep two months of it" |
| Rest to work | put the rest to work, invest whatever is left, idle USDC earning |
| Hedge share | move about a third into euros, hedge 25% into EURC, protect against the dollar weakening |
| Defensive | safe, defensive, conservative, nothing risky, no leverage, out within a day |
| Pay N people | pay my two contractors 0x… and 0x… 50 USDC each on the first of every month |
| Sweep | every Friday sweep idle USDC above 500, whenever my balance goes above 2000 put the excess to work |
| DCA | buy 50 USDC of cirBTC every week for 10 weeks, DCA 100 USDC into EURC monthly |
| Take profit, stop-loss | sell half my cirBTC if BTC goes above 120k, stop loss on my bitcoin at 60k |
| Alerts | tell me if EURC drops below 1.05, keep my health above 1.8 |
| Agent budgets | let my research agent spend up to 20 USDC a day |
| Cross-chain | bridge 200 USDC to Base for 0x…, keep 500 USDC in Gateway |

Clauses it does not recognise go to the existing sentence reader, so every
concrete command Lykia already understood still works. Context sentences
("I run a small studio") produce nothing. The guard refuses override
attempts (English, plus common Spanish, German, French and Turkish phrasings),
Fence changes ("disable the Fence", "auto-sign"), guaranteed yields, venues
Lykia does not execute (Compound, Curve, Lido, …) and tokens outside the
registry, and a clause that names a refused venue is not planned somewhere
else instead.

## 3. Resolution against live state

`resolveProgram` (`packages/core/src/programCompile.ts`) is pure. The API
gathers its state (`apps/api/src/compiler/service.ts`): the owner's Flock
(wallet balances and positions), Chainlink prices, venue facts from the
knowledge rows (risk tier, whether the tier is refined live, withdrawal
time), Lykia's fee, the mainnet beta cap and confirmed contacts. Callers can
pass what-if balances instead; the result is then flagged `hypothetical` and
nothing is stored.

Per token, in this order:

1. **Reserves**: exact, runway (3 × 400 = 1200) or a share of the total.
2. **Buffers**: the first period of scheduled payments in that token, fee
   included, so the first run never fails; and a gas buffer (1 USDC: Arc gas
   is paid in USDC). Both are assumptions the owner can turn off.
3. **Exact amounts**, payments counted per recipient with the fee on top.
4. **Shares**: of what is available after 1–3 (or of the total when the owner
   said "of everything").
5. **The rest**: what is left, split evenly if "the rest" appears twice.

A deposit that follows a conversion into its token ("convert, then put the
euros to work") is not resolved against the wallet: it takes exactly what the
conversion produces (`{ previous: true }`).

The resolver **fails closed with a precise question** when a hard fact is
missing (a recipient address, the payroll size, a schedule it cannot express
such as "every two weeks", a shortened address, a decimal comma) or when the
wallet is short. While such a question is open, nothing is planned for now:
"the rest" is unknowable. When a **sensible default** exists, it is used and
listed as an assumption the owner can change: the gas buffer, the schedule
time (09:00) and zone (the profile's, else UTC), day 28 for "the 31st",
"about a third" read as 33.33% of what is left after the reserve, a 20% EURC
hedge for "protect against the dollar weakening", a tenth kept liquid for
"out within a day", the rest earning in the low-risk tier for "defensive".

**Fees and the beta cap** are estimated per step. A step over the per-step
beta cap, or a plan over the daily cap, is a blocker and a question; the
compiler never splits a move to fit a cap. If the owner picks "plan a
smaller version" (override `beta: fit`), each step shrinks to the cap and the
difference stays in the wallet, stated as an assumption.

**Venue policy**: the risk ceiling, the liquidity horizon and the venue lists
decide which deposit venues are allowed; excluded executable venues become a
Fence deny list for the route search, and each exclusion has a reason (USYC:
not executable by Lykia, redemptions follow the Teller's schedule; Morpho
vaults below the ceiling are pruned live from TVL).

**Overrides** change an assumption by id: `share:e3`, `reserve:e1`,
`buffer.gas`, `buffer.schedule`, `schedule.time`, `schedule.timezone`, `risk`,
`beta`, `drop:e4` (drop an element the reader chose as a default). The
program hash stays the same; the resolution hash changes.

## 4. Compilation into artifacts

`compileProgram` returns:

- **Now**: one ordered list of plan actions with dependencies: the reserve
  first (the planner keeps it untouched), withdrawals, conversions (each
  followed by the deposit of exactly what it produced), payments, bridges,
  Gateway deposits and repayments, then deposits of the rest. Each part
  carries a rationale tied to the owner's words. The API runs the route
  search over the whole list under the owner's Fence (tightened by the venue
  policy) with the risk ceiling as appetite, and the winner's calldata is
  self-checked with one `eth_call`.
- **Scheduled**: drafts. Recurring payments and conditional moves become
  automations that re-plan one English sentence at each fire; conditional
  conversions of a priced token become LykiaOrders take-profit, stop-loss or
  limit orders; DCA becomes a LykiaOrders DCA order; health triggers become
  standing orders; notifications become alerts; agent budgets become a Fence
  suggestion signed on the Pack page. Every automation sentence is read back
  by the language reader and must produce exactly the drafted actions
  (`roundTrip: "ok"`), and every draft passes the same validator the web form
  runs.
- **Why**: assumptions, trade-offs (lower yield for lower risk, idle reserve,
  EUR/USD exposure, withdrawal liquidity, the fee), rejected alternatives with
  reasons (excluded venues, leverage, depositing the hedge, splitting to fit a
  cap, refused requests) and what is deferred to schedules.

**Pinning.** The program digest goes into the Fence facts of every plan the
compiler makes (`FenceFacts.program`), so the verdict digest commits to the
program. The response carries `pin = { programHash, resolutionHash,
fenceHash, verdictDigest, digest }`.

## 5. Where it runs

- `POST /v1/ai/compile { text, owner?, balances?, overrides?, constraints?, search?, plan?, preview?, reader? }`
  returns the program, the resolution, the plan for now (with the route
  search and its verdict; `plan: true` stores it for signing), the checked
  drafts (link to the prefilled form, round trip, a dry-run Fence preview),
  the why, the questions, the pin and a compact `view`.
- `POST /v1/ai/route` sends goal language (several goals, time or abstract
  wording) to the compiler and returns its program as `compiled`, with the
  assumptions, rejected options and deferred parts in `explain`. When the old
  reader would only have asked "What should Lykia do?", the compiler answers
  instead.
- **Lyko** has a `compile_goal` tool and is told to use it whenever a request
  has several goals, a time dimension or abstract wording. Without a model,
  the deterministic Lyko sends such messages to the lexicon. Both paths turn
  the plan for now into one proposal, save or link the drafts by the
  ownerVerified rule, and emit a `program` chat event.
- **The Ask page** renders the event as a program card: Now (the signable
  plan and its Fence verdict, what stays liquid, the fee), Scheduled (each
  draft with its kind, rationale, Fence preview and a review link) and
  Assumptions (chips that recompile with an override), then "Why this plan".

## 6. Worked example: the studio

> I run a small studio. Keep enough USDC liquid for 3 months of 400 USDC
> payroll, put the rest to work somewhere safe, move about a third into euros
> as a hedge, and pay my two contractors 0x1111…1111 and 0x2222…2222 50 USDC
> each on the first of every month.

(The eval uses the full 40-character addresses.) The wallet holds 2500 USDC.

**Program** (lexicon):

| id | element | from the words |
|---|---|---|
| e1 | reserve USDC, runway 400 × 3 month, purpose payroll | "Keep enough USDC liquid for 3 months of 400 USDC payroll" |
| e2 | earn USDC, quantity rest | "put the rest to work somewhere safe" |
| e3 | convert USDC → EURC, share 3333 bps of available, approx, purpose hedge | "move about a third into euros as a hedge" |
| e4 | pay 50 USDC to each of 2 addresses, memo contractor, when every month day 1 | "pay my two contractors … on the first of every month" |

Preferences: `risk: low` ("somewhere safe"), `hedge: EUR`. "I run a small
studio" produces nothing.

**Resolution**:

| Kept liquid | USDC |
|---|---|
| payroll (3 months × 400) | 1200 |
| first month of contractor payments, 1% fee included (2 × 50 + 1) | 101 |
| gas buffer | 1 |
| **total** | **1302** |

Available after that: 1198 USDC. "About a third" = 33.33% of 1198 = **399.29
USDC** to EURC. The rest = 2500 − 1302 − 399.29 = **798.71 USDC** to work.
Fees about $11.98 (1%). Each step is below the $1000 beta cap and the total
below $5000. Venues allowed: Aave V4 and Morpho vaults (low tier only, decided
live from TVL); excluded: the USYC Teller.

**Now** (one plan):

1. `reserve 1302 USDC` (payroll)
2. `fx 399.29 USDC → EURC`
3. `earn 798.71 USDC` with `maxRisk: low`

**Scheduled**: an automation, every month on day 1 at 09:00 UTC (first run
2026-12-01), that plans "send 50 USDC to 0x1111… for contractor and send 50
USDC to 0x2222… for contractor". Its sentence reads back into exactly those two
sends. The Fence preview is denied under the default Shepherd Fence (the
recipients are not the owner), which tells the owner to allowlist them before
the first run.

**Assumptions** the owner can change: the time zone (UTC) and time (09:00),
the 101 USDC schedule buffer, the 1 USDC gas buffer, and "about a third" read
as 33.33% of what is left after the reserve. Picking 25% recompiles to 299.5
USDC to EURC and 898.5 USDC to work.

**Why**: lower yield for lower risk; 1302 USDC stays liquid and earns nothing
so payroll never waits on a withdrawal; the EURC share follows EUR/USD; the
fee. Rejected: the USYC Teller, borrowing for more yield, depositing the EURC
(the owner asked for a hedge).

With a real wallet the API also runs the route search. For a similar request
on mainnet ("keep 200 USDC liquid, put the rest to work somewhere safe and move
a third into euros as a hedge", capped to the beta limit) it picked the Morpho Galaxy USDC vault (low tier by TVL),
pruned the medium- and high-tier Morpho vaults for the low appetite, swapped
USDC → EURC on Uniswap v4, and the `eth_call` self-check of the batch passed.

**Defensive savings.** "Be defensive with my savings: nothing risky, protect
against the dollar weakening, and make sure I can always get my money out
within a day" used to get "name the token, the amount and the action". With
1200 USDC it now compiles to: keep 121 USDC liquid (a tenth plus gas), 215.80
USDC to EURC (20% hedge), 863.20 USDC to work in the low-risk tier, with
`liquidityHours: 24` and `leverage: false`, and each default listed as an
assumption.

## 7. Evaluation

The evaluation set lives in `apps/api/src/evals/`: `intents.ts` (52 cases and
their rubrics), `states.ts` (mocked chain state), `score.ts` and `run.ts`.
Cases cover treasury and payroll, savings, hedging, agents with budgets,
take-profit and stop-loss rules, DCA, sweeps, cross-chain transfers through
CCTP and Gateway, ambiguity, contradictions, impossible requests and prompt
injection. Six cases are in Turkish, German and Spanish (written with Unicode
escapes) and score the model path. Each rubric lists the program elements,
preferences, plan actions and exact amounts, drafts, kept amounts, questions,
refusals, assumptions, conflicts, blockers and round trips the result must
show, and what it must not show (a payment from an injected message, an
earn at a refused venue).

```sh
npm run eval:intents -w @lykia/api                                  # offline, the lexicon, mocked state
BASE=https://lykia-api-akdogan1.vercel.app npm run eval:intents -w @lykia/api   # live, the model path
READER=deterministic BASE=http://localhost:3002 npm run eval:intents -w @lykia/api
ONLY=studio,defensive VERBOSE=1 npm run eval:intents -w @lykia/api
```

Results on 4 November 2026:

| Run | Cases | Checks |
|---|---|---|
| Offline, lexicon (46 English cases) | 46/46 | 194/194 |
| Local HTTP API, lexicon forced (all 52) | 47/52: the 46 English cases, and the Spanish injection caught by the guard; the other 5 non-English cases need the model | 198/213 |
| Live model path | not scored yet: `/v1/ai/compile` must be deployed with a model key | |

The offline run is also a test (`compiler.test.ts`), so a lexicon change that
breaks a case fails `npm test`.
