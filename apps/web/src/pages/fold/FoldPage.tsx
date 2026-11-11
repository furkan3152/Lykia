/**
 * The Fold: everything you own and everything in motion. A two-column
 * workspace: the Fold bar and five tabs on the left (Flock, Trails,
 * Herding, Pack, Fence; keys 1 to 5), Lyko on watch docked on the right.
 * On phones the bar condenses into one card, the tabs become a chip row,
 * Lyko becomes a tab of its own with a badge, drafts open as bottom sheets
 * and an "Ask Lyko" bar stays within thumb reach.
 */
import { DEFAULT_BETA_CAP, fenceForProfile, DEFAULT_PROFILE, riskTierOf, trailFeesUsd, type FoldTab, type Position, type PositionAction } from "@lykia/core";
import type { PackAgentView } from "@lykia/core/api/agents";
import type { FoldInsight, FoldInstruction, FoldProposal, WhistleItem } from "@lykia/core/api/fold";
import type { UnsignedTransaction } from "@lykia/core";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { navigate } from "../../app/routes/history";
import { useRouteParam, useSearchParam } from "../../app/routes/useRoute";
import { mediaMatches, subscribeMedia } from "../../app/state/media";
import { useAsk } from "../../features/ask/store";
import { useMountedAt, useFoldInsights, useFoldOwner, useFoldPack, useFoldSnapshot, useFoldSummary, useExplain, useInstructions, usePositions, usePreferences, useProposals, useSampleSnapshot, useTrails, useWhistle } from "../../features/fold/data";
import { useFoldBadge } from "../../features/fold/badge";
import { DraftSheet } from "../../features/fold/DraftSheet";
import { FoldBar } from "../../features/fold/FoldBar";
import { LykoOnWatch } from "../../features/fold/LykoOnWatch";
import { badgeCount, controlOf, countsOf, FOLD_TAB_META, headroom, herdingFilterOf, LYKO_TAB, sampleInstructions, sampleTrails, sampleWaiting, tabForKey, tabFromParam, visibleTabs, type PhoneTab } from "../../features/fold/model";
import { WhistleSheet } from "../../features/fold/WhistleSheet";
import { CancelOrderModal } from "../../features/route/OrderReview";
import { FenceTab } from "../../features/fold/tabs/FenceTab";
import { FlockTab } from "../../features/fold/tabs/FlockTab";
import { HerdingTab } from "../../features/fold/tabs/HerdingTab";
import { LeashSection } from "../../features/fold/leash/LeashSection";
import { AutopilotSection } from "../../features/fold/autopilot/AutopilotSection";
import { useAutopilot } from "../../features/fold/autopilot/data";
import { useLeashes } from "../../features/fold/leash/data";
import { isNewcomer } from "../../features/fold/newcomer";
import { NewcomerCard } from "../../features/fold/NewcomerCard";
import { TrailsTab } from "../../features/fold/tabs/TrailsTab";
import { useSiwe } from "../../features/session/useSiwe";
import { useOwnerFence } from "../../features/fence/sync";
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { useWallet } from "../../features/wallet/store";
import { HowItWorks } from "../../features/help/Help";
import type { HelpArea } from "../../features/help/help";
import { useBetaCap } from "../../features/ecosystem/useBetaCap";
import { apiDelete, apiGet, apiPost, describeError } from "../../lib/api";
import { useLykiaStore } from "../../lib/lykiaStore";
import { runCommand } from "../../lib/runCommand";
import { Button, LykoFace, toast } from "../../mosaic";
import { Sheet } from "../../city/Sheet";
import { askAboutPosition } from "../../features/fold/model";
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
  const fenceView = useOwnerFence();
  // The Whistle is the server's: blown when it holds anything for the owner (or the deck's Fence is in whistle mode).
  const wh = useWhistle(owner);
  const held = (wh.state.data?.items ?? []).filter((i) => i.state === "paused").length;
  const whistle = fence.mode === "whistle" || held > 0;
  const [whistleOpen, setWhistleOpen] = useState(false);
  const [cancelling, setCancelling] = useState<{ hash: string; name: string; environment: "mainnet" | "testnet" } | null>(null);
  const qc = useQueryClient();
  const wallet = useLykiaWallet();
  const openModal = useWallet((st) => st.openModal);
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
  const setPrefill = useAsk((s) => s.setPrefill);
  const carry = useAsk((s) => s.carry);
  const [openDraft, setOpenDraft] = useState<FoldProposal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const mountedAt = useMountedAt();
  const sampleInstr = useMemo(() => (owner.sample ? sampleInstructions(mountedAt) : undefined), [owner.sample, mountedAt]);
  const sampleTrail = useMemo(() => (owner.sample ? sampleTrails(mountedAt) : undefined), [owner.sample, mountedAt]);
  const sampleWait = useMemo(() => (owner.sample ? sampleWaiting(mountedAt) : undefined), [owner.sample, mountedAt]);
  const instructionList = instructions.data?.instructions ?? sampleInstr;
  // Signed out, the inbox shows the sample's one draft, so the bar's "1 draft waits" and Herding agree.
  const waiting = instructions.data?.waiting ?? sampleWait;
  const trailItems = trails.data?.items ?? sampleTrail;
  const leashesOf = useLeashes(owner);
  const autopilotOf = useAutopilot(owner);
  // Nothing of theirs exists yet: Herding, Pack and Fence each show one friendly state with one action.
  const newcomer = isNewcomer({
    signedIn: owner.signedIn,
    sample: owner.sample,
    running: instructions.data?.instructions?.length,
    waiting: instructions.data?.waiting?.length,
    agents: pack.data ? pack.data.agents.filter((a) => a.role !== "orchestrator" && a.status !== "revoked").length : undefined,
    leashes: leashesOf.data?.leashes.length,
    autopilot: autopilotOf.data ? Boolean(autopilotOf.data.autopilot) : undefined,
    trail: trails.data?.items?.length,
  });
  // One fee figure for the page: the server's total, or the sample trail's through the same core function.
  const trailTotals = trails.data?.totals ?? (sampleTrail ? { settled: sampleTrail.filter((t) => t.kind === "settled").length, failed: sampleTrail.filter((t) => t.kind === "failed").length, refused: sampleTrail.filter((t) => t.kind === "refused").length, feesUsd: trailFeesUsd(sampleTrail, mountedAt) } : undefined);
  // Phones: Lyko on watch opens as a sheet over whichever tab is showing.
  const [watchSheet, setWatchSheet] = useState(false);

  const minHealth = Number(fence.lending?.minHealthFactor ?? fenceForProfile({ ...DEFAULT_PROFILE, risk: riskTierOf(preferences.risk) }).lending?.minHealthFactor ?? "1.2");
  const fenceDaily = fence.caps?.dailyUsd ?? summary.data?.fenceDailyUsd ?? null;
  // Lykia's beta limit applies on mainnet (the sample flock is a mainnet flock).
  const betaCap = owner.sample ? (beta.data ?? DEFAULT_BETA_CAP) : owner.environment === "mainnet" ? (beta.data === undefined ? DEFAULT_BETA_CAP : beta.data) : null;
  const room = headroom(owner.sample ? 1240 : (summary.data?.spent.dayUsd ?? 0), fenceDaily, betaCap ? (summary.data?.beta?.perDayUsd ?? betaCap.perDayUsd) : null);
  // The bar's counts are Herding's: computed from the Running list whenever it is loaded (the sample's too).
  const counts = instructionList && waiting ? countsOf(instructionList, waiting) : summary.data ? summary.data.counts : { rules: 0, ordersWaiting: 0, agentsWorking: 0 };
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
    if (phone) return setWatchSheet(true);
    const el = document.querySelector<HTMLTextAreaElement>(".fd-lyko textarea");
    el?.focus();
  }, [phone]);

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
  // "Ask about this": the position goes to Lyko on watch as context, with one scoped question, in the same thread as Ask Lyko.
  const onAskAbout = (p: Position) => {
    const q = askAboutPosition(p);
    carry(q.context);
    void useAsk.getState().send(q.question, { environment: owner.environment, ...(owner.address ? { owner: owner.address as `0x${string}` } : {}), origin: "fold" });
    if (phone) setWatchSheet(true);
    else document.querySelector<HTMLElement>(".fd__side .fd-lyko")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  // WHISTLE · STOP ALL: one server call stops everything for the owner; the sheet lists what stopped, each with Resume.
  const whistleAll = () => {
    if (owner.sample) {
      toast.info("This is the sample flock", { description: "Sign in with your wallet and the Whistle stops your automations, agents, leashes and Autopilot at once.", from: "LYKO" });
      return;
    }
    if (!owner.signedIn) {
      runCommand(whistle ? "release" : "whistle");
      void siwe.signIn();
      return;
    }
    if (!whistle) runCommand("whistle");
    setWhistleOpen(true);
  };
  const resumeOne = async (item: WhistleItem) => {
    setBusyId(item.id);
    try {
      const after = await wh.resume.mutateAsync(item);
      toast.success("Running again", { description: item.label, from: "LYKO" });
      if (!after.items.some((i) => i.state === "paused") && fence.mode === "whistle") runCommand("release");
    } catch (e) {
      toast.error("Not resumed", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };
  const resumeAll = () => {
    setBusyId("all");
    runCommand("release");
    setTimeout(() => setBusyId(null), 600);
  };
  /** A Running row's one control: the HTTP call the row names; an order cancel and a leash's revokeSession are signed in the wallet after it. */
  const runControl = async (i: FoldInstruction) => {
    const c = controlOf(i);
    if (!c) return;
    if (c.sign === "order-cancel") return cancelOrderRow(i);
    if (owner.sample) {
      toast.info("This is the sample flock", { description: "Connect a wallet and sign in, and these controls act on your own.", from: "LYKO" });
      return;
    }
    if (needWallet()) return;
    setBusyId(i.id);
    try {
      const options = c.query ? { query: c.query } : {};
      const r = c.method === "delete" ? await apiDelete<unknown>(c.path, options) : c.method === "get" ? await apiGet<unknown>(c.path, options) : await apiPost<{ transaction?: UnsignedTransaction | null }>(c.path, c.body ?? {}, options);
      for (const k of ["fold-instructions", "fold-summary", "fold-insights", "pack", "leashes", "autopilot", "fold-positions"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success(c.action === "pause" ? "Paused" : c.action === "resume" ? "Running again" : c.action === "stop" ? (c.label === "Revoke" ? "Key stopped" : "Stopped") : "Cancelled", { description: i.name, from: "LYKO" });
      const tx = (r as { transaction?: UnsignedTransaction | null } | null)?.transaction;
      if (c.sign === "revoke-session" && tx) {
        if (!wallet.connected) openModal();
        else await wallet.send([{ to: tx.to, data: tx.data, value: tx.value, chainId: tx.chainId }]);
      }
    } catch (e) {
      toast.error("No change", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };
  const cancelOrderRow = (i: FoldInstruction) => {
    if (!i.cancel) return;
    if (owner.sample) {
      toast.info("This is the sample flock", { description: "Connect a wallet to cancel your own orders.", from: "LYKO" });
      return;
    }
    if (needWallet()) return;
    setCancelling({ hash: i.cancel.hash, name: i.name, environment: i.cancel.environment });
  };
  const revokeAgent = async (a: PackAgentView) => {
    if (needWallet()) return;
    setBusyId(a.id);
    try {
      await apiPost(`/v1/pack/${encodeURIComponent(a.id)}/revoke`, {});
      for (const k of ["pack", "leashes", "fold-instructions", "fold-summary"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.success(`${a.name} is off its leash for good`, { description: "Its budget returns to you.", from: "LYKO" });
    } catch (e) {
      toast.error("Not revoked", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusyId(null);
    }
  };
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
    <LykoOnWatch variant={variant} owner={owner} insights={insights.data} loading={insights.isLoading} instructions={instructionList} snapshot={snapshot} minHealth={minHealth} busy={draft.isPending} onDraft={onInsight} onOpenInAsk={openInAsk} onOpenHerding={() => { setWatchSheet(false); go("herding"); }} />
  );

  return (
    <div className="fd">
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
              <div className="fd-tabhead__row">
                <h2>
                  {meta.label} <span>{`· ${meta.sub}`}</span>
                </h2>
                <HowItWorks area={effectiveTab as HelpArea} />
              </div>
              <p>{meta.line}</p>
            </div>
          ) : null}

          <div className="fd-panel" role="tabpanel" aria-label={meta ? `${meta.label} · ${meta.sub}` : "Lyko on watch"}>
            {effectiveTab === "flock" ? <FlockTab snapshot={snapshot} map={positions} minHealth={minHealth} signedIn={owner.signedIn} onSignIn={() => void siwe.signIn()} onAction={onPosition} onAskAbout={onAskAbout} onAsk={(t) => openInAsk(t, "A Stress test question from the Fold.")} busy={draft.isPending} openWhatIf={whatifOpen} /> : null}
            {effectiveTab === "trails" ? <TrailsTab now={mountedAt} items={trailItems} totals={trailTotals} onAskWhy={(question, context) => { carry(context); void useAsk.getState().send(question, { environment: owner.environment, ...(owner.address ? { owner: owner.address as `0x${string}` } : {}), origin: "fold" }); if (phone) setWatchSheet(true); }} explain={explain.data} explainLoading={explain.isLoading} sample={owner.sample} signedIn={owner.signedIn} onSignIn={() => void siwe.signIn()} /> : null}
            {newcomer && (effectiveTab === "herding" || effectiveTab === "pack" || effectiveTab === "fence") ? <NewcomerCard tab={effectiveTab} onAsk={(text) => openInAsk(text, `Started from the Fold's ${effectiveTab} tab.`)} /> : null}
            {effectiveTab === "herding" && !newcomer ? <HerdingTab instructions={instructionList} waiting={waiting} sample={owner.sample} signedIn={owner.signedIn} initialFilter={show} onSignIn={() => void siwe.signIn()} onOpen={setOpenDraft} onStop={(p) => void stopP(p)} onControl={(i) => void runControl(i)} onChange={(i) => openInAsk(i.editSentence, `Running item ${i.id}: ${i.name} (${i.trigger}; ${i.status}; next ${i.nextRunLabel}).`)} onAsk={() => openInAsk("", "Something new from Herding.")} busyId={busyId} /> : null}
            {effectiveTab === "pack" && !newcomer ? <AutopilotSection owner={owner} onAsk={openInAsk} /> : null}
            {effectiveTab === "pack" && !newcomer ? <LeashSection owner={owner} agents={pack.data?.agents} busyId={busyId} onPauseAgent={(a) => void whistleAgent(a)} onRevokeAgent={(a) => void revokeAgent(a)} onAsk={openInAsk} /> : null}
            {effectiveTab === "fence" ? <FenceTab newcomer={newcomer} fence={fence} owner={owner} view={fenceView.data} headroom={room} beta={betaCap} verdicts={trailItems ?? []} onSuggest={onFenceSuggest} onAsk={() => openInAsk("Change my Fence: ", "A Fence edit from the Fold.")} onWhistle={whistleAll} busy={draft.isPending} /> : null}
            {effectiveTab === "lyko" ? panel("tab") : null}
          </div>
        </div>
        {!phone ? <div className="fd__side">{panel("dock")}</div> : null}
      </div>

      {phone && effectiveTab !== "lyko" ? (
        <div className="fd-askbar">
          <button type="button" className="fd-askbar__btn" onClick={() => setWatchSheet(true)} aria-haspopup="dialog">
            <LykoFace mood={badge > 0 ? "alert" : "happy"} scale={1.4} />
            <span className="fd-askbar__t"><b>{"Lyko on watch"}</b><small>{badge > 0 ? `noticed ${badge} thing${badge === 1 ? "" : "s"} · tap to act` : "ask about anything here"}</small></span>
            {badge > 0 ? <span className="fd-badge">{badge}</span> : null}
          </button>
        </div>
      ) : null}

      {phone ? (
        <Sheet open={watchSheet && effectiveTab !== "lyko"} onClose={() => setWatchSheet(false)} title="Lyko on watch" className="fd-watchsheet">
          {panel("tab")}
        </Sheet>
      ) : null}
      <DraftSheet proposal={openDraft} onClose={() => setOpenDraft(null)} onMove={moveP} />
      <WhistleSheet open={whistleOpen} onClose={() => setWhistleOpen(false)} state={wh.state.data} busyId={busyId} onResume={(i) => void resumeOne(i)} onResumeAll={resumeAll} />
      {cancelling ? <CancelOrderModal key={cancelling.hash} order={cancelling} open onClose={() => setCancelling(null)} /> : null}
      {owner.address && !owner.signedIn && !owner.sample ? (
        <div className="fd-signin m-wrap m-wrap--wide">
          <span className="m-small">{"Reading this address in public. Sign in as its owner to see instructions, trails and drafts, and to act."}</span>
          <Button size="sm" onClick={() => void siwe.signIn()} disabled={siwe.busy || !owner.own}>{owner.own ? "SIGN IN" : "NOT YOUR WALLET"}</Button>
        </div>
      ) : null}
    </div>
  );
}
