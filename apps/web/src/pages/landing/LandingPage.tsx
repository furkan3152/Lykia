import { LYKO_LINES } from "@lykia/core";

import { routeHref } from "../../app/routes/routeTable";
import { pick, useLang } from "../../lib/i18n";
import { Cards, Page, Section } from "../../pixel/layout";
import { Lyko } from "../../pixel/Lyko";
import { ValleyScene } from "../../pixel/ValleyScene";
import { Tag } from "../../ui/Badge";
import { ButtonLink } from "../../ui/Button";
import { Kbd } from "../../ui/Kbd";
import { HERO, PILLARS, STORY } from "./copy";

const CURL = `curl -s $LYKIA/v1/intents \\
  -H 'content-type: application/json' \\
  -d '{"text":"put half my USDC to work",
       "owner":"0xYou","environment":"testnet"}'`;

function Story() {
  const lang = useLang();
  return (
    <Section
      id="story"
      tag={lang === "tr" ? "Altmış saniyede Lykia" : "Lykia in sixty seconds"}
      title={lang === "tr" ? "Plan, Çit, imza, kesinlik." : "Plan, Fence, sign, final."}
      lede={lang === "tr" ? "Lyko her adımda ne olduğunu söyler. Hiçbir adım senin imzan olmadan değer taşımaz." : "Lyko says what happens at every step. No step moves value without your signature."}
    >
      <Cards n={3}>
        {STORY.map((step) => (
          <article key={step.time} className="flex flex-col items-center gap-3 bg-card p-5 text-center px-frame px-drop">
            <Lyko mood={step.mood} size={84} label={null} />
            <span className="font-tag text-[11px] uppercase text-ink-3 tnum">{step.time}</span>
            <h3 className="font-display text-2xl font-bold text-ink">{pick(lang, step.title)}</h3>
            <p className="text-[14px] leading-relaxed text-ink-2 text-pretty">{pick(lang, step.body)}</p>
          </article>
        ))}
      </Cards>
    </Section>
  );
}

function Pillars() {
  const lang = useLang();
  return (
    <Section
      id="pillars"
      tag={lang === "tr" ? "Dört sütun" : "Four pillars"}
      title={lang === "tr" ? "Arc'ın her nimeti, tek çitin içinde." : "Everything Arc offers, inside one Fence."}
      lede={
        lang === "tr"
          ? "USDC ile gaz, deterministik kesinlik, Memo, Multicall3From, CCTP, Gateway, StableFX ve ERC-8004: Lykia hepsini agent'lar ve stablecoin işletmeleri için birleştirir."
          : "USDC gas, deterministic finality, Memo, Multicall3From, CCTP, Gateway, StableFX and ERC-8004: Lykia brings them together for agents and stablecoin businesses."
      }
    >
      <Cards n={4} phone={1}>
        {PILLARS.map((pillar) => (
          <article key={pillar.key} className="flex flex-col gap-3 bg-card p-5 px-frame px-drop">
            <Tag>{pillar.key.toUpperCase()}</Tag>
            <h3 className="font-display text-2xl font-bold text-ink">{pick(lang, pillar.title)}</h3>
            <p className="text-[14px] leading-relaxed text-ink-2 text-pretty">{pick(lang, pillar.body)}</p>
          </article>
        ))}
      </Cards>
    </Section>
  );
}

function Builders() {
  const lang = useLang();
  return (
    <Section
      id="builders"
      tag={lang === "tr" ? "Geliştiriciler için" : "For builders"}
      title={lang === "tr" ? "Bir API anahtarı, bir Çit, hazır." : "One API key, one Fence, done."}
      lede={
        lang === "tr"
          ? "REST ve SSE ile planla, hazırla, gönder ve takip et. MCP sunucusu agent'lara güvenli bir planlama yüzeyi verir; x402 ile çağrı başına USDC öde."
          : "Plan, prepare, submit and track over REST and SSE. The MCP server gives agents a safe planning surface; x402 lets them pay per call in USDC."
      }
      actions={
        <ButtonLink to={routeHref("developers")} variant="ink">
          {lang === "tr" ? "API'yi gör" : "See the API"} →
        </ButtonLink>
      }
    >
      <pre className="mx-auto max-w-[680px] overflow-x-auto bg-ink p-5 font-mono text-[13px] leading-relaxed text-paper px-frame">{CURL}</pre>
    </Section>
  );
}

function Closing() {
  const lang = useLang();
  return (
    <Section id="closing" className="pb-8 sm:pb-10">
      <div className="mx-auto flex max-w-[760px] flex-col items-center text-center">
        <Lyko mood="proud" size={168} label="Lyko, proud, his Künye shining" />
        <h2 className="mt-8 font-display text-[clamp(2.75rem,7vw,5rem)] font-bold leading-none text-ink">{lang === "tr" ? "Her sürünün bir Lyko'su olmalı." : "Every flock needs a Lyko."}</h2>
        <p className="mt-5 max-w-[560px] text-[17px] leading-relaxed text-ink-2 text-pretty">{pick(lang, LYKO_LINES.watching)}</p>
        <div className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-7">
          <ButtonLink to={routeHref("deck")} size="xl">
            {pick(lang, HERO.cta)} →
          </ButtonLink>
          <ButtonLink to={routeHref("fence")} variant="ink" size="xl">
            {lang === "tr" ? "Çitini kur" : "Build your Fence"}
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

/**
 * "/": the valley. Lyko on watch over the flock while a plan runs its arc,
 * the sixty-second story, the four pillars, a builder's teaser and the way in.
 */
export default function LandingPage() {
  const lang = useLang();
  return (
    <Page className="!pt-0 !pb-0">
      <Section
        id="hero"
        level={1}
        tag={pick(lang, HERO.tag)}
        title={
          <>
            {pick(lang, HERO.title1)}
            <br />
            {pick(lang, HERO.title2)}
          </>
        }
        lede={pick(lang, HERO.lede)}
        actions={
          <>
            <ButtonLink to={routeHref("deck")} size="lg">
              {pick(lang, HERO.cta)} →
            </ButtonLink>
            <ButtonLink to={routeHref("developers")} variant="ink" size="lg">
              {pick(lang, HERO.build)}
            </ButtonLink>
          </>
        }
      >
        <div className="bg-card p-2 px-frame px-drop-lg">
          <ValleyScene
            label="The Lycian valley: the turquoise sea, pines and a rainbow over the meadow; the flock grazes inside the Fence, Lyko runs the outrun arc toward the Fold, and two wolves lurk outside the Fence"
            sheep={[{ size: 3 }, { size: 2 }, { size: 2, wool: "#EFE4CF" }, { size: 1 }, { size: 1 }, { size: 2 }]}
            wolves={2}
            lyko="run"
            outrun={{ waypoints: 3, progress: 0.62 }}
          />
        </div>
        <p className="mt-6 hidden items-center justify-center gap-2 font-tag text-[11px] uppercase text-ink-2 sm:flex">
          <Kbd>/</Kbd> {lang === "tr" ? "her yerde düdük kutusunu açar · “come bye” yazmayı dene" : "opens the whistle box anywhere · try typing “come bye”"}
        </p>
      </Section>
      <Story />
      <Pillars />
      <Builders />
      <Closing />
    </Page>
  );
}
