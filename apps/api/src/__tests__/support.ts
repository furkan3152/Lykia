/**
 * Test harness: config, an ephemeral HTTP server and a fake Arc chain that
 * answers the reads the services make. Not a test file itself.
 */
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import { loadConfig, type Config } from "../config.js";
import type { ArcChains } from "../chains/arc.js";

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: "test", LYKIA_LOG_LEVEL: "silent", ...env });
}

export interface Served {
  readonly url: string;
  close(): Promise<void>;
}

export async function serve(app: Express): Promise<Served> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

type Call = { address: string; functionName: string; args?: readonly unknown[] };

/** A fake Arc: balances per (token, holder), vault sizes, a Uniswap quoter and Chainlink feeds. */
export class FakeArc {
  balances = new Map<string, bigint>();
  vaultAssets = new Map<string, bigint>();
  /** amountOut = amountIn * rate / 1e6 for fee 500; other tiers revert. */
  quoteRatePpm = 896_000n;
  eurcUsd = 111_540_300n;
  btcUsd = 7_797_796_775_331n;
  transactions = new Map<string, { from: string; to: string; input: string; value: bigint; chainId: number }>();
  receipts = new Map<string, { status: "success" | "reverted" }>();
  now = () => Math.floor(Date.now() / 1000);

  setBalance(token: string, holder: string, amount: bigint): void {
    this.balances.set(`${token.toLowerCase()}:${holder.toLowerCase()}`, amount);
  }

  private read(call: Call): unknown {
    const a = call.address.toLowerCase();
    switch (call.functionName) {
      case "balanceOf":
        return this.balances.get(`${a}:${String(call.args?.[0]).toLowerCase()}`) ?? 0n;
      case "getEthBalance":
        return this.balances.get(`0x3600000000000000000000000000000000000000:${String(call.args?.[0]).toLowerCase()}`) ?? 0n;
      case "getBlockNumber":
        return 1000n;
      case "totalAssets":
        return this.vaultAssets.get(a) ?? 0n;
      case "maxWithdraw":
        return 0n;
      case "convertToAssets":
        return call.args?.[0] as bigint;
      case "allowance":
        return 0n;
      case "decimals":
        return 8;
      case "latestRoundData": {
        const answer = a === "0x361b95c10b76ca3f35c686d423e43a951755bf23" ? this.eurcUsd : a === "0xa109b535c70c8be9995be64bb6751acdb27e03de" ? this.btcUsd : 100_000_000n;
        return [1n, answer, 0n, BigInt(this.now()), 1n];
      }
      default:
        throw new Error(`FakeArc: no read for ${call.functionName}`);
    }
  }

  client() {
    return {
      multicall: async ({ contracts }: { contracts: readonly Call[] }) =>
        contracts.map((c) => {
          try {
            return { status: "success", result: this.read(c) };
          } catch (error) {
            return { status: "failure", error };
          }
        }),
      readContract: async (call: Call) => this.read(call),
      simulateContract: async (call: Call & { args: readonly [{ amountIn: bigint; fee: number }] }) => {
        const params = call.args[0];
        if (params.fee !== 500) throw new Error("no pool");
        return { result: [(params.amountIn * this.quoteRatePpm) / 1_000_000n, 0n, 0, 0n] };
      },
    };
  }

  asChains(): ArcChains {
    return {
      client: () => this.client(),
      getTransaction: async (_env: string, hash: string) => this.transactions.get(hash.toLowerCase()) ?? null,
      getTxReceipt: async (_env: string, hash: string) => this.receipts.get(hash.toLowerCase()) ?? null,
      getBalances: async () => {
        throw new Error("not used");
      },
    } as unknown as ArcChains;
  }
}

/** A fetch that fails everything (Circle APIs unreachable in tests) unless routed. */
export function offlineFetch(routes: Record<string, unknown> = {}) {
  return async (input: string) => {
    const hit = Object.keys(routes).find((prefix) => input.startsWith(prefix));
    if (!hit) throw new TypeError(`fetch failed: ${input}`);
    return new Response(JSON.stringify(routes[hit]), { status: 200, headers: { "content-type": "application/json" } });
  };
}
