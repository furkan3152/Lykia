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
import { useEffect, useMemo, useRef, useState } from "react";

import { navigate } from "../../app/routes/history";
import { useUiStore } from "../../app/state/uiStore";
import { useRouteParam } from "../../app/routes/useRoute";
import { Composer } from "../../features/ask/Composer";
import { clarifyAction } from "../../features/ask/clarify";
import { latestProposal, storedMessage } from "../../features/ask/model";
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
import { Button, LykoFace, MosaicCanvas, Tag, cx, toast } from "../../mosaic";
import { strip, STRIP_H, STRIP_W } from "../../mosaic/scenes";
import { handleLine } from "../../shell/palette";
import { useSession } from "../../lib/session";
import type { ThreadSummaryView } from "@lykia/core/api/fold";
import { mergeThreads } from "../../features/fold/model";
import { HowItWorks } from "../../features/help/Help";
import { NextStepBar, StarterGrid } from "../../features/ask/Starters";
import type { Starter } from "../../features/ask/starters";

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
  // Where the route would cover the conversation (narrow screens), it opens only when asked ("Open the route").
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1100px)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(max-width: 1100px)");
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const showArtifact = Boolean(proposal && artifactKey !== artifactClosed && (!phone || picked));
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
  const empty = convo.messages.length === 0 && !serverThread.data;
  // A starter either asks at once or fills the composer with its blanks selected.
  const pick = (st: Starter) => (st.kind === "ask" ? ask(st.text) : setPrefill(st.text));
  // History phrases ("again", "same as last week") only mean something once there is a history.
  const hasHistory = threads.length > 0 || convo.messages.length > 0;
  const lastAnswer = [...convo.messages].reverse().find((m) => m.role === "assistant") ?? null;
  const walletLine = address ? "LYKO ONLY PROPOSES · YOUR WALLET SIGNS" : "NO WALLET · DRY RUNS FOR A SAMPLE ADDRESS · CONNECT TO PLAN YOURS";
  const composer = <Composer onSubmit={ask} busy={status === "streaming"} onStop={stop} autoFocus memoryChips={hasHistory} prefill={prefill} hints />;
  const firstUser = convo.messages.findIndex((m) => m.role === "user");

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
        <div style={{ padding: 14, borderTop: "2px dashed var(--grout)", display: "grid", gap: 6 }}>
          <span className="m-kick">{"FENCE"} · {fence.label?.toUpperCase() ?? "CUSTOM"} · {(fence.mode ?? "live").toUpperCase()}</span>
          <span className="m-kick">{environment === "mainnet" ? "ARC MAINNET 5042" : "ARC TESTNET 5042002"}</span>
          {convo.mode ? <Tag tone={convo.mode === "llm" ? "ok" : "ghost"}>{convo.mode === "llm" ? "LYKO · AI ON" : "READER MODE · SIMPLE SENTENCES"}</Tag> : null}
        </div>
      </aside>

      <section className="m-convo">
        <div className="m-convo__scene">
          <div className="flex items-center gap-2">
            <button type="button" className="m-btn m-btn--ghost m-btn--sm m-railbtn" onClick={() => setRailOpen((o) => !o)} aria-label="Threads">
              ☰
            </button>
            <div className="vt-scene m-frame m-frame--thin" style={{ flex: 1, padding: 0 }}>
              <MosaicCanvas build={(t) => strip({ lit, night, running: status === "streaming" }, t)} width={STRIP_W} height={STRIP_H} tile={4} fps={10} dataKey={`${lit}-${status}-${night}`} assembleKey="strip" label="The bay, folded into a strip; Lyko runs while he works" />
            </div>
          </div>
        </div>
        <div className="m-convo__scroll" ref={scrollRef}>
          <div className="m-convo__col">
            {empty ? (
              <div className="m-ask-empty m-ask-hero">
                <div className="m-ask-hero__head">
                  <LykoFace mood="happy" scale={2.4} />
                  <div>
                    <h1 className="m-title">{"What should your money do?"}</h1>
                    <p className="m-sub">{"Say it in one sentence. Lyko plans it across Arc and Circle rails, your Fence checks every step, and you sign once."}</p>
                  </div>
                </div>
                {composer}
                <StarterGrid onPick={pick} />
                <p className="m-kick m-center m-ask-hero__foot">{walletLine}</p>
                <HowItWorks area="ask" inAsk />
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
            {convo.messages.map((m, i) => (m.role === "user" ? <UserMessage key={m.id} text={m.text} morph={i === firstUser} /> : <AssistantMessage key={m.id} m={m} onChoose={choose} />))}
            {lastAnswer && status !== "streaming" ? <NextStepBar key={lastAnswer.id} m={lastAnswer} onPick={pick} /> : null}
          </div>
        </div>
        {empty ? null : (
          <div className="m-convo__dock">
            <div className="m-convo__col">
              {composer}
              <p className="m-kick m-center" style={{ marginTop: 8 }}>{walletLine}</p>
            </div>
          </div>
        )}
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
          {...(lastUser && status !== "streaming" ? { onReplan: () => { closeReview(); ask(lastUser); } } : {})}
        />
      ) : null}
    </div>
    </ChatActionsContext.Provider>
  );
}
