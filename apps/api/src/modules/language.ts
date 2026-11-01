/** POST /language/parse: English and Turkish sentences to plan actions. */
import { z } from "zod";
import type { ApiModule } from "../http/router.js";
import { parseBody } from "../http/validate.js";
import { readSentence } from "../language/reader.js";

export const languageModule: ApiModule = {
  name: "language",
  register(router) {
    router.post("/language/parse", (req, res) => {
      const body = parseBody(req, z.object({ text: z.string().min(1).max(500), environment: z.enum(["mainnet", "testnet"]).optional(), owner: z.string().optional() }));
      res.json(readSentence(body.text));
    });
  },
};
