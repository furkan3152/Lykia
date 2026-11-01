/**
 * The planner: plan actions -> an intent graph with live reads and quotes,
 * the facts the Fence needs, and the Fence verdict. Amounts chain through
 * the plan ("bridge 50, then earn the rest" spends what the first step
 * leaves), so "all" never double-counts.
 */
import {
  DEFAULT_FENCE,
  evaluateFence,
  findCctpDestination,
  fromBaseUnits,
  getToken,
  INTENT_SPEC_VERSION,
  portionOf,
  toBaseUnitsBig,
  tokenAddress,
  type ActionAmount,
  type Address,
  type ArcEnvironment,
  type Fence,
  type FenceFacts,
  type IntentGraph,
  type IntentStep,
  type PlanAction,
  type StepAmount,
  type StepFact,
  type TokenFact,
} from "@lykia/core";
import type { ArcChains } from "../chains/arc.js";
import type { FetchLike } from "../health/dependencies.js";
import { LykiaHttpError } from "../http/errors.js";
import { usdValue, type PriceService } from "../arc/prices.js";
import { ERC4626_ABI, morphoVaults } from "../flock/flock.js";
import { ADAPTER_VENUE, bestUniswapQuote, cctpFeeBps, noRoute, pickVault, stepKindOf, type AdapterId, type StepPlan } from "./adapters.js";

export const DEFAULT_SLIPPAGE_BPS = 50;

export interface PlannerDeps {
  readonly chains: ArcChains;
  readonly prices: PriceService;
  readonly fetch: FetchLike;
  readonly stablefxConfigured: boolean;
}

export interface PlanInput {
  readonly id: string;
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly signer: "wallet" | "agent";
  readonly agent?: { readonly address: Address; readonly agentId?: string };
  readonly actions: readonly PlanAction[];
  readonly fence?: Fence;
  readonly source: string;
  readonly now: number;
  /** USD spent today / this week (from the store); null when unknown. */
  readonly spent: { readonly dayUsd: string | null; readonly weekUsd: string | null };
  readonly proposedByAgent?: boolean;
  /** Dry runs plan past a short balance (with a warning) so a route can be previewed before funding. */
  readonly dryRun?: boolean;
}

export interface PlanResult {
  readonly graph: IntentGraph;
  readonly plans: Record<string, StepPlan>;
  readonly facts: FenceFacts;
  readonly fence: Fence;
}

interface Draft {
  readonly adapter: AdapterId;
  readonly fx: boolean;
  readonly summary: string;
  readonly params: Record<string, string>;
  readonly inputs: StepAmount[];
  readonly outputs: StepAmount[];
  readonly fact: Omit<StepFact, "id" | "kind" | "venue">;
  readonly settlement: IntentStep["settlement"];
  readonly warnings: string[];
}

function resolve(amount: ActionAmount, available: bigint, decimals: number): bigint {
  if ("exact" in amount) return toBaseUnitsBig(amount.exact, decimals);
  if ("percent" in amount) return portionOf(available, amount.percent * 100);
  return available;
}

export class Planner {
  constructor(private readonly deps: PlannerDeps) {}

  async plan(input: PlanInput): Promise<PlanResult> {
    const env = input.environment;
    const account = input.agent?.address ?? input.owner;
    const client = this.deps.chains.client(env);
    const fence = input.fence ?? DEFAULT_FENCE;
    const symbols = ["USDC", "EURC", "cirBTC"] as const;
    const balances = new Map<string, bigint>();
    const reads = await client.multicall({
      contracts: symbols.map((s) => ({ address: tokenAddress(getToken(s)!, env) as Address, abi: ERC4626_ABI, functionName: "balanceOf", args: [account] }) as const),
      allowFailure: true,
    });
    symbols.forEach((s, i) => balances.set(s, reads[i]?.status === "success" ? (reads[i].result as bigint) : 0n));
    const prices = await this.deps.prices.prices([...symbols]);
    const amountOf = (symbol: string, units: bigint, minimum?: bigint): StepAmount => {
      const token = getToken(symbol)!;
      const whole = fromBaseUnits(units, token.decimals);
      return { symbol: token.symbol, token: tokenAddress(token, env) as Address, decimals: token.decimals, amount: units.toString(), ...(minimum !== undefined ? { minimum: minimum.toString() } : {}), usd: usdValue(whole, prices[token.symbol]?.usd ?? null) };
    };
    const tokenFact = (symbol: string, acquired: boolean): TokenFact => ({ symbol, address: tokenAddress(getToken(symbol)!, env) as Address, listed: true, acquired });
    const planWarnings: string[] = [];
    const spend = (symbol: string, units: bigint, label: string) => {
      const have = balances.get(symbol) ?? 0n;
      if (units > 0n && units > have && input.dryRun) {
        planWarnings.push(`Dry run: ${label} needs ${fromBaseUnits(units, getToken(symbol)!.decimals)} ${symbol}; ${account} has ${fromBaseUnits(have, getToken(symbol)!.decimals)}. Fund the wallet before signing.`);
        balances.set(symbol, 0n);
        return;
      }
      if (units <= 0n) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `Nothing to ${label}: the ${symbol} balance is 0.`);
      if (units > have) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `${label} needs ${fromBaseUnits(units, getToken(symbol)!.decimals)} ${symbol}; ${account} has ${fromBaseUnits(have, getToken(symbol)!.decimals)}.`);
      balances.set(symbol, have - units);
    };
    const receive = (symbol: string, units: bigint) => balances.set(symbol, (balances.get(symbol) ?? 0n) + units);

    const drafts: Draft[] = [];
    for (const action of input.actions) drafts.push(await this.draft(action, { env, account, owner: input.owner, balances, amountOf, tokenFact, spend, receive, prices }));

    const plans: Record<string, StepPlan> = {};
    const steps: IntentStep[] = drafts.map((d, i) => {
      const id = `s${i + 1}`;
      plans[id] = { adapter: d.adapter, params: d.params };
      return {
        id,
        kind: stepKindOf(d.adapter, d.fx),
        venue: ADAPTER_VENUE[d.adapter],
        summary: d.summary,
        signer: input.signer,
        account,
        dependsOn: i === 0 ? [] : [`s${i}`],
        inputs: d.inputs,
        outputs: d.outputs,
        settlement: d.settlement,
        status: i === 0 ? "ready" : "blocked",
      };
    });
    const facts: FenceFacts = {
      environment: env,
      signer: input.signer,
      owner: input.owner,
      ...(input.proposedByAgent ? { proposedByAgent: true } : {}),
      steps: steps.map((s, i) => ({ id: s.id, kind: s.kind, venue: s.venue, ...(drafts[i] as Draft).fact })),
      spent: input.spent,
      now: input.now,
    };
    const verdict = evaluateFence(fence, facts);
    const graph: IntentGraph = {
      spec: INTENT_SPEC_VERSION,
      id: input.id,
      environment: env,
      createdAt: new Date(input.now).toISOString(),
      source: input.source,
      owner: input.owner,
      ...(input.agent ? { agent: input.agent } : {}),
      steps,
      verdict,
      warnings: [...planWarnings, ...drafts.flatMap((d) => d.warnings)],
    };
    return { graph, plans, facts, fence };
  }

  private async draft(
    action: PlanAction,
    c: {
      env: ArcEnvironment;
      account: Address;
      owner: Address;
      balances: Map<string, bigint>;
      amountOf: (symbol: string, units: bigint, minimum?: bigint) => StepAmount;
      tokenFact: (symbol: string, acquired: boolean) => TokenFact;
      spend: (symbol: string, units: bigint, label: string) => void;
      receive: (symbol: string, units: bigint) => void;
      prices: Record<string, { usd: string | null }>;
    },
  ): Promise<Draft> {
    const { env } = c;
    switch (action.verb) {
      case "send": {
        const token = getToken(action.token)!;
        const units = resolve(action.amount, c.balances.get(token.symbol) ?? 0n, token.decimals);
        c.spend(token.symbol, units, "send");
        const amount = c.amountOf(token.symbol, units);
        const display = `${fromBaseUnits(units, token.decimals)} ${token.symbol}`;
        return {
          adapter: "transfer",
          fx: false,
          summary: `Send ${display} to ${action.to}${action.memo ? ` (${action.memo})` : ""}`,
          params: { token: amount.token, amount: units.toString(), to: action.to, display, decimals: String(token.decimals), ...(action.memo ? { note: action.memo } : {}) },
          inputs: [amount],
          outputs: [],
          fact: { usd: amount.usd, tokens: [c.tokenFact(token.symbol, false)], recipient: action.to },
          settlement: { kind: "receipt" },
          warnings: [],
        };
      }
      case "bridge": {
        const dest = findCctpDestination(action.destination);
        if (!dest) throw noRoute(`${action.destination} is not a CCTP destination.`);
        if (dest.vm !== "evm") throw noRoute(`${dest.name} needs a token account as the mint recipient; Lykia bridges to EVM chains for now.`);
        const recipient = (action.recipient as Address | undefined) ?? c.owner;
        if (!/^0x[0-9a-fA-F]{40}$/u.test(recipient)) throw new LykiaHttpError("INVALID_ACTIONS", 400, "recipient must be an EVM address.");
        const units = resolve(action.amount, c.balances.get("USDC") ?? 0n, 6);
        c.spend("USDC", units, "bridge");
        const feeBps = await cctpFeeBps(this.deps.fetch, env, dest.domain);
        const warnings: string[] = [];
        if (feeBps === null) warnings.push("The CCTP fee could not be read; the burn allows no fee (standard transfer).");
        const maxFee = feeBps ? (units * BigInt(Math.ceil(feeBps * 100)) + 999_999n) / 1_000_000n : 0n;
        const amount = c.amountOf("USDC", units);
        const display = `${fromBaseUnits(units, 6)} USDC`;
        return {
          adapter: "bridge",
          fx: false,
          summary: `Bridge ${display} to ${dest.name} over CCTP`,
          params: { token: amount.token, amount: units.toString(), domain: String(dest.domain), recipient, maxFee: maxFee.toString(), destinationName: dest.name, destination: dest.key, display, decimals: "6" },
          inputs: [amount],
          outputs: [{ ...c.amountOf("USDC", units - maxFee), symbol: `USDC@${dest.key}` }],
          fact: { usd: amount.usd, tokens: [c.tokenFact("USDC", false)], recipient, destination: dest.key },
          settlement: { kind: "cctp", destination: dest.key, expectedSeconds: 30 },
          warnings,
        };
      }
      case "unify": {
        const units = resolve(action.amount, c.balances.get("USDC") ?? 0n, 6);
        c.spend("USDC", units, "deposit into Gateway");
        const amount = c.amountOf("USDC", units);
        const display = `${fromBaseUnits(units, 6)} USDC`;
        return {
          adapter: "gateway",
          fx: false,
          summary: `Deposit ${display} into Circle Gateway (one balance on every Gateway chain)`,
          params: { token: amount.token, amount: units.toString(), display, decimals: "6" },
          inputs: [amount],
          outputs: [{ ...amount, symbol: "USDC@gateway" }],
          fact: { usd: amount.usd, tokens: [c.tokenFact("USDC", false)] },
          settlement: { kind: "gateway", destination: "gateway", expectedSeconds: 1 },
          warnings: [],
        };
      }
      case "earn": {
        if (action.token !== "USDC" && action.token !== "EURC") throw noRoute("Earn takes USDC or EURC on Arc.");
        const vault = await pickVault(this.deps.chains, env, action.token, action.venue);
        if (!vault) throw noRoute(env === "testnet" ? "No earn venue on Arc testnet: Morpho vaults are mainnet only." : `No ${action.token} vault found.`);
        const token = getToken(action.token)!;
        const units = resolve(action.amount, c.balances.get(token.symbol) ?? 0n, token.decimals);
        c.spend(token.symbol, units, "deposit");
        const amount = c.amountOf(token.symbol, units);
        const display = `${fromBaseUnits(units, token.decimals)} ${token.symbol}`;
        return {
          adapter: "vault-deposit",
          fx: false,
          summary: `Deposit ${display} into Morpho ${vault.id} (largest ${token.symbol} vault by assets)`,
          params: { token: amount.token, symbol: token.symbol, amount: units.toString(), vault: vault.address, vaultName: `Morpho ${vault.id}`, display, decimals: String(token.decimals) },
          inputs: [amount],
          outputs: [{ ...amount, symbol: `${token.symbol}@morpho:${vault.id}` }],
          fact: { usd: amount.usd, tokens: [c.tokenFact(token.symbol, false)] },
          settlement: { kind: "receipt" },
          warnings: ["Vaults are ranked by total assets, not by yield: Lykia shows no APY it cannot read on chain."],
        };
      }
      case "withdraw": {
        if (action.token !== "USDC" && action.token !== "EURC") throw noRoute("Withdraw takes USDC or EURC vault positions on Arc.");
        const token = getToken(action.token)!;
        const client = this.deps.chains.client(env);
        const vaults = morphoVaults(env).filter((v) => v.asset === action.token);
        if (vaults.length === 0) throw noRoute("No vault positions on this environment.");
        const positions = await client.multicall({ contracts: vaults.map((v) => ({ address: v.address, abi: ERC4626_ABI, functionName: "maxWithdraw", args: [c.account] }) as const), allowFailure: true });
        const held = vaults.map((v, i) => ({ v, max: positions[i]?.status === "success" ? (positions[i].result as bigint) : 0n })).filter((h) => h.max > 0n).sort((a, b) => (b.max > a.max ? 1 : -1));
        const named = action.venue?.includes(":") ? held.find((h) => h.v.id.toLowerCase().startsWith((action.venue as string).split(":")[1]!.toLowerCase().replace(/usdc|eurc/u, ""))) : held[0];
        if (!named) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `No ${action.token} vault position to withdraw from.`);
        const all = "all" in action.amount;
        const units = all ? named.max : resolve(action.amount, named.max, token.decimals);
        if (units > named.max) throw new LykiaHttpError("INSUFFICIENT_BALANCE", 422, `The vault holds ${fromBaseUnits(named.max, token.decimals)} ${token.symbol} for you.`);
        let shares = "0";
        if (all) shares = (await client.readContract({ address: named.v.address, abi: ERC4626_ABI, functionName: "balanceOf", args: [c.account] })).toString();
        c.receive(token.symbol, units);
        const amount = c.amountOf(token.symbol, units);
        const display = `${fromBaseUnits(units, token.decimals)} ${token.symbol}`;
        return {
          adapter: "vault-withdraw",
          fx: false,
          summary: `Withdraw ${display} from Morpho ${named.v.id}`,
          params: { vault: named.v.address, vaultName: `Morpho ${named.v.id}`, mode: all ? "redeem" : "withdraw", amount: units.toString(), shares, display, decimals: String(token.decimals) },
          inputs: [],
          outputs: [amount],
          fact: { usd: amount.usd, tokens: [c.tokenFact(token.symbol, true)], recipient: c.account === c.owner ? c.owner : c.account },
          settlement: { kind: "receipt" },
          warnings: [],
        };
      }
      case "fx":
      case "swap": {
        const from = getToken(action.from)!;
        const to = getToken(action.to)!;
        const isFx = (from.symbol === "USDC" && to.symbol === "EURC") || (from.symbol === "EURC" && to.symbol === "USDC");
        const units = resolve(action.amount, c.balances.get(from.symbol) ?? 0n, from.decimals);
        if (env === "testnet") throw noRoute(isFx ? "No FX venue on Arc testnet that Lykia can execute (StableFX needs Circle credentials; Uniswap is mainnet only)." : "No swap venue on Arc testnet: Uniswap v3 is mainnet only.");
        const tokenIn = tokenAddress(from, env) as Address;
        const tokenOut = tokenAddress(to, env) as Address;
        const quote = await bestUniswapQuote(this.deps.chains, env, tokenIn, tokenOut, units > 0n ? units : 1n);
        if (!quote) throw noRoute(`No Uniswap v3 pool quotes ${from.symbol} -> ${to.symbol}.`);
        c.spend(from.symbol, units, action.verb);
        const slippageBps = action.verb === "swap" && action.slippageBps !== undefined ? action.slippageBps : DEFAULT_SLIPPAGE_BPS;
        const minOut = (quote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
        c.receive(to.symbol, minOut);
        const warnings: string[] = [];
        let fxDeviationBps: number | null | undefined;
        if (isFx) {
          warnings.push(this.deps.stablefxConfigured ? "StableFX RFQ is configured but its taker flow is not built yet; routed through the Uniswap v3 USDC/EURC pool." : "StableFX RFQ needs Circle credentials; routed through the Uniswap v3 USDC/EURC pool and checked against Chainlink EURC/USD.");
          const eurUsd = c.prices.EURC?.usd ?? null;
          fxDeviationBps = eurUsd === null ? null : fxDeviation(from.symbol, units, quote.amountOut, eurUsd);
        }
        const input = c.amountOf(from.symbol, units);
        const display = `${fromBaseUnits(units, from.decimals)} ${from.symbol} -> ${fromBaseUnits(quote.amountOut, to.decimals)} ${to.symbol}`;
        return {
          adapter: "swap",
          fx: isFx,
          summary: `${isFx ? "Convert" : "Swap"} ${display} (Uniswap v3, ${quote.fee / 10_000}% pool, min ${fromBaseUnits(minOut, to.decimals)})`,
          params: { tokenIn, tokenOut, symbolIn: from.symbol, amountIn: units.toString(), fee: String(quote.fee), minOut: minOut.toString(), display, decimals: String(from.decimals) },
          inputs: [input],
          outputs: [c.amountOf(to.symbol, quote.amountOut, minOut)],
          fact: { usd: input.usd, tokens: [c.tokenFact(from.symbol, false), c.tokenFact(to.symbol, true)], slippageBps, ...(isFx ? { fxDeviationBps } : {}) },
          settlement: { kind: "receipt" },
          warnings,
        };
      }
      case "borrow":
      case "repay":
        throw noRoute(`${action.verb === "borrow" ? "Borrowing" : "Repaying"} is not executable yet: Morpho Blue and Aave V4 adapters are on the trail, not in this build.`);
    }
  }
}

/**
 * Deviation of a USDC<->EURC quote from the Chainlink EURC/USD reference,
 * in bps (positive = worse than the reference for the user).
 */
export function fxDeviation(fromSymbol: string, amountIn: bigint, amountOut: bigint, eurcUsd: string): number {
  const [w = "0", f = ""] = eurcUsd.split(".");
  const price = BigInt(w) * 100_000_000n + BigInt(f.padEnd(8, "0").slice(0, 8) || "0");
  if (price <= 0n || amountIn <= 0n) return 0;
  // Both tokens have 6 decimals. Fair out: USDC->EURC = in / price; EURC->USDC = in * price.
  const fair = fromSymbol === "USDC" ? (amountIn * 100_000_000n) / price : (amountIn * price) / 100_000_000n;
  if (fair === 0n) return 0;
  return Number(((fair - amountOut) * 10_000n) / fair);
}
