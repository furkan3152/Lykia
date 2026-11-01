/** Every API module, in mount order. */
import type { ApiModule } from "../http/router.js";
import { adminModule } from "./admin.js";
import { agentModule } from "./agent.js";
import { authModule } from "./auth.js";
import { developersModule } from "./developers.js";
import { platformModule } from "./platform.js";
import { arcModule } from "./arc.js";
import { fenceModule } from "./fence.js";
import { flockModule } from "./flock.js";
import { intentsModule } from "./intents.js";
import { tagModule } from "./tag.js";
import { languageModule } from "./language.js";
import { mcpModule } from "./mcp.js";
import { scentModule } from "./scent.js";
import { routesModule } from "./routes.js";
import { knowledgeModule } from "./knowledge.js";
import { standingModule } from "./standing.js";
import { systemModule } from "./system.js";
import { personalModule } from "./personal.js";
import { circleModule } from "./circle.js";
import { circleStackModule } from "./circleStack.js";
import { ownershipModule } from "./ownership.js";
import { jobsModule } from "./jobs.js";
import { ordersModule } from "./orders.js";
import { alertsModule } from "./alerts.js";
import { discoverModule } from "./discover.js";
import { ecosystemModule } from "./ecosystem.js";
import { projectsModule } from "./projects.js";
import { securityModule } from "./security.js";
import { devflowsModule } from "./devflows.js";
import { aggregatorModule } from "./aggregator.js";
import { aiModule } from "./ai.js";
import { integrationsModule } from "./integrations.js";
import { dataModule } from "./data.js";

// developersModule goes first: its gate checks every request that presents a Lykia-Key.
export const MODULES: readonly ApiModule[] = [developersModule, platformModule, projectsModule, authModule, systemModule, arcModule, flockModule, fenceModule, languageModule, intentsModule, standingModule, routesModule, knowledgeModule, scentModule, tagModule, agentModule, personalModule, circleModule, circleStackModule, ownershipModule, jobsModule, ordersModule, alertsModule, discoverModule, ecosystemModule, adminModule, securityModule, devflowsModule, aggregatorModule, aiModule, integrationsModule, dataModule, mcpModule];
