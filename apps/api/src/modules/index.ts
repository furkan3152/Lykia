/** Every API module, in mount order. */
import type { ApiModule } from "../http/router.js";
import { agentModule } from "./agent.js";
import { arcModule } from "./arc.js";
import { fenceModule } from "./fence.js";
import { flockModule } from "./flock.js";
import { intentsModule } from "./intents.js";
import { kunyeModule } from "./kunye.js";
import { languageModule } from "./language.js";
import { mcpModule } from "./mcp.js";
import { scentModule } from "./scent.js";
import { systemModule } from "./system.js";

export const MODULES: readonly ApiModule[] = [systemModule, arcModule, flockModule, fenceModule, languageModule, intentsModule, scentModule, kunyeModule, agentModule, mcpModule];
