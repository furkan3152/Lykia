/**
 * Ask Lyko: the conversation. The landing composer morphs into the dock
 * here, the bay shrinks into the scene strip, the first question lands as
 * the first bubble, and a proposal slides the route artifact in.
 */
import type { ThreadView } from "@lykia/core/api/agents";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { useRouteParam } from "../../app/routes/useRoute";
import { Composer } from "../../features/ask/Composer";
import { memoryBadges } from "../../features/ask/memoryRefs";
import { latestProposal, type ChatMessage } from "../../features/ask/model";
import { useAsk } from "../../features/ask/store";
import { RouteArtifact } from "../../features/route/RouteArtifact";
import { apiGet } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLang } from "../../lib/i18n";
import { useLykiaStore } from "../../lib/lykiaStore";
import { useLamp } from "../../lib/pulseStore";
import { Button, LykoFace, LykoTile, MosaicCanvas, Seal, Tag, cx } from "../../mosaic";
import { strip, STRIP_H, STRIP_W } from "../../mosaic/scenes";
import { handleLine } from "../../shell/palette";

const SAMPLE_OWNER = "0x000000000000000000000000000000000000dEaD" as const;

const STARTERS = [
  { en: "Greener pasture", tr: "Daha yeşil mera", q: { en: "Put half my USDC to work", tr: "Maaş için 5000 USDC tut, kalanını en iyi getiriye koy" }, kick: "EARN · MORPHO · AAVE V4" },
  { en: "Pay with a memo", tr: "Memo ile öde", q: { en: "Send 250 EURC to 0x4100000000000000000000000000000000009e for invoice 12", tr: "0x4100000000000000000000000000000000009e adresine fatura 12 için 250 EURC gönder" }, kick: "ARC MEMO · ONE TX" },
  { en: "Hedge into EURC", tr: "EURC'ye korun", q: { en: "Convert 200 USDC to EURC", tr: "200 USDC'yi EURC'ye çevir" }, kick: "FX · CHAINLINK BAND" },
  { en: "Bridge to Base", tr: "Base'e köprüle", q: { en: "Bridge 50 USDC to Base", tr: "50 USDC'yi Base'e köprüle" }, kick: "CCTP V2 · FAST" },
] as const;

function Bubble({ m, first, lang }: { m: ChatMessage; first: boolean; lang: "en" | "tr" }) {
  if (m.role === "user")
    return (
      <div className="m-msg m-msg--user">
        <div className={cx("m-bubble", first && "vt-first")}>{m.text}</div>
      </div>
    );
  return (
    <div className="m-msg">
      <div className="m-msg__who">
        <LykoTile mood={m.error ? "growling" : m.streaming ? "herding" : m.proposals.some((p) => p.decision === "deny") ? "alert" : "happy"} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
        {m.trail.length > 0 ? (
          <div className="m-trail">
            {m.trail.map((t, i) => (
              <span key={i} data-ok={t.ok}>
                {t.ok ? "✓" : "✕"} {t.label}
              </span>
            ))}
          </div>
        ) : null}
        {m.text || m.streaming ? <div className={cx("m-bubble", m.streaming && "m-caret")}>{m.text || (lang === "tr" ? "Lyko sürüyü sayıyor…" : "Lyko is counting the flock…")}</div> : null}
        {m.error ? <p className="m-note m-note--bad">{m.error}</p> : null}
        {m.proposals.map((p, i) => (
          <div key={i} className="m-frame m-frame--thin" style={{ padding: 12, animation: "m-msg-in 400ms both" }}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <b style={{ fontFamily: "Pixelify Sans", fontSize: 18 }}>{p.title}</b>
              <Seal decision={p.decision} />
            </div>
            {memoryBadges(p).length > 0 ? <div className="flex gap-1 flex-wrap" style={{ marginTop: 6 }}>{memoryBadges(p).map((b) => <Tag key={b} tone="sea">FROM MEMORY · {b}</Tag>)}</div> : null}
            <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 14 }}>
              {p.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AskPage() {
  const lang = useLang();
  const environment = useEnvironment();
  const { address } = useAccount();
  const fence = useLykiaStore((s) => s.fence);
  const night = fence.mode === "whistle";
  const lit = useLamp();
  const threadParam = useRouteParam("threadId");
  const { convo, status, threads, send, stop, fresh, openThread, takePending } = useAsk();
  const [railOpen, setRailOpen] = useState(false);
  const [artifactClosed, setArtifactClosed] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);

  // Without a wallet Lyko plans dry runs for a sample address, and says so.
  const ctx = useMemo(() => ({ environment, fence, owner: address ?? SAMPLE_OWNER }), [environment, fence, address]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const pending = takePending();
    if (pending) {
      if (threadParam) openThread(threadParam);
      void send(pending, ctx);
    } else if (threadParam) openThread(threadParam);
  }, [takePending, send, ctx, threadParam, openThread]);

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

  const proposal = latestProposal(convo);
  const artifactKey = proposal ? `${proposal.intentId ?? proposal.title}` : null;
  const showArtifact = Boolean(proposal && artifactKey !== artifactClosed);
  const ask = (text: string) => {
    if (handleLine(text, lang)) return;
    useAsk.getState().takePending();
    void send(text, ctx);
  };
  const empty = convo.messages.length === 0 && !serverThread.data;
  const firstUser = convo.messages.findIndex((m) => m.role === "user");

  return (
    <div className={cx("m-chat", showArtifact && "m-chat--artifact")}>
      <aside className="m-rail" data-open={railOpen}>
        <div className="m-rail__head">
          <Button onClick={() => { fresh(); navigate("/app"); setRailOpen(false); }}>
            + {lang === "tr" ? "YENİ OUTRUN" : "NEW OUTRUN"}
          </Button>
          <span className="m-kick">{lang === "tr" ? "KONUŞMALAR" : "THREADS"} · {threads.length}</span>
        </div>
        <div className="m-rail__list">
          {threads.length === 0 ? <p className="m-small m-muted" style={{ padding: 10 }}>{lang === "tr" ? "Henüz konuşma yok. Lyko'ya bir şey sor." : "No threads yet. Ask Lyko anything."}</p> : null}
          {threads.map((t) => (
            <button key={t.id} type="button" className="m-thread" aria-current={t.id === convo.threadId} onClick={() => { openThread(t.id); navigate(`/app/ask/${encodeURIComponent(t.id)}`); setRailOpen(false); }}>
              {t.title}
              <small>{new Date(t.at).toLocaleString()}</small>
            </button>
          ))}
        </div>
        <div style={{ padding: 14, borderTop: "2px dashed var(--grout)", display: "grid", gap: 6 }}>
          <span className="m-kick">{lang === "tr" ? "ÇİT" : "FENCE"} · {fence.label?.toUpperCase() ?? "CUSTOM"} · {(fence.mode ?? "live").toUpperCase()}</span>
          <span className="m-kick">{environment === "mainnet" ? "ARC MAINNET 5042" : "ARC TESTNET 5042002"}</span>
          {convo.mode ? <Tag tone={convo.mode === "llm" ? "ok" : "ghost"}>{convo.mode === "llm" ? "LYKO + CLAUDE" : lang === "tr" ? "OKUYUCU MODU · AI ANAHTARI YOK" : "READER MODE · NO AI KEY"}</Tag> : null}
        </div>
      </aside>

      <section className="m-convo">
        <div className="m-convo__scene">
          <div className="flex items-center gap-2">
            <button type="button" className="m-btn m-btn--ghost m-btn--sm md:hidden" onClick={() => setRailOpen((o) => !o)} aria-label="Threads">
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
              <div className="m-center" style={{ padding: "32px 0 8px" }}>
                <LykoFace mood="happy" scale={4} className="mx-auto" />
                <h1 className="m-title" style={{ fontSize: 44, marginTop: 12 }}>{lang === "tr" ? "Nereye güdelim?" : "Where to, shepherd?"}</h1>
                <p className="m-sub">{lang === "tr" ? "Bir cümle yaz. Lyko ve yavruları Arc üzerinde planlar, Çit karar verir, sen tek imza atarsın." : "Write one sentence. Lyko and his pups plan it across Arc, the Fence decides, you sign once."}</p>
                <div className="m-grid-2" style={{ marginTop: 24, textAlign: "left" }}>
                  {STARTERS.map((s) => (
                    <button key={s.en} type="button" className="m-frame m-frame--thin" style={{ padding: 14, cursor: "pointer", textAlign: "left" }} onClick={() => ask(s.q[lang])}>
                      <span className="m-kick">{s.kick}</span>
                      <b style={{ display: "block", fontFamily: "Pixelify Sans", fontSize: 20, marginTop: 4 }}>{lang === "tr" ? s.tr : s.en}</b>
                      <span className="m-small m-muted">{s.q[lang]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {serverThread.data && convo.messages.length === 0
              ? serverThread.data.messages.map((m, i) => (
                  <Bubble key={i} lang={lang} first={false} m={{ id: String(i), role: m.role, text: m.text, trail: [], proposals: m.proposals ?? [], clarify: null, streaming: false }} />
                ))
              : null}
            {convo.messages.map((m, i) => (
              <div key={m.id}>
                <Bubble m={m} first={i === firstUser} lang={lang} />
                {m.clarify ? (
                  <div className="m-chips" style={{ justifyContent: "flex-start", marginLeft: 52 }}>
                    <span className="m-small m-muted" style={{ width: "100%" }}>{m.clarify.question}</span>
                    {m.clarify.options.map((o) => (
                      <button key={o} type="button" className="m-chip" onClick={() => ask(o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="m-convo__dock">
          <div className="m-convo__col">
            <Composer onSubmit={ask} busy={status === "streaming"} onStop={stop} autoFocus memoryChips />
            <p className="m-kick m-center" style={{ marginTop: 8 }}>{address ? (lang === "tr" ? "LYKO SADECE ÖNERİR · İMZA SENİN CÜZDANINDA" : "LYKO ONLY PROPOSES · YOUR WALLET SIGNS") : lang === "tr" ? "CÜZDAN YOK · ÖRNEK BİR ADRES İÇİN DENEME PLANI" : "NO WALLET · DRY RUNS FOR A SAMPLE ADDRESS · CONNECT TO PLAN YOURS"}</p>
          </div>
        </div>
      </section>

      {showArtifact && proposal ? (
        <aside className="m-artifact" aria-label="Route">
          <RouteArtifact proposal={proposal} intentId={proposal.intentId} onClose={() => setArtifactClosed(artifactKey)} />
        </aside>
      ) : null}
    </div>
  );
}
