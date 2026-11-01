import { useLang } from "../../lib/i18n";
import { Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { Tag } from "../../ui/Badge";
import { cx } from "../../ui/cx";
import { ARC_FEATURES, CURL_PLAN, CURL_SCENT, MCP_CONFIG, ROUTE_GROUPS, X402_FLOW } from "./manual";

function Code({ children }: { readonly children: string }) {
  return <pre className="overflow-x-auto bg-ink p-4 font-mono text-[12.5px] leading-relaxed text-paper px-frame">{children}</pre>;
}

export default function DevelopersPage() {
  const lang = useLang();
  return (
    <Page>
      <Section
        level={1}
        tag={lang === "tr" ? "Geliştiriciler" : "Developers"}
        title={lang === "tr" ? "Agent'lara muhakeme ver." : "Give your agents judgment."}
        lede={
          lang === "tr"
            ? "Lykia API'si plan, Çit, Koku ve Künye'yi tek yüzeyde sunar. Sunucu asla imzalamaz: imzasız işlemler verir, sonra makbuzları doğrular."
            : "The Lykia API puts planning, the Fence, Scent and the Künye behind one surface. The server never signs: it hands out unsigned transactions and verifies the receipts."
        }
      >
        <div className="mx-auto flex max-w-[960px] flex-col gap-10">
          <div className="flex items-center justify-center gap-4">
            <Lyko mood="watching" size={72} label={null} />
            <p className="max-w-[520px] text-[14px] text-ink-2">{lang === "tr" ? "Taban adres: VITE_API_URL ya da kendi sunucun. Hatalar her zaman aynı zarfta gelir: { error: { code, message, details, requestId } }." : "Base URL: your own Lykia API. Errors always come in one envelope: { error: { code, message, details, requestId } }."}</p>
          </div>
          {ROUTE_GROUPS.map((group) => (
            <section key={group.title} className="flex flex-col gap-3">
              <h2 className="font-display text-2xl font-bold text-ink">{group.title}</h2>
              <ul className="flex flex-col gap-2">
                {group.routes.map((route) => (
                  <li key={route.path} className="flex flex-col gap-1 bg-card p-3 px-frame-thin sm:flex-row sm:items-baseline sm:gap-4">
                    <span className={cx("w-14 shrink-0 font-tag text-[11px] uppercase", route.method === "GET" ? "text-up" : "text-summit-ink")}>{route.method}</span>
                    <code className="shrink-0 font-mono text-[13px] text-ink">{route.path}</code>
                    <span className="text-[13px] text-ink-2">{route.what}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-2xl font-bold text-ink">{lang === "tr" ? "Bir plan iste" : "Ask for a plan"}</h2>
            <Code>{CURL_PLAN}</Code>
            <Code>{CURL_SCENT}</Code>
          </section>
          <section id="mcp" className="flex scroll-mt-28 flex-col gap-3">
            <Tag>MCP</Tag>
            <h2 className="font-display text-2xl font-bold text-ink">{lang === "tr" ? "Agent'lar için MCP" : "MCP for agents"}</h2>
            <p className="text-[14px] text-ink-2">{lang === "tr" ? "/v1/mcp, planlama, Çit değerlendirme, Koku ve Sürü araçlarını sunar. Hiçbir araç anahtar tutmaz ya da imzalamaz." : "/v1/mcp exposes planning, Fence evaluation, Scent and Flock tools. No tool holds keys or signs."}</p>
            <Code>{MCP_CONFIG}</Code>
          </section>
          <section id="x402" className="flex scroll-mt-28 flex-col gap-3">
            <Tag>x402</Tag>
            <h2 className="font-display text-2xl font-bold text-ink">{lang === "tr" ? "Çağrı başına USDC" : "Pay per call in USDC"}</h2>
            <p className="text-[14px] text-ink-2">{lang === "tr" ? "Derin Koku raporları gibi ücretli uçlar 402 döner; agent USDC ödeme yetkisini imzalayıp tekrar sorar. Abonelik yok, API anahtarı şart değil." : "Paid endpoints such as deep Scent reports answer 402; the agent signs a USDC payment authorization and asks again. No subscription, no API key required."}</p>
            <Code>{X402_FLOW}</Code>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-2xl font-bold text-ink">{lang === "tr" ? "Kullanılan Arc özellikleri" : "Arc features Lykia uses"}</h2>
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {ARC_FEATURES.map(([term, detail]) => (
                <div key={term} className="flex flex-col gap-1 bg-card p-4 px-frame px-drop">
                  <dt className="font-display text-lg font-bold text-ink">{term}</dt>
                  <dd className="text-[13px] text-ink-2">{detail}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </Section>
    </Page>
  );
}
