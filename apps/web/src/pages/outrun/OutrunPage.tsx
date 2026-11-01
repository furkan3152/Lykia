import type { IntentGraph, Outrun } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useRouteParam } from "../../app/routes/useRoute";
import { OutrunCard } from "../../features/outrun/OutrunCard";
import { useIntentStream } from "../../features/outrun/useIntentStream";
import { useStepRunner } from "../../features/outrun/useStepRunner";
import { apiGet, describeError } from "../../lib/api";
import { useLang } from "../../lib/i18n";
import { useLykiaStore, whistleOn } from "../../lib/lykiaStore";
import { Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { LykoLoader } from "../../pixel/LykoLoader";

export default function OutrunPage() {
  const lang = useLang();
  const id = useRouteParam("id") ?? null;
  const whistle = whistleOn(useLykiaStore((s) => s.fence));
  const graphQuery = useQuery({ queryKey: ["intent", id], enabled: id !== null, queryFn: ({ signal }) => apiGet<IntentGraph>(`/v1/intents/${encodeURIComponent(id!)}`, { signal }) });
  const outrunQuery = useQuery({ queryKey: ["outrun", id], enabled: id !== null, queryFn: ({ signal }) => apiGet<Outrun>(`/v1/intents/${encodeURIComponent(id!)}/outrun`, { signal }) });
  const stream = useIntentStream(id);
  const [pushed, setPushed] = useState<Outrun | null>(null);
  const onOutrun = useCallback((o: Outrun) => setPushed(o), []);
  const graph = stream.intent ?? graphQuery.data ?? null;
  const outrun = pushed ?? stream.outrun ?? outrunQuery.data ?? null;
  const runner = useStepRunner(id, graph?.environment ?? "testnet", onOutrun);
  return (
    <Page>
      <Section level={1} tag={`Outrun · ${id ?? "?"}`} title={lang === "tr" ? "Para nerede?" : "Where is the money?"} lede={lang === "tr" ? "Başlangıçtan Ağıl'a, adım adım. Her adım bir Arc Memo taşır." : "From the start post to the Fold, step by step. Every step carries an Arc Memo."}>
        <div className="mx-auto max-w-[860px]">
          {graphQuery.isLoading || outrunQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <LykoLoader label={lang === "tr" ? "Patika okunuyor" : "Reading the trail"} size="lg" />
            </div>
          ) : graph && outrun ? (
            <OutrunCard outrun={outrun} verdict={graph.verdict} environment={graph.environment} runs={runner.runs} onRun={(s, c) => void runner.run(s, c)} connected={runner.connected} whistle={whistle} />
          ) : (
            <div role="alert" className="flex flex-col items-center gap-3 bg-card p-6 text-center px-frame">
              <Lyko mood="alert" size={72} label={null} />
              <p className="text-[14px] text-ink-2">{describeError(graphQuery.error ?? outrunQuery.error) || (lang === "tr" ? "Bu outrun bulunamadı." : "This outrun was not found.")}</p>
            </div>
          )}
        </div>
      </Section>
    </Page>
  );
}
