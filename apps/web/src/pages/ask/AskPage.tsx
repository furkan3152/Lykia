/**
 * Ask Lyko: the conversation. The landing composer morphs into the dock
 * here, the bay shrinks into the scene strip, the first question lands as
 * the first bubble, and a proposal slides the route artifact in. "Review
 * and sign" opens the review modal over the conversation; the old review
 * route (/app/outrun/:id) renders this page with that modal open.
 */
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import type { ThreadView } from "@lykia/core/api/agents";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { mediaMatches, subscribeMedia } from "../../app/state/media";

import { navigate } from "../../app/routes/history";
import { useUiStore } from "../../app/state/uiStore";
import { useRouteParam } from "../../app/routes/useRoute";
import { Composer } from "../../features/ask/Composer";
import { clarifyAction } from "../../features/ask/clarify";
import { askMessages, latestProposal, storedMessage } from "../../features/ask/model";
import { AssistantMessage, UserMessage } from "../../features/ask/Answer";
import { ChatActionsContext, type ChatActions } from "../../features/ask/actions";
import type { AgentProposal } from "@lykia/core/api/agents";
import { useAsk } from "../../features/ask/store";
import { RouteArtifact } from "../../features/route/RouteArtifact";
import { ReviewModal } from "../../features/route/ReviewModal";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useLamp } from "../../lib/pulseStore";
import { Button, LykoFace, MosaicCanvas, cx, toast } from "../../mosaic";
import { strip, STRIP_H, STRIP_W } from "../../mosaic/scenes";
import { handleLine } from "../../shell/palette";
import { useSession } from "../../lib/session";
import type { ThreadSummaryView } from "@lykia/core/api/fold";
import { mergeThreads } from "../../features/fold/model";
import { NextStepBar, StarterChips, StarterGrid } from "../../features/ask/Starters";
import { ASK_STARTERS, DO_STARTERS, followUps, nextStep, type Starter } from "../../features/ask/starters";

const PHONE = "(max-width: 640px)";
/** True on phone widths: Ask then becomes a plain chat, the box at the bottom. */
function usePhone(): boolean {
  return useSyncExternalStore((cb) => subscribeMedia(PHONE, cb), () => mediaMatches(PHONE) === true, () => false);
}

const SAMPLE_OWNER = "0x000000000000000000000000000000000000dEaD" as const;

export default function AskPage({ reviewId = null }: { readonly reviewId?: string | null } = {}) {
  const environment = useEnvironment();
  const qc = useQueryClient();
  const { address } = useLykiaWallet();
  const fence = useLykiaStore((s) => s.fence);
  const night = fence.mode === "whistle";
  const lit = useLamp();
  const threadParam = useRouteParam("threadId");
  const { convo, status, threads: localThreads, send, stop, fresh, openThread, takePending, prefill, setPrefill } = useAsk();
  const session = useSession((st) => st.session);
  const signedIn = Boolean(session && address && session.address.toLowerCase() === address.toLowerCase());
  const serverThreads = useQuery({ queryKey: ["me-threads", session?.address, convo.threadId], enabled: signedIn, retry: false, staleTime: 15_000, queryFn: ({ signal }) => apiGet<{ threads: ThreadSummaryView[] }>("/v1/me/threads", { signal }) });
  const threads = useMemo(() => mergeThreads(localThreads, serverThreads.data?.threads ?? []), [localThreads, serverThreads.data]);
  const [railOpen, setRailOpen] = useState(false);
  const [artifactClosed, setArtifactClosed] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);

  // Without a wallet Lyko plans dry runs for a sample address, and says so. The Fence is the server's: never sent from here.
  const ctx = useMemo(() => ({ environment, owner: address ?? SAMPLE_OWNER }), [environment, address]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // /app?intent=…: an old page or a quick action asked for this; fill the composer, never send on its own.
    const intent = new URLSearchParams(window.location.search).get("intent");
    if (intent) {
      setPrefill(intent.slice(0, 400));
      navigate(window.location.pathname, { replace: true });
    }
    const pending = takePending();
    if (pending) {
      if (threadParam) openThread(threadParam);
      void send(pending, ctx);
    } else if (threadParam) openThread(threadParam);
  }, [takePending, send, ctx, threadParam, openThread, setPrefill]);

  // Questions asked from ⌘K while already here.
  const pendingLive = useAsk((s) => s.pending);
  useEffect(() => {
    if (!pendingLive || !started.current) return;
    const p = takePending();
    if (p) void send(p, ctx);
  }, [pendingLive, takePending, send, ctx]);

  // Keep the URL on the thread once the server names it.
  useEffect(() => {
    // Not while the old review route shows its modal: moving the URL would close it.
    if (reviewId) return;
    if (convo.threadId && convo.threadId !== threadParam) navigate(`/app/ask/${encodeURIComponent(convo.threadId)}`, { replace: true });
  }, [convo.threadId, threadParam, reviewId]);

  const serverThread = useQuery({
    queryKey: ["thread", convo.threadId, address],
    enabled: Boolean(convo.threadId && address && convo.messages.length === 0),
    queryFn: ({ signal }) => apiGet<ThreadView>(`/v1/agent/threads/${encodeURIComponent(convo.threadId!)}`, { query: { owner: address }, signal }),
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The empty state reads from the top; only a running conversation follows the newest message.
    if (convo.messages.length === 0) el.scrollTo({ top: 0 });
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [convo.messages]);

  const [picked, setPicked] = useState<AgentProposal | null>(null);
  // The review modal: opened from a plan card, the route panel, or the old review route.
  const [review, setReview] = useState<{ readonly intentId: string; readonly proposal: AgentProposal | null } | null>(() => (reviewId ? { intentId: reviewId, proposal: null } : null));
  const closeReview = () => {
    setReview(null);
    if (reviewId) navigate("/app", { replace: true });
  };
  const proposal = picked ?? latestProposal(convo);
  const artifactKey = proposal ? `${proposal.intentId ?? proposal.title}` : null;
  // The route panel opens only when asked ("Open the route"): the plan card is enough to act on.
  const showArtifact = Boolean(picked && proposal && artifactKey !== artifactClosed);
  const setMode = useUiStore((st) => st.setMode);
  const choose = (option: string) => {
    const action = clarifyAction(option);
    if (action.kind === "owner") return navigate("/letoon");
    if (action.kind === "mainnet") {
      setMode("mainnet");
      useAsk.getState().takePending();
      // The network toggle follows; this one question is planned on mainnet right away.
      void send(action.sentence, { ...ctx, environment: "mainnet" });
      return;
    }
    ask(action.text);
  };
  const ask = (text: string) => {
    if (handleLine(text)) return;
    useAsk.getState().takePending();
    void send(text, { ...ctx, origin: "ask" });
  };
  const lastUser = [...convo.messages].reverse().find((m) => m.role === "user")?.text ?? null;
  const actions: ChatActions = {
    environment,
    prefill: (text) => setPrefill(text),
    ask,
    retry: lastUser && status !== "streaming" ? () => ask(lastUser) : undefined,
    openRoute: (p) => {
      setPicked(p);
      setArtifactClosed(null);
    },
    openReview: (p) => {
      if (p.intentId) setReview({ intentId: p.intentId, proposal: p });
    },
    stopPlan: async (intentId) => {
      try {
        await apiPost(`/v1/intents/${encodeURIComponent(intentId)}/stop`, {});
        await qc.invalidateQueries({ queryKey: ["intent", intentId] });
      } catch (error) {
        toast.error("The plan could not be stopped", { description: describeError(error), from: "LYKO" });
      }
    },
    // Hand-offs are the owner's own: only offered once the wallet is signed in.
    ...(signedIn && address
      ? {
          watchPosition: async (intentId: string) => {
            await apiPost("/v1/agent/instructions", { owner: address, environment, kind: "watch", from: "ask", to: "watch", intentId, ...(convo.threadId ? { threadId: convo.threadId } : {}) });
            await qc.invalidateQueries({ queryKey: ["fold-instructions"] });
            toast.success("Lyko on watch has it", { description: "It shows in the Fold under Herding, marked From Ask Lyko.", from: "LYKO" });
          },
        }
      : {}),
  };
  // What Lyko on watch said about the Fold's sample flock stays in the Fold.
  const shown = askMessages(convo);
  const empty = shown.length === 0 && !serverThread.data;
  // A starter either asks at once or fills the composer with its blanks selected.
  const pick = (st: Starter) => (st.kind === "ask" ? ask(st.text) : setPrefill(st.text));
  const lastAnswer = [...convo.messages].reverse().find((m) => m.role === "assistant") ?? null;
  // History phrases ("again", "same as last week") only mean something inside a thread with a history, and only
  // while the box is empty; never beside an open question, which is the one thing to answer.
  const asking = Boolean(lastAnswer && status !== "streaming" && nextStep(lastAnswer).kind === "choose");
  const hasHistory = convo.messages.length > 0 && !asking;
  // One short line, sentence case: long notes in pixel caps wrap into two lines on a phone.
  const walletLine = address ? "Lyko only proposes · your wallet signs" : "Sample mode · connect to plan yours";
  const walletBadge = address ? "YOU SIGN" : "SAMPLE MODE";
  const threadTitle = threads.find((t) => t.id === convo.threadId)?.title ?? (lastUser || null);
  const small = usePhone();
  const docked = !empty || small;
  const composer = <Composer onSubmit={ask} busy={status === "streaming"} onStop={stop} autoFocus={!small} memoryChips={hasHistory && !small} prefill={prefill} hints {...(docked ? { className: "m-composer--dock", placeholder: empty ? "Say what your money should do…" : "Reply, or ask something new…" } : {})} />;
  // Phones: suggestions sit as small chips right above the box.
  const smallChips: readonly Starter[] = !small || status === "streaming"
    ? []
    : empty
      ? [...DO_STARTERS, ...ASK_STARTERS]
      : lastAnswer && nextStep(lastAnswer).kind !== "choose" ? followUps(lastAnswer) : [];
  const firstUser = shown.findIndex((m) => m.role === "user");

  return (
    <ChatActionsContext.Provider value={actions}>
    <div className={cx("m-chat", showArtifact && "m-chat--artifact")}>
      <aside className="m-rail" data-open={railOpen}>
        <div className="m-rail__head">
          <Button onClick={() => { fresh(); navigate("/app"); setRailOpen(false); }}>
            + {"NEW PLAN"}
          </Button>
          <span className="m-kick">{"THREADS"} · {threads.length}</span>
        </div>
        <div className="m-rail__list">
          {threads.length === 0 ? <p className="m-small m-muted" style={{ padding: 10 }}>{"No threads yet. Ask Lyko anything."}</p> : null}
          {threads.map((t) => (
            <button key={t.id} type="button" className="m-thread" aria-current={t.id === convo.threadId} onClick={() => { openThread(t.id); navigate(`/app/ask/${encodeURIComponent(t.id)}`); setRailOpen(false); }}>
              {t.title}
              <small>{t.origin === "fold" ? "FROM THE FOLD · " : ""}{new Date(t.at).toLocaleString()}</small>
            </button>
          ))}
        </div>
        {/* One small line: which rules and which network Lyko plans under. */}
        <p className="m-rail__foot" title={convo.mode === "reader" ? "Reader mode: Lyko answers in simple sentences without the AI model." : undefined}>
          {`Fence: ${fence.label ?? "custom"}${fence.mode && fence.mode !== "live" ? ` (${fence.mode === "dry-run" ? "practice" : fence.mode})` : ""} · Arc ${environment}`}
        </p>
      </aside>

      <section className="m-convo">
        {/* Narrow screens: the threads button, the thread's name and the mode, in one slim row. */}
        <div className="m-convo__top">
          <button type="button" className="m-btn m-btn--ghost m-btn--sm m-railbtn" onClick={() => setRailOpen((o) => !o)} aria-label="Threads" aria-expanded={railOpen}>
            ☰
          </button>
          <span className="m-convo__title">{empty ? "New plan" : (threadTitle ?? "This thread")}</span>
          <span className="m-askbadge" data-tone={address ? "ok" : "sample"} title={walletLine}>{walletBadge}</span>
        </div>
        <div className="m-convo__scroll" ref={scrollRef}>
          {/* The bay scrolls with the conversation: it never sits over a message. */}
          <div className="m-convo__scene" data-slim={empty ? undefined : true}>
            <div className="vt-scene m-frame m-frame--thin">
              <MosaicCanvas build={(t) => strip({ lit, night, running: status === "streaming" }, t)} width={STRIP_W} height={STRIP_H} tile={4} fps={10} dataKey={`${lit}-${status}-${night}`} assembleKey="strip" label="The bay, folded into a strip; Lyko runs while he works" />
            </div>
          </div>
          <div className="m-convo__col">
            {empty ? (
              <div className="m-ask-empty m-ask-hero">
                <div className="m-ask-hero__head">
                  <LykoFace mood="happy" scale={small ? 2 : 2.4} />
                  <div>
                    <h1 className="m-title">{"What should your money do?"}</h1>
                    {small ? <p className="m-sub">{"Pick one below or type it. You sign once."}</p> : <p className="m-sub">{"Say it in one sentence. Lyko plans it across Arc and Circle rails, your Fence checks every step, and you sign once."}</p>}
                  </div>
                </div>
                {small ? null : (
                  <>
                    {composer}
                    <StarterGrid onPick={pick} />
                    <p className="m-asknote m-ask-hero__foot">{walletLine}</p>
                  </>
                )}
              </div>
            ) : null}
            {serverThread.data && convo.messages.length === 0
              ? serverThread.data.messages.map((m, i) =>
                  m.role === "user" ? (
                    <UserMessage key={i} text={m.text} />
                  ) : (
                    <AssistantMessage key={i} m={storedMessage(m, String(i))} />
                  ),
                )
              : null}
            {shown.map((m, i) => (m.role === "user" ? <UserMessage key={m.id} text={m.text} morph={i === firstUser} /> : <AssistantMessage key={m.id} m={m} onChoose={choose} />))}
            {lastAnswer && status !== "streaming" ? <NextStepBar key={lastAnswer.id} m={lastAnswer} onPick={pick} chips={!small} /> : null}
          </div>
        </div>
        {docked ? (
          <div className="m-convo__dock">
            <div className="m-convo__col">
              <StarterChips items={smallChips} onPick={pick} />
              {composer}
              <p className="m-asknote m-convo__note">{walletLine}</p>
            </div>
          </div>
        ) : null}
      </section>

      {showArtifact && proposal ? (
        <aside className="m-artifact" aria-label="Route">
          <RouteArtifact proposal={proposal} intentId={proposal.intentId} onClose={() => { setArtifactClosed(artifactKey); setPicked(null); }} onReview={proposal.intentId ? () => setReview({ intentId: proposal.intentId!, proposal }) : undefined} />
        </aside>
      ) : null}
      {review ? (
        <ReviewModal
          key={review.intentId}
          intentId={review.intentId}
          proposal={review.proposal}
          open
          onClose={closeReview}
          askFix={(sentence) => { closeReview(); ask(sentence); }}
          {...(lastUser && status !== "streaming" ? { onReplan: () => { closeReview(); ask(lastUser); } } : {})}
        />
      ) : null}
    </div>
    </ChatActionsContext.Provider>
  );
}
