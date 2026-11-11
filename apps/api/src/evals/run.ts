/**
 * The intent-compiler evaluation runner.
 *
 *   npm run eval:intents -w @lykia/api                      offline: deterministic lexicon, mocked chain state
 *   BASE=https://api.lykiaai.com \
 *     npm run eval:intents -w @lykia/api                    live: POST $BASE/v1/ai/compile (model path when the
 *                                                          deployment has a model key), every case
 *   READER=deterministic BASE=... npm run eval:intents ... live, forcing the lexicon
 *   ONLY=studio,defensive   CATEGORY=injection   VERBOSE=1  filters and per-check output
 *   LYKIA_EVAL_LOCALE=all (default) | en | tr,fr            interface languages for the conversation suite: every
 *                                                          answer must come back whole in that language
 *
 * Offline runs score the "both" cases (English); live runs score every case,
 * other languages included. Offline runs also score whole Lyko turns
 * (turns.ts): grounding, binding route choice, Lyko on watch's sourced
 * answers and the Whistle, preflight on whole plans (preflight.ts), and the conversation suite
 * (conversations.ts: what people type into Ask Lyko, through the chat route). Each case is scored check by check (score.ts)
 * and a summary table is printed. Exit code 1 when a scored case fails.
 */
import { isLocale, LOCALES as LOCALE_LIST, type Locale } from "@lykia/core";
import { compileOffline } from "../compiler/service.js";
import { EVAL_CASES, type EvalCase } from "./intents.js";
import { scoreResult, type CaseScore } from "./score.js";
import { evalState, PRESET_BALANCES } from "./states.js";
import { runTurnCases } from "./turns.js";
import { runPreflightCases } from "./preflight.js";
import { runConversationCases } from "./conversationRun.js";

const BASE = process.env.BASE?.replace(/\/+$/u, "") ?? null;
const READER = (process.env.READER ?? (BASE ? "llm" : "deterministic")) as "llm" | "deterministic" | "auto";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : null;
const CATEGORY = process.env.CATEGORY ?? null;
const VERBOSE = process.env.VERBOSE === "1";
const LOCALES: readonly Locale[] = (() => {
  const raw = (process.env.LYKIA_EVAL_LOCALE ?? "all").trim();
  if (raw === "all") return LOCALE_LIST;
  const picked = raw.split(",").map((s) => s.trim()).filter(isLocale);
  return picked.length > 0 ? picked : ["en"];
})();
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 90_000);

async function live(c: EvalCase): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}/v1/ai/compile`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.LYKIA_API_KEY ? { authorization: `Bearer ${process.env.LYKIA_API_KEY}` } : {}) },
      body: JSON.stringify({ text: c.text, environment: "mainnet", balances: PRESET_BALANCES[c.state], reader: READER, search: false, preview: false }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!response.ok) throw new Error(`HTTP ${response.status}${body?.error?.message ? `: ${body.error.message}` : ""}${response.status === 404 ? " (is /v1/ai/compile deployed?)" : ""}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 1)}…` : text + " ".repeat(width - text.length);
}

async function main(): Promise<void> {
  const cases = EVAL_CASES.filter((c) => (BASE ? true : c.mode === "both") && (!ONLY || ONLY.has(c.id)) && (!CATEGORY || c.category === CATEGORY));
  const skipped = EVAL_CASES.length - cases.length;
  console.log(`Intent compiler evaluation · ${BASE ? `live ${BASE} (reader ${READER})` : "offline (deterministic lexicon, mocked chain state)"} · ${cases.length} cases${skipped ? `, ${skipped} skipped` : ""}\n`);
  const scores: CaseScore[] = [];
  for (const c of cases) {
    try {
      const result = BASE ? await live(c) : compileOffline(c.text, evalState(c.state));
      scores.push(scoreResult(c, result));
    } catch (error) {
      scores.push({ id: c.id, category: c.category, passed: false, checks: [], score: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  // Whole turns (scripted model, fake Arc): offline only.
  if (!BASE) scores.push(...(await runTurnCases(ONLY, CATEGORY)));
  // Preflight on whole plans (fake Arc): offline only.
  if (!BASE) scores.push(...(await runPreflightCases(ONLY, CATEGORY)));
  // Whole conversations through the chat route (fake Arc, the reader path): offline only; `npm run eval:live` runs them against a deployment.
  if (!BASE) scores.push(...(await runConversationCases(ONLY, CATEGORY, process.env.PRINT === "1", LOCALES)));
  console.log(`${pad("case", 26)} ${pad("category", 14)} ${pad("result", 6)} ${pad("checks", 7)} failing`);
  console.log("-".repeat(100));
  for (const s of scores) {
    const failing = s.error ? `error: ${s.error}` : s.checks.filter((x) => !x.ok).map((x) => x.name).join("; ");
    console.log(`${pad(s.id, 26)} ${pad(s.category, 14)} ${pad(s.passed ? "PASS" : "FAIL", 6)} ${pad(`${s.checks.filter((x) => x.ok).length}/${s.checks.length}`, 7)} ${failing.slice(0, 120)}`);
    if (VERBOSE || (!s.passed && !s.error)) for (const x of s.checks.filter((k) => VERBOSE || !k.ok)) console.log(`${" ".repeat(28)}${x.ok ? "ok  " : "FAIL"} ${x.name}${x.detail ? ` — ${x.detail}` : ""}`);
  }
  const passed = scores.filter((s) => s.passed).length;
  const checks = scores.flatMap((s) => s.checks);
  const byCategory = new Map<string, { n: number; pass: number }>();
  for (const s of scores) {
    const row = byCategory.get(s.category) ?? { n: 0, pass: 0 };
    row.n++;
    if (s.passed) row.pass++;
    byCategory.set(s.category, row);
  }
  console.log("-".repeat(100));
  console.log(`By category: ${[...byCategory.entries()].map(([k, v]) => `${k} ${v.pass}/${v.n}`).join(" · ")}`);
  console.log(`Cases passed: ${passed}/${scores.length} (${scores.length ? ((passed / scores.length) * 100).toFixed(1) : "0"}%) · checks passed: ${checks.filter((x) => x.ok).length}/${checks.length} (${checks.length ? ((checks.filter((x) => x.ok).length / checks.length) * 100).toFixed(1) : "0"}%)`);
  if (passed < scores.length) process.exitCode = 1;
}

await main();
