/** POST /language/parse: English sentences to plan actions. */
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { parseBody } from "../http/validate.js";
import type { Address } from "@lykia/core";
import { readWithMemory } from "../personal/reader.js";
import { sessionOf } from "../platform/session.js";

export const languageModule: ApiModule = {
  name: "language",
  register(router, ctx) {
    router.post("/language/parse", async (req, res) => {
      const body = parseBody(req, z.object({ text: z.string().min(1).max(500), environment: z.enum(["mainnet", "testnet"]).optional(), owner: z.string().optional() }));
      // Memory (contacts, "again", "undo") is personal: it is read only for the signed-in owner.
      const session = await sessionOf(ctx, req);
      res.json(await readWithMemory(ctx, (session?.address as Address | undefined) ?? null, body.text));
    });
  },
};
