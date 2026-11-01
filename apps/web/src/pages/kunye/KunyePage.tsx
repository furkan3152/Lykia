/** Künye: an agent's ERC-8004 identity on Arc, pinning the hash of the Fence it obeys. */
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { useRouteParam } from "../../app/routes/useRoute";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLykiaStore } from "../../lib/lykiaStore";
import { Button, Card, EmptyState, Field, Input, Medallion, PageHead, Skeleton, Tag, toast } from "../../mosaic";

interface KunyeView { readonly agentId: string; readonly owner: string; readonly agentWallet: string | null; readonly agentURI?: string | null; readonly card?: unknown; readonly cardNote?: string; readonly fenceInCard?: string | null; readonly fenceMatches?: boolean | null; readonly validations: { count: number; averageResponse: number | null }; readonly reputation: { clients: number; count: number | null; value: string | null } }
interface Draft { readonly card: unknown; readonly cardDigest: string; readonly fenceHash: string; readonly agentURI: string; readonly transaction: { chainId: number; to: `0x${string}`; data: `0x${string}`; value: string; label: string } }

export default function KunyePage() {
  const environment = useEnvironment();
  const agentId = useRouteParam("agentId") ?? null;
  const wallet = useLykiaWallet();
  const { address } = wallet;
  const fence = useLykiaStore((s) => s.fence);
  const [id, setId] = useState(agentId ?? "");
  const [name, setName] = useState("Treasurer");
  const [description, setDescription] = useState("Pays suppliers and keeps idle USDC working inside its Fence.");
  const [draft, setDraft] = useState<Draft | null>(null);
  const view = useQuery({ queryKey: ["kunye", agentId, environment], enabled: Boolean(agentId), queryFn: ({ signal }) => apiGet<KunyeView>(`/v1/kunye/${agentId}`, { query: { environment }, signal, timeoutMs: 20_000 }) });
  const makeDraft = async () => {
    if (!address) return toast.warning("Connect a wallet first", { from: "LYKO" });
    try {
      setDraft(await apiPost<Draft>("/v1/kunye/draft", { environment, owner: address, name, description, fence }));
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  const register = async () => {
    if (!draft) return;
    try {
      const [hash] = await wallet.send([draft.transaction]);
      toast.success("Künye registration sent", { description: hash, from: "LYKO" });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  const v = view.data;
  return (
    <div>
      <PageHead kicker={"KÜNYE · ON ERC-8004"} title={<>Every agent wears a <em>tag.</em></>} sub={"A Künye is an ERC-8004 identity on Arc that pins the hash of the Fence the agent obeys, so anyone can check which rules it follows."} medal={false}>
        <div style={{ marginTop: 8 }}><Medallion size={180} spin title={v ? `Künye #${v.agentId}` : "Künye"} /></div>
        <form className="flex gap-2 justify-center" style={{ marginTop: 16, maxWidth: 420, marginInline: "auto" }} onSubmit={(e) => { e.preventDefault(); if (/^\d{1,30}$/u.test(id)) navigate(`/app/kunye/${id}`); }}>
          <Input placeholder={"Agent id, e.g. 1"} value={id} onChange={(e) => setId(e.target.value)} />
          <Button type="submit" tone="sea">{"READ"}</Button>
        </form>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <Card title={agentId ? `Künye #${agentId}` : "Read a tag"} kicker={`ARC ${environment.toUpperCase()} · IDENTITY REGISTRY`}>
            {!agentId ? <EmptyState title={"Type an id"} example="1" onExample={(x) => navigate(`/app/kunye/${x}`)} /> : view.isLoading ? <Skeleton h={180} /> : view.isError ? <p className="m-note m-note--bad">{describeError(view.error)}</p> : v ? (
              <div style={{ display: "grid", gap: 10 }}>
                <dl className="m-kv">
                  <dt>Owner</dt><dd>{v.owner}</dd>
                  <dt>Agent wallet</dt><dd>{v.agentWallet ?? "—"}</dd>
                  <dt>Card</dt><dd>{v.agentURI ? `${v.agentURI.slice(0, 40)}…` : "—"}</dd>
                  <dt>Validations</dt><dd>{v.validations.count}</dd>
                  <dt>Reputation</dt><dd>{v.reputation.count ?? 0} from {v.reputation.clients} clients</dd>
                </dl>
                {v.fenceInCard ? <Tag tone={v.fenceMatches === false ? "bad" : "ok"}>FENCE {v.fenceInCard.slice(0, 20)}… {v.fenceMatches === null ? "" : v.fenceMatches ? "· MATCHES CHAIN" : "· MISMATCH"}</Tag> : <Tag tone="ghost">{"NO FENCE IN THE CARD"}</Tag>}
                {v.cardNote ? <p className="m-note">{v.cardNote}</p> : null}
                {v.card ? <pre className="m-code" style={{ maxHeight: 220 }}>{JSON.stringify(v.card, null, 2)}</pre> : null}
              </div>
            ) : null}
          </Card>
          <Card title={"Draft a new tag"} kicker={"PINS YOUR SAVED FENCE"} footer={draft ? <Button onClick={() => void register()}>{"REGISTER ON ARC"}</Button> : <Button tone="sea" onClick={() => void makeDraft()}>{"DRAFT IT"}</Button>}>
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={"Name"}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label={"Description"}><textarea className="m-textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
              <p className="m-small m-muted">Fence: {fence.label ?? "custom"} · {fence.mode ?? "live"}</p>
              {draft ? (
                <>
                  <Tag tone="ok">FENCE {draft.fenceHash.slice(0, 22)}…</Tag>
                  <p className="m-small">{draft.transaction.label}</p>
                  <pre className="m-code" style={{ maxHeight: 200 }}>{JSON.stringify(draft.card, null, 2)}</pre>
                </>
              ) : null}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
