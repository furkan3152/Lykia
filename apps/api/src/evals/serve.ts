/**
 * The offline API the conversation suite runs on, served on a port:
 *
 *   npm run eval:serve -w @lykia/api          (http://localhost:8787, or LYKIA_EVAL_PORT)
 *   LYKIA_EVAL_BASE_URL=http://localhost:8787 npm run eval:live -w @lykia/api
 *   VITE_API_URL=http://localhost:8787 npm run dev -w @lykia/web
 *   LYKIA_EVAL_MODEL=drifting npm run eval:serve -w @lykia/api   (the model path, with a scripted model)
 *
 * A fake Arc, no model (the reader path) and no network. The sample address
 * holds 187.28 USDC and owes 600 USDC on Aave V4 at health 1.38, so a
 * signed-out visitor sees what the suite checks: a labelled sample, a loan
 * under the floor and its computed fix. Nothing here touches a real chain.
 */
import { findToken, SAMPLE_OWNER, tokenAddress } from "@lykia/core";
import type { PulseFeed } from "../arc/pulse.js";
import { createApp } from "../app.js";
import { createContext } from "../context.js";
import { offlineFetch, testConfig } from "../__tests__/support.js";
import { lendOnAave, TalkArc } from "./conversationRun.js";
import { setLlmClient } from "../agents/index.js";
import { driftingModel } from "./driftingModel.js";

const PORT = Number(process.env.LYKIA_EVAL_PORT ?? 8787);
const USDC = "0x3600000000000000000000000000000000000000";
const GALAXY = "0x8E357432CC12ff425c36432F312968aEb16112AF";
const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };

const arc = new TalkArc();
arc.setBalance(USDC, SAMPLE_OWNER, 187_280_000n);
const eurc = findToken("mainnet", "EURC");
const eurcAt = eurc ? tokenAddress(eurc, "mainnet") : null;
if (eurcAt) arc.setBalance(eurcAt, SAMPLE_OWNER, 10_440_000n);
arc.vaultAssets.set(GALAXY.toLowerCase(), 80_000_000_000_000n);
lendOnAave(arc);

const ctx = createContext(testConfig({ LYKIA_WEB_ORIGIN: process.env.LYKIA_WEB_ORIGIN ?? "http://localhost:5173,http://localhost:4173", LYKIA_RATE_LIMIT_HEAVY: "100000", LYKIA_RATE_LIMIT_SHARED: "100000", LYKIA_RATE_LIMIT_DEFAULT: "100000" }), { chains: arc.asChains(), pulse: idlePulse, fetch: offlineFetch() });
// LYKIA_EVAL_MODEL=drifting: the model path, answered by the scripted model that drifts like a live one.
if (process.env.LYKIA_EVAL_MODEL === "drifting") setLlmClient(ctx, driftingModel());
createApp(ctx).listen(PORT, "127.0.0.1", () => console.log(`Offline Lykia API (fake Arc, reader path) on http://localhost:${PORT}`));
