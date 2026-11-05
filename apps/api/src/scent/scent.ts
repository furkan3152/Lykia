/**
 * Scent: what can be proven about a token before anyone touches it.
 *
 *   registry    Lykia's verified list and look-alike detection (core assessToken)
 *   bytecode    is there a contract at all
 *   proxy       EIP-1167 clones, EIP-1967 implementation/admin/beacon slots
 *   privileges  selectors in the code it runs that give someone power over holders
 *   owner       owner() renounced or not
 *   simulation  a holder's transfer, simulated with eth_call and a state
 *               override of the balance slot (Arc's public RPC has no
 *               eth_simulateV1): a token that cannot leave a wallet is a
 *               one-way gate. Nothing is signed or broadcast.
 *
 * Never "safe": the best verdict without registry evidence is
 * `no-red-flags`, and only when every check ran.
 */
import { assessToken, type Address, type ArcEnvironment, type ScentLevel, type WolfKind } from "@lykia/core";
import type { ScentCheck, ScentReport } from "@lykia/core/api/scent";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";
import type { Clock } from "../clock.js";

const EIP1967_IMPLEMENTATION = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const EIP1967_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as Hex;
const EIP1967_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as Hex;
/** OpenZeppelin v5 ERC20 namespaced storage (ERC-7201 "openzeppelin.storage.ERC20"). */
const OZ5_ERC20_STORAGE = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00n;
const OWNER_SELECTOR = "0x8da5cb5b" as Hex;
const IMPLEMENTATION_SELECTOR = "0x5c60da1b" as Hex;
const PROBE_FROM = "0x00000000000000000000000000000000004c796b" as Address; // "Lyk"
const PROBE_TO = "0x000000000000000000000000000000004c796b6f" as Address; // "Lyko"
const SCENT_CACHE_MS = 10 * 60_000;

/** Selectors whose presence gives someone power over holders, with the wolf they reveal. */
const PRIVILEGED_SELECTORS: Readonly<Record<string, { readonly signature: string; readonly wolf: WolfKind }>> = Object.freeze({
  "40c10f19": { signature: "mint(address,uint256)", wolf: "mint-authority" },
  a0712d68: { signature: "mint(uint256)", wolf: "mint-authority" },
  "8456cb59": { signature: "pause()", wolf: "blacklist" },
  f9f92be4: { signature: "blacklist(address)", wolf: "blacklist" },
  "44337ea1": { signature: "addToBlacklist(address)", wolf: "blacklist" },
  "0ecb93c0": { signature: "addBlackList(address)", wolf: "blacklist" },
  "69fe0e2d": { signature: "setFee(uint256)", wolf: "fee-on-transfer" },
  c0246668: { signature: "excludeFromFee(address,bool)", wolf: "fee-on-transfer" },
  "8ee88c53": { signature: "setTaxFeePercent(uint256)", wolf: "fee-on-transfer" },
  ec28438a: { signature: "setMaxTxAmount(uint256)", wolf: "honeypot" },
  "3659cfe6": { signature: "upgradeTo(address)", wolf: "upgradeable" },
  "4f1ef286": { signature: "upgradeToAndCall(address,bytes)", wolf: "upgradeable" },
  "9dc29fac": { signature: "burn(address,uint256)", wolf: "mint-authority" },
});

/** Privileged selectors pushed by PUSH4 in the bytecode. */
export function privilegedIn(code: Hex): { signature: string; wolf: WolfKind }[] {
  const hex = code.toLowerCase();
  return Object.entries(PRIVILEGED_SELECTORS)
    .filter(([selector]) => hex.includes(`63${selector}`))
    .map(([, info]) => info);
}

/** EIP-1167 minimal proxy target, or null. */
export function cloneTarget(code: Hex): Address | null {
  const match = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/iu.exec(code);
  return match ? (`0x${(match[1] as string).toLowerCase()}` as Address) : null;
}

export function wordToAddress(word: Hex | null | undefined): Address | null {
  if (!word || word.length < 66) return null;
  const address = `0x${word.slice(-40).toLowerCase()}` as Address;
  return /^0x0{40}$/u.test(address) ? null : address;
}

/** Storage key of `balances[holder]` for a Solidity mapping at `slot`. */
export function mappingKey(holder: Address, slot: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, slot]));
}

/** Level from checks and wolves (registry tokens are verified upstream). */
export function levelOf(checks: readonly ScentCheck[], wolves: readonly WolfKind[]): ScentLevel {
  if (wolves.includes("lookalike") || wolves.includes("honeypot") || wolves.includes("no-code")) return "danger";
  if (wolves.length > 0) return "caution";
  if (checks.some((c) => c.ok === null)) return "unknown";
  return "no-red-flags";
}

export class ScentService {
  private readonly cache = new Map<string, { at: number; report: ScentReport }>();

  constructor(private readonly deps: { readonly chains: ArcChains; readonly clock: Clock }) {}

  async sniff(environment: ArcEnvironment, token: Address, options: { readonly deep?: boolean } = {}): Promise<ScentReport> {
    const key = `${environment}:${token.toLowerCase()}:${options.deep ? 1 : 0}`;
    const cached = this.cache.get(key);
    const now = this.deps.clock.now();
    if (cached && now - cached.at < SCENT_CACHE_MS) return cached.report;
    const report = await this.inspect(environment, token, options.deep === true);
    this.cache.set(key, { at: now, report });
    return report;
  }

  private async inspect(environment: ArcEnvironment, token: Address, deep: boolean): Promise<ScentReport> {
    const client = this.deps.chains.client(environment);
    const checks: ScentCheck[] = [];
    const wolves = new Set<WolfKind>();
    const at = new Date(this.deps.clock.now()).toISOString();

    const [symbol, name, decimals] = await Promise.all(
      (["symbol", "name", "decimals"] as const).map((fn) => client.readContract({ address: token, abi: erc20Abi, functionName: fn }).catch(() => null)),
    );
    const meta = { symbol: typeof symbol === "string" ? symbol : null, name: typeof name === "string" ? name : null, decimals: typeof decimals === "number" ? decimals : null };
    const trust = assessToken({ environment, address: token, ...(meta.symbol ? { symbol: meta.symbol } : {}), ...(meta.name ? { name: meta.name } : {}) });

    if (trust.status === "verified") {
      checks.push({ id: "registry", ok: true, detail: `${trust.token.symbol} is in Lykia's verified registry (issuer ${trust.token.issuer}).` });
      checks.push({ id: "blocklist", ok: true, detail: "Circle stablecoins carry an issuer blocklist; Circle can freeze addresses under its policy." });
      return { token, environment, ...meta, level: "verified", wolves: [], checks, trust, at, ...(deep ? { deep } : {}) };
    }
    if (trust.status === "lookalike") {
      wolves.add("lookalike");
      checks.push({ id: "registry", ok: false, detail: trust.warning });
    } else checks.push({ id: "registry", ok: null, detail: trust.warning });
    checks.push({ id: "metadata", ok: meta.symbol !== null && meta.decimals !== null ? true : false, detail: meta.symbol !== null ? `symbol ${meta.symbol}, ${meta.decimals ?? "?"} decimals` : "Does not answer ERC-20 metadata calls." });

    const code = await client.getCode({ address: token }).catch(() => null);
    if (code === null) checks.push({ id: "bytecode", ok: null, detail: "Could not read the code." });
    else if (code === "0x" || code === undefined) {
      wolves.add("no-code");
      checks.push({ id: "bytecode", ok: false, detail: "No contract at this address." });
      return { token, environment, ...meta, level: levelOf(checks, [...wolves]), wolves: [...wolves], checks, trust, at };
    } else checks.push({ id: "bytecode", ok: true, detail: `${(code.length - 2) / 2} bytes of code.` });

    let running: Hex = (code ?? "0x") as Hex;
    const clone = code ? cloneTarget(code) : null;
    if (clone) {
      checks.push({ id: "proxy", ok: true, detail: `Minimal clone of ${clone} (not upgradeable).` });
      running = ((await client.getCode({ address: clone }).catch(() => "0x")) ?? "0x") as Hex;
    } else if (code) {
      const [impl, admin, beacon] = await Promise.all([EIP1967_IMPLEMENTATION, EIP1967_ADMIN, EIP1967_BEACON].map((slot) => client.getStorageAt({ address: token, slot }).catch(() => null)));
      let implementation = wordToAddress(impl);
      const beaconAddress = wordToAddress(beacon);
      if (!implementation && beaconAddress) {
        const word = await client.call({ to: beaconAddress, data: IMPLEMENTATION_SELECTOR }).then((r) => r.data ?? null).catch(() => null);
        implementation = wordToAddress(word);
      }
      if (implementation) {
        wolves.add("upgradeable");
        checks.push({ id: "proxy", ok: false, detail: `Upgradeable proxy: implementation ${implementation}${wordToAddress(admin) ? `, admin ${wordToAddress(admin)}` : ""}. The code can change under holders.` });
        running = ((await client.getCode({ address: implementation }).catch(() => "0x")) ?? "0x") as Hex;
      } else checks.push({ id: "proxy", ok: true, detail: "Not a proxy (no EIP-1167 code, empty EIP-1967 slots)." });
    }

    const privileged = privilegedIn(running);
    for (const p of privileged) wolves.add(p.wolf);
    checks.push({ id: "privileges", ok: privileged.length === 0, detail: privileged.length === 0 ? "No mint, pause, blacklist, fee or upgrade selector in the code it runs." : `Privileged functions: ${privileged.map((p) => p.signature).join(", ")}.` });

    const ownerWord = await client.call({ to: token, data: OWNER_SELECTOR }).then((r) => r.data ?? null).catch(() => null);
    const owner = wordToAddress(ownerWord);
    if (ownerWord === null || ownerWord === undefined) checks.push({ id: "owner", ok: true, detail: "No owner() function." });
    else if (owner === null) checks.push({ id: "owner", ok: true, detail: "Ownership renounced (owner is the zero address)." });
    else {
      wolves.add("owner-active");
      checks.push({ id: "owner", ok: false, detail: `Owner ${owner} still holds the keys.` });
    }

    checks.push(await this.simulateTransfer(environment, token, meta.decimals, deep));
    if (checks.find((c) => c.id === "simulation")?.ok === false) wolves.add("honeypot");

    return { token, environment, ...meta, level: levelOf(checks, [...wolves]), wolves: [...wolves], checks, trust, at, ...(deep ? { deep } : {}) };
  }

  /**
   * Finds the balance mapping slot by overriding candidate slots for a probe
   * holder, then simulates a transfer out of that holder with eth_call.
   */
  async simulateTransfer(environment: ArcEnvironment, token: Address, decimals: number | null, deep: boolean): Promise<ScentCheck> {
    const amount = 10n ** BigInt(Math.min(decimals ?? 18, 30)) * 1000n;
    const value = `0x${amount.toString(16).padStart(64, "0")}` as Hex;
    const candidates: bigint[] = [OZ5_ERC20_STORAGE, ...Array.from({ length: deep ? 64 : 12 }, (_, i) => BigInt(i))];
    for (const slot of candidates) {
      const key = mappingKey(PROBE_FROM, slot);
      const override = { [token]: { stateDiff: { [key]: value } } };
      try {
        const balanceHex = (await this.deps.chains.rawRpc(environment, "eth_call", [
          { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [PROBE_FROM] }) },
          "latest",
          override,
        ])) as Hex;
        if (typeof balanceHex !== "string" || BigInt(balanceHex === "0x" ? 0 : balanceHex) !== amount) continue;
        try {
          const result = (await this.deps.chains.rawRpc(environment, "eth_call", [
            { from: PROBE_FROM, to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [PROBE_TO, amount / 2n] }) },
            "latest",
            override,
          ])) as Hex;
          const ok = result === "0x" || decodeFunctionResult({ abi: erc20Abi, functionName: "transfer", data: result }) === true;
          return ok
            ? { id: "simulation", ok: true, detail: "A holder's transfer simulates cleanly (eth_call with a balance override)." }
            : { id: "simulation", ok: false, detail: "A holder's transfer returns false: tokens may not be able to leave a wallet." };
        } catch {
          return { id: "simulation", ok: false, detail: "A holder's transfer reverts in simulation: a one-way gate." };
        }
      } catch {
        continue;
      }
    }
    return { id: "simulation", ok: null, detail: "Could not locate the balance storage to simulate a transfer." };
  }
}
