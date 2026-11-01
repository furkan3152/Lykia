import { WOLVES, type ScentLevel } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useRouteParam } from "../../app/routes/useRoute";
import { apiGet, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLang } from "../../lib/i18n";
import type { ScentReport } from "../../lib/types";
import { Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { LykoEmpty } from "../../pixel/LykoEmpty";
import { LykoLoader } from "../../pixel/LykoLoader";
import { ValleyScene } from "../../pixel/ValleyScene";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

const LEVEL_VIEW: Readonly<Record<ScentLevel, { readonly en: string; readonly tr: string; readonly tone: string; readonly mood: "proud" | "watching" | "alert" | "growling" }>> = {
  verified: { en: "Verified (registry)", tr: "Doğrulanmış (kayıt)", tone: "bg-up text-white", mood: "proud" },
  "no-red-flags": { en: "No red flags found", tr: "Kırmızı bayrak bulunmadı", tone: "bg-accent text-white", mood: "watching" },
  caution: { en: "Caution", tr: "Dikkat", tone: "bg-signal text-[#1B1714]", mood: "alert" },
  danger: { en: "Danger", tr: "Tehlike", tone: "bg-down text-white", mood: "growling" },
  unknown: { en: "Could not tell", tr: "Anlaşılamadı", tone: "bg-paper-2 text-ink", mood: "alert" },
};

export default function ScentPage() {
  const lang = useLang();
  const environment = useEnvironment();
  const token = useRouteParam("token");
  const valid = typeof token === "string" && ADDRESS.test(token);
  const [input, setInput] = useState(token ?? "");
  const query = useQuery({
    queryKey: ["scent", token, environment],
    enabled: valid,
    queryFn: ({ signal }) => apiGet<ScentReport>(`/v1/scent/${token}`, { query: { environment }, signal, timeoutMs: 20_000 }),
  });
  const report = query.data;

  return (
    <Page>
      <Section
        level={1}
        tag={lang === "tr" ? "Koku · dokunmadan önce" : "Scent · before anyone touches it"}
        title={lang === "tr" ? "Lyko koklasın." : "Let Lyko sniff it."}
        lede={lang === "tr" ? "Kayıt, bytecode, proxy, yetkiler, sahip ve simüle alım-satım. En iyi sonuç bile “güvenli” değil, “kırmızı bayrak bulunmadı”dır." : "Registry, bytecode, proxies, privileges, owner and a simulated buy and sell. Even the best result is not “safe”; it is “no red flags found”."}
      >
        <form
          className="mx-auto mb-8 flex max-w-[680px] items-stretch bg-card px-frame px-drop"
          onSubmit={(e) => {
            e.preventDefault();
            if (ADDRESS.test(input.trim())) navigate(routeHref("scent", { token: input.trim() }));
          }}
        >
          <span className="flex items-center bg-ink px-3 font-tag text-[11px] uppercase text-paper">{lang === "tr" ? "Token" : "Token"}</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x…" aria-label="Token address" className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-3" />
          <Button type="submit" className="m-1.5" disabled={!ADDRESS.test(input.trim())}>
            {lang === "tr" ? "Kokla" : "Sniff"}
          </Button>
        </form>
        {!valid ? (
          <LykoEmpty title={lang === "tr" ? "Bir token adresi ver" : "Give Lyko a token address"} description={lang === "tr" ? "Arc'taki herhangi bir ERC-20. Lyko her denetimi tek tek gösterir." : "Any ERC-20 on Arc. Lyko shows every check, one by one."} />
        ) : query.isLoading ? (
          <div className="flex justify-center py-10">
            <LykoLoader label={lang === "tr" ? "Lyko kokluyor" : "Lyko is sniffing"} size="lg" />
          </div>
        ) : query.isError ? (
          <div role="alert" className="mx-auto flex max-w-[560px] flex-col items-center gap-3 bg-card p-6 text-center px-frame">
            <Lyko mood="alert" size={72} label={null} />
            <p className="text-[14px] text-ink-2">{describeError(query.error)}</p>
          </div>
        ) : report ? (
          <div className="mx-auto flex max-w-[860px] flex-col gap-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <Lyko mood={LEVEL_VIEW[report.level].mood} size={110} />
              <span className={cx("px-3 py-1 font-tag text-[13px] uppercase", LEVEL_VIEW[report.level].tone)}>{lang === "tr" ? LEVEL_VIEW[report.level].tr : LEVEL_VIEW[report.level].en}</span>
              <p className="font-display text-3xl font-bold text-ink">
                {report.symbol ?? "?"} <span className="text-ink-3">· {report.name ?? (lang === "tr" ? "isimsiz" : "unnamed")}</span>
              </p>
              <p className="break-all font-mono text-[12px] text-ink-3">{report.token}</p>
              {"warning" in report.trust ? <p className="max-w-[560px] text-[13px] text-warn-ink">{report.trust.warning}</p> : null}
            </div>
            {report.wolves.length > 0 ? (
              <>
                <div className="bg-card p-2 px-frame-thin">
                  <ValleyScene aspect={0.22} pixelSize={3} label={`${report.wolves.length} wolves at the fence`} wolves={report.wolves.length} lyko="sit" rainbow={false} />
                </div>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {report.wolves.map((w) => (
                    <li key={w} className="flex flex-col gap-1 bg-card p-4 px-frame px-drop">
                      <span className="font-tag text-[11px] uppercase text-down">{w}</span>
                      <span className="font-display text-xl font-bold text-ink">{WOLVES[w].name}</span>
                      <span className="text-[13px] text-ink-2">{WOLVES[w].line}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <table className="w-full bg-card text-left text-[13px] px-frame">
              <thead>
                <tr className="font-tag text-[11px] uppercase text-ink-2">
                  <th className="p-3">{lang === "tr" ? "Denetim" : "Check"}</th>
                  <th className="p-3">{lang === "tr" ? "Sonuç" : "Result"}</th>
                  <th className="p-3">{lang === "tr" ? "Ayrıntı" : "Detail"}</th>
                </tr>
              </thead>
              <tbody>
                {report.checks.map((c) => (
                  <tr key={c.id} className="border-t-2 border-dashed border-rule align-top">
                    <td className="p-3 font-mono text-ink">{c.id}</td>
                    <td className={cx("p-3 font-tag text-[11px] uppercase", c.ok === true ? "text-up" : c.ok === false ? "text-down" : "text-ink-3")}>{c.ok === true ? (lang === "tr" ? "geçti" : "passed") : c.ok === false ? (lang === "tr" ? "bayrak" : "red flag") : lang === "tr" ? "çalışmadı" : "not run"}</td>
                    <td className="p-3 text-ink-2">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-center font-tag text-[11px] uppercase text-ink-3">
              {new Date(report.at).toLocaleString()} · {report.environment} {report.deep ? "· deep (x402)" : ""}
            </p>
          </div>
        ) : null}
      </Section>
    </Page>
  );
}
