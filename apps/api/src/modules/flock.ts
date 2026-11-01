/** The Flock: GET /flock/:address and its SSE stream (snapshot when anything changed). */
import { canonicalDigest, type Address } from "@lykia/core";
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { openSse } from "../http/sse.js";
import { evmAddress, parseParams, parseQuery } from "../http/validate.js";
import { services } from "../services.js";
import { environmentOf, environmentQuery } from "./common.js";

export const FLOCK_STREAM_INTERVAL_MS = 10_000;
const Params = z.object({ address: evmAddress });

export const flockModule: ApiModule = {
  name: "flock",
  register(router, ctx) {
    router.get("/flock/:address", ctx.limits.heavy, async (req, res) => {
      const { address } = parseParams(req, Params);
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json(await services(ctx).flock.snapshot(environment, address as Address));
    });

    router.get("/flock/:address/stream", ctx.limits.heavy, (req, res) => {
      const { address } = parseParams(req, Params);
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      const stream = openSse(req, res, { slots: ctx.limits.streams });
      let last = "";
      let timer: NodeJS.Timeout | null = null;
      const tick = async () => {
        try {
          const snapshot = await services(ctx).flock.snapshot(environment, address as Address);
          const digest = canonicalDigest({ ...snapshot, at: "", block: "" });
          if (digest !== last) stream.send("snapshot", snapshot);
          else stream.send("unchanged", { at: snapshot.at, block: snapshot.block }, undefined, { droppable: true });
          last = digest;
        } catch {
          stream.send("error", { message: "The flock could not be read just now." });
        }
        if (!stream.closed) timer = setTimeout(() => void tick(), FLOCK_STREAM_INTERVAL_MS);
      };
      void tick();
      stream.onClose(() => {
        if (timer) clearTimeout(timer);
      });
    });
  },
};
