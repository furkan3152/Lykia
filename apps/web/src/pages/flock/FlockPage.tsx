import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useRouteParam, useSearchParam } from "../../app/routes/useRoute";
import { apiGet, apiUrl, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { formatUsd, shortAddress } from "../../lib/format";
import { useLang } from "../../lib/i18n";
import { openEventStream } from "../../lib/sse";
import type { FlockSnapshot } from "../../lib/types";
import { Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { LykoEmpty } from "../../pixel/LykoEmpty";
import { LykoLoader } from "../../pixel/LykoLoader";
import { ValleyScene } from "../../pixel/ValleyScene";
import { Tag } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { groupByPlace, placeLabel, sheepFor } from "./model";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function usdText(usd: string | null, lang: "en" | "tr"): string {
  if (usd === null) return lang === "tr" ? "fiyatsız" : "unpriced";
  return formatUsd(Number(usd));
}

export default function FlockPage() {
  const lang = useLang();
  const environment = useEnvironment();
  const { address: connected } = useAccount();
  const param = useRouteParam("address");
  const as = useSearchParam("as");
  const address = [param, as, connected].find((a): a is string => typeof a === "string" && ADDRESS.test(a)) ?? null;
  const viewOnly = Boolean(address && (!connected || address.toLowerCase() !== connected.toLowerCase()));
  const [input, setInput] = useState("");
  const [live, setLive] = useState<{ readonly key: string; readonly snapshot: FlockSnapshot } | null>(null);
  const liveKey = `${address ?? ""}|${environment}`;

  const query = useQuery({
    queryKey: ["flock", address, environment],
    enabled: address !== null,
    queryFn: ({ signal }) => apiGet<FlockSnapshot>(`/v1/flock/${address}`, { query: { environment }, signal }),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!address) return undefined;
    const key = `${address}|${environment}`;
    const stream = openEventStream<{ snapshot: FlockSnapshot }>({
      url: apiUrl(`/v1/flock/${address}/stream`, { environment }),
      parsers: { snapshot: (d) => (typeof d === "object" && d !== null && Array.isArray((d as FlockSnapshot).holdings) ? (d as FlockSnapshot) : null) },
      onEvent: (_name, value) => setLive({ key, snapshot: value }),
      maxAttempts: 5,
    });
    return () => stream.close();
  }, [address, environment]);

  const snapshot = (live && live.key === liveKey ? live.snapshot : null) ?? query.data ?? null;

  return (
    <Page>
      <Section
        level={1}
        tag={lang === "tr" ? "Sürü · Arc'taki her şey" : "Flock · everything on Arc"}
        title={lang === "tr" ? "Sürünü say." : "Count your flock."}
        lede={lang === "tr" ? "Cüzdan, Gateway birleşik bakiyesi ve protokoller tek tabloda. Fiyatı olmayan “fiyatsız” yazar, asla sıfır değil." : "Wallet, Gateway unified balance and venues in one sheet. Anything without a price reads “unpriced”, never zero."}
      >
        {!address ? (
          <div className="mx-auto flex max-w-[640px] flex-col items-center gap-4">
            <LykoEmpty title={lang === "tr" ? "Hangi sürü?" : "Whose flock?"} description={lang === "tr" ? "Cüzdanını bağla ya da bir adres yapıştır (sadece görüntüleme)." : "Connect your wallet, or paste an address to view it read-only."} />
            <form
              className="flex w-full items-stretch bg-card px-frame"
              onSubmit={(e) => {
                e.preventDefault();
                if (ADDRESS.test(input.trim())) navigate(`${routeHref("flock")}?as=${input.trim()}`);
              }}
            >
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x…" aria-label="Address to view" className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-[14px] text-ink outline-none" />
              <Button type="submit" className="m-1.5" disabled={!ADDRESS.test(input.trim())}>
                {lang === "tr" ? "Görüntüle" : "View"}
              </Button>
            </form>
          </div>
        ) : query.isLoading && !snapshot ? (
          <div className="flex justify-center py-10">
            <LykoLoader label={lang === "tr" ? "Sürü sayılıyor" : "Counting the flock"} size="lg" />
          </div>
        ) : query.isError && !snapshot ? (
          <div role="alert" className="mx-auto flex max-w-[560px] flex-col items-center gap-3 bg-card p-6 text-center px-frame">
            <Lyko mood="alert" size={72} label={null} />
            <p className="text-[14px] text-ink-2">{describeError(query.error)}</p>
          </div>
        ) : snapshot ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Tag>{shortAddress(snapshot.address, 6, 4)}</Tag>
              {viewOnly ? <Tag>{lang === "tr" ? "SADECE GÖRÜNTÜLEME" : "VIEW ONLY"}</Tag> : null}
              <span className="font-tag text-[11px] uppercase text-ink-3">{new Date(snapshot.at).toLocaleTimeString()}</span>
            </div>
            <div className="mx-auto flex flex-col items-center gap-1 text-center">
              <span className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Toplam" : "Total"}</span>
              <span className="tnum font-display text-5xl font-bold text-ink">{usdText(snapshot.totalUsd, lang)}</span>
              {snapshot.totalUsd === null ? <span className="text-[12px] text-warn-ink">{lang === "tr" ? "Bazı varlıkların fiyatı yok; toplam tahmin edilmedi." : "Some holdings have no price; the total is not guessed."}</span> : null}
            </div>
            <div className="bg-card p-2 px-frame px-drop">
              <ValleyScene aspect={0.34} label={`The pasture: ${snapshot.holdings.length} holdings drawn as sheep, sized by value`} sheep={sheepFor(snapshot)} lyko="sit" rainbow={false} />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {groupByPlace(snapshot.holdings).map((group) => (
                <section key={group.where} className="flex flex-col gap-2 bg-card p-4 px-frame px-drop">
                  <header className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-xl font-bold text-ink">{placeLabel(group.where, lang)}</h2>
                    <span className="tnum font-mono text-[13px] text-ink-2">{usdText(group.usd, lang)}</span>
                  </header>
                  <table className="w-full text-left text-[13px]">
                    <tbody>
                      {group.holdings.map((h) => (
                        <tr key={`${h.token}-${h.kind}`} className="border-t-2 border-dashed border-rule">
                          <td className="py-1.5 font-display font-bold text-ink">{h.symbol}</td>
                          <td className="py-1.5 font-tag text-[10px] uppercase text-ink-3">{h.kind}</td>
                          <td className={cx("tnum py-1.5 text-right font-mono", h.kind === "debt" ? "text-down" : "text-ink")}>{h.kind === "debt" ? "−" : ""}{h.amount}</td>
                          <td className={cx("tnum py-1.5 text-right font-mono", h.usd === null ? "text-warn-ink" : "text-ink-2")}>{usdText(h.usd, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-1 bg-card p-4 px-frame-thin">
                <span className="font-tag text-[11px] uppercase text-ink-2">Gateway</span>
                <span className="tnum font-display text-2xl font-bold text-ink">{snapshot.gateway.unifiedUsdc === null ? (lang === "tr" ? "okunamadı" : "unread") : `${snapshot.gateway.unifiedUsdc} USDC`}</span>
                {snapshot.gateway.note ? <span className="text-[12px] text-ink-3">{snapshot.gateway.note}</span> : null}
              </div>
              <div className="flex flex-col gap-1 bg-card p-4 px-frame-thin">
                <span className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Gaz (native USDC, 18 ondalık)" : "Gas (native USDC, 18 decimals)"}</span>
                <span className="tnum break-all font-mono text-[13px] text-ink">{snapshot.native.usdc18}</span>
              </div>
              <div className="flex flex-col gap-1 bg-card p-4 px-frame-thin">
                <span className="font-tag text-[11px] uppercase text-ink-2">{lang === "tr" ? "Sağlık faktörleri" : "Health factors"}</span>
                {snapshot.health.length === 0 ? <span className="text-[13px] text-ink-3">{lang === "tr" ? "Borç yok." : "No debt."}</span> : null}
                {snapshot.health.map((h) => (
                  <span key={h.venue} className="flex justify-between font-mono text-[13px]">
                    <span className="text-ink-2">{h.venue}</span>
                    <span className={cx("tnum", h.healthFactor !== null && Number(h.healthFactor) < 1.5 ? "text-down" : "text-ink")}>{h.healthFactor ?? "?"}</span>
                  </span>
                ))}
              </div>
            </div>
            {snapshot.notes && snapshot.notes.length > 0 ? (
              <ul className="mx-auto max-w-[760px] list-inside list-disc text-[12px] text-ink-3">
                {snapshot.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Section>
    </Page>
  );
}
