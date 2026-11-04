/** Greener pastures: live yields on Arc, one pen per venue, grass height = rate. */
import { useEffect, useState } from "react";

import { navigate } from "../../app/routes/history";
import { useAsk } from "../../features/ask/store";
import { topYields, useRates } from "../../features/data/hooks";
import { SceneFrame } from "../../features/scenes/SceneFrame";
import { useEnvironment } from "../../lib/environment";
import { useLamp } from "../../lib/pulseStore";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { Button, Card, PageHead, Skeleton, Tag, Toggle } from "../../mosaic";
import { pastures, PASTURES_H, PASTURES_W } from "../../mosaic/scenes";

export default function PasturesPage() {
  const environment = useEnvironment();
  const [asset, setAsset] = useState<"USDC" | "EURC">("USDC");
  const rates = useRates(environment);
  const lit = useLamp();
  const reduced = useReducedMotion();
  const begin = useAsk((s) => s.begin);
  const rows = topYields(rates.data, asset, 6);
  const [growing, setGrowing] = useState(0);
  useEffect(() => {
    if (reduced || rows.length === 0) return undefined;
    let v = 0;
    const id = window.setInterval(() => {
      v = Math.min(1, v + 0.08);
      setGrowing(v);
      if (v >= 1) window.clearInterval(id);
    }, 60);
    return () => window.clearInterval(id);
  }, [rows.length, asset, reduced]);
  const grow = reduced || rows.length === 0 ? 1 : growing;
  const best = rows[0];
  const n = Math.max(1, rows.length);
  return (
    <div>
      <PageHead kicker={"FLOCK · PASTURES · YIELDS"} title={<>Where stablecoins <em>earn on Arc.</em></>} sub={"Live rates from Arc lending and vault protocols. In the picture each protocol is a pen and grass height is its rate. The strip under each pen is risk: green low, ochre medium, terracotta high. The source is always named."} mood="happy">
        <div className="flex justify-center gap-3" style={{ marginTop: 18 }}>
          <Toggle light label="Asset" value={asset} onChange={setAsset} options={[{ value: "USDC", label: "USDC" }, { value: "EURC", label: "EURC" }]} />
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        {rates.isLoading ? (
          <Skeleton h={340} />
        ) : (
          <SceneFrame
            build={(t) => pastures({ pens: rows.map((r) => ({ label: r.label, apy: r.apy, risk: r.risk })), grow, lit }, t)}
            width={PASTURES_W}
            height={PASTURES_H}
            dataKey={`${asset}-${grow}-${lit}-${rows.length}`}
            assembleKey={asset}
            label={`Pens for ${asset} yields on Arc ${environment}`}
            labels={rows.map((r, i) => ({ x: 4 + ((i + 0.5) * 92) / n, y: 44, text: r.apy === null ? "N/A" : `${r.apy.toFixed(2)}%`, tone: i === 0 ? ("ok" as const) : ("ochre" as const) }))}
          />
        )}
        {environment === "testnet" ? <p className="m-note" style={{ marginTop: 12 }}>{"Morpho and Aave are not on Arc testnet; Lykia's practice vaults appear here once deployed."}</p> : null}
      </section>
      <section className="m-wrap" style={{ marginTop: 32 }}>
        <div className="m-grid-2">
          <Card title={"The ranking"} kicker={`${asset} · ${rates.data ? `MORPHO ${rates.data.sources.morpho.toUpperCase()} · AAVE ${rates.data.sources.aave.toUpperCase()}` : "…"}`}>
            {rows.length === 0 ? <p className="m-muted m-center">{"No readable rates."}</p> : (
              <table className="m-table">
                <thead><tr><th>Venue</th><th className="r">APY</th><th>Risk</th><th>Source</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.label} className={i === 0 ? "win" : undefined}>
                      <td>{r.label}</td>
                      <td className="r num">{r.apy === null ? "n/a" : `${r.apy.toFixed(2)}%`}</td>
                      <td><Tag tone={r.risk === "low" ? "ok" : r.risk === "medium" ? "ochre" : "bad"}>{r.risk}</Tag></td>
                      <td className="m-small">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title={"Plan it"} kicker={"ONE SENTENCE · FENCE-CHECKED"} footer={best ? <Button onClick={() => { begin(`Put half my ${asset} to work`); navigate("/app"); }}>{"PLAN IT"}</Button> : undefined}>
            <p>{best ? (`The greenest pen right now is ${best.label} (${best.apy?.toFixed(2)}%). Lyko builds the plan, the Fence checks its risk and your caps, you sign once.`) : "…"}</p>
            <p className="m-note" style={{ marginTop: 10 }}>{"Rates are read, never promised; an unreadable rate says \"n/a\"."}</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
