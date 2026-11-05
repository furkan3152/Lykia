/**
 * Address protection (layer 2): look-alike and poisoning detection against
 * the owner's contacts and past recipients, first-time warnings, the
 * USDC/EURC blocklist, Circle Compliance screening (reused, when
 * configured), contract vs wallet, and Contract Scent for contracts.
 */
import { contractAt, protocolsAt, sameAddress, type Address, type ArcEnvironment } from "@lykia/core";
import { bytecodeTraits, contractFindings, recipientFindings, type SecurityFinding } from "@lykia/core/security/index";
import { parseAbi, parseAbiItem, type Hex } from "viem";
import type { AppContext } from "../context.js";
import { screenAddress } from "../circle/compliance.js";
import { memoryService } from "../personal/memory.js";
import { typedCollection } from "../platform/typed.js";

const BLOCKLIST_ABI = parseAbi(["function isBlacklisted(address account) view returns (bool)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as const;
const LOOKBACK_BLOCKS = 20_000n;

const recipients = (ctx: AppContext) => typedCollection<{ address: string; count: number; lastAt: string }>(ctx, "security_recipients");

/** Remembers a recipient once a payment to it settles (postflight). */
export async function rememberRecipient(ctx: AppContext, owner: string, address: string): Promise<void> {
  const id = `${owner.toLowerCase()}:${address.toLowerCase()}`;
  const current = (await recipients(ctx).get(id))?.value;
  await recipients(ctx).put(id, { address: address.toLowerCase(), count: (current?.count ?? 0) + 1, lastAt: new Date(ctx.clock.now()).toISOString() }, { ttlMs: 365 * 86_400_000 });
}

async function knownAddresses(ctx: AppContext, owner: Address): Promise<Address[]> {
  const [contacts, past] = await Promise.all([memoryService(ctx).contacts(owner).catch(() => []), recipients(ctx).list({ prefix: `${owner.toLowerCase()}:`, limit: 1000 }).catch(() => [])]);
  return [...new Set([...contacts.map((c) => c.address.toLowerCase()), ...past.map((d) => d.value.address)])] as Address[];
}

function slotAddress(word: Hex | undefined | null): string | null {
  if (!word || /^0x0*$/u.test(word)) return null;
  return `0x${word.slice(-40)}`;
}

async function zeroValueSenders(ctx: AppContext, environment: ArcEnvironment, owner: Address, tokens: readonly Address[]): Promise<Address[]> {
  try {
    const client = ctx.chains.client(environment) as unknown as { getBlockNumber(): Promise<bigint>; getLogs(args: unknown): Promise<readonly { args: { from?: Address; value?: bigint } }[]> };
    const head = await client.getBlockNumber();
    const fromBlock = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n;
    const logs = await client.getLogs({ address: tokens, event: TRANSFER, args: { to: owner }, fromBlock, toBlock: head });
    return [...new Set(logs.filter((l) => l.args.value === 0n && l.args.from).map((l) => (l.args.from as string).toLowerCase()))] as Address[];
  } catch {
    return [];
  }
}

export interface AddressCheck {
  readonly address: Address;
  readonly kind: "wallet" | "contract" | "unknown";
  readonly known: boolean;
  readonly findings: SecurityFinding[];
}

export async function checkRecipient(ctx: AppContext, input: { readonly environment: ArcEnvironment; readonly owner: Address; readonly recipient: Address; readonly tokens: readonly Address[]; readonly stepId?: string }): Promise<AddressCheck> {
  const { environment, owner, recipient } = input;
  if (sameAddress(owner, recipient)) return { address: recipient, kind: "wallet", known: true, findings: [] };
  const client = ctx.chains.client(environment) as unknown as {
    getCode?(a: { address: Address }): Promise<Hex | undefined>;
    getStorageAt?(a: { address: Address; slot: Hex }): Promise<Hex | undefined>;
    multicall(a: unknown): Promise<readonly { status: string; result?: unknown }[]>;
  };
  const apiKey = ctx.config.circle.apiKey;
  const [known, code, blockReads, screening] = await Promise.all([
    knownAddresses(ctx, owner),
    client.getCode ? client.getCode({ address: recipient }).catch(() => null) : Promise.resolve(null),
    input.tokens.length > 0 ? client.multicall({ contracts: input.tokens.map((address) => ({ address, abi: BLOCKLIST_ABI, functionName: "isBlacklisted", args: [recipient] })), allowFailure: true }).catch(() => [] as const) : Promise.resolve([] as const),
    apiKey ? screenAddress(ctx.fetch, apiKey, environment, recipient, ctx.clock.now()).catch(() => null) : Promise.resolve(null),
  ]);
  const reads = blockReads.filter((r) => r.status === "success");
  const blocklisted = reads.some((r) => r.result === true) ? true : reads.length > 0 && reads.length === input.tokens.length ? false : null;
  const isKnown = known.some((k) => sameAddress(k, recipient));
  const lookalikePossible = known.length > 0 && !isKnown;
  const spam = lookalikePossible ? await zeroValueSenders(ctx, environment, owner, input.tokens) : [];
  const isContract = code === null ? null : code !== undefined && code !== "0x";
  const findings = recipientFindings(
    { recipient, owner, known, zeroValueSenders: spam, isContract, blocklisted, screening: screening ? (screening.result === "UNKNOWN" ? null : screening.result) : null },
    input.stepId,
  );
  if (isContract && code) {
    const [impl, admin] = client.getStorageAt ? await Promise.all([client.getStorageAt({ address: recipient, slot: IMPL_SLOT }).catch(() => null), client.getStorageAt({ address: recipient, slot: ADMIN_SLOT }).catch(() => null)]) : [null, null];
    const listed = contractAt(recipient, environment) !== null || protocolsAt(recipient, environment).length > 0;
    findings.push(...contractFindings(recipient, { traits: bytecodeTraits(code), implementation: slotAddress(impl), admin: slotAddress(admin), ageSeconds: null, verified: listed ? true : null, listed }, input.stepId));
  }
  return { address: recipient, kind: isContract === null ? "unknown" : isContract ? "contract" : "wallet", known: isKnown, findings };
}
