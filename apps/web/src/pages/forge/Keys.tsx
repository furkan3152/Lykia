/** Keys tab: live and test keys, fine-grained scopes, rotation with an overlap window, IP allowlists. */
import { FINE_API_KEY_SCOPES, SCOPE_DESCRIPTIONS, type ApiKeyView, type CreatedApiKey, type FineApiKeyScope } from "@lykia/core/api/platform";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiFetch, apiGet, apiPost, describeError } from "../../lib/api";
import { Button, Card, EmptyState, Field, Input, Select, Skeleton, Tag, toast } from "../../mosaic";
import { ScrollTable } from "./portalShared";
import { t } from "../../i18n";

const fail = (e: unknown) => toast.error(describeError(e), { from: "LYKO" });
const DEFAULT_SCOPES: FineApiKeyScope[] = ["read", "quote", "build", "execute", "agents", "automation"];

export function Keys({ enabled }: { readonly enabled: boolean }) {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["dev-keys"], enabled, queryFn: ({ signal }) => apiGet<{ keys: ApiKeyView[] }>("/v1/developers/keys", { signal }) });
  const [label, setLabel] = useState("server");
  const [kind, setKind] = useState<"secret" | "publishable">("secret");
  const [mode, setMode] = useState<"test" | "live">("test");
  const [scopes, setScopes] = useState<FineApiKeyScope[]>(DEFAULT_SCOPES);
  const [ips, setIps] = useState("");
  const [overlap, setOverlap] = useState("86400");
  const [shown, setShown] = useState<CreatedApiKey | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editIps, setEditIps] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["dev-keys"] });
  const ipList = (text: string) => text.split(/[\s,]+/u).map((s) => s.trim()).filter(Boolean);

  const create = useMutation({
    mutationFn: () =>
      apiPost<CreatedApiKey>("/v1/developers/keys", {
        label,
        kind,
        mode,
        scopes: kind === "publishable" ? scopes.filter((s) => s === "read" || s === "quote" || s === "build") : scopes,
        ...(kind === "publishable" ? { allowedOrigins: [window.location.origin] } : {}),
        ...(ips.trim() ? { allowedIps: ipList(ips) } : {}),
      }),
    onSuccess: (k) => {
      setShown(k);
      refresh();
    },
    onError: fail,
  });
  const rotate = useMutation({ mutationFn: (id: string) => apiPost<CreatedApiKey>(`/v1/developers/keys/${id}/rotate`, { overlapSeconds: Number(overlap) }), onSuccess: (k) => { setShown(k); refresh(); }, onError: fail });
  const revoke = useMutation({ mutationFn: (id: string) => apiPost<ApiKeyView>(`/v1/developers/keys/${id}/revoke`, {}), onSuccess: refresh, onError: fail });
  const saveIps = useMutation({
    mutationFn: (id: string) => apiFetch<ApiKeyView>(`/v1/developers/keys/${id}`, { method: "PATCH", body: { allowedIps: ipList(editIps) } }),
    onSuccess: () => { setEditing(null); refresh(); toast.success(t("forge.keys.ipAllowlistSaved"), { from: "LYKO" }); },
    onError: fail,
  });

  if (!enabled) return <EmptyState title={t("forge.keys.signInFirst")}>{t("forge.keys.keysBelongToYourDeveloperWallet")}</EmptyState>;
  const list = keys.data?.keys ?? [];
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      {shown ? (
        <div className="m-note" role="status" style={{ overflowWrap: "anywhere" }}>
          <b>{t("forge.keys.shownOnce")}</b> <code className="num">{shown.secret}</code>
          {shown.previousSecretExpiresAt ? <span className="m-small"> {t("forge.keys.theOldSecretKeepsWorkingUntil")} {shown.previousSecretExpiresAt}.</span> : null}
          <div style={{ marginTop: 6 }}><Button size="sm" tone="ghost" onClick={() => void navigator.clipboard?.writeText(shown.secret)}>{t("forge.keys.copy")}</Button> <Button size="sm" tone="ghost" onClick={() => setShown(null)}>{t("forge.keys.hide")}</Button></div>
        </div>
      ) : null}
      <Card title={t("forge.keys.apiKeys")} kicker={t("forge.keys.testLiveOnlyAnHmacIs")}>
        {keys.isLoading ? <Skeleton h={120} /> : list.length === 0 ? <p className="m-small m-muted">{t("forge.keys.noKeysYetStartWithA")}</p> : (
          <ScrollTable label={t("forge.keys.apiKeys")}>
            <thead><tr><th>{t("forge.keys.label")}</th><th>{t("forge.keys.mode")}</th><th>{t("forge.keys.prefix")}</th><th>{t("forge.keys.scopes")}</th><th>{t("forge.keys.ips")}</th><th>{t("forge.keys.lastUsed")}</th><th /></tr></thead>
            <tbody>
              {list.map((k) => (
                <tr key={k.id} style={k.revokedAt ? { opacity: 0.55 } : undefined}>
                  <td>{k.label}<div className="m-small m-muted">{k.kind}</div></td>
                  <td><Tag tone={k.mode === "test" ? "sea" : k.mode === "live" ? "bad" : "ghost"}>{k.mode ?? "legacy"}</Tag></td>
                  <td className="num m-small">{k.prefix}</td>
                  <td className="m-small">{k.scopes.join(", ")}</td>
                  <td className="m-small">
                    {editing === k.id ? (
                      <div style={{ display: "grid", gap: 4, minWidth: 160 }}>
                        <Input aria-label={t("forge.keys.allowedIps")} value={editIps} onChange={(e) => setEditIps(e.target.value)} placeholder="203.0.113.0/24, 2001:db8::1" />
                        <div className="flex gap-2"><Button size="sm" onClick={() => saveIps.mutate(k.id)}>{t("forge.keys.save")}</Button><Button size="sm" tone="ghost" onClick={() => setEditing(null)}>{t("forge.keys.cancel")}</Button></div>
                      </div>
                    ) : (k.allowedIps ?? []).length > 0 ? (k.allowedIps ?? []).join(", ") : "any"}
                  </td>
                  <td className="m-small">{k.lastUsedAt ? k.lastUsedAt.slice(0, 10) : "never"}</td>
                  <td>
                    {k.revokedAt ? <Tag tone="ghost">{t("forge.keys.revoked")}</Tag> : (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" tone="sea" onClick={() => rotate.mutate(k.id)} disabled={rotate.isPending}>{t("forge.keys.rotate")}</Button>
                        <Button size="sm" tone="ghost" onClick={() => { setEditing(k.id); setEditIps((k.allowedIps ?? []).join(", ")); }}>{t("forge.keys.ips2")}</Button>
                        <Button size="sm" tone="ghost" onClick={() => { if (window.confirm(t("forge.keys.revokeRequestsWithItFailAt", { prefix: k.prefix }))) revoke.mutate(k.id); }}>{t("forge.keys.revoke")}</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        )}
        <div style={{ marginTop: 10, maxWidth: 320 }}>
          <Field label={t("forge.keys.rotationOverlap")} hint={t("forge.keys.howLongTheOldSecretKeeps")}>
            <Select value={overlap} onChange={(e) => setOverlap(e.target.value)}>
              <option value="0">{t("forge.keys.noneImmediate")}</option>
              <option value="3600">{t("forge.keys.n1Hour")}</option>
              <option value="86400">{t("forge.keys.n24Hours")}</option>
              <option value="604800">{t("forge.keys.n7Days")}</option>
            </Select>
          </Field>
        </div>
      </Card>
      <Card title={t("forge.keys.newKey")} kicker={t("forge.keys.scopesIpAllowlist")} footer={<Button disabled={create.isPending || !label} onClick={() => create.mutate()}>CREATE KEY</Button>}>
        <div className="m-grid-2" style={{ gap: 12 }}>
          <Field label={t("forge.keys.label")}><Input value={label} maxLength={48} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label={t("forge.keys.mode")} hint={mode === "test" ? t("forge.keys.lkTestArcTestnetOnlyNever") : t("forge.keys.lkLiveMainnetAndTestnet")}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as "test" | "live")}><option value="test">{t("forge.keys.testSandbox")}</option><option value="live">{t("forge.keys.live")}</option></Select>
          </Field>
          <Field label={t("forge.keys.kind")} hint={kind === "publishable" ? t("forge.keys.boundToThisOriginReadQuote") : t("forge.keys.serverSideOnly")}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as "secret" | "publishable")}><option value="secret">{t("forge.keys.secret")}</option><option value="publishable">{t("forge.keys.publishable")}</option></Select>
          </Field>
          <Field label={t("forge.keys.allowedIps")} hint={t("forge.keys.optionalAddressesOrCidrRangesComma")}><Input value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.0/24" /></Field>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
          <legend className="m-kick">{t("forge.keys.scopes")}</legend>
          <div className="m-grid-2" style={{ gap: 6, marginTop: 6 }}>
            {FINE_API_KEY_SCOPES.map((s) => (
              <label key={s} className="m-small" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))} />
                <span><b>{s}</b> <span className="m-muted">{SCOPE_DESCRIPTIONS[s]}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>
    </div>
  );
}
