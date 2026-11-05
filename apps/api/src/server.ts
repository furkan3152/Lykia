/**
 * HTTP server lifecycle: listen, then graceful shutdown on SIGTERM/SIGINT:
 * stop accepting, close idle keep-alive sockets, end open SSE streams (they
 * never finish by themselves), give other in-flight requests 2 s before
 * cutting them, stop background work and pools, and exit; a hard exit after
 * 5 s regardless.
 */
import type { Server } from "node:http";
import type { Express } from "express";
import { closeContext, type AppContext } from "./context.js";
import type { ApiModule } from "./http/router.js";

const SHUTDOWN_GRACE_MS = 2_000;
const SHUTDOWN_DEADLINE_MS = 5_000;

export interface RunningServer {
  readonly server: Server;
  /** Resolves when the server is closed and the context released. Idempotent. */
  stop(reason: string): Promise<void>;
}

/** Starts background work of each module (pollers, schedulers); a failing module is logged, never fatal. */
export async function startModules(ctx: AppContext, modules: readonly ApiModule[]): Promise<void> {
  for (const module of modules) {
    if (!module.start) continue;
    try {
      await module.start(ctx);
    } catch (error) {
      ctx.log.error("module failed to start", { module: module.name, error: error instanceof Error ? error : String(error) });
    }
  }
}

async function stopModules(ctx: AppContext, modules: readonly ApiModule[]): Promise<void> {
  for (const module of [...modules].reverse()) {
    if (!module.stop) continue;
    try {
      await module.stop(ctx);
    } catch (error) {
      ctx.log.error("module failed to stop", { module: module.name, error: error instanceof Error ? error : String(error) });
    }
  }
}

export function startServer(ctx: AppContext, app: Express, modules: readonly ApiModule[] = []): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(ctx.config.port, ctx.config.host);
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      server.on("error", (error) => ctx.log.error("http server error", { error }));
      const address = server.address();
      ctx.log.info("lykia api listening", {
        host: ctx.config.host,
        port: typeof address === "object" && address ? address.port : ctx.config.port,
        mode: ctx.config.mode,
        store: ctx.store.kind,
        version: ctx.config.version,
      });
      void startModules(ctx, modules);
      let stopping: Promise<void> | null = null;
      resolve({
        server,
        stop(reason) {
          stopping ??= (async () => {
            ctx.log.info("shutting down", { reason });
            const closed = new Promise<void>((done) => server.close(() => done()));
            server.closeIdleConnections();
            // Event streams never finish by themselves: end them now so clients reconnect elsewhere.
            const streams = ctx.limits.streams.closeAll();
            if (streams > 0) ctx.log.info("closed event streams", { streams });
            const cut = setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS);
            cut.unref();
            // Background work first: no new upstream calls while requests drain.
            await stopModules(ctx, modules);
            ctx.pulse.close();
            await closed;
            clearTimeout(cut);
            await closeContext(ctx);
            ctx.log.info("shutdown complete");
          })();
          return stopping;
        },
      });
    });
  });
}

/** Wires SIGTERM/SIGINT and last-resort error handlers to `stop`, exiting the process afterwards. */
export function installProcessHandlers(running: RunningServer, ctx: AppContext): void {
  const exit = (code: number, reason: string) => {
    const deadline = setTimeout(() => process.exit(code || 1), SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    running
      .stop(reason)
      .catch((error: unknown) => ctx.log.error("shutdown failed", { error: error instanceof Error ? error : String(error) }))
      .finally(() => process.exit(code));
  };
  process.once("SIGTERM", () => exit(0, "SIGTERM"));
  process.once("SIGINT", () => exit(0, "SIGINT"));
  process.on("unhandledRejection", (reason) => {
    ctx.log.error("unhandled rejection", { error: reason instanceof Error ? reason : String(reason) });
  });
  process.once("uncaughtException", (error) => {
    ctx.log.error("uncaught exception", { error });
    exit(1, "uncaughtException");
  });
}
