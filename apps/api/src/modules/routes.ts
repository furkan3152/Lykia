/**
 * Route intelligence and Circle rails that are not plans:
 *
 *   POST /quote          every live venue's option for a swap, earn or borrow, and the engine's pick (why this route)
 *   GET  /rates          live yields and borrow rates on Arc mainnet (Morpho API, Aave API), labelled
 *   POST /cctp/inbound   USDC burned on another chain: Iris attestation + the unsigned receiveMessage on Arc
 */
import { CCTP_DESTINATIONS, contractAddress, networkFor, type Address } from "@lykia/core";
import { encodeFunctionData } from "viem";
import { z } from "zod";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseQuery, txHash } from "../http/validate.js";
import { MESSAGE_TRANSMITTER_V2_ABI } from "../engine/abis.js";
import { IRIS_API } from "../engine/adapters.js";
import { quoteVenues, type QuoteRequest } from "../engine/api.js";
import { services } from "../services.js";
import { environmentOf, environmentQuery, environmentSchema } from "./common.js";

const amount = z.string().regex(/^\d{1,18}(?:\.\d{1,18})?$/u);
const token = z.string().min(2).max(10);

const quoteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("swap"), environment: environmentSchema.optional(), from: token, to: token, amount }),
  z.object({ kind: z.literal("earn"), environment: environmentSchema.optional(), token, maxRisk: z.enum(["low", "medium", "high"]).optional() }),
  z.object({ kind: z.literal("borrow"), environment: environmentSchema.optional(), token, amount, collateral: token.optional(), collateralAmount: amount.optional(), minHealth: z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/u).optional(), account: evmAddress }),
]);

export const routesModule: ApiModule = {
  name: "routes",
  register(router, ctx) {
    router.post("/quote", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, quoteSchema);
      const request = { ...body, environment: environmentOf(ctx, body.environment) } as QuoteRequest;
      res.json(await quoteVenues(services(ctx).router, request));
    });

    router.get("/rates", ctx.limits.heavy, async (req, res) => {
      const environment = environmentOf(ctx, parseQuery(req, environmentQuery).environment);
      res.json({ environment, ...(await services(ctx).yields.rates(environment)) });
    });

    router.post("/cctp/inbound", ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, z.object({ environment: environmentSchema.optional(), source: z.string().min(2).max(20), txHash, from: evmAddress.optional() }));
      const environment = environmentOf(ctx, body.environment);
      const source = CCTP_DESTINATIONS.find((d) => d.key === body.source.toLowerCase() || d.name.toLowerCase() === body.source.toLowerCase());
      if (!source) throw new LykiaHttpError("INVALID_REQUEST", 400, `${body.source} is not a CCTP chain Lykia knows.`);
      let messages: Array<{ status?: string; attestation?: string; message?: string; decodedMessage?: { destinationDomain?: string } }> = [];
      try {
        const response = await ctx.fetch(`${IRIS_API[environment]}/v2/messages/${source.domain}?transactionHash=${body.txHash}`, { signal: AbortSignal.timeout(6_000) });
        if (response.status === 404) messages = [];
        else if (!response.ok) throw new Error(String(response.status));
        else messages = ((await response.json()) as { messages?: typeof messages }).messages ?? [];
      } catch {
        throw new LykiaHttpError("UPSTREAM_UNAVAILABLE", 503, "Circle's attestation service (Iris) did not answer.");
      }
      const message = messages[0];
      if (!message) return void res.json({ status: "not-found", source: source.key, note: "Iris has not seen this burn yet; try again in a few seconds." });
      if (message.status !== "complete" || !message.attestation || !message.message) return void res.json({ status: "pending", source: source.key, note: "The burn is waiting for its attestation." });
      const network = networkFor(environment);
      const transmitter = contractAddress("messageTransmitterV2", environment) as Address;
      res.json({
        status: "complete",
        source: source.key,
        message: message.message,
        attestation: message.attestation,
        transaction: {
          chainId: network.chainId,
          ...(body.from ? { from: body.from } : {}),
          to: transmitter,
          data: encodeFunctionData({ abi: MESSAGE_TRANSMITTER_V2_ABI, functionName: "receiveMessage", args: [message.message as `0x${string}`, message.attestation as `0x${string}`] }),
          value: "0",
          label: `Mint USDC on Arc from a ${source.name} burn (CCTP)`,
        },
        note: "Anyone may submit receiveMessage; it mints to the recipient the burn named.",
      });
    });
  },
};
