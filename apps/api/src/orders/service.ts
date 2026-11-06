/**
 * Conditional orders through LykiaOrders: drafts (EIP-712 typed data plus the
 * allowance the maker still needs), signed-order intake, status from chain
 * state, cancel transactions, and the keeper.
 *
 * The keeper is permissionless on chain. With LYKIA_KEEPER_PRIVATE_KEY set the
 * server executes due orders itself (it earns the signed keeper tip); without
 * it, due orders are marked so any wallet can execute them from the web
 * (GET /v1/orders/:hash/execute-tx). The key is read from the environment,
 * never logged and never returned.
 */
import {
  DEFAULT_FEE_BPS,
  findToken,
  fromBaseUnits,
  lykiaContracts,
  maxTipFor,
  networkFor,
  ORDER_EIP712_TYPES,
  ORDER_KIND_INDEX,
  orderDomain,
  orderSlice,
  toBaseUnitsBig,
  tokenAddress,
  validateOrderStruct,
  type Address,
  type ArcEnvironment,
  type OrderKind,
  type OrderRecord,
  type OrderStatus,
  type OrderView,
  type SignedOrderStruct,
} from "@lykia/core";
import { createWalletClient, encodeFunctionData, hashStruct, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppContext } from "../context.js";
import { LykiaHttpError } from "../http/errors.js";
import { FEEDS } from "../arc/prices.js";
import { QUOTER_V2_ABI, SWAP_ROUTER_02_ABI } from "../engine/abis.js";
import type { JsonValue } from "../store/types.js";

const ORDERS_ABI = lykiaContracts.lykiaOrdersArtifact.abi;
const ERC20_ABI = parseAbi(["function allowance(address owner, address spender) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"]);
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const FEE_TIERS = [100, 500, 3000] as const;

/** Uniswap v3 on Arc mainnet (registry row uniswap-v3; simulated by the engine). */
const UNISWAP: Readonly<Partial<Record<ArcEnvironment, { readonly quoter: Address; readonly router: Address }>>> = {
  mainnet: { quoter: "0x7dfd4f31be6814d2906bde155c3e1b146eac1468", router: "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77" },
};

export const KEEPER_INTERVAL_MS = 30_000;

export interface DraftInput {
  readonly owner: Address;
  readonly environment: ArcEnvironment;
  readonly kind: OrderKind;
  readonly sell: string;
  readonly buy: string;
  /** Whole tokens sold per execution. */
  readonly amount: string;
  readonly executions?: number;
  readonly intervalSeconds?: number;
  /** USD price of the non-USDC side (EURC/USD, BTC/USD) that triggers the order. */
  readonly triggerPrice?: string;
  readonly triggerAbove?: boolean;
  readonly slippageBps?: number;
  readonly expiresInSeconds?: number;
  readonly maxTipBps?: number;
}

export interface OrdersConfig {
  readonly environment: ArcEnvironment;
  readonly address: Address | null;
  readonly router: Address | null;
  readonly feeBps: number;
  readonly keeper: "server" | "anyone";
  readonly domain: ReturnType<typeof orderDomain> | null;
  readonly types: typeof ORDER_EIP712_TYPES;
  readonly feeds: Readonly<Record<string, { readonly address: Address; readonly pair: string }>>;
  readonly notes: readonly string[];
}

function ordersAddress(environment: ArcEnvironment): Address | null {
  return lykiaContracts.deployedAddress(environment, "LykiaOrders");
}

function routerAddress(environment: ArcEnvironment): Address | null {
  return lykiaContracts.deployedAddress(environment, "LykiaRouter");
}

function requireDeployed(environment: ArcEnvironment): Address {
  const address = ordersAddress(environment);
  if (!address) throw new LykiaHttpError("NO_ROUTE", 422, `LykiaOrders is not deployed on Arc ${environment} yet. Deploy it from the owner console (/owner); it is the next step of the deploy plan.`);
  return address;
}

function keeperKey(): Hex | null {
  const raw = process.env.LYKIA_KEEPER_PRIVATE_KEY;
  return raw && /^0x[0-9a-fA-F]{64}$/u.test(raw) ? (raw as Hex) : null;
}

/** The feed that prices the non-USDC side of a pair, if the pair has one. */
function feedFor(sell: string, buy: string): { readonly symbol: string; readonly address: Address; readonly pair: string; readonly maxAgeSeconds: number } | null {
  const other = sell === "USDC" ? buy : sell;
  const feed = FEEDS[other];
  return feed ? { symbol: other, ...feed } : null;
}

function toStruct(raw: SignedOrderStruct) {
  return {
    ...raw,
    amountIn: BigInt(raw.amountIn),
    minAmountOut: BigInt(raw.minAmountOut),
    maxTip: BigInt(raw.maxTip),
    triggerPrice: BigInt(raw.triggerPrice),
    startTime: BigInt(raw.startTime),
    deadline: BigInt(raw.deadline),
    nonce: BigInt(raw.nonce),
  };
}

export function orderHash(raw: SignedOrderStruct): `0x${string}` {
  return hashStruct({ data: toStruct(raw), primaryType: "Order", types: ORDER_EIP712_TYPES });
}

function describe(kind: OrderKind, sell: string, buy: string, amount: string, executions: number, pair: string | null, trigger: string | null, above: boolean): string {
  const base = `Sell ${amount} ${sell} for ${buy}`;
  const when = pair && trigger ? ` when ${pair} ${above ? "≥" : "≤"} ${trigger}` : "";
  if (kind === "dca" || kind === "twap") return `${kind.toUpperCase()}: ${base}, ${executions} times${when}`;
  const label = kind === "limit" ? "Limit" : kind === "stop-loss" ? "Stop-loss" : "Take-profit";
  return `${label}: ${base}${when}`;
}

class OrdersService {
  constructor(private readonly ctx: AppContext) {}

  private get docs() {
    return this.ctx.store.collection<JsonValue>("orders");
  }

  async config(environment: ArcEnvironment): Promise<OrdersConfig> {
    const address = ordersAddress(environment);
    let feeBps = DEFAULT_FEE_BPS;
    if (address) {
      feeBps = Number(await this.ctx.chains.client(environment).readContract({ address, abi: ORDERS_ABI, functionName: "feeBps" }).catch(() => BigInt(DEFAULT_FEE_BPS)));
    }
    const feeds = Object.fromEntries(Object.entries(FEEDS).filter(([s]) => s !== "USDC").map(([s, f]) => [s, { address: f.address, pair: f.pair }]));
    const notes = [
      "Orders are signed off chain; funds stay in your wallet behind an allowance until a keeper executes a slice.",
      `Each execution pays the protocol fee (${feeBps / 100}%) and a keeper tip of at most 1% from the slice; the rest is swapped and must meet your minimum.`,
    ];
    if (!address) notes.push(`LykiaOrders is not deployed on Arc ${environment} yet.`);
    if (environment === "testnet") notes.push("Chainlink feeds are read on Arc mainnet; on testnet only time-based orders (DCA, TWAP) and plain limits are practical.");
    return { environment, address, router: routerAddress(environment), feeBps, keeper: keeperKey() ? "server" : "anyone", domain: address ? orderDomain(environment, address) : null, types: ORDER_EIP712_TYPES, feeds, notes };
  }

  /** Best Uniswap v3 single-hop quote for `amountIn` (fee tier and output). */
  private async quote(environment: ArcEnvironment, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<{ fee: number; amountOut: bigint } | null> {
    const uni = UNISWAP[environment];
    if (!uni || amountIn <= 0n) return null;
    const client = this.ctx.chains.client(environment);
    let best: { fee: number; amountOut: bigint } | null = null;
    for (const fee of FEE_TIERS) {
      try {
        const { result } = await client.simulateContract({ address: uni.quoter, abi: QUOTER_V2_ABI, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }] });
        const out = (result as readonly bigint[])[0] ?? 0n;
        if (!best || out > best.amountOut) best = { fee, amountOut: out };
      } catch {
        /* no pool at this tier */
      }
    }
    return best && best.amountOut > 0n ? best : null;
  }

  async draft(input: DraftInput) {
    const env = input.environment;
    const address = requireDeployed(env);
    const sell = findToken(env, input.sell);
    const buy = findToken(env, input.buy);
    if (!sell || !buy) throw new LykiaHttpError("INVALID_REQUEST", 400, "Orders trade registry tokens (see /v1/tokens).");
    if (sell.symbol === buy.symbol) throw new LykiaHttpError("INVALID_REQUEST", 400, "Sell and buy tokens must differ.");
    const tokenIn = tokenAddress(sell, env) as Address;
    const tokenOut = tokenAddress(buy, env) as Address;
    const amountIn = toBaseUnitsBig(input.amount, sell.decimals);
    const single = input.kind === "limit" || input.kind === "stop-loss" || input.kind === "take-profit";
    const executions = single ? 1 : Math.max(2, Math.min(1000, input.executions ?? 4));
    const interval = single ? 0 : Math.max(60, input.intervalSeconds ?? 3600);
    const config = await this.config(env);
    const feeBps = config.feeBps;
    const maxTip = (amountIn * BigInt(Math.min(100, Math.max(0, input.maxTipBps ?? 10)))) / 10_000n;
    const slice = orderSlice(amountIn, feeBps, maxTip);
    const slippage = BigInt(Math.min(1000, Math.max(0, input.slippageBps ?? 100)));

    const feed = input.triggerPrice !== undefined ? feedFor(sell.symbol, buy.symbol) : null;
    if (input.triggerPrice !== undefined && !feed) throw new LykiaHttpError("INVALID_REQUEST", 400, "This pair has no price feed for a trigger on Arc.");
    if ((input.kind === "stop-loss" || input.kind === "take-profit") && !feed) throw new LykiaHttpError("INVALID_REQUEST", 400, "Stop-loss and take-profit orders need a triggerPrice.");
    const triggerAbove = input.triggerAbove ?? (input.kind === "take-profit" ? true : input.kind === "stop-loss" ? false : sell.symbol !== "USDC");
    const triggerPrice = feed ? toBaseUnitsBig(input.triggerPrice as string, 8) : 0n;

    // Minimum output: at the trigger price when there is one (the price the order is for), else the live quote, minus slippage.
    let expected: bigint | null = null;
    let basis = "";
    if (feed) {
      const swappedWhole = Number(fromBaseUnits(slice.swapped, sell.decimals));
      const price = Number(input.triggerPrice);
      const outWhole = sell.symbol === "USDC" ? swappedWhole / price : swappedWhole * price;
      expected = toBaseUnitsBig(outWhole.toFixed(buy.decimals), buy.decimals);
      basis = `at the trigger (${feed.pair} ${input.triggerPrice})`;
    } else {
      const q = await this.quote(env, tokenIn, tokenOut, slice.swapped);
      if (q) {
        expected = q.amountOut;
        basis = `from the live Uniswap v3 quote (${q.fee / 10_000}% pool)`;
      }
    }
    if (expected === null || expected <= 0n) throw new LykiaHttpError("NO_ROUTE", 422, "No price to set a minimum output; add a triggerPrice.");
    const minAmountOut = (expected * (10_000n - slippage)) / 10_000n;

    const now = Math.floor(this.ctx.clock.now() / 1000);
    const order: SignedOrderStruct = {
      maker: input.owner,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      minAmountOut: minAmountOut.toString(),
      maxTip: maxTip.toString(),
      maxFeeBps: feeBps,
      oracle: feed ? feed.address : ZERO,
      triggerPrice: triggerPrice.toString(),
      triggerAbove,
      maxOracleAge: feed ? feed.maxAgeSeconds : 0,
      kind: ORDER_KIND_INDEX[input.kind],
      executions,
      interval,
      startTime: now - 60,
      deadline: now + Math.max(600, Math.min(365 * 86_400, input.expiresInSeconds ?? 7 * 86_400)),
      nonce: BigInt(this.ctx.clock.now()).toString(),
    };
    const issues = validateOrderStruct(order);
    if (issues.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, issues.map((i) => i.message).join(" "), { issues });

    const total = amountIn * BigInt(executions);
    const allowance = (await this.ctx.chains.client(env).readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "allowance", args: [input.owner, address] }).catch(() => 0n)) as bigint;
    const approval = allowance >= total ? null : { chainId: networkFor(env).chainId, from: input.owner, to: tokenIn, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [address, total] }), value: "0", label: `Allow LykiaOrders to use ${fromBaseUnits(total, sell.decimals)} ${sell.symbol}` };
    const summary = describe(input.kind, sell.symbol, buy.symbol, input.amount, executions, feed?.pair ?? null, input.triggerPrice ?? null, triggerAbove);
    return {
      order,
      hash: orderHash(order),
      summary,
      typedData: { domain: orderDomain(env, address), types: ORDER_EIP712_TYPES, primaryType: "Order" as const, message: order },
      approval,
      perExecution: { fee: fromBaseUnits(slice.fee, sell.decimals), maxTip: fromBaseUnits(maxTip, sell.decimals), swapped: fromBaseUnits(slice.swapped, sell.decimals), minOut: fromBaseUnits(minAmountOut, buy.decimals), symbolIn: sell.symbol, symbolOut: buy.symbol },
      notes: [`Minimum output is set ${basis}, minus ${Number(slippage) / 100}% slippage.`, ...config.notes],
    };
  }

  async submit(environment: ArcEnvironment, order: SignedOrderStruct, signature: `0x${string}`, kind: OrderKind, summary: string): Promise<OrderView> {
    const address = requireDeployed(environment);
    const issues = validateOrderStruct(order);
    if (issues.length > 0) throw new LykiaHttpError("INVALID_REQUEST", 400, issues.map((i) => i.message).join(" "), { issues });
    if (ORDER_KIND_INDEX[kind] !== order.kind) throw new LykiaHttpError("INVALID_REQUEST", 400, "kind does not match the order.");
    const valid = await this.ctx.chains
      .client(environment)
      .verifyTypedData({ address: order.maker, domain: orderDomain(environment, address), types: ORDER_EIP712_TYPES, primaryType: "Order", message: toStruct(order), signature })
      .catch(() => false);
    if (!valid) throw new LykiaHttpError("INVALID_REQUEST", 400, "The signature does not match this order and maker.");
    const hash = orderHash(order);
    const record: OrderRecord = { hash, environment, owner: order.maker, kind, order, signature, summary: summary.slice(0, 200), createdAt: new Date(this.ctx.clock.now()).toISOString() };
    await this.docs.put(`${environment}:${order.maker.toLowerCase()}:${hash}`, record as unknown as JsonValue);
    return (await this.views(environment, [record]))[0] as OrderView;
  }

  private async records(environment: ArcEnvironment, owner?: Address): Promise<OrderRecord[]> {
    const prefix = owner ? `${environment}:${owner.toLowerCase()}:` : `${environment}:`;
    const docs = await this.docs.list({ prefix, limit: 500 });
    return docs.map((d) => d.value as unknown as OrderRecord);
  }

  private async views(environment: ArcEnvironment, records: readonly OrderRecord[]): Promise<OrderView[]> {
    const address = ordersAddress(environment);
    if (!address || records.length === 0) return records.map((r) => ({ ...r, status: "invalid" as OrderStatus, executed: 0, waitingFor: "LykiaOrders is not deployed", lastExecutedAt: null }));
    const client = this.ctx.chains.client(environment);
    const reads = await client.multicall({
      contracts: records.flatMap((r) => [
        { address, abi: ORDERS_ABI, functionName: "states", args: [r.hash] },
        { address, abi: ORDERS_ABI, functionName: "canExecute", args: [toStruct(r.order)] },
      ]),
      allowFailure: true,
    });
    const now = Math.floor(this.ctx.clock.now() / 1000);
    return records.map((r, i) => {
      const st = reads[2 * i]?.status === "success" ? (reads[2 * i]?.result as unknown as readonly [number, bigint, boolean]) : null;
      const can = reads[2 * i + 1]?.status === "success" ? (reads[2 * i + 1]?.result as unknown as readonly [boolean, string]) : null;
      const executed = st ? Number(st[0]) : 0;
      const status: OrderStatus = st?.[2] ? "cancelled" : executed >= r.order.executions ? "filled" : now > r.order.deadline ? "expired" : can?.[0] ? "open" : "waiting";
      return { ...r, status, executed, waitingFor: can && !can[0] ? can[1] : null, lastExecutedAt: st && st[1] > 0n ? new Date(Number(st[1]) * 1000).toISOString() : null };
    });
  }

  async list(environment: ArcEnvironment, owner: Address): Promise<OrderView[]> {
    return this.views(environment, await this.records(environment, owner));
  }

  private async find(environment: ArcEnvironment, hash: string): Promise<OrderRecord> {
    const all = await this.records(environment);
    const hit = all.find((r) => r.hash.toLowerCase() === hash.toLowerCase());
    if (!hit) throw new LykiaHttpError("NOT_FOUND", 404, "No such order.");
    return hit;
  }

  async cancelTx(environment: ArcEnvironment, hash: string) {
    const address = requireDeployed(environment);
    const r = await this.find(environment, hash);
    return { chainId: networkFor(environment).chainId, from: r.owner, to: address, data: encodeFunctionData({ abi: ORDERS_ABI, functionName: "cancel", args: [toStruct(r.order)] }), value: "0", label: `Cancel: ${r.summary}` };
  }

  /** The router steps and tip a keeper would use right now, or why it cannot execute. */
  private async route(environment: ArcEnvironment, r: OrderRecord): Promise<{ steps: unknown[]; tip: bigint; expectedOut: bigint } | { reason: string }> {
    const uni = UNISWAP[environment];
    const router = routerAddress(environment);
    if (!uni || !router) return { reason: "no keeper route on this network" };
    const amountIn = BigInt(r.order.amountIn);
    const tip = maxTipFor(amountIn, BigInt(r.order.maxTip));
    const feeBps = (await this.config(environment)).feeBps;
    const { swapped } = orderSlice(amountIn, feeBps, tip);
    const q = await this.quote(environment, r.order.tokenIn, r.order.tokenOut, swapped);
    if (!q) return { reason: "no pool quote" };
    const minOut = BigInt(r.order.minAmountOut);
    if (q.amountOut < minOut) return { reason: "market below the order's minimum" };
    const data = encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: "exactInputSingle", args: [{ tokenIn: r.order.tokenIn, tokenOut: r.order.tokenOut, fee: q.fee, recipient: router, amountIn: swapped, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
    return { steps: [{ venue: uni.router, tokenIn: r.order.tokenIn, amountIn: 0n, tokenOut: r.order.tokenOut, minOut, data }], tip, expectedOut: q.amountOut };
  }

  /** An unsigned execute transaction any wallet can send (it earns the tip). */
  async executeTx(environment: ArcEnvironment, hash: string, keeper: Address) {
    const address = requireDeployed(environment);
    const r = await this.find(environment, hash);
    const route = await this.route(environment, r);
    if ("reason" in route) throw new LykiaHttpError("NO_ROUTE", 422, `Not executable now: ${route.reason}.`);
    const data = encodeFunctionData({ abi: ORDERS_ABI, functionName: "execute", args: [toStruct(r.order), r.signature, route.steps as never, route.tip] });
    return { chainId: networkFor(environment).chainId, from: keeper, to: address, data, value: "0", label: `Execute: ${r.summary}`, tip: route.tip.toString(), expectedOut: route.expectedOut.toString() };
  }

  /** One keeper pass: executes due orders with the server key, or reports them. */
  async tick(environment: ArcEnvironment): Promise<{ due: number; executed: number; skipped: Record<string, string> }> {
    const address = ordersAddress(environment);
    if (!address) return { due: 0, executed: 0, skipped: {} };
    const open = (await this.views(environment, await this.records(environment))).filter((v) => v.status === "open");
    const key = keeperKey();
    const skipped: Record<string, string> = {};
    let executed = 0;
    for (const v of open) {
      const route = await this.route(environment, v);
      if ("reason" in route) {
        skipped[v.hash] = route.reason;
        continue;
      }
      if (!key) {
        skipped[v.hash] = "due: waiting for a keeper";
        continue;
      }
      try {
        const account = privateKeyToAccount(key);
        const client = this.ctx.chains.client(environment);
        const args = [toStruct(v.order), v.signature, route.steps as never, route.tip] as const;
        const { request } = await client.simulateContract({ account, address, abi: ORDERS_ABI, functionName: "execute", args });
        const wallet = createWalletClient({ account, chain: client.chain, transport: http(networkFor(environment).rpcUrls[0]) });
        const hash = await wallet.writeContract(request);
        await client.waitForTransactionReceipt({ hash });
        executed += 1;
        this.ctx.log.info("order executed", { order: v.hash, tx: hash });
      } catch (error) {
        // The node's raw error stays in the log; the answer says what happened in plain words.
        this.ctx.log.warn("keeper execution failed", { order: v.hash, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
        skipped[v.hash] = "execution failed: the swap would revert or the transaction was not accepted; it is retried on the next pass";
      }
    }
    return { due: open.length, executed, skipped };
  }
}

const services = new WeakMap<AppContext, OrdersService>();
export function ordersService(ctx: AppContext): OrdersService {
  let s = services.get(ctx);
  if (!s) {
    s = new OrdersService(ctx);
    services.set(ctx, s);
  }
  return s;
}

/**
 * An order as anyone may see it without proving control of its owner: the
 * hash, kind and status. The signed struct (trigger levels, amounts,
 * slippage) and the summary stay private until the order executes on chain.
 */
export function publicOrderView(view: OrderView) {
  return { hash: view.hash, environment: view.environment, owner: view.owner, kind: view.kind, status: view.status, executed: view.executed, lastExecutedAt: view.lastExecutedAt, createdAt: view.createdAt, redacted: true as const };
}
