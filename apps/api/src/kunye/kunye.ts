/**
 * Tag service: draft and serve ERC-8004 registration cards that pin a
 * Fence hash, build the unsigned register / validation calls, and read an
 * agent's identity, card and standing from the registries.
 */
import {
  attestationFor,
  attestationJson,
  buildVerdict,
  encodeAttestation,
  encodeVerdict,
  ERC8354_EIP,
  ERC8354_TAG,
  registryHashes,
  responseScore,
  verdictJson,
  buildKunyeCard,
  contractAddress,
  digestToBytes32,
  FENCE_METADATA_KEY,
  fenceHash,
  isAddress,
  kunyeCardDigest,
  networkFor,
  validationRecord,
  validationRequestHash,
  VALIDATION_TAG,
  type Address,
  type ArcEnvironment,
  type Fence,
  type FenceVerdict,
  type KunyeCard,
  type KunyeEndpoint,
  type UnsignedTransaction,
  type ValidationRecord,
  type Mechanism,
} from "@lykia/core";
import { randomBytes } from "node:crypto";
import { encodeFunctionData, type Hex } from "viem";
import type { ArcChains } from "../chains/arc.js";
import type { FetchLike } from "../health/dependencies.js";
import { LykiaHttpError } from "../http/errors.js";
import { assertPublicUrl } from "../http/netguard.js";
import type { JsonValue, Store } from "../store/types.js";
import { IDENTITY_REGISTRY_ABI, REPUTATION_REGISTRY_ABI, VALIDATION_REGISTRY_ABI } from "../engine/abis.js";

export const CARD_FETCH_MAX_BYTES = 64 * 1024;

export interface DraftInput {
  readonly environment: ArcEnvironment;
  readonly owner: Address;
  readonly agentWallet?: Address;
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly fence: Fence;
  readonly endpoints?: readonly KunyeEndpoint[];
  /** Public base URL of this API, so the card can be served from /v1/tags/cards/:digest. */
  readonly publicBaseUrl?: string;
}

export interface DraftResult {
  readonly card: KunyeCard;
  readonly cardDigest: string;
  readonly fenceHash: string;
  readonly agentURI: string;
  readonly transaction: UnsignedTransaction;
}

export interface KunyeView {
  readonly agentId: string;
  readonly environment: ArcEnvironment;
  readonly owner: Address | null;
  readonly agentWallet: Address | null;
  readonly agentURI: string | null;
  readonly card: unknown | null;
  readonly cardNote?: string;
  /** Fence hash pinned on-chain under the `lykia.fence` metadata key. */
  readonly fenceOnChain: string | null;
  /** Fence hash in the card (lykia.fenceHash), if any. */
  readonly fenceInCard: string | null;
  readonly fenceMatches: boolean | null;
  readonly validations: { readonly count: number; readonly averageResponse: number | null; readonly lykiaTag: string };
  /** ERC-8354 policy verdicts filed under the `erc-8354` tag (any validator). */
  readonly erc8354: { readonly count: number; readonly averageResponse: number | null; readonly tag: string; readonly guard: Address | null };
  readonly reputation: { readonly clients: number; readonly count: number | null; readonly value: string | null };
}

export interface Erc8354Input {
  readonly environment: ArcEnvironment;
  readonly agentId: string;
  readonly intentId: string;
  readonly verdict: FenceVerdict;
  /** The owner confirmed a `confirm` verdict before signing. */
  readonly confirmed?: boolean;
  readonly owner: Address;
  /** The address that executes the action (the agent wallet or the owner). */
  readonly executor: Address;
  /** The judged action: the prepared call's target, value and calldata. */
  readonly action: { readonly to: Address; readonly data: Hex; readonly value: string };
  readonly mechanism?: Mechanism;
  readonly expirySeconds?: number;
  readonly publicBaseUrl?: string;
}

export interface Erc8354Result {
  readonly eip: string;
  readonly mechanism: Mechanism;
  readonly verdict: Record<string, string | number>;
  readonly attestation: Record<string, string | number>;
  readonly encoded: { readonly verdict: Hex; readonly attestation: Hex };
  readonly requestHash: Hex;
  readonly responseHash: Hex;
  readonly requestURI: string;
  readonly responseURI: string;
  readonly actionNonce: string;
  /** Owner files the request naming the guard as validator. */
  readonly requestTransaction: UnsignedTransaction | null;
  /** The guard answers with the attestation; signed by the guard's own key, never by this server. */
  readonly responseTransaction: UnsignedTransaction | null;
  readonly notes: readonly string[];
}

export class KunyeService {
  constructor(private readonly deps: { readonly chains: ArcChains; readonly store: Store; readonly fetch: FetchLike; readonly guard?: Address | null }) {}

  private docs() {
    return this.deps.store.collection<JsonValue>("erc8354_docs");
  }

  /** Per-agent salt padding the Fence commitment (the draft's rule for low-entropy rulesets). Never returned by attest. */
  async policySalt(environment: ArcEnvironment, agentId: string): Promise<Hex> {
    const salts = this.deps.store.collection<JsonValue>("erc8354_salts");
    const key = `${environment}:${agentId}`;
    const found = await salts.get(key);
    if (found && typeof found.value === "string") return found.value as Hex;
    const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
    await salts.compareAndSet(key, null, salt);
    const settled = await salts.get(key);
    return (settled?.value as Hex | undefined) ?? salt;
  }

  async verdictDoc(hash: string): Promise<JsonValue | null> {
    if (!/^0x[0-9a-f]{64}$/u.test(hash)) return null;
    return (await this.docs().get(hash))?.value ?? null;
  }

  /** An ERC-8354 verdict envelope + VerdictAttestation for one judged action, and the ValidationRegistry calls that file it. */
  async attest8354(input: Erc8354Input): Promise<Erc8354Result> {
    const mechanism: Mechanism = input.mechanism ?? "independent-mediator";
    if (mechanism === "zk-secret-policy") throw new LykiaHttpError("INVALID_REQUEST", 400, "Lykia verdicts are not zero-knowledge proofs; zk-secret-policy is reserved for ZK Guards.");
    const salt = await this.policySalt(input.environment, input.agentId);
    const nonce = BigInt(await this.deps.store.counters("erc8354_nonce").increment(`${input.environment}:${input.agentId}`));
    const expiry = BigInt(Math.floor(Date.now() / 1000) + (input.expirySeconds ?? 3_600));
    const verdict = buildVerdict({
      environment: input.environment,
      agentId: input.agentId,
      verdict: input.verdict,
      ...(input.confirmed ? { confirmed: true } : {}),
      salt,
      executor: input.executor,
      target: input.action.to,
      value: BigInt(input.action.value),
      callData: input.action.data,
      actionNonce: nonce,
      expiry,
    });
    const attestation = attestationFor(verdict, mechanism);
    const { requestHash, responseHash } = registryHashes(verdict, attestation);
    const legacy = validationRecord({ environment: input.environment, agentId: input.agentId, intentId: input.intentId, verdict: input.verdict });
    const requestDoc = { schema: "erc-8354/verdict", eip: ERC8354_EIP, verdict: verdictJson(verdict), encoded: encodeVerdict(verdict), lykia: legacy };
    const responseDoc = { schema: "erc-8354/attestation", eip: ERC8354_EIP, mechanism, attestation: attestationJson(attestation), encoded: encodeAttestation(attestation) };
    await this.docs().put(requestHash, requestDoc as unknown as JsonValue);
    await this.docs().put(responseHash, responseDoc as unknown as JsonValue);
    const base = input.publicBaseUrl?.replace(/\/$/u, "");
    const uri = (hash: Hex, doc: unknown) => (base ? `${base}/v1/tags/verdicts/${hash}` : `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString("base64")}`);
    const requestURI = uri(requestHash, requestDoc);
    const responseURI = uri(responseHash, responseDoc);
    const network = networkFor(input.environment);
    const registry = contractAddress("validationRegistry", input.environment) as Address;
    const guard = this.deps.guard ?? null;
    const notes: string[] = [
      `mechanism ${mechanism}: the Fence is evaluated by Lykia's policy engine; this is not a zero-knowledge proof.`,
      "policyRoot commits to the Fence hash padded with a per-agent salt; the owner can disclose (Fence, salt) to an auditor to recompute it.",
    ];
    if (!guard) notes.push("Set LYKIA_GUARD_ADDRESS to name a guard; until then only the documents and hashes are produced.");
    return {
      eip: ERC8354_EIP,
      mechanism,
      verdict: verdictJson(verdict),
      attestation: attestationJson(attestation),
      encoded: { verdict: encodeVerdict(verdict), attestation: encodeAttestation(attestation) },
      requestHash,
      responseHash,
      requestURI,
      responseURI,
      actionNonce: nonce.toString(),
      requestTransaction: guard
        ? { chainId: network.chainId, from: input.owner, to: registry, data: encodeFunctionData({ abi: VALIDATION_REGISTRY_ABI, functionName: "validationRequest", args: [guard, BigInt(input.agentId), requestURI, requestHash] }), value: "0", label: `Request an ERC-8354 policy verdict for agent #${input.agentId}` }
        : null,
      responseTransaction: guard
        ? { chainId: network.chainId, from: guard, to: registry, data: encodeFunctionData({ abi: VALIDATION_REGISTRY_ABI, functionName: "validationResponse", args: [requestHash, responseScore(verdict), responseURI, responseHash, ERC8354_TAG] }), value: "0", label: `Guard answers: ${verdict.decision === 1 ? "ALLOWED" : "not allowed"} (${ERC8354_TAG})` }
        : null,
      notes,
    };
  }

  private cards() {
    return this.deps.store.collection<JsonValue>("kunye_cards");
  }

  async draft(input: DraftInput): Promise<DraftResult> {
    const hash = fenceHash(input.fence);
    const card = buildKunyeCard({
      environment: input.environment,
      owner: input.owner,
      ...(input.agentWallet ? { agentWallet: input.agentWallet } : {}),
      name: input.name,
      description: input.description,
      ...(input.image ? { image: input.image } : {}),
      fenceHash: hash,
      ...(input.endpoints ? { endpoints: input.endpoints } : {}),
    });
    const digest = kunyeCardDigest(card);
    await this.cards().put(digest.slice("sha256:".length), { card, fence: input.fence } as unknown as JsonValue);
    const agentURI = input.publicBaseUrl ? `${input.publicBaseUrl.replace(/\/$/u, "")}/v1/tags/cards/${digest.slice("sha256:".length)}` : `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString("base64")}`;
    const network = networkFor(input.environment);
    const registry = contractAddress("identityRegistry", input.environment) as Address;
    const data = encodeFunctionData({
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "register",
      args: [agentURI, [{ metadataKey: FENCE_METADATA_KEY, metadataValue: digestToBytes32(hash) }]],
    });
    return {
      card,
      cardDigest: digest,
      fenceHash: hash,
      agentURI,
      transaction: { chainId: network.chainId, from: input.owner, to: registry, data, value: "0", label: `Register Tag “${card.name}” (ERC-8004) pinning Fence ${hash.slice(7, 19)}…` },
    };
  }

  async card(digestHex: string): Promise<{ card: KunyeCard; fence: Fence } | null> {
    if (!/^[0-9a-f]{64}$/u.test(digestHex)) return null;
    const found = await this.cards().get(digestHex);
    return found ? (found.value as unknown as { card: KunyeCard; fence: Fence }) : null;
  }

  /** The unsigned ValidationRegistry request filing a Fence verdict for an agent. */
  attest(input: { readonly environment: ArcEnvironment; readonly agentId: string; readonly intentId: string; readonly verdict: FenceVerdict; readonly owner: Address; readonly validator: Address; readonly requestURI?: string }): { record: ValidationRecord; requestHash: Hex; transaction: UnsignedTransaction } {
    if (!isAddress(input.validator)) throw new LykiaHttpError("INVALID_REQUEST", 400, "validator must be an address.");
    const record = validationRecord({ environment: input.environment, agentId: input.agentId, intentId: input.intentId, verdict: input.verdict });
    const requestHash = validationRequestHash(record);
    const requestURI = input.requestURI ?? `data:application/json;base64,${Buffer.from(JSON.stringify(record)).toString("base64")}`;
    const network = networkFor(input.environment);
    const data = encodeFunctionData({ abi: VALIDATION_REGISTRY_ABI, functionName: "validationRequest", args: [input.validator, BigInt(input.agentId), requestURI, requestHash] });
    return {
      record,
      requestHash,
      transaction: { chainId: network.chainId, from: input.owner, to: contractAddress("validationRegistry", input.environment) as Address, data, value: "0", label: `File Fence verdict for agent #${input.agentId} (${VALIDATION_TAG})` },
    };
  }

  async view(environment: ArcEnvironment, agentId: string): Promise<KunyeView> {
    if (!/^\d{1,30}$/u.test(agentId)) throw new LykiaHttpError("INVALID_REQUEST", 400, "agentId must be a decimal token id.");
    const client = this.deps.chains.client(environment);
    const id = BigInt(agentId);
    const identity = contractAddress("identityRegistry", environment) as Address;
    const [owner, wallet, uri, fenceMeta] = await client.multicall({
      contracts: [
        { address: identity, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [id] },
        { address: identity, abi: IDENTITY_REGISTRY_ABI, functionName: "getAgentWallet", args: [id] },
        { address: identity, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [id] },
        { address: identity, abi: IDENTITY_REGISTRY_ABI, functionName: "getMetadata", args: [id, FENCE_METADATA_KEY] },
      ],
      allowFailure: true,
    });
    if (owner?.status !== "success") throw new LykiaHttpError("NOT_FOUND", 404, `No agent #${agentId} on Arc ${environment}.`);
    const agentURI = uri?.status === "success" ? (uri.result as string) : null;
    const { card, note } = agentURI ? await this.fetchCard(agentURI) : { card: null, note: "No agent URI." };
    const fenceOnChain = fenceMeta?.status === "success" && typeof fenceMeta.result === "string" && /^0x[0-9a-f]{64}$/iu.test(fenceMeta.result) ? `sha256:${fenceMeta.result.slice(2).toLowerCase()}` : null;
    const fenceInCard = (card as { lykia?: { fenceHash?: unknown } } | null)?.lykia?.fenceHash;
    const inCard = typeof fenceInCard === "string" ? fenceInCard : null;
    const validationRegistry = contractAddress("validationRegistry", environment) as Address;
    const reputationRegistry = contractAddress("reputationRegistry", environment) as Address;
    const [validations, lykiaSummary, clients, ercSummary] = await client.multicall({
      contracts: [
        { address: validationRegistry, abi: VALIDATION_REGISTRY_ABI, functionName: "getAgentValidations", args: [id] },
        { address: validationRegistry, abi: VALIDATION_REGISTRY_ABI, functionName: "getSummary", args: [id, [], VALIDATION_TAG] },
        { address: reputationRegistry, abi: REPUTATION_REGISTRY_ABI, functionName: "getClients", args: [id] },
        { address: validationRegistry, abi: VALIDATION_REGISTRY_ABI, functionName: "getSummary", args: [id, [], ERC8354_TAG] },
      ],
      allowFailure: true,
    });
    const erc = ercSummary?.status === "success" ? (ercSummary.result as readonly [bigint, number]) : null;
    const clientList = clients?.status === "success" ? (clients.result as readonly Address[]) : [];
    let reputation: KunyeView["reputation"] = { clients: clientList.length, count: null, value: null };
    if (clientList.length > 0) {
      const summary = await client.readContract({ address: reputationRegistry, abi: REPUTATION_REGISTRY_ABI, functionName: "getSummary", args: [id, clientList, "", ""] }).catch(() => null);
      if (summary) reputation = { clients: clientList.length, count: Number(summary[0]), value: (Number(summary[1]) / 10 ** Number(summary[2])).toString() };
    }
    const summary = lykiaSummary?.status === "success" ? (lykiaSummary.result as readonly [bigint, number]) : null;
    return {
      agentId,
      environment,
      owner: owner.result as Address,
      agentWallet: wallet?.status === "success" && !/^0x0{40}$/iu.test(wallet.result as string) ? (wallet.result as Address) : null,
      agentURI,
      card,
      ...(note ? { cardNote: note } : {}),
      fenceOnChain,
      fenceInCard: inCard,
      fenceMatches: fenceOnChain && inCard ? fenceOnChain === inCard : null,
      validations: { count: validations?.status === "success" ? (validations.result as readonly Hex[]).length : 0, averageResponse: summary && summary[0] > 0n ? summary[1] : null, lykiaTag: VALIDATION_TAG },
      erc8354: { count: erc ? Number(erc[0]) : 0, averageResponse: erc && erc[0] > 0n ? erc[1] : null, tag: ERC8354_TAG, guard: this.deps.guard ?? null },
      reputation,
    };
  }

  /** Reads a card from a data: URI, Lykia's own card route, or a public https URL (SSRF-guarded, 64 KB cap). */
  async fetchCard(uri: string): Promise<{ card: unknown | null; note?: string }> {
    try {
      if (uri.startsWith("data:application/json;base64,")) return { card: JSON.parse(Buffer.from(uri.slice(29), "base64").toString("utf8")) };
      if (uri.startsWith("data:application/json,")) return { card: JSON.parse(decodeURIComponent(uri.slice(22))) };
      const own = /\/v1\/kunye\/cards\/([0-9a-f]{64})$/u.exec(uri);
      if (own) {
        const stored = await this.card(own[1] as string);
        if (stored) return { card: stored.card };
      }
      if (uri.startsWith("ipfs://")) return { card: null, note: "IPFS cards are not fetched by this server." };
      const url = await assertPublicUrl(uri, "agentURI");
      if (url.protocol !== "https:") return { card: null, note: "Only https cards are fetched." };
      const response = await this.deps.fetch(url.href, { signal: AbortSignal.timeout(4_000), redirect: "error" });
      if (!response.ok) return { card: null, note: `Card URL answered ${response.status}.` };
      const text = await response.text();
      if (text.length > CARD_FETCH_MAX_BYTES) return { card: null, note: "Card is larger than 64 KB." };
      return { card: JSON.parse(text) };
    } catch (error) {
      return { card: null, note: error instanceof LykiaHttpError ? error.message : "Card could not be read." };
    }
  }
}
