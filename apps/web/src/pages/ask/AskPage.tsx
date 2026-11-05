/**
 * Ask Lyko: the conversation. The landing composer morphs into the dock
 * here, the bay shrinks into the scene strip, the first question lands as
 * the first bubble, and a proposal slides the route artifact in.
 */
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import type { ThreadView } from "@lykia/core/api/agents";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { navigate } from "../../app/routes/history";
import { Link } from "../../app/routes/Link";
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
import { apiGet } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useLamp } from "../../lib/pulseStore";
import { Button, LykoFace, MosaicCanvas, Tag, cx } from "../../mosaic";
import { strip, STRIP_H, STRIP_W } from "../../mosaic/scenes";
import { handleLine } from "../../shell/palette";
import { useSession } from "../../lib/session";
import type { ThreadSummaryView } from "@lykia/core/api/fold";
import { mergeThreads } from "../../features/fold/model";

const SAMPLE_OWNER = "0x000000000000000000000000000000000000dEaD" as const;

/** Quick actions: each drops an intent into the composer for you to finish. Nothing is sent until you press PLAN IT. */
const QUICK = [
  { en: "Pay someone", q: "Pay 250 USDC to ", kick: "ARC MEMO · ONE TX", hint: "Name, address or @contact, an amount, a note" },
  { en: "Put idle USDC to work", q: "Put my idle USDC to work at low risk", kick: "EARN · MORPHO · AAVE V4", hint: "Keeps your liquidity floor in the wallet" },
  { en: "Hedge into EUR", q: "Convert 200 USDC to EURC", kick: "FX · STABLEFX · BAND", hint: "Inside your Fence's FX band" },
  { en: "Set a rule", q: "Every Friday at 17:00, pay ", kick: "HERDING · ROUNDS · ORDERS", hint: "Schedules, price triggers, alerts" },
  { en: "New agent", q: "Create a payroll agent with a 500 USDC daily budget", kick: "PACK · FENCE · TAG", hint: "A budget carved from yours" },
] as const;

export default function AskPage() {
  const environment = useEnvironment();
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

  // Without a wallet Lyko plans dry runs for a sample address, and says so.
  const ctx = useMemo(() => ({ environment, fence, owner: address ?? SAMPLE_OWNER }), [environment, fence, address]);

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
    if (convo.threadId && convo.threadId !== threadParam) navigate(`/app/ask/${encodeURIComponent(convo.threadId)}`, { replace: true });
  }, [convo.threadId, threadParam]);

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
  };
  const empty = convo.messages.length === 0 && !serverThread.data;
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
          {convo.mode ? <Tag tone={convo.mode === "llm" ? "ok" : "ghost"}>{convo.mode === "llm" ? "LYKO · AI ON" : "READER MODE · NO AI KEY"}</Tag> : null}
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
              <div className="m-center m-ask-empty">
                <LykoFace mood="happy" scale={3} className="mx-auto" />
                <h1 className="m-title">{"What should your money do?"}</h1>
                <p className="m-sub">{"Say the outcome in one sentence. Lykia plans it across Arc protocols and Circle rails, your Fence (your spending rules) checks every step, and you sign once."}</p>
                <div className="m-starters m-starters--quick" role="list" aria-label="Quick actions">
                  {QUICK.map((s) => (
                    <button key={s.en} type="button" role="listitem" className="m-starter" onClick={() => setPrefill(s.q)}>
                      <span className="m-kick">{s.kick}</span>
                      <b>{s.en}</b>
                      <span className="m-small m-muted">{s.hint}</span>
                    </button>
                  ))}
                </div>
                <p className="m-small m-muted" style={{ marginTop: 14 }}>
                  {"Everything you own and everything in motion lives in "}<Link to="/app/fold">{"The Fold"}</Link>{"; Lyko on watch keeps an eye on it there."}
                </p>
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
          </div>
        </div>
        <div className="m-convo__dock">
          <div className="m-convo__col">
            <Composer onSubmit={ask} busy={status === "streaming"} onStop={stop} autoFocus memoryChips prefill={prefill} />
            <p className="m-kick m-center" style={{ marginTop: 8 }}>{address ? ("LYKO ONLY PROPOSES · YOUR WALLET SIGNS") : "NO WALLET · DRY RUNS FOR A SAMPLE ADDRESS · CONNECT TO PLAN YOURS"}</p>
          </div>
        </div>
      </section>

      {showArtifact && proposal ? (
        <aside className="m-artifact" aria-label="Route">
          <RouteArtifact proposal={proposal} intentId={proposal.intentId} onClose={() => { setArtifactClosed(artifactKey); setPicked(null); }} />
        </aside>
      ) : null}
    </div>
    </ChatActionsContext.Provider>
  );
}
