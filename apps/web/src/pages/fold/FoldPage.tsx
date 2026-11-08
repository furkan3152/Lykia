/**
 * The Fold: everything you own and everything in motion. A two-column
 * workspace: the Fold bar and five tabs on the left (Flock, Trails,
 * Herding, Pack, Fence; keys 1 to 5), Lyko on watch docked on the right.
 * On phones the bar condenses into one card, the tabs become a chip row,
 * Lyko becomes a tab of its own with a badge, drafts open as bottom sheets
 * and an "Ask Lyko" bar stays within thumb reach.
 */
import { fenceForProfile, DEFAULT_PROFILE, riskTierOf, type FoldTab, type Position, type PositionAction } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";
import type { FoldInsight, FoldInstruction, FoldProposal } from "@lykia/core/api/fold";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { navigate } from "../../app/routes/history";
import { useRouteParam, useSearchParam } from "../../app/routes/useRoute";
import { mediaMatches, subscribeMedia } from "../../app/state/media";
import { useAsk } from "../../features/ask/store";
import { useMountedAt, useFoldInsights, useFoldOwner, useFoldPack, useFoldSnapshot, useFoldSummary, useExplain, useInstructions, usePositions, usePreferences, useProposals, useSampleSnapshot, useTrails, useInstructionControl } from "../../features/fold/data";
import { useFoldBadge } from "../../features/fold/badge";
import { DraftSheet } from "../../features/fold/DraftSheet";
import { FoldBar } from "../../features/fold/FoldBar";
import { LykoOnWatch } from "../../features/fold/LykoOnWatch";
import { badgeCount, FOLD_TAB_META, headroom, herdingFilterOf, LYKO_TAB, SAMPLE_COUNTS, sampleInstructions, sampleTrails, tabForKey, tabFromParam, visibleTabs, type PhoneTab } from "../../features/fold/model";
import { FenceTab } from "../../features/fold/tabs/FenceTab";
import { FlockTab } from "../../features/fold/tabs/FlockTab";
import { HerdingTab } from "../../features/fold/tabs/HerdingTab";
import { PackTab } from "../../features/fold/tabs/PackTab";
import { LeashSection } from "../../features/fold/leash/LeashSection";
import { TrailsTab } from "../../features/fold/tabs/TrailsTab";
import { useSiwe } from "../../features/session/useSiwe";
import { useBetaCap } from "../../features/ecosystem/useBetaCap";
import { apiPost, describeError } from "../../lib/api";
import { useLykiaStore } from "../../lib/lykiaStore";
import { runCommand } from "../../lib/runCommand";
import { Button, LykoFace, cx, toast } from "../../mosaic";
import { useQueryClient } from "@tanstack/react-query";

const PHONE = "(max-width: 899px)";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMedia(query, cb),
    () => mediaMatches(query) ?? false,
    () => false,
  );
}

export default function FoldPage() {
  const owner = useFoldOwner();
  const siwe = useSiwe();
  const phone = useMedia(PHONE);
  const fence = useLykiaStore((s) => s.fence);
  const whistle = fence.mode === "whistle";
  const qc = useQueryClient();
  const { preferences } = usePreferences(owner);
  const tabs = visibleTabs(preferences);
  const tabParam = useRouteParam("tab");
  const tab = tabFromParam(tabParam, tabs);
  const effectiveTab: PhoneTab = !phone && tab === "lyko" ? tabs[0]! : tab;
  const show = herdingFilterOf(useSearchParam("show"));
  const whatifOpen = useSearchParam("whatif") === "1";

  const live = useFoldSnapshot(owner);
  const positions = usePositions(owner);
  const sampleSnap = useSampleSnapshot(owner);
  const snapshot = live.data ?? sampleSnap;
  const insights = useFoldInsights(owner);
  const summary = useFoldSummary(owner);
  const instructions = useInstructions(owner);
  const trails = useTrails(owner);
  const pack = useFoldPack(owner);
  const beta = useBetaCap();
  const explain = useExplain(owner, "yield", effectiveTab === "trails");
  const { draft, move } = useProposals(owner);
  const control = useInstructionControl(owner);
  const setPrefill = useAsk((s) => s.setPrefill);
  const carry = useAsk((s) => s.carry);
  const [openDraft, setOpenDraft] = useState<FoldProposal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const mountedAt = useMountedAt();
  const sampleInstr = useMemo(() => (owner.sample ? sampleInstructions(mountedAt) : undefined), [owner.sample, mountedAt]);
  const sampleTrail = useMemo(() => (owner.sample ? sampleTrails(mountedAt) : undefined), [owner.sample, mountedAt]);
  const instructionList = instructions.data?.instructions ?? sampleInstr;
  const waiting = instructions.data?.waiting ?? (owner.sample ? [] : undefined);
  const trailItems = trails.data?.items ?? sampleTrail;

  const minHealth = Number(fence.lending?.minHealthFactor ?? fenceForProfile({ ...DEFAULT_PROFILE, risk: riskTierOf(preferences.risk) }).lending?.minHealthFactor ?? "1.2");
  const fenceDaily = fence.caps?.dailyUsd ?? summary.data?.fenceDailyUsd ?? null;
  const room = headroom(owner.sample ? 1240 : (summary.data?.spent.dayUsd ?? 0), fenceDaily, owner.environment === "mainnet" ? (summary.data?.beta?.perDayUsd ?? beta.data?.perDayUsd ?? null) : null);
  const counts = owner.sample ? SAMPLE_COUNTS : summary.data ? summary.data.counts : { rules: 0, ordersWaiting: 0, agentsWorking: pack.data?.agents.filter((a) => a.status === "active").length ?? 0 };
  const badge = badgeCount(insights.data?.insights ?? [], waiting?.length ?? 0);
  useEffect(() => {
    useFoldBadge.getState().set(badge);
  }, [badge]);
  useEffect(() => {
    // The chip row scrolls on phones: keep the open tab in view.
    document.querySelector<HTMLElement>('.fd-tabs [aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [effectiveTab]);
  // Once every venue has answered, the bar shows the same net as the position map; until then, the Flock snapshot.
  const mapNet = !positions.loading && positions.summary.unavailable.length === 0 && positions.summary.positions > 0 ? Number(positions.summary.pricedNetUsd) : null;
  const total = mapNet ?? (snapshot?.totalUsd === null || snapshot?.totalUsd === undefined ? null : Number(snapshot.totalUsd));

  const go = useCallback((t: PhoneTab) => {
    // Reading another address (?address=) survives switching tabs.
    const as = new URLSearchParams(window.location.search).get("address");
    navigate(`/app/fold/${t}${as ? `?address=${as}` : ""}`, { replace: true });
  }, []);

  const focusLyko = useCallback(() => {
    if (phone) return go("lyko");
    const el = document.querySelector<HTMLTextAreaElement>(".fd-lyko textarea");
    el?.focus();
  }, [phone, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable))) return;
      if (e.key === "/") {
        e.preventDefault();
        focusLyko();
        return;
      }
      const next = tabForKey(e.key, tabs);
      if (next) go(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, go, focusLyko]);

  const needWallet = () => {
    if (!owner.address) {
      toast.info("Connect a wallet first", { description: "The sample flock is for looking around.", from: "LYKO" });
      return true;
    }
    if (!owner.signedIn) {
      void siwe.signIn();
      return true;
    }
    return false;
  };

  const openInAsk = (text: string, context: string) => {
    carry(context);
    if (text) setPrefill(text);
    navigate("/app");
  };

  const draftFrom = async (input: Parameters<typeof draft.mutateAsync>[0]) => {
    if (needWallet()) return;
    try {
      const p = await draft.mutateAsync(input);
      setOpenDraft(p);
      if (p.status === "stopped") toast.warning("The Fence said no", { description: p.reasons[0] ?? p.outcome ?? undefined, from: "LYKO" });
    } catch (e) {
      toast.error("Lyko could not draft that", { description: describeError(e), from: "LYKO" });
    }
  };

  const onInsight = (i: FoldInsight) => void draftFrom({ source: { kind: "insight", ref: i.id } });
  const onPosition = (p: Position, a: PositionAction) => {
    // "ask" moves Lykia cannot draft in one step open Ask Lyko with the question; "draft" plans through the proposal system.
    if (a.mode === "ask") return openInAsk(a.sentence, `Position ${p.label} (${p.venueName}): ${p.doing}. Value ${p.valueUsd ?? "unpriced"} USD, read at block ${p.block ?? "n/a"}.`);
    if (owner.sample) {
      toast.info("This is the sample flock", { description: "Connect a wallet and Lyko drafts this for yours.", from: "LYKO" });
      return;
    }
    void draftFrom({ source: { kind: "holding", ref: p.id.slice(0, 120) }, sentence: a.sentence, title: `${a.label}: ${a.sentence}`.slice(0, 160) });
  };
  const onFenceSuggest = (label: string, patch: Record<string, unknown>) => void draftFrom({ source: { kind: "fence", ref: null }, title: label, fencePatch: patch });
  const moveP = (id: string, to: "approve" | "done" | "stop", note?: string) => move.mutateAsync({ id, to, ...(note ? { note } : {}) });
  const stopP = async (p: FoldProposal) => {
    setBusyId(p.id);
    try {
      await moveP(p.id, "stop", "Stopped by the owner.");
    } catch (e) {
      toast.error("Not stopped", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };
  const toggle = async (i: FoldInstruction) => {
    if (needWallet()) return;
    setBusyId(i.id);
    try {
      await control.mutateAsync({ id: i.id, action: i.status === "paused" ? "resume" : "pause", source: i.source });
      toast.success(i.status === "paused" ? "Resumed" : "Paused", { description: i.name, from: "LYKO" });
    } catch (e) {
      toast.error("No change", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (i: FoldInstruction) => {
    if (needWallet()) return;
    setBusyId(i.id);
    try {
      await control.mutateAsync({ id: i.id, action: "remove", source: i.source });
      toast.success("Watch removed", { description: i.name, from: "LYKO" });
    } catch (e) {
      toast.error("Not removed", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };
  const whistleAll = () => runCommand(whistle ? "release" : "whistle");
  const whistleAgent = async (a: PackAgentView) => {
    if (needWallet()) return;
    setBusyId(a.id);
    try {
      await apiPost(`/v1/pack/${encodeURIComponent(a.id)}/${a.status === "paused" ? "resume" : "pause"}`, {});
      await qc.invalidateQueries({ queryKey: ["pack"] });
      toast.success(a.status === "paused" ? `${a.name} is back at work` : `${a.name} lies down`, { from: "LYKO" });
    } catch (e) {
      toast.error("No change", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };

  const meta = effectiveTab === "lyko" ? null : FOLD_TAB_META[effectiveTab as FoldTab];
  const panel = (variant: "dock" | "tab") => (
    <LykoOnWatch variant={variant} owner={owner} insights={insights.data} loading={insights.isLoading} instructions={instructionList} snapshot={snapshot} minHealth={minHealth} busy={draft.isPending} onDraft={onInsight} onOpenInAsk={openInAsk} />
  );

  return (
    <div className={cx("fd", whistle && "fd--night")}>
      <h1 className="sr-only">{"The Fold: everything you own and everything in motion"}</h1>
      <div className="m-wrap m-wrap--wide fd__grid">
        <div className="fd__main">
          {owner.sample ? (
            <div className="fd-samplebar" role="note">
              <LykoFace mood="happy" scale={1} />
              <span>{"A sample flock, so you can look around. Connect a wallet and Lyko watches yours."}</span>
            </div>
          ) : null}
          {phone && effectiveTab === "lyko" ? null : <FoldBar total={total} unpriced={mapNet !== null ? positions.summary.unpriced > 0 : snapshot?.totalUsd === null} holdings={snapshot?.holdings ?? []} headroom={room} counts={counts} cards={preferences.layout.cards} sample={owner.sample} whistle={whistle} onAsk={focusLyko} onWhistle={whistleAll} loading={!snapshot && live.isLoading} />}

          <nav className="fd-tabs" role="tablist" aria-label="The Fold">
            {tabs.map((t, i) => (
              <button key={t} type="button" role="tab" aria-selected={effectiveTab === t} className="fd-tab" onClick={() => go(t)}>
                <span className="fd-tab__l">{FOLD_TAB_META[t].label}</span>
                <span className="fd-tab__s">{FOLD_TAB_META[t].sub}</span>
                <kbd className="fd-tab__k" aria-hidden="true">{i + 1}</kbd>
              </button>
            ))}
            {phone ? (
              <button type="button" role="tab" aria-selected={effectiveTab === "lyko"} className="fd-tab fd-tab--lyko" onClick={() => go("lyko")}>
                <span className="fd-tab__l">{LYKO_TAB.label}</span>
                <span className="fd-tab__s">{LYKO_TAB.sub}</span>
                {badge > 0 ? <span className="fd-badge" aria-label={`${badge} new`}>{badge}</span> : null}
              </button>
            ) : null}
          </nav>

          {meta ? (
            <div className="fd-tabhead">
              <h2>
                {meta.label} <span>{`· ${meta.sub}`}</span>
              </h2>
              <p>{meta.line}</p>
            </div>
          ) : null}

          <div className="fd-panel" role="tabpanel" aria-label={meta ? `${meta.label} · ${meta.sub}` : "Lyko on watch"}>
            {effectiveTab === "flock" ? <FlockTab snapshot={snapshot} map={positions} minHealth={minHealth} signedIn={owner.signedIn} onSignIn={() => void siwe.signIn()} onAction={onPosition} busy={draft.isPending} openWhatIf={whatifOpen} /> : null}
            {effectiveTab === "trails" ? <TrailsTab now={mountedAt} items={trailItems} totals={trails.data?.totals ?? (owner.sample ? { settled: 2, failed: 0, refused: 1, feesUsd: "54.00" } : undefined)} explain={explain.data ?? (owner.sample ? { kind: "yield", title: "Where your yield comes from", summary: "$6,600 earns about $372 a year (2.95% on the whole Flock); $5,616 rests in the wallet.", lines: [{ label: "Galaxy USDC · morpho-vaults", value: "$4,200", note: "6.10% a year ≈ $256" }, { label: "USDC · aave-v4", value: "$2,400", note: "4.80% a year ≈ $115" }, { label: "Borrowed USDC · aave-v4", value: "−$600", note: "interest accrues against your yield" }, { label: "Resting in the wallet", value: "$5,616", note: "earns nothing; kept liquid" }, { label: "Lykia fees, last 30 days", value: "$54.00", note: "1% of what moved" }], sources: ["sample"], at: new Date(mountedAt).toISOString() } : undefined)} explainLoading={explain.isLoading} sample={owner.sample} signedIn={owner.signedIn} onSignIn={() => void siwe.signIn()} /> : null}
            {effectiveTab === "herding" ? <HerdingTab instructions={instructionList} waiting={waiting} sample={owner.sample} signedIn={owner.signedIn} initialFilter={show} onSignIn={() => void siwe.signIn()} onOpen={setOpenDraft} onStop={(p) => void stopP(p)} onToggle={(i) => void toggle(i)} onRemove={(i) => void remove(i)} onEdit={(i) => openInAsk(i.editSentence, `Herding item ${i.id}: ${i.name} (${i.trigger}; ${i.status}; next ${i.nextRunLabel}).`)} onNew={() => openInAsk("Every Friday at 17:00, pay ", "A new standing instruction from Herding.")} busyId={busyId} /> : null}
            {effectiveTab === "pack" ? <LeashSection owner={owner} onSignIn={() => void siwe.signIn()} /> : null}
            {effectiveTab === "pack" ? <PackTab agents={pack.data?.agents} sample={owner.sample} busyId={busyId} onWhistle={(a) => void whistleAgent(a)} onNew={() => openInAsk("Create a payroll agent with a 500 USDC daily budget", "A new agent from the Pack.")} onAsk={(a) => openInAsk(`How is ${a.name} doing, and what did it do today?`, `Agent ${a.name} (${a.role}), ${a.status}; daily cap ${a.budget.caps.dailyUsd ?? "none"}, spent today ${a.budget.spent.dayUsd}.`)} /> : null}
            {effectiveTab === "fence" ? <FenceTab fence={fence} headroom={room} verdicts={trailItems ?? []} onSuggest={onFenceSuggest} onAsk={() => openInAsk("Change my Fence: ", "A Fence edit from the Fold.")} onWhistle={whistleAll} busy={draft.isPending} /> : null}
            {effectiveTab === "lyko" ? panel("tab") : null}
          </div>
        </div>
        {!phone ? <div className="fd__side">{panel("dock")}</div> : null}
      </div>

      {phone && effectiveTab !== "lyko" ? (
        <div className="fd-askbar">
          <button type="button" className="fd-askbar__btn" onClick={() => go("lyko")}>
            <LykoFace mood={badge > 0 ? "alert" : "happy"} scale={1.4} />
            <span>{badge > 0 ? `Lyko noticed ${badge} thing${badge === 1 ? "" : "s"}` : "Ask Lyko about your Fold"}</span>
            {badge > 0 ? <span className="fd-badge">{badge}</span> : null}
          </button>
        </div>
      ) : null}

      <DraftSheet proposal={openDraft} onClose={() => setOpenDraft(null)} onMove={moveP} />
      {owner.address && !owner.signedIn && !owner.sample ? (
        <div className="fd-signin m-wrap m-wrap--wide">
          <span className="m-small">{"Reading this address in public. Sign in as its owner to see instructions, trails and drafts, and to act."}</span>
          <Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy || !owner.own}>{owner.own ? "SIGN IN" : "NOT YOUR WALLET"}</Button>
        </div>
      ) : null}
    </div>
  );
}
