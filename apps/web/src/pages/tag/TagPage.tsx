/** Tag: an agent's ERC-8004 identity on Arc, pinning the hash of the Fence it obeys. */
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../app/routes/history";
import { useRouteParam } from "../../app/routes/useRoute";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLykiaStore } from "../../lib/lykiaStore";
import { Button, Card, EmptyState, Field, Input, Medallion, PageHead, Skeleton, Tag, toast } from "../../mosaic";
import { t } from "../../i18n";

interface TagView { readonly agentId: string; readonly owner: string; readonly agentWallet: string | null; readonly agentURI?: string | null; readonly card?: unknown; readonly cardNote?: string; readonly fenceInCard?: string | null; readonly fenceMatches?: boolean | null; readonly validations: { count: number; averageResponse: number | null }; readonly erc8354?: { count: number; averageResponse: number | null; tag: string; guard: string | null }; readonly reputation: { clients: number; count: number | null; value: string | null } }
interface Draft { readonly card: unknown; readonly cardDigest: string; readonly fenceHash: string; readonly agentURI: string; readonly transaction: { chainId: number; to: `0x${string}`; data: `0x${string}`; value: string; label: string } }

export default function TagPage() {
  const environment = useEnvironment();
  const agentId = useRouteParam("agentId") ?? null;
  const wallet = useLykiaWallet();
  const { address } = wallet;
  const fence = useLykiaStore((s) => s.fence);
  const [id, setId] = useState(agentId ?? "");
  const [name, setName] = useState(t("tag.treasurer"));
  const [description, setDescription] = useState(t("tag.paysSuppliersAndKeepsIdleUsdc"));
  const [draft, setDraft] = useState<Draft | null>(null);
  const view = useQuery({ queryKey: ["tag", agentId, environment], enabled: Boolean(agentId), queryFn: ({ signal }) => apiGet<TagView>(`/v1/tags/${agentId}`, { query: { environment }, signal, timeoutMs: 20_000 }) });
  const makeDraft = async () => {
    if (!address) return toast.warning(t("tag.connectAWalletFirst"), { from: "LYKO" });
    try {
      setDraft(await apiPost<Draft>("/v1/tags/draft", { environment, owner: address, name, description, fence }));
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  const register = async () => {
    if (!draft) return;
    try {
      const [hash] = await wallet.send([draft.transaction]);
      toast.success(t("tag.tagRegistrationSent"), { description: hash, from: "LYKO" });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    }
  };
  const v = view.data;
  return (
    <div>
      <PageHead kicker={t("tag.fenceTagAgentIdentityErc8004")} title={<>{t("tag.everyAgentWearsA")} <em>{t("tag.tag3")}</em></>} sub={t("tag.aTagIsAnErc8004")} medal={false}>
        <div style={{ marginTop: 8 }}><Medallion size={180} spin title={v ? t("tag.tag", { agentId: v.agentId }) : t("tag.tag2")} /></div>
        <form className="flex gap-2 justify-center" style={{ marginTop: 16, maxWidth: 420, marginInline: "auto" }} onSubmit={(e) => { e.preventDefault(); if (/^\d{1,30}$/u.test(id)) navigate(`/app/tag/${id}`); }}>
          <Input placeholder={t("tag.agentIdEG1")} value={id} onChange={(e) => setId(e.target.value)} />
          <Button type="submit" tone="sea">{t("tag.read")}</Button>
        </form>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2">
          <Card title={agentId ? t("tag.tag", { agentId }) : t("tag.readATag")} kicker={t("tag.arcIdentityRegistry", { environment: environment.toUpperCase() })}>
            {!agentId ? <EmptyState title={t("tag.typeAnId")} example="1" onExample={(x) => navigate(`/app/tag/${x}`)} /> : view.isLoading ? <Skeleton h={180} /> : view.isError ? <p className="m-note m-note--bad">{describeError(view.error)}</p> : v ? (
              <div style={{ display: "grid", gap: 10 }}>
                <dl className="m-kv">
                  <dt>{t("tag.owner")}</dt><dd>{v.owner}</dd>
                  <dt>{t("tag.agentWallet")}</dt><dd>{v.agentWallet ?? "—"}</dd>
                  <dt>{t("tag.card")}</dt><dd>{v.agentURI ? `${v.agentURI.slice(0, 40)}…` : "—"}</dd>
                  <dt>{t("tag.validations")}</dt><dd>{v.validations.count}</dd>
                  <dt>{t("tag.erc8354PolicyVerdicts")}</dt><dd>{v.erc8354 ? `${v.erc8354.count}${v.erc8354.averageResponse !== null ? t("tag.avg100", { averageResponse: v.erc8354.averageResponse }) : ""}` : "—"}</dd>
                  <dt>{t("tag.reputation")}</dt><dd>{v.reputation.count ?? 0} {t("tag.from")} {v.reputation.clients} {t("tag.clients")}</dd>
                </dl>
                {v.fenceInCard ? <Tag tone={v.fenceMatches === false ? "bad" : "ok"}>FENCE {v.fenceInCard.slice(0, 20)}… {v.fenceMatches === null ? "" : v.fenceMatches ? t("tag.matchesChain") : t("tag.mismatch")}</Tag> : <Tag tone="ghost">{t("tag.noFenceInTheCard")}</Tag>}
                {v.cardNote ? <p className="m-note">{v.cardNote}</p> : null}
                <p className="m-small m-muted">{t("tag.policyVerdictsFollowErc8354Each")}</p>
                {v.card ? <pre className="m-code" style={{ maxHeight: 220 }}>{JSON.stringify(v.card, null, 2)}</pre> : null}
              </div>
            ) : null}
          </Card>
          <Card title={t("tag.draftANewTag")} kicker={t("tag.pinsYourSavedFence")} footer={draft ? <Button onClick={() => void register()}>{t("tag.registerOnArc")}</Button> : <Button tone="sea" onClick={() => void makeDraft()}>{t("tag.draftIt")}</Button>}>
            <div style={{ display: "grid", gap: 10 }}>
              <Field label={t("tag.name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label={t("tag.description")}><textarea className="m-textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
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
