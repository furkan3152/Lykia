/** The Arc pulse: GET /arc/pulse and the SSE stream. */
import type { ApiModule } from "../http/router.js";
import { LykiaHttpError } from "../http/errors.js";
import { openSse } from "../http/sse.js";
import { parseQuery } from "../http/validate.js";
import { environmentOf, environmentQuery } from "./common.js";

export const arcModule: ApiModule = {
  name: "arc",
  register(router, ctx) {
    router.get("/arc/pulse", async (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      const pulse = await ctx.pulse.current(environment);
      if (!pulse) throw new LykiaHttpError("NETWORK_UNAVAILABLE", 503, `Arc ${environment} did not answer in time.`);
      res.json(pulse);
    });

    router.get("/arc/pulse/stream", (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      const stream = openSse(req, res, { slots: ctx.limits.streams });
      const latest = ctx.pulse.latest(environment);
      if (latest) stream.send("pulse", latest);
      const stop = ctx.pulse.subscribe(environment, (pulse) => stream.send("pulse", pulse));
      stream.onClose(stop);
    });
  },
};
