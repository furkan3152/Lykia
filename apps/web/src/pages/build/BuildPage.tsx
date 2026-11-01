/** Build: the developer portal. SIWE sign-in, keys, usage, webhooks, fee, playground, MCP and SDK. */
import type { ApiKeyView, CreatedApiKey, UsageView, WebhookEndpointView } from "@lykia/core/api/platform";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CircleMarket } from "../../features/circle/Circle";
import { useSiwe } from "../../features/session/useSiwe";
import { apiGet, apiPost, apiPut, apiUrl, describeError } from "../../lib/api";
import { Button, Card, EmptyState, Field, Input, PageHead, Select, Skeleton, Tabs, Tag, toast } from "../../mosaic";

type Tab = "keys" | "webhooks" | "fee" | "playground" | "mcp" | "sdk" | "circle";

const SDK = `import { Lykia } from "@lykia/sdk";

const lykia = new Lykia({ apiKey: process.env.LYKIA_KEY });
const plan = await lykia.intents.create({
  text: "put half my USDC on the greenest pasture",
  owner, environment: "mainnet",
});
for (const step of plan.intent.steps) {
  const { transactions } = await lykia.intents.prepare(plan.intent.id, step.id);
  // sign with viem, then:
  await lykia.intents.submit(plan.intent.id, step.id, { hashes });
}`;

export default function BuildPage() {
  const siwe = useSiwe();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("keys");
  const [label, setLabel] = useState("server");
  const [kind, setKind] = useState<"secret" | "publishable">("secret");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [hook, setHook] = useState("");
  const [fee, setFee] = useState("10");
  const [feeTo, setFeeTo] = useState("");
  const [play, setPlay] = useState("put half my USDC to work");
  const [playOut, setPlayOut] = useState<string>("");
  const enabled = siwe.signedIn;
  const keys = useQuery({ queryKey: ["dev-keys"], enabled, queryFn: ({ signal }) => apiGet<{ keys: ApiKeyView[] }>("/v1/developers/keys", { signal }) });
  const usage = useQuery({ queryKey: ["dev-usage"], enabled, queryFn: ({ signal }) => apiGet<UsageView>("/v1/developers/usage", { signal }) });
  const hooks = useQuery({ queryKey: ["dev-hooks"], enabled, queryFn: ({ signal }) => apiGet<{ endpoints: WebhookEndpointView[] }>("/v1/developers/webhooks", { signal }) });
  const register = useMutation({ mutationFn: () => apiPost("/v1/developers/register", { name: "Lykia builder" }), onSuccess: () => toast.success("Developer role added", { from: "LYKO" }), onError: (e) => toast.error(describeError(e), { from: "LYKO" }) });
  const createKey = useMutation({
    mutationFn: () => apiPost<CreatedApiKey>("/v1/developers/keys", { label, kind, ...(kind === "publishable" ? { allowedOrigins: [window.location.origin] } : {}) }),
    onSuccess: (k) => { setCreated(k); void qc.invalidateQueries({ queryKey: ["dev-keys"] }); },
    onError: (e) => toast.error(describeError(e), { from: "LYKO" }),
  });
  const runPlay = async () => {
    try {
      const r = await apiPost<unknown>("/v1/language/parse", { text: play, environment: "mainnet" });
      setPlayOut(JSON.stringify(r, null, 2));
    } catch (e) {
      setPlayOut(describeError(e));
    }
  };
  return (
    <div>
      <PageHead kicker={"BUILD · API · MCP · SDK"} title={<>Put Lyko in <em>your product.</em></>} sub={"Get a key and plug the same planning, Fence and Scent layer into your app or agent. The server never signs."} mood="happy">
        <div className="flex justify-center gap-2" style={{ marginTop: 18 }}>
          {siwe.signedIn ? <Tag tone="ok">SIGNED IN · {siwe.session?.roles.join(", ").toUpperCase()}</Tag> : <Button onClick={() => void siwe.signIn()} disabled={siwe.busy}>{"SIGN IN ON ARC (SIWE)"}</Button>}
          {siwe.signedIn && !siwe.session?.roles.includes("developer") ? <Button tone="sea" onClick={() => register.mutate()}>{"BECOME A DEVELOPER"}</Button> : null}
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-4">
          {[["REST + SSE", "/v1 · plan, prepare, submit, follow"], ["MCP", "/v1/mcp · read & propose tools"], ["x402", "pay per call in USDC on Arc"], ["Webhooks", "signed · retried · 6 events"]].map(([t, d]) => (
            <div key={t} className="m-frame m-card m-center"><h3 style={{ fontSize: 20 }}>{t}</h3><p className="m-small m-muted">{d}</p></div>
          ))}
        </div>
        <div style={{ marginTop: 24 }}>
          <Tabs label="Portal" value={tab} onChange={setTab} tabs={[{ id: "keys", label: "KEYS" }, { id: "webhooks", label: "WEBHOOKS" }, { id: "fee", label: "FEE" }, { id: "playground", label: "PLAYGROUND" }, { id: "mcp", label: "MCP" }, { id: "sdk", label: "SDK" }, { id: "circle", label: "CIRCLE" }]} />
        </div>
        <div style={{ marginTop: 20 }}>
          {tab === "keys" ? (
            <div className="m-grid-2">
              <Card title={"Keys"} kicker={"ONLY AN HMAC IS STORED"}>
                {!enabled ? <EmptyState title={"Sign in first"}>{"Keys belong to your wallet."}</EmptyState> : keys.isLoading ? <Skeleton h={120} /> : (
                  <table className="m-table"><thead><tr><th>Label</th><th>Kind</th><th>Prefix</th><th>Scopes</th></tr></thead><tbody>
                    {(keys.data?.keys ?? []).map((k) => <tr key={k.id}><td>{k.label}</td><td><Tag tone={k.kind === "secret" ? "bad" : "sea"}>{k.kind}</Tag></td><td className="num">{k.prefix}</td><td className="m-small">{k.scopes.join(", ")}</td></tr>)}
                  </tbody></table>
                )}
                {created ? <div className="m-note" style={{ marginTop: 10 }}><b>{"Shown once:"}</b> <code className="num">{created.secret}</code></div> : null}
              </Card>
              <Card title={"New key"} kicker="SECRET · PUBLISHABLE" footer={<Button disabled={!enabled || createKey.isPending} onClick={() => createKey.mutate()}>{"CREATE"}</Button>}>
                <div style={{ display: "grid", gap: 10 }}>
                  <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
                  <Field label="Kind" hint={kind === "publishable" ? "Bound to this origin; safe in a browser." : "Server-side only."}>
                    <Select value={kind} onChange={(e) => setKind(e.target.value as "secret" | "publishable")}><option value="secret">secret</option><option value="publishable">publishable</option></Select>
                  </Field>
                  {usage.data ? <p className="m-small m-muted">{"Today"}: <b className="num">{usage.data.today}</b> requests</p> : null}
                </div>
              </Card>
            </div>
          ) : tab === "webhooks" ? (
            <Card title="Webhooks" kicker="HMAC · Lykia-Signature" footer={<Button disabled={!enabled || !hook} onClick={async () => { try { await apiPost("/v1/developers/webhooks", { url: hook }); toast.success("Webhook added", { from: "LYKO" }); void qc.invalidateQueries({ queryKey: ["dev-hooks"] }); } catch (e) { toast.error(describeError(e), { from: "LYKO" }); } }}>ADD</Button>}>
              <Field label="URL"><Input placeholder="https://example.com/lykia" value={hook} onChange={(e) => setHook(e.target.value)} /></Field>
              <div style={{ marginTop: 10 }}>{(hooks.data?.endpoints ?? []).map((w) => <div key={w.id} className="m-row"><span className="num m-small">{w.url}</span></div>)}</div>
            </Card>
          ) : tab === "fee" ? (
            <Card title={"Integrator fee"} kicker="MAX 50 BPS" footer={<Button disabled={!enabled} onClick={async () => { try { await apiPut("/v1/developers/settings", { integratorFeeBps: Number(fee), feeRecipient: feeTo || null }); toast.success("Saved", { from: "LYKO" }); } catch (e) { toast.error(describeError(e), { from: "LYKO" }); } }}>SAVE</Button>}>
              <div className="m-grid-2" style={{ gap: 10 }}><Field label="bps"><Input value={fee} onChange={(e) => setFee(e.target.value)} /></Field><Field label="Recipient"><Input value={feeTo} placeholder="0x…" onChange={(e) => setFeeTo(e.target.value)} /></Field></div>
            </Card>
          ) : tab === "playground" ? (
            <Card title="Playground" kicker="POST /v1/language/parse" footer={<Button onClick={() => void runPlay()}>RUN</Button>}>
              <Field label="Sentence (EN or TR)"><Input value={play} onChange={(e) => setPlay(e.target.value)} /></Field>
              {playOut ? <pre className="m-code" style={{ marginTop: 10, maxHeight: 320 }}>{playOut}</pre> : null}
            </Card>
          ) : tab === "mcp" ? (
            <Card title="MCP" kicker="STREAMABLE HTTP · READ + PROPOSE">
              <pre className="m-code">{JSON.stringify({ mcpServers: { lykia: { url: apiUrl("/v1/mcp"), headers: { "Lykia-Key": "lk_live_…" } } } }, null, 2)}</pre>
              <p className="m-small m-muted" style={{ marginTop: 8 }}>Tools: lykia_plan, lykia_scent, lykia_flock, lykia_fence_evaluate, lykia_venues, lykia_outrun, lykia_pack, lykia_insights, lykia_pack_plan.</p>
            </Card>
          ) : tab === "circle" ? (
            <CircleMarket compact />
          ) : (
            <Card title="@lykia/sdk" kicker="TYPED · RETRIES · SSE · WEBHOOK VERIFY"><pre className="m-code">{SDK}</pre></Card>
          )}
        </div>
      </section>
    </div>
  );
}
