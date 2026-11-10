/**
 * The conversation suite against a deployed API.
 *
 *   LYKIA_EVAL_BASE_URL=https://api.lykiaai.com npm run eval:live -w @lykia/api
 *
 * Sends the cases of conversations.ts to POST /v1/agent/chat over HTTP (the
 * model path when the deployment has a model, the reader otherwise) and
 * checks every answer's structure: no placeholder phrase, no tool name, no
 * fixture card in an Ask answer, a labelled sample when no wallet is
 * connected, the expected card present, and every figure in the prose
 * present on a card, in a plan step, in an option or in the owner's words.
 *
 * Environment:
 *   LYKIA_EVAL_BASE_URL   required: the API origin, with or without /v1
 *   LYKIA_EVAL_OWNER      optional: an address to read and plan for. Without it every case runs with no wallet
 *                         (the sample address), which is what a signed-out visitor gets.
 *   LYKIA_EVAL_SESSION    optional: a Lykia-Session token for that owner; adds the cases that need a sign-in
 *                         (watches, running things, Trails). They create a watch and a recurring payment draft.
 *   LYKIA_EVAL_STRICT=1   also fail on the expected outcome class, wording, options and plan steps (always
 *                         printed). Off by default: a deployed wallet's balances differ from the offline fixture.
 *   LYKIA_EVAL_DELAY_MS   pause between turns (default 3500: the chat route allows 20 turns a minute)
 *   ONLY=id,id  CATEGORY=act|manage|follow-up|read|guest|fold|self  VERBOSE=1
 *
 * Prints each case, the answers that failed, and how long turns took (median and slowest) per answering mode.
 * Exit code 1 when a case fails.
 */
import { CONVERSATIONS, scoreConversation, type ChatAnswer, type ConversationCase } from "./conversations.js";
import type { CaseScore } from "./score.js";

const RAW = process.env.LYKIA_EVAL_BASE_URL?.trim().replace(/\/+$/u, "") ?? "";
const BASE = RAW.replace(/\/v1$/u, "");
const OWNER = process.env.LYKIA_EVAL_OWNER?.trim() || null;
const SESSION = process.env.LYKIA_EVAL_SESSION?.trim() || null;
const STRICT = process.env.LYKIA_EVAL_STRICT === "1";
const DELAY_MS = Number(process.env.LYKIA_EVAL_DELAY_MS ?? 3_500);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 90_000);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : null;
const CATEGORY = process.env.CATEGORY ?? null;
const VERBOSE = process.env.VERBOSE === "1";

/** Cases that save or read something private: they need a signed-in owner. */
const NEEDS_SESSION = new Set(["watch-health", "recurring-payment", "fees-paid", "why-failed", "what-is-running-none", "undo-last-swap"]);
/** Cases whose card depends on what the wallet holds: they need an owner with funds on Arc. */
const NEEDS_FUNDS = new Set(["earn-idle", "earn-idle-best-vault", "earn-idle-tr", "exit-everything", "exit-everything-tr", "close-all", "stress"]);
/** What a soft check is: right for the offline fixture, dependent on balances and phrasing live. */
const SOFT = /^(?:turn \d+: )?(?:outcome |says |never says |offers |plans )/u;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(c: ConversationCase, say: string, threadId: string | undefined): Promise<{ answer: ChatAnswer; ms: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`${BASE}/v1/agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(SESSION && c.who === "owner" ? { "lykia-session": SESSION } : {}) },
      body: JSON.stringify({ message: say, environment: "mainnet", ...(OWNER && c.who === "owner" ? { owner: OWNER } : {}), ...(threadId ? { threadId } : {}), ...(c.origin ? { origin: c.origin } : {}) }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as (ChatAnswer & { error?: { message?: string } }) | null;
    if (!response.ok || !body) throw new Error(`HTTP ${response.status}${body?.error?.message ? `: ${body.error.message}` : ""}${response.status === 429 ? " (raise LYKIA_EVAL_DELAY_MS)" : ""}`);
    return { answer: body, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 1)}…` : text + " ".repeat(width - text.length);
}

const median = (xs: readonly number[]) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!);

async function main(): Promise<void> {
  if (!BASE) {
    console.error("Set LYKIA_EVAL_BASE_URL to the API to test, for example https://api.lykiaai.com");
    process.exitCode = 2;
    return;
  }
  const wanted = CONVERSATIONS.filter((c) => (!ONLY || ONLY.has(c.id)) && (!CATEGORY || c.category === CATEGORY));
  const cases = wanted.filter((c) => !c.offlineOnly && (SESSION || !NEEDS_SESSION.has(c.id)) && (OWNER || !NEEDS_FUNDS.has(c.id)) && (OWNER || c.origin !== "fold"));
  console.log(`Conversation suite · live ${BASE} · ${OWNER ? `owner ${OWNER}${SESSION ? " (signed in)" : " (not signed in)"}` : "no wallet (the sample address)"} · ${cases.length} cases, ${wanted.length - cases.length} skipped (offline state, a sign-in or funds needed)${STRICT ? " · strict" : ""}\n`);
  const scores: CaseScore[] = [];
  const soft: string[] = [];
  const timings = new Map<string, number[]>();
  for (const c of cases) {
    const answers: ChatAnswer[] = [];
    let threadId: string | undefined;
    try {
      for (const turn of c.turns) {
        const { answer, ms } = await ask(c, turn.say, threadId);
        threadId = answer.threadId ?? threadId;
        answers.push(answer);
        const mode = answer.mode ?? "unknown";
        timings.set(mode, [...(timings.get(mode) ?? []), ms]);
        if (VERBOSE) console.log(`\n> ${turn.say}\n${answer.reply}\n  [${answer.stopReason} · ${ms} ms · ${mode}]`);
        await sleep(DELAY_MS);
      }
      // With no owner given, every case is a signed-out visitor: money answers must be labelled as a sample.
      const full = scoreConversation(c, answers, !OWNER || c.who === "guest");
      const hard = STRICT ? full.checks : full.checks.filter((x) => !SOFT.test(x.name));
      for (const x of full.checks.filter((k) => !k.ok && SOFT.test(k.name))) soft.push(`${c.id}: ${x.name}${x.detail ? ` — ${x.detail.replace(/\s+/gu, " ").slice(0, 160)}` : ""}`);
      scores.push({ ...full, checks: hard, passed: hard.every((x) => x.ok), score: hard.filter((x) => x.ok).length / Math.max(1, hard.length) });
    } catch (error) {
      scores.push({ id: c.id, category: `talk:${c.category}`, passed: false, checks: [], score: 0, error: error instanceof Error ? error.message : String(error) });
      await sleep(DELAY_MS);
    }
  }
  console.log(`\n${pad("case", 28)} ${pad("category", 16)} ${pad("result", 6)} ${pad("checks", 7)} failing`);
  console.log("-".repeat(100));
  for (const s of scores) {
    const failing = s.error ? `error: ${s.error}` : s.checks.filter((x) => !x.ok).map((x) => x.name).join("; ");
    console.log(`${pad(s.id, 28)} ${pad(s.category, 16)} ${pad(s.passed ? "PASS" : "FAIL", 6)} ${pad(`${s.checks.filter((x) => x.ok).length}/${s.checks.length}`, 7)} ${failing.slice(0, 120)}`);
    if (!s.passed && !s.error) for (const x of s.checks.filter((k) => !k.ok)) console.log(`${" ".repeat(30)}FAIL ${x.name}${x.detail ? ` — ${x.detail}` : ""}`);
  }
  console.log("-".repeat(100));
  const passed = scores.filter((s) => s.passed).length;
  console.log(`Cases passed: ${passed}/${scores.length} (${scores.length ? ((passed / scores.length) * 100).toFixed(1) : "0"}%)`);
  for (const [mode, xs] of timings) console.log(`Turn time · ${mode}: median ${median(xs)} ms · slowest ${Math.max(...xs)} ms · ${xs.length} turns`);
  if (soft.length > 0 && !STRICT) {
    console.log(`\nDifferent from the offline fixture (not failing; LYKIA_EVAL_STRICT=1 makes them fail): ${soft.length}`);
    for (const line of soft.slice(0, 60)) console.log(`  ${line}`);
  }
  if (passed < scores.length) process.exitCode = 1;
}

await main();
