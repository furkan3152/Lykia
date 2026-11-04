/**
 * Creates the League's official cities (Lykia Pay, Lykia Agents and the
 * coming Lykia Perps) as real projects owned by the first address in
 * LYKIA_ADMIN_ADDRESSES. Idempotent and safe in production: each city has a
 * deterministic project id, cities that already exist are left as they are.
 *
 *   npm run seed:league -w @lykia/api            (reads .env like the server)
 *
 * The same seed runs from Letoon (League council, "Seed official cities").
 */
import dotenv from "dotenv";
import { loadConfig } from "../config.js";
import { closeContext, createContext } from "../context.js";
import { seedLeague } from "../platform/league.js";

dotenv.config({ quiet: true });
const ctx = createContext(loadConfig(process.env));
try {
  const report = await seedLeague(ctx, "seed-script");
  for (const c of report.cities) console.log(`${c.outcome.padEnd(8)} ${c.name} (${c.projectId})`);
  console.log(`owner ${report.owner} · store ${ctx.store.kind}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await closeContext(ctx);
}
