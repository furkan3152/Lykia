/**
 * Conditional orders (LykiaOrders): limit, stop-loss, take-profit, DCA, TWAP.
 *
 *   GET  /orders/config?environment=           contract, fee, EIP-712 domain and types, feeds
 *   POST /orders/draft                         typed data to sign + the allowance still needed
 *   POST /orders                               { environment, kind, summary, order, signature } → OrderView
 *   GET  /orders?owner=&environment=           the owner's orders with live status
 *   GET  /orders/:hash/cancel-tx?environment=  unsigned cancel (the maker sends it)
 *   GET  /orders/:hash/execute-tx?environment=&keeper=  unsigned execute for any wallet (earns the tip)
 *   POST /orders/keeper/tick?environment=      one keeper pass (admin or CRON_SECRET)
 *
 * The server never signs for makers. The keeper key (LYKIA_KEEPER_PRIVATE_KEY,
 * optional) only executes orders that are due; the contract enforces the rest.
 */
import { findToken, fromBaseUnits, ORDER_KINDS, type Address, type OrderKind, type SignedOrderStruct } from "@lykia/core";
import { cronAuthorized } from "../platform/crypto.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import type { ApiModule } from "../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery } from "../http/validate.js";
import { KEEPER_INTERVAL_MS, ordersService, publicOrderView } from "../orders/service.js";
import { sessionOf } from "../platform/session.js";
import { assertSignable, environmentOf, environmentSchema, ownerProof } from "./common.js";
import { orderVerdict, quoteOf, type OrderQuote } from "../orders/verdict.js";


const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u);
const uint = z.string().regex(/^\d{1,78}$/u);
const HashParams = z.object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/u) });

const draftSchema = z.object({
  owner: evmAddress,
  environment: environmentSchema.optional(),
  kind: z.enum(ORDER_KINDS as unknown as [OrderKind, ...OrderKind[]]),
  sell: z.string().min(2).max(10),
  buy: z.string().min(2).max(10),
  amount: decimal,
  executions: z.number().int().min(1).max(1000).optional(),
  intervalSeconds: z.number().int().min(60).max(30 * 86_400).optional(),
  triggerPrice: decimal.optional(),
  triggerAbove: z.boolean().optional(),
  slippageBps: z.number().int().min(0).max(1000).optional(),
  expiresInSeconds: z.number().int().min(600).max(365 * 86_400).optional(),
  maxTipBps: z.number().int().min(0).max(100).optional(),
  fence: z.unknown().optional(),
});

const orderSchema = z.object({
  maker: evmAddress,
  tokenIn: evmAddress,
  tokenOut: evmAddress,
  amountIn: uint,
  minAmountOut: uint,
  maxTip: uint,
  maxFeeBps: z.number().int().min(0).max(300),
  oracle: evmAddress,
  triggerPrice: z.string().regex(/^-?\d{1,77}$/u),
  triggerAbove: z.boolean(),
  maxOracleAge: z.number().int().min(0).max(4_294_967_295),
  kind: z.number().int().min(0).max(4),
  executions: z.number().int().min(1).max(1000),
  interval: z.number().int().min(0).max(4_294_967_295),
  startTime: z.number().int().min(0),
  deadline: z.number().int().min(0),
  nonce: uint,
});

const submitSchema = z.object({
  environment: environmentSchema.optional(),
  kind: z.enum(ORDER_KINDS as unknown as [OrderKind, ...OrderKind[]]),
  summary: z.string().max(200).default(""),
  order: orderSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130,}$/u),
});

const timers = new WeakMap<AppContext, NodeJS.Timeout>();

async function mayRunKeeper(ctx: AppContext, req: Parameters<typeof sessionOf>[1]): Promise<boolean> {
  if (cronAuthorized(req.headers.authorization)) return true;
  const session = await sessionOf(ctx, req);
  return Boolean(session && ctx.config.platform.adminAddresses.includes(session.address.toLowerCase()));
}

export const ordersModule: ApiModule = {
  name: "orders",
  register(router, ctx) {
    const s = () => ordersService(ctx);

    router.get("/orders/config", async (req, res) => {
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      res.json(await s().config(environmentOf(ctx, q.environment)));
    });

    // Each execution of an order is one swap the keeper may run: the owner's Fence and the mainnet beta cap judge one
    // execution's full value (amountIn is pulled per execution) at draft time and again when the signed order is stored.
    const judge = async (environment: "mainnet" | "testnet", owner: Address, sell: string, buy: string, perExecution: string, fence: unknown, quote: OrderQuote) => {
      const verdict = await orderVerdict(ctx, { environment, owner, sell, buy, perExecution, quote, ...(fence !== undefined ? { fence } : {}) });
      assertSignable(verdict);
      return verdict;
    };

    router.post("/orders/draft", ctx.limits.heavy, async (req, res) => {
      const b = parseBody(req, draftSchema);
      const environment = environmentOf(ctx, b.environment);
      const draft = await s().draft({ ...b, owner: b.owner as Address, environment });
      const verdict = await judge(environment, b.owner as Address, b.sell, b.buy, b.amount, b.fence, quoteOf(draft, b.triggerPrice));
      res.json({ ...draft, verdict });
    });

    router.post("/orders", ctx.limits.heavy, async (req, res) => {
      const b = parseBody(req, submitSchema);
      const environment = environmentOf(ctx, b.environment);
      const sell = findToken(environment, b.order.tokenIn);
      const buy = findToken(environment, b.order.tokenOut);
      if (!sell || !buy) throw new LykiaHttpError("INVALID_REQUEST", 400, "Orders trade registry tokens (see /v1/tokens).");
      // The signed order's own quote: the minimum out at the trigger when it has one (the reference is the trigger), else the
      // minimum out before the draft's default 1% slippage, against Chainlink now.
      const triggered = b.order.oracle !== "0x0000000000000000000000000000000000000000" && BigInt(b.order.triggerPrice) > 0n;
      const swapped = BigInt(b.order.amountIn) - (BigInt(b.order.amountIn) * BigInt(b.order.maxFeeBps)) / 10_000n - BigInt(b.order.maxTip);
      const expectedOut = (BigInt(b.order.minAmountOut) * 10_000n) / 9_900n;
      await judge(environment, b.order.maker as Address, sell.symbol, buy.symbol, fromBaseUnits(BigInt(b.order.amountIn), sell.decimals), undefined, { swapped: fromBaseUnits(swapped, sell.decimals), expectedOut: fromBaseUnits(expectedOut, buy.decimals), ...(triggered ? { triggerPrice: fromBaseUnits(BigInt(b.order.triggerPrice), 8) } : {}) });
      res.status(201).json(await s().submit(environment, b.order as SignedOrderStruct, b.signature as `0x${string}`, b.kind, b.summary));
    });

    router.get("/orders", async (req, res) => {
      const q = parseQuery(req, z.object({ owner: evmAddress, environment: environmentSchema.optional() }));
      const orders = await s().list(environmentOf(ctx, q.environment), q.owner as Address);
      // Resting levels are private until they execute: the full view only for the proven owner.
      if (await ownerProof(ctx, req, q.owner)) return void res.json({ orders, redacted: false });
      res.json({ orders: orders.map(publicOrderView), redacted: true });
    });

    router.get("/orders/:hash/cancel-tx", async (req, res) => {
      const { hash } = parseParams(req, HashParams);
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      res.json(await s().cancelTx(environmentOf(ctx, q.environment), hash));
    });

    router.get("/orders/:hash/execute-tx", ctx.limits.heavy, async (req, res) => {
      const { hash } = parseParams(req, HashParams);
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional(), keeper: evmAddress }));
      res.json(await s().executeTx(environmentOf(ctx, q.environment), hash, q.keeper as Address));
    });

    router.post("/orders/keeper/tick", ctx.limits.heavy, async (req, res) => {
      if (!(await mayRunKeeper(ctx, req))) throw new LykiaHttpError("NOT_FOUND", 404, "Not found.");
      const q = parseQuery(req, z.object({ environment: environmentSchema.optional() }));
      res.json(await s().tick(environmentOf(ctx, q.environment)));
    });
  },
  start(ctx) {
    const loop = async () => {
      for (const env of ["mainnet", "testnet"] as const) {
        try {
          const r = await ordersService(ctx).tick(env);
          if (r.executed > 0) ctx.log.info("keeper pass", { environment: env, ...r });
        } catch (error) {
          ctx.log.debug("keeper pass failed", { environment: env, error: error instanceof Error ? error.message : String(error) });
        }
      }
      const t = setTimeout(() => void loop(), KEEPER_INTERVAL_MS);
      t.unref();
      timers.set(ctx, t);
    };
    const t = setTimeout(() => void loop(), KEEPER_INTERVAL_MS);
    t.unref();
    timers.set(ctx, t);
  },
  stop(ctx) {
    const t = timers.get(ctx);
    if (t) clearTimeout(t);
    timers.delete(ctx);
  },
};
