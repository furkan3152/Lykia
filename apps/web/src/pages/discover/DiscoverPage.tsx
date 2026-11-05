/** Launch radar: new pools on Arc's AMMs with each token's trust verdict, and the launchpads building on Arc. */
import { explorerAddress, networkFor, shortHash } from "@lykia/core";
import { useQuery } from "@tanstack/react-query";

import { navigate } from "../../app/routes/history";
import { apiGet, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, EmptyState, PageHead, Skeleton, Tag } from "../../mosaic";

interface LaunchToken { readonly address: string; readonly symbol: string | null; readonly name: string | null; readonly trust: "verified" | "lookalike" | "unverified"; readonly warning: string | null }
interface LaunchPool { readonly venue: string; readonly label: string; readonly pool: string; readonly block: string; readonly feeOrSpacing: number | null; readonly tokens: readonly [LaunchToken, LaunchToken]; readonly newToken: string | null }
interface Radar { readonly fromBlock: string; readonly toBlock: string; readonly at: string; readonly pools: readonly LaunchPool[]; readonly launchpads: readonly { id: string; name: string; website?: string; summary: string }[]; readonly notes: readonly string[] }

const TRUST_TONE = { verified: "ok", lookalike: "bad", unverified: "ochre" } as const;

export default function DiscoverPage() {
  const environment = useEnvironment();
  const radar = useQuery({ queryKey: ["launches", environment], refetchInterval: 120_000, queryFn: ({ signal }) => apiGet<Radar>("/v1/discover/launches", { query: { environment }, signal, timeoutMs: 45_000 }) });
  const r = radar.data;
  return (
    <div>
      <PageHead kicker={"MORE · NEW POOLS"} title={<>New pools <em>on Arc.</em></>} sub={"New pools on Uniswap, Aerodrome, Synthra, SushiSwap and Archery, read from factory events on Arc, with Lykia's token check for each one. New is not good: check anything unverified before you touch it."} mood="alert" />
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <Card title={"New pools"} kicker={r ? `BLOCKS ${Number(r.fromBlock).toLocaleString("en-US")}–${Number(r.toBlock).toLocaleString("en-US")}` : "…"}>
          {radar.isLoading ? <Skeleton h={220} /> : radar.isError ? <p className="m-note m-note--bad">{describeError(radar.error)}</p> : !r?.pools.length ? (
            <EmptyState mood="watching" title={"No new pools"}>{r?.notes[0] ?? "No new pools in the scanned window."}</EmptyState>
          ) : (
            <div className="m-scroll-x">
              <table className="m-table">
                <thead><tr><th>Pair</th><th>Venue</th><th>Trust</th><th className="r">Block</th><th /></tr></thead>
                <tbody>
                  {r.pools.map((p) => (
                    <tr key={p.pool}>
                      <td><b>{p.tokens.map((t) => t.symbol ?? shortHash(t.address, 4, 4)).join(" / ")}</b><div className="m-small m-muted"><a href={explorerAddress(networkFor(environment), p.pool)} target="_blank" rel="noreferrer">{shortHash(p.pool, 4, 4)} ↗</a>{p.feeOrSpacing !== null ? ` · ${p.venue.startsWith("aerodrome") ? `spacing ${p.feeOrSpacing}` : `${p.feeOrSpacing / 10_000}%`}` : ""}</div></td>
                      <td className="m-small">{p.label}</td>
                      <td>{p.tokens.map((t) => <Tag key={t.address} tone={TRUST_TONE[t.trust]} style={{ marginRight: 4 }}>{`${t.symbol ?? "?"} ${t.trust}`}</Tag>)}</td>
                      <td className="r num m-small">{Number(p.block).toLocaleString("en-US")}</td>
                      <td>{p.newToken ? <Button size="sm" tone="ochre" onClick={() => navigate(`/app/scent/${p.newToken}`)}>{"SNIFF"}</Button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r?.notes.map((n) => <p key={n} className="m-small m-muted" style={{ marginTop: 8 }}>{n}</p>)}
        </Card>
      </section>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <Card title={"Launchpads on Arc"} kicker={"FROM LYKIA'S PROTOCOL REGISTRY"} tone="sea">
          {r ? (
            <div className="m-grid-2" style={{ gap: 12 }}>
              {r.launchpads.map((l) => (
                <div key={l.id} className="m-row">
                  <div>
                    <b>{l.name}</b>
                    <p className="m-small m-muted">{l.summary}</p>
                    {l.website ? <a className="m-small" href={l.website} target="_blank" rel="noreferrer">{l.website.replace(/^https?:\/\//u, "")} ↗</a> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : <Skeleton h={120} />}
          <p className="m-small m-muted" style={{ marginTop: 8 }}>{"Lykia lists launchpads; it does not buy launches for you. Any token from a launchpad goes through Scent and your Fence like every other token."}</p>
        </Card>
      </section>
    </div>
  );
}
