/**
 * The Fold's reads and writes over the Lykia API. Signed out, every hook
 * resolves to the labelled sample; with a wallet, public reads are live;
 * signed in (SIWE), the personal ones are too.
 */
import { DEFAULT_FOLD_PREFERENCES, POSITION_VENUES, summarizePositions, type AgentInstruction, type ArcEnvironment, type FoldPreferences, type PositionsResponse, type PositionsSummary, type PositionVenueInfo, type VenueRead } from "@lykia/core";
import type { AgentProposal, PackAgentView } from "@lykia/core/api/agents";
import type { FlockSnapshot } from "@lykia/core/api/flock";
import type { FoldAnswerResponse, FoldExplainArtifact, FoldInsightsResponse, FoldInstructionsResponse, FoldProposal, FoldQuestion, FoldSummaryResponse, FoldTrailsResponse, PreferencesResponse } from "@lykia/core/api/fold";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { useSearchParam } from "../../app/routes/useRoute";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useSession } from "../../lib/session";
import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { sampleInsights, samplePack, sampleSnapshot } from "./model";
import { samplePositions } from "./positionsModel";

export interface FoldOwner {
  /** The address the Fold reads: ?address=, else the connected wallet, else null (sample). */
  readonly address: string | null;
  /** Signed in as that address: personal reads and writes work. */
  readonly signedIn: boolean;
  /** The connected wallet is the address shown. */
  readonly own: boolean;
  readonly sample: boolean;
  readonly environment: ArcEnvironment;
}

export function useFoldOwner(): FoldOwner {
  const environment = useEnvironment();
  const { address: wallet } = useLykiaWallet();
  const as = useSearchParam("address");
  const session = useSession((s) => s.session);
  const address = as && /^0x[0-9a-fA-F]{40}$/u.test(as) ? as : (wallet ?? null);
  const signedIn = Boolean(address && session && session.address.toLowerCase() === address.toLowerCase());
  return { address, signedIn, own: Boolean(wallet && address && wallet.toLowerCase() === address.toLowerCase()), sample: !address, environment };
}

/** The time the page mounted: samples and day groupings stay stable while it is open. */
export function useMountedAt(): number {
  return useState(() => Date.now())[0];
}

export function useFoldSnapshot(o: FoldOwner) {
  return useQuery({
    queryKey: ["fold-flock", o.address, o.environment],
    enabled: Boolean(o.address),
    refetchInterval: 30_000,
    queryFn: ({ signal }) => apiGet<FlockSnapshot>(`/v1/flock/${o.address}`, { query: { environment: o.environment }, signal, timeoutMs: 20_000 }),
  });
}

export interface VenueSlot {
  readonly info: PositionVenueInfo;
  /** The venue's read once it answered (ok, unavailable or private); null while it loads. */
  readonly read: VenueRead | null;
  readonly loading: boolean;
  readonly refetch: () => void;
}

export interface PositionMap {
  readonly slots: readonly VenueSlot[];
  readonly summary: PositionsSummary;
  readonly healthFloor: string;
  readonly at: string | null;
  readonly block: string | null;
  readonly sample: boolean;
  readonly loading: boolean;
}

/**
 * The position map, read in a few groups of venues so pens fill as their
 * group answers and the slow, event-scanned venues never hold the rest. A request that fails to
 * reach Lykia becomes that venue's "unavailable" read with a retry; it is
 * never shown as zero. Signed out: the labelled sample.
 */
/** Venues read together: fast chain reads, LP enumeration, event-scanned venues, and the owner's own records. Four requests stream the map in without crowding the API's rate limit. */
export const POSITION_GROUPS: readonly (readonly string[])[] = [
  ["wallet", "aave-v4", "morpho-vaults", "galaxy-curation", "keyrock", "steakhouse-financial", "gauntlet", "bitwise", "usyc", "gateway", "lykia-practice"],
  ["uniswap-v3", "aerodrome-slipstream", "archery", "unitflow-finance-v3", "sushiswap"],
  ["uniswap-v4", "morpho-blue"],
  ["cctp", "relay", "across", "lykia-orders", "arc-transfer"],
];

export function usePositions(o: FoldOwner): PositionMap {
  const venues = POSITION_VENUES[o.environment];
  const groups = POSITION_GROUPS.map((g) => g.filter((id) => venues.some((v) => v.id === id))).filter((g) => g.length > 0);
  const results = useQueries({
    queries: groups.map((g) => ({
      queryKey: ["fold-positions", o.address, o.environment, o.signedIn, g.join(",")],
      enabled: Boolean(o.address),
      refetchInterval: 60_000,
      retry: 1,
      queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<PositionsResponse>(`/v1/fold/positions/${o.address}`, { query: { environment: o.environment, venues: g.join(",") }, signal, timeoutMs: 30_000 }),
    })),
  });
  const at = useMountedAt();
  const sample = useMemo(() => (o.sample ? samplePositions(at, o.environment) : null), [o.sample, at, o.environment]);
  if (sample) {
    const slots = venues.map((info) => ({ info, read: sample.venues.find((r) => r.venue === info.id) ?? null, loading: false, refetch: () => undefined }));
    return { slots, summary: sample.summary, healthFloor: sample.healthFloor, at: sample.at, block: sample.block, sample: true, loading: false };
  }
  const slots: VenueSlot[] = venues.map((info) => {
    const gi = groups.findIndex((g) => g.includes(info.id));
    const q = results[gi];
    const answered = q?.data?.venues.find((r) => r.venue === info.id) ?? null;
    const failed: VenueRead | null = !answered && q?.isError ? { venue: info.id, venueName: info.name, venueKind: info.kind, status: "unavailable", reason: "Lykia's API did not answer for this venue.", positions: [], source: "chain", method: "", readAt: new Date().toISOString(), block: null, ms: 0 } : null;
    return { info, read: answered ?? failed, loading: !answered && !failed, refetch: () => void q?.refetch() };
  });
  const reads = slots.map((s) => s.read).filter((r): r is VenueRead => r !== null);
  const first = results.find((q) => q.data)?.data;
  const blocks = reads.map((r) => (r.block ? Number(r.block) : 0));
  return { slots, summary: summarizePositions(reads), healthFloor: first?.healthFloor ?? "1.5", at: first?.at ?? null, block: blocks.length > 0 && Math.max(...blocks) > 0 ? String(Math.max(...blocks)) : null, sample: false, loading: slots.some((s) => s.loading) };
}

export function useFoldInsights(o: FoldOwner) {
  const q = useQuery({
    queryKey: ["fold-insights", o.address, o.environment, o.signedIn],
    enabled: Boolean(o.address),
    refetchInterval: 60_000,
    queryFn: ({ signal }) => apiGet<FoldInsightsResponse>(`/v1/fold/insights/${o.address}`, { query: { environment: o.environment }, signal, timeoutMs: 20_000 }),
  });
  const at = useMountedAt();
  const sample = useMemo<FoldInsightsResponse | undefined>(() => (o.sample ? { owner: "0x000000000000000000000000000000000000dEaD", environment: "mainnet", at: new Date(at).toISOString(), insights: sampleInsights(), brief: { since: null, lines: [] }, personal: false } : undefined), [o.sample, at]);
  return { ...q, data: q.data ?? sample };
}

export function useFoldSummary(o: FoldOwner) {
  return useQuery({
    queryKey: ["fold-summary", o.address, o.environment, o.signedIn],
    enabled: Boolean(o.address),
    refetchInterval: 60_000,
    queryFn: ({ signal }) => apiGet<FoldSummaryResponse>(`/v1/fold/summary/${o.address}`, { query: { environment: o.environment }, signal }),
  });
}

export function useInstructions(o: FoldOwner) {
  return useQuery({
    queryKey: ["fold-instructions", o.address],
    enabled: o.signedIn,
    refetchInterval: 45_000,
    queryFn: ({ signal }) => apiGet<FoldInstructionsResponse>("/v1/fold/instructions", { query: { owner: o.address }, signal, timeoutMs: 20_000 }),
  });
}

export function useTrails(o: FoldOwner) {
  return useQuery({
    queryKey: ["fold-trails", o.address],
    enabled: o.signedIn,
    refetchInterval: 45_000,
    queryFn: ({ signal }) => apiGet<FoldTrailsResponse>("/v1/fold/trails", { query: { owner: o.address }, signal, timeoutMs: 20_000 }),
  });
}

export function useExplain(o: FoldOwner, question: FoldQuestion, enabled: boolean) {
  return useQuery({
    queryKey: ["fold-explain", o.address, o.environment, question],
    enabled: enabled && o.signedIn,
    staleTime: 60_000,
    queryFn: ({ signal }) => apiGet<FoldExplainArtifact>("/v1/fold/explain", { query: { owner: o.address, environment: o.environment, question }, signal, timeoutMs: 20_000 }),
  });
}

export function useFoldPack(o: FoldOwner) {
  const q = useQuery({
    queryKey: ["pack", o.address, o.environment, o.signedIn],
    enabled: Boolean(o.address),
    // Names, Fences and budgets come back only for the signed-in owner; a redacted answer lists nothing here.
    queryFn: async ({ signal }) => {
      const r = await apiGet<{ agents: PackAgentView[]; redacted?: boolean }>("/v1/pack", { query: { owner: o.address, environment: o.environment }, signal });
      return { agents: r.redacted ? [] : r.agents };
    },
  });
  const sample = useMemo(() => (o.sample ? { agents: samplePack() } : undefined), [o.sample]);
  return { ...q, data: q.data ?? sample };
}

export function useSampleSnapshot(o: FoldOwner): FlockSnapshot | undefined {
  const at = useMountedAt();
  return useMemo(() => (o.sample ? sampleSnapshot(at) : undefined), [o.sample, at]);
}

export function usePreferences(o: Pick<FoldOwner, "signedIn" | "address">) {
  const q = useQuery({
    queryKey: ["me-preferences", o.address],
    enabled: o.signedIn,
    retry: false,
    queryFn: ({ signal }) => apiGet<PreferencesResponse>("/v1/me/preferences", { signal }),
  });
  return { ...q, preferences: (q.data?.preferences ?? DEFAULT_FOLD_PREFERENCES) as FoldPreferences };
}

export function useSavePreferences(address: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<FoldPreferences>) => apiPut<PreferencesResponse>("/v1/me/preferences", patch),
    onSuccess: (data) => {
      qc.setQueryData(["me-preferences", address], data);
      void qc.invalidateQueries({ queryKey: ["fold-insights"] });
    },
  });
}

/** Proposal writes: draft (from an insight, a holding, a sentence, a Fence edit) and move along the lifecycle. */
export function useProposals(o: FoldOwner) {
  const qc = useQueryClient();
  const fence = useLykiaStore((s) => s.fence);
  const refresh = () => Promise.all(["fold-insights", "fold-instructions", "fold-summary", "fold-trails"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const draft = useMutation({
    mutationFn: (input: { source: { kind: "insight" | "holding" | "chat" | "fence"; ref: string | null }; title?: string; sentence?: string; fencePatch?: Record<string, unknown> }) => apiPost<FoldProposal>("/v1/fold/proposals", { owner: o.address, environment: o.environment, fence, ...input }, { timeoutMs: 30_000 }),
    onSuccess: () => void refresh(),
  });
  const move = useMutation({
    mutationFn: (input: { id: string; to: "approve" | "done" | "stop"; note?: string }) => apiPost<FoldProposal>(`/v1/fold/proposals/${encodeURIComponent(input.id)}/${input.to}`, { owner: o.address, ...(input.note ? { note: input.note } : {}) }),
    onSuccess: () => void refresh(),
  });
  return { draft, move };
}

export function useAnswer(o: FoldOwner) {
  return useMutation({
    mutationFn: (input: { question: FoldQuestion; threadId?: string | null; shocks?: { EURC?: number; cirBTC?: number; ratesBps?: number } }) => apiPost<FoldAnswerResponse>("/v1/fold/answer", { owner: o.address, environment: o.environment, question: input.question, ...(input.threadId ? { threadId: input.threadId } : {}), ...(input.shocks ? { shocks: input.shocks } : {}) }, { timeoutMs: 25_000 }),
  });
}

export function useMarkSeen(o: FoldOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ at: string }>("/v1/fold/seen", { owner: o.address, environment: o.environment }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["fold-insights"] }),
  });
}

/** Pause or resume a Herding instruction (no signature needed for automations, standing orders and alerts). */
export function useInstructionControl(o: FoldOwner) {
  const qc = useQueryClient();
  return useMutation({
    // Watch tasks from Ask Lyko live with the agent instructions; everything else is an automation.
    mutationFn: (input: { id: string; action: "pause" | "resume" | "remove"; source?: string }) =>
      input.source === "watch" || input.id.includes(":ins_")
        ? apiPost(`/v1/agent/instructions/${encodeURIComponent(input.id)}/${input.action}`, { owner: o.address })
        : apiPost(`/v1/automations/${encodeURIComponent(input.id)}/${input.action}`, {}, { query: { owner: o.address } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fold-instructions"] });
      void qc.invalidateQueries({ queryKey: ["fold-insights"] });
    },
  });
}

/** "Send to Ask Lyko": the insight becomes a staged plan on the shared thread, marked From Lyko on watch. */
export function useSendToAsk(o: FoldOwner) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { insightId: string; threadId: string | null }) =>
      apiPost<{ instruction: AgentInstruction; proposal: AgentProposal; threadId: string }>("/v1/agent/instructions", { owner: o.address, environment: o.environment, kind: "plan", from: "watch", to: "ask", insightId: input.insightId, ...(input.threadId ? { threadId: input.threadId } : {}) }),
    onSuccess: () => {
      for (const k of ["fold-insights", "fold-instructions", "fold-proposals", "me-threads"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
}
