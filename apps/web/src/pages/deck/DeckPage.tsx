import { fenceHash, LYKO_LINES, type IntentGraph, type Outrun } from "@lykia/core";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useSearchParam } from "../../app/routes/useRoute";
import { moodFor, nextActionable } from "../../features/outrun/model";
import { OutrunCard } from "../../features/outrun/OutrunCard";
import { useIntentStream } from "../../features/outrun/useIntentStream";
import { useStepRunner } from "../../features/outrun/useStepRunner";
import { apiPost, describeError } from "../../lib/api";
import { resolveInput } from "../../lib/commands";
import { useEnvironment } from "../../lib/environment";
import { pick, useLang } from "../../lib/i18n";
import { useLykiaStore, whistleOn } from "../../lib/lykiaStore";
import { runCommand } from "../../lib/runCommand";
import type { CreateIntentResponse, ParseResponse } from "../../lib/types";
import { Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { LykoEmpty } from "../../pixel/LykoEmpty";
import { LykoLoader } from "../../pixel/LykoLoader";
import { Tag } from "../../ui/Badge";
import { Button, ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { toast } from "../../ui/toast";

/** Plans made without a wallet use this placeholder owner; they are dry runs and say so. */
const PREVIEW_OWNER = "0x000000000000000000000000000000000000dEaD";

const EXAMPLES = {
  en: ["put half my USDC to work", "convert 200 USDC to EURC", "send 25 USDC to 0x1111111111111111111111111111111111111111 for invoice 12", "bridge 50 USDC to base"],
  tr: ["USDC'min yarısını çalıştır", "200 USDC'yi EURC'ye çevir", "0x1111111111111111111111111111111111111111 adresine fatura 12 için 25 USDC gönder", "50 USDC'yi Base'e köprüle"],
} as const;

interface PlanResult {
  readonly parse: ParseResponse | null;
  readonly plan: CreateIntentResponse | null;
}

export default function DeckPage() {
  const lang = useLang();
  const environment = useEnvironment();
  const fence = useLykiaStore((s) => s.fence);
  const lastCommand = useLykiaStore((s) => s.lastCommand);
  const setLastOutrun = useLykiaStore((s) => s.setLastOutrun);
  const initial = useSearchParam("intent");
  const [text, setText] = useState(initial ?? "");
  const [graph, setGraph] = useState<IntentGraph | null>(null);
  const [outrun, setOutrun] = useState<Outrun | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [clarify, setClarify] = useState<readonly string[]>([]);
  const whistle = whistleOn(fence);
  const stream = useIntentStream(graph?.id ?? null);
  const liveGraph = stream.intent ?? graph;
  const liveOutrun = stream.outrun ?? outrun;
  const onOutrun = useCallback((next: Outrun) => setOutrun(next), []);
  const runner = useStepRunner(liveGraph?.id ?? null, environment, onOutrun);

  const planMutation = useMutation({
    mutationFn: async (sentence: string): Promise<PlanResult> => {
      const owner = runner.address ?? PREVIEW_OWNER;
      const parse = await apiPost<ParseResponse>("/v1/language/parse", { text: sentence, environment, owner }).catch(() => null);
      if (parse && parse.clarify.length > 0) return { parse, plan: null };
      const plan = await apiPost<CreateIntentResponse>("/v1/intents", { text: sentence, owner, environment, fence, signer: "wallet", dryRun: !runner.address });
      return { parse, plan };
    },
    onSuccess: ({ parse, plan }) => {
      setReply(parse?.reply ?? null);
      setClarify(parse?.clarify ?? []);
      if (plan) {
        setGraph(plan.intent);
        setOutrun(plan.outrun);
        if (plan.stored !== false) setLastOutrun(plan.intent.id);
      }
    },
  });

  const submit = (sentence: string) => {
    const resolution = resolveInput(sentence);
    switch (resolution.kind) {
      case "empty":
        return;
      case "command":
        runCommand(resolution.action);
        setText("");
        return;
      case "egg":
        if (resolution.href) navigate(resolution.href);
        else toast.info(resolution.line, { from: "LYKO", id: "egg", duration: 7000 });
        setText("");
        return;
      case "token":
        navigate(routeHref("scent", { token: resolution.address }));
        return;
      case "agent":
        navigate(routeHref("kunye", { agentId: resolution.agentId }));
        return;
      case "page":
        navigate(routeHref(resolution.destination));
        return;
      case "sentence":
        planMutation.mutate(resolution.text);
    }
  };

  // "?intent=" from the whistle box or the landing page plans once on arrival.
  const planned = useRef(false);
  useEffect(() => {
    if (initial && !planned.current) {
      planned.current = true;
      planMutation.mutate(initial);
    }
  }, [initial, planMutation]);

  // "walk up": prepare and sign the next ready step.
  const handled = useRef(0);
  useEffect(() => {
    if (!lastCommand || lastCommand.action !== "advance" || lastCommand.at === handled.current) return;
    handled.current = lastCommand.at;
    const next = nextActionable(liveOutrun);
    if (next && liveGraph?.verdict.signable) void runner.run(next, false);
  }, [lastCommand, liveOutrun, liveGraph, runner]);

  const mood = planMutation.isPending ? "herding" : moodFor({ whistle, graph: liveGraph, outrun: liveOutrun });
  // Once a plan exists, Lyko speaks for its state (a denied plan growls), not for the parsed sentence.
  const line = liveGraph && !planMutation.isPending ? pick(lang, LYKO_LINES[mood]) : reply ?? pick(lang, LYKO_LINES[mood]);

  return (
    <Page>
      <Section
        level={1}
        tag={lang === "tr" ? `Masa · ${environment === "mainnet" ? "Arc mainnet" : "Arc testnet"}` : `Deck · ${environment === "mainnet" ? "Arc mainnet" : "Arc testnet"}`}
        title={lang === "tr" ? "Bir sonuç söyle." : "Say an outcome."}
        lede={lang === "tr" ? "Lyko planlar, Çit karar verir, cüzdanın imzalar. Komutlar da çalışır: “come bye”, “lie down”, “walk up”." : "Lyko plans, the Fence decides, your wallet signs. Commands work too: “come bye”, “lie down”, “walk up”."}
      >
        <div className="mx-auto flex max-w-[860px] flex-col gap-6">
          <div className="flex items-end gap-4">
            <Lyko mood={mood} size={96} className="shrink-0" />
            <p className="relative flex-1 bg-card p-3 text-[15px] leading-snug text-ink px-frame-thin px-drop" aria-live="polite">
              {line}
            </p>
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit(text);
            }}
          >
            <label className="flex items-stretch bg-card px-frame px-drop">
              <span className="flex items-center bg-ink px-3 font-tag text-[11px] uppercase text-paper">{lang === "tr" ? "Söyle" : "Say"}</span>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={EXAMPLES[lang][0]}
                aria-label={lang === "tr" ? "Bir sonuç, komut ya da adres" : "An outcome, a command or an address"}
                className="min-w-0 flex-1 bg-transparent px-3 py-3.5 font-mono text-[15px] text-ink outline-none placeholder:text-ink-3"
              />
              <Button type="submit" className="m-1.5" disabled={planMutation.isPending}>
                {lang === "tr" ? "Planla" : "Plan"} →
              </Button>
            </label>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES[lang].map((example) => (
                <button key={example} type="button" onClick={() => setText(example)} className={cx("max-w-full truncate bg-paper-2 px-2.5 py-1 font-mono text-[12px] text-ink-2 hover:text-ink px-frame-thin", FOCUS_RING)}>
                  {example}
                </button>
              ))}
            </div>
          </form>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            <Tag>
              {lang === "tr" ? "Çit" : "Fence"} · {fence.label ?? "custom"} · {(fence.mode ?? "live").toUpperCase()}
            </Tag>
            <span className="font-mono text-[11px] text-ink-3">{fenceHash(fence).slice(0, 18)}…</span>
            <ButtonLink to={routeHref("fence")} variant="ghost" size="sm">
              {lang === "tr" ? "Çiti düzenle" : "Edit the Fence"}
            </ButtonLink>
            <Button size="sm" variant={whistle ? "ink" : "danger"} onClick={() => runCommand(whistle ? "release" : "whistle")}>
              {whistle ? (lang === "tr" ? "Düdüğü bırak" : "Release the whistle") : lang === "tr" ? "Düdüğü çal" : "Blow the whistle"}
            </Button>
          </div>
          {!runner.connected ? <p className="font-tag text-[11px] uppercase text-warn-ink">{lang === "tr" ? "Cüzdan bağlı değil: planlar kuru çalışma (dry run) olarak gösterilir." : "No wallet connected: plans are shown as dry runs."}</p> : null}
        </div>
      </Section>

      <div className="mx-auto max-w-[860px] pb-16">
        {planMutation.isPending ? (
          <div className="flex justify-center py-10">
            <LykoLoader label={lang === "tr" ? "Lyko rotayı koşuyor" : "Lyko is running the outrun"} size="lg" />
          </div>
        ) : planMutation.isError ? (
          <div role="alert" className="flex flex-col items-center gap-3 bg-card p-6 text-center px-frame">
            <Lyko mood="alert" size={72} label={null} />
            <p className="font-display text-xl font-bold text-ink">{lang === "tr" ? "Plan yapılamadı" : "No plan this time"}</p>
            <p className="text-[14px] text-ink-2">{describeError(planMutation.error)}</p>
          </div>
        ) : clarify.length > 0 ? (
          <div className="flex flex-col gap-2 bg-card p-5 px-frame">
            <p className="font-display text-xl font-bold text-ink">{lang === "tr" ? "Lyko önce soruyor" : "Lyko asks first"}</p>
            <ul className="list-inside list-disc text-[14px] text-ink-2">
              {clarify.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        ) : liveGraph && liveOutrun ? (
          <OutrunCard outrun={liveOutrun} verdict={liveGraph.verdict} environment={environment} runs={runner.runs} onRun={(id, confirmed) => void runner.run(id, confirmed)} connected={runner.connected} whistle={whistle} />
        ) : (
          <LykoEmpty
            title={lang === "tr" ? "Patika boş" : "The trail is empty"}
            description={lang === "tr" ? "Yukarıya bir sonuç yaz. Lyko onu Arc protokolleri üzerinde bir Outrun'a çevirir." : "Write an outcome above. Lyko turns it into an Outrun across Arc venues."}
          />
        )}
      </div>
    </Page>
  );
}
