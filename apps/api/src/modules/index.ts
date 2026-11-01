/** Every API module, in mount order. */
import type { ApiModule } from "../http/router.js";
import { adminModule } from "./admin.js";
import { agentModule } from "./agent.js";
import { authModule } from "./auth.js";
import { developersModule } from "./developers.js";
import { arcModule } from "./arc.js";
import { fenceModule } from "./fence.js";
import { flockModule } from "./flock.js";
import { intentsModule } from "./intents.js";
import { kunyeModule } from "./kunye.js";
import { languageModule } from "./language.js";
import { mcpModule } from "./mcp.js";
import { scentModule } from "./scent.js";
import { routesModule } from "./routes.js";
import { standingModule } from "./standing.js";
import { systemModule } from "./system.js";
import { personalModule } from "./personal.js";
import { circleModule } from "./circle.js";
import { jobsModule } from "./jobs.js";
import { ordersModule } from "./orders.js";
import { alertsModule } from "./alerts.js";
import { discoverModule } from "./discover.js";

// developersModule goes first: its gate checks every request that presents a Lykia-Key.
export const MODULES: readonly ApiModule[] = [developersModule, authModule, systemModule, arcModule, flockModule, fenceModule, languageModule, intentsModule, standingModule, routesModule, scentModule, kunyeModule, agentModule, personalModule, circleModule, jobsModule, ordersModule, alertsModule, discoverModule, adminModule, mcpModule];
