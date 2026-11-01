/**
 * The landing: Lyko's bay. Ask in the composer and it morphs into the Ask
 * Lyko conversation (shared composer + scene in a View Transition).
 */
import { useMemo } from "react";

import { Link } from "../../app/routes/Link";
import { warmRoute } from "../../app/routes/loader";
import { Composer } from "../../features/ask/Composer";
import { SAMPLE_PENS, topYields, useRates } from "../../features/data/hooks";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { handleLine } from "../../shell/palette";
import { useLang } from "../../lib/i18n";
import { usePulse } from "../../lib/pulseStore";
import { Button, Card, LykoFace, MeanderBand, Medallion, PupIcon, Sprite, Stat, Tag } from "../../mosaic";
import { bay, BAY_H, BAY_W } from "../../mosaic/scenes";
import { LYKO_SNIFF, LYKO_TROT, PAL, SHEEP, WOOL } from "../../mosaic/sprites";

const CHIPS = {
  en: ["Put half my USDC to work", "Keep 5000 USDC for payroll, put the rest in the best vault and hedge 20% into EURC", "Convert 200 USDC to EURC", "Bridge 50 USDC to Base"],
  tr: ["Maaş için 5000 USDC tut, kalanını en iyi getiriye koy", "200 USDC'yi EURC'ye çevir", "50 USDC'yi Base'e köprüle", "100 USDC'yi Morpho'ya yatır"],
} as const;

export default function LandingPage() {
  const lang = useLang();
  const rates = useRates("mainnet");
  const lit = usePulse((s) => s.lit);
  const pulse = usePulse((s) => s.pulse);
  const live = useMemo(() => topYields(rates.data, "USDC", 3), [rates.data]);
  const pens = useMemo(() => (live.length >= 3 ? [live[1]!, live[0]!, live[2]!] : SAMPLE_PENS), [live]);
  const best = Math.max(...pens.map((p) => p.apy ?? 0));
  const ask = (text: string) => {
    // A question is handed to Ask Lyko (and the composer morphs there); commands and pages run here.
    handleLine(text, lang);
  };
  const dataKey = useMemo(() => `${pens.map((p) => p.apy).join(",")}|${lit}`, [pens, lit]);
  const short = (s: string) => s.replace(/ USDC$/u, "").replace(/^Aave V4 /u, "AAVE V4 ").toUpperCase().slice(0, 16);

  return (
    <div>
      <header className="m-head m-wrap">
        <Medallion size={168} spin />
        <h1 className="m-title" style={{ marginTop: 18 }}>
          {lang === "tr" ? (
            <>
              Sürüyü <em>daha yeşil meralara</em> güt.
            </>
          ) : (
            <>
              Lead the flock to <em>greener pastures.</em>
            </>
          )}
        </h1>
        <p className="m-sub">
          {lang === "tr"
            ? "Bir kez söyle. Lyko stablecoin'lerini Arc üzerinde güder, her agent'ı Çit'in içinde ve her kurdu dışında tutar. Built on Arc Network."
            : "Say it once. Lyko herds your stablecoins across Arc, keeps every agent inside its Fence and every wolf outside it. Built on Arc Network."}
        </p>
      </header>

      <section className="m-wrap" style={{ marginTop: 28 }}>
        <SceneFrame
          vt
          build={(t) => bay({ pens: pens.map((p) => ({ label: p.label, apy: p.apy })), flock: ["USDC", "EURC", "USDC", "USDC", "cirBTC", "EURC"], wolves: 2, lit, grow: rates.isLoading ? 0.25 : 1 }, t)}
          width={BAY_W}
          height={BAY_H}
          dataKey={dataKey}
          assembleKey="bay"
          label="Lyko's bay: three pens whose grass height is each venue's yield, the flock, the Patara lighthouse and two wolves kept outside the fence"
          labels={[
            { x: 50, y: 1.5, text: lang === "tr" ? "PATARA · HER ARC BLOĞUNDA YANAR" : "PATARA · BLINKS EVERY ARC BLOCK" },
            { x: 28, y: 26, text: "BASE · CCTP", tone: undefined },
            { x: 72, y: 26, text: "ETHEREUM · CCTP" },
            { x: 18.5, y: 63, text: `${short(pens[0]!.label)} ${pens[0]!.apy?.toFixed(1) ?? "n/a"}%`, tone: pens[0]!.apy === best ? "ok" : "ochre" },
            { x: 50, y: 59, text: `${short(pens[1]!.label)} ${pens[1]!.apy?.toFixed(1) ?? "n/a"}%${pens[1]!.apy === best ? " · GREENEST" : ""}`, tone: pens[1]!.apy === best ? "ok" : "ochre" },
            { x: 81.5, y: 66, text: `${short(pens[2]!.label)} ${pens[2]!.apy?.toFixed(1) ?? "n/a"}%`, tone: pens[2]!.apy === best ? "ok" : "ochre" },
            { x: 6.5, y: 76, text: "LOOK-ALIKE", tone: "wolf" },
            { x: 93.5, y: 76, text: "HONEYPOT", tone: "wolf" },
          ]}
          footer={
            <div style={{ padding: 12, borderTop: "8px solid", borderImage: "var(--rule8) 8 round" }} onFocus={() => void warmRoute("/app")} onMouseEnter={() => void warmRoute("/app")}>
              <Composer onSubmit={ask} className="m-frame--thin" />
              <div className="m-chips">
                {CHIPS[lang].map((c) => (
                  <button key={c} type="button" className="m-chip" onClick={() => ask(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          }
        />
        <p className="m-kick m-center" style={{ marginTop: 10 }}>
          {live.length >= 3 ? `${lang === "tr" ? "CANLI GETİRİLER" : "LIVE YIELDS"} · MORPHO + AAVE · ARC MAINNET` : rates.isLoading ? "…" : lang === "tr" ? "ÖRNEK GETİRİLER · API'YE ULAŞILAMADI" : "SAMPLE YIELDS · API NOT REACHED"}
        </p>
      </section>

      <MeanderBand className="mt-12" />

      <section className="m-wrap" style={{ marginTop: 40 }}>
        <div className="m-center">
          <span className="m-kick">{lang === "tr" ? "ALTMIŞ SANİYEDE" : "IN SIXTY SECONDS"}</span>
          <h2 className="m-h2" style={{ marginTop: 8 }}>
            {lang === "tr" ? "Arc agent'lara para verir. Lyko onları hizada tutar." : "Arc gives agents money. Lyko keeps them in line."}
          </h2>
        </div>
        <div className="m-grid-3" style={{ marginTop: 28 }}>
          <Card title="The Outrun" kicker={lang === "tr" ? "BİR CÜMLE · BİR İMZA · <1 SN" : "ONE SENTENCE · ONE SIGNATURE · <1 S"} footer={<Button onClick={() => ask(CHIPS[lang][0])}>{lang === "tr" ? "DENE" : "TRY IT"}</Button>}>
            <div className="flex justify-center" style={{ padding: "8px 0" }}>
              <Sprite rows={LYKO_TROT} scale={3} label="Lyko trotting" />
            </div>
            {[
              ["I", lang === "tr" ? "Planlar" : "Plans", lang === "tr" ? "Arc'taki her canlı venue karşılaştırılır" : "Every live Arc venue is compared"],
              ["II", lang === "tr" ? "Çit karar verir" : "The Fence decides", lang === "tr" ? "Limitler, alıcılar, Koku, sağlık faktörü" : "Caps, recipients, Scent, health factor"],
              ["III", lang === "tr" ? "Tek imza" : "One signature", lang === "tr" ? "Onay + işlem + memo tek Arc işleminde" : "Approve + act + memo in one Arc transaction"],
            ].map(([n, t, d]) => (
              <div key={n} className="m-row">
                <span style={{ fontFamily: "Pixelify Sans", fontWeight: 700, fontSize: 20, color: "var(--terra)", width: 28, textAlign: "center" }}>{n}</span>
                <div>
                  <b>{t}</b>
                  <p className="m-small m-muted">{d}</p>
                </div>
              </div>
            ))}
          </Card>
          <Card title="The Pack" kicker={lang === "tr" ? "ALT AGENT'LAR · KENDİ ÇİTLERİ" : "SUB-AGENTS · THEIR OWN FENCES"} footer={<Link to="/app/pack" className="m-btn m-btn--sea">{lang === "tr" ? "YAVRU EKLE" : "SPAWN A PUP"}</Link>}>
            {([["treasurer", "Treasurer", "Künye on Arc · daily cap"], ["payroll", "Payroll", "Fridays · named payees"], ["fx-hedger", "FX hedger", "EURC band ±25 bps"], ["sentinel", "Sentinel", "Scent + health · blows the whistle"]] as const).map(([role, name, line]) => (
              <div key={role} className="m-row" style={{ alignItems: "center" }}>
                <PupIcon role={role} scale={3} />
                <div>
                  <b>{name}</b>
                  <p className="m-small m-muted">{line}</p>
                </div>
              </div>
            ))}
            <p className="m-note" style={{ marginTop: 8 }}>{lang === "tr" ? "Bir yavrunun Çit'i asla ebeveyninin dışına çıkamaz; bütçesi ebeveynden dilimlenir." : "A pup's Fence can never leave its parent's; its budget is carved from the parent's."}</p>
          </Card>
          <Card title="The Fence" kicker={lang === "tr" ? "ÇİT · ZİNCİR ÜSTÜNDE DE" : "ÇİT · ON CHAIN TOO"} footer={<Link to="/app/fence" className="m-btn m-btn--navy">{lang === "tr" ? "ÇİTİ KUR" : "BUILD YOUR FENCE"}</Link>}>
            {[
              [lang === "tr" ? "Adım başı" : "Per step", "$1,000"],
              [lang === "tr" ? "Günlük" : "Per day", "$5,000"],
              [lang === "tr" ? "Sağlık faktörü" : "Health factor", "≥ 1.5"],
              ["FX band", "±50 bps"],
              [lang === "tr" ? "Yabancılar" : "Strangers", lang === "tr" ? "asla" : "never"],
            ].map(([k, v]) => (
              <div key={k} className="m-row" style={{ justifyContent: "space-between" }}>
                <span>{k}</span>
                <span className="num">{v}</span>
              </div>
            ))}
            <p className="m-note" style={{ marginTop: 8 }}>{lang === "tr" ? "Düdük: yeni risk durur, eve dönüş her zaman geçer." : "The Whistle: new risk stops, moves home always pass."}</p>
          </Card>
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }}>
        <div className="m-grid-4">
          {[
            { rows: LYKO_SNIFF, title: "Scent", tr: "Koku", line: lang === "tr" ? "Bir token'a dokunmadan önce kanıtlanabilen her şey. Asla \"güvenli\" demez." : "What can be proven about a token before anyone touches it. Never says \"safe\".", href: "/app/scent" },
            { rows: SHEEP, palette: { ...PAL, W: WOOL.USDC! }, title: "Flock", tr: "Sürü", line: lang === "tr" ? "Mainnet ve testnet, cüzdan, Gateway ve venue'lar tek merada." : "Mainnet and testnet, wallet, Gateway and venues in one pasture.", href: "/app/flock" },
            { face: true, title: "Künye", tr: "Künye", line: lang === "tr" ? "ERC-8004 kimliği, uyduğu Çit'in hash'ini taşır." : "An ERC-8004 identity that pins the hash of the Fence it obeys.", href: "/app/kunye" },
            { rows: SHEEP, palette: { ...PAL, W: WOOL.EURC! }, title: "Pastures", tr: "Meralar", line: lang === "tr" ? "Canlı getiriler; otun boyu oran, risk ve kaynak etiketli." : "Live yields: grass height is the rate, with risk and source.", href: "/app/pastures" },
          ].map((p) => (
            <Link key={p.title} to={p.href} className="m-frame m-card m-center" style={{ textDecoration: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ height: 72, display: "grid", placeItems: "center" }}>{p.face ? <LykoFace mood="proud" scale={2.4} /> : <Sprite rows={p.rows!} palette={p.palette} scale={3} />}</div>
              <h3 style={{ fontSize: 22 }}>{lang === "tr" ? p.tr : p.title}</h3>
              <p className="m-small m-muted">{p.line}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="m-wrap" style={{ marginTop: 48 }}>
        <div className="m-grid-2">
          <Card title={lang === "tr" ? "Geliştiriciler için" : "For builders"} kicker="REST · SSE · MCP · x402 · SDK" footer={<Link to="/build" className="m-btn m-btn--sea">{lang === "tr" ? "ANAHTAR AL" : "GET A KEY"}</Link>}>
            <pre className="m-code">{`curl -X POST $LYKIA/v1/agent/chat \\
  -H 'Accept: text/event-stream' \\
  -d '{"message":"put half my USDC to work",
       "environment":"mainnet"}'

event: proposal
data: {"decision":"allow","steps":[...]}`}</pre>
          </Card>
          <Card title={lang === "tr" ? "Canlı kanıt" : "Live proof"} kicker={lang === "tr" ? "ŞU AN ARC'TAN OKUNUYOR" : "READ FROM ARC RIGHT NOW"}>
            <div className="m-grid-2" style={{ gap: 8 }}>
              <Stat label={lang === "tr" ? "BLOK" : "BLOCK"} value={pulse ? `#${pulse.block.toLocaleString("en-US")}` : "…"} />
              <Stat label={lang === "tr" ? "BLOK SÜRESİ" : "BLOCK TIME"} value={pulse?.blockTimeMs ? `${Math.round(pulse.blockTimeMs)} ms` : "…"} />
              <Stat label="TRANSFER" value={pulse?.transferCostUsd ? `$${Number(pulse.transferCostUsd).toFixed(4)}` : "…"} />
              <Stat label={lang === "tr" ? "KESİNLİK" : "FINALITY"} value={<Tag tone="ok">DETERMINISTIC</Tag>} />
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
