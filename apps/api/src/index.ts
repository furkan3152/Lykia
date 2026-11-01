/**
 * Process entry: load .env (when present), validate the environment, build
 * the context and the app, listen, and shut down gracefully on SIGTERM.
 */
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { createContext } from "./context.js";
import { MODULES } from "./modules/index.js";
import { installProcessHandlers, startServer } from "./server.js";

dotenv.config({ quiet: true });

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  const ctx = createContext(config);
  const app = createApp(ctx);
  try {
    const running = await startServer(ctx, app, MODULES);
    installProcessHandlers(running, ctx);
  } catch (error) {
    ctx.log.error("failed to start", { error: error instanceof Error ? error : String(error) });
    process.exit(1);
  }
}

void main();
