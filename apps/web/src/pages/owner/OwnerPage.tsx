/** Owner console: Lykia's contracts deployed step by step from the owner's wallet, recorded and checked. */
import { lykiaContracts } from "@lykia/core";
import type { DeploymentRecord, FeatureFlag } from "@lykia/core/api/platform";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, useSendTransaction, useSwitchChain, usePublicClient } from "wagmi";

import { useSiwe } from "../../features/session/useSiwe";
import { apiGet, apiPost, apiPut, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { useLang } from "../../lib/i18n";
import { Button, Card, EmptyState, PageHead, Tag, toast } from "../../mosaic";

export default function OwnerPage() {
  const lang = useLang();
  const environment = useEnvironment();
  const { address, chainId } = useAccount();
  const siwe = useSiwe();
  const qc = useQueryClient();
  const client = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const [busy, setBusy] = useState<number | null>(null);
  const plan = address ? lykiaContracts.deployPlan(environment, address) : null;
  const deployments = useQuery({ queryKey: ["deployments", environment], queryFn: ({ signal }) => apiGet<{ deployments: DeploymentRecord[] }>("/v1/deployments", { query: { environment }, signal }) });
  const admin = siwe.session?.roles.includes("admin") ?? false;
  const flags = useQuery({ queryKey: ["flags"], enabled: admin, queryFn: ({ signal }) => apiGet<Record<FeatureFlag, boolean>>("/v1/admin/flags", { signal }) });
  const recorded = new Set((deployments.data?.deployments ?? []).map((d) => d.address.toLowerCase()));

  const deploy = async (step: lykiaContracts.DeployStep) => {
    if (!plan) return;
    setBusy(step.step);
    try {
      if (chainId !== plan.chainId) await switchChainAsync({ chainId: plan.chainId });
      const hash = await sendTransactionAsync({ to: step.tx.to, data: step.tx.data, value: 0n, chainId: plan.chainId });
      await client?.waitForTransactionReceipt({ hash });
      if (admin) await apiPost("/v1/admin/deployments", { environment, contract: step.contract, address: step.predictedAddress, txHash: hash });
      toast.success(`${step.name} deployed`, { description: step.predictedAddress, from: "LYKO" });
      void qc.invalidateQueries({ queryKey: ["deployments"] });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHead kicker={lang === "tr" ? "SAHİP KONSOLU · KONTRATLAR" : "OWNER CONSOLE · CONTRACTS"} title={lang === "tr" ? <>Taşları <em>sen döşe.</em></> : <>Lay the stones <em>yourself.</em></>} sub={lang === "tr" ? "Her kontrat CREATE2 ile, senin cüzdanın imzasıyla deploy edilir; konsol oluşan kodu artefaktla karşılaştırır. Repoda hiç özel anahtar yok. Denetlenmedi: küçük tutarlarla kullan." : "Each contract goes out through CREATE2, signed by your wallet; the console compares the created code with the artifact. No private keys in the repo. Not audited: use small amounts."} mood="alert">
        <div className="flex justify-center gap-2" style={{ marginTop: 16 }}>
          {siwe.signedIn ? <Tag tone={admin ? "ok" : "ghost"}>{admin ? "ADMIN" : "SIGNED IN · NOT ADMIN"}</Tag> : <Button onClick={() => void siwe.signIn()}>{lang === "tr" ? "ARC İLE GİRİŞ" : "SIGN IN ON ARC"}</Button>}
          <Tag tone="sea">ARC {environment.toUpperCase()}</Tag>
        </div>
      </PageHead>
      <section className="m-wrap" style={{ marginTop: 28 }}>
        <div className="m-grid-2 m-grid-2--l">
          <Card title={lang === "tr" ? "Deploy planı" : "Deploy plan"} kicker={plan ? `${plan.steps.length} STEPS · DEPLOYER ${plan.deployer.slice(0, 8)}…` : ""}>
            {!plan ? <EmptyState title={lang === "tr" ? "Cüzdan bağla" : "Connect a wallet"} /> : (
              <div className="m-stops">
                {plan.steps.map((s) => {
                  const done = recorded.has(s.predictedAddress.toLowerCase());
                  return (
                    <div key={s.step} className="m-stop" data-status={done ? "settled" : "ready"}>
                      <div className="flex justify-between items-start gap-2">
                        <div><b>{s.step}. {s.name}</b><small>{s.predictedAddress}</small>{s.note ? <p className="m-small m-muted">{s.note}</p> : null}</div>
                        {done ? <Tag tone="ok">RECORDED</Tag> : <Button size="sm" onClick={() => void deploy(s)} disabled={busy !== null}>{busy === s.step ? "…" : lang === "tr" ? "İMZALA" : "SIGN"}</Button>}
                      </div>
                    </div>
                  );
                })}
                {plan.notes.map((n) => <p key={n} className="m-note">{n}</p>)}
              </div>
            )}
          </Card>
          <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
            <Card title={lang === "tr" ? "Kayıtlı" : "Recorded"} kicker="RECEIPT + BYTECODE CHECKED">
              {(deployments.data?.deployments ?? []).length === 0 ? <p className="m-muted m-center m-small">{lang === "tr" ? "Henüz kayıt yok." : "Nothing recorded yet."}</p> : (deployments.data?.deployments ?? []).map((d) => <div key={d.id} className="m-row"><Tag tone={d.verified ? "ok" : "bad"}>{d.verified ? "OK" : "CODE?"}</Tag><div><b>{d.contract}</b><p className="m-small num">{d.address}</p></div></div>)}
            </Card>
            <Card title={lang === "tr" ? "Bayraklar" : "Flags"} kicker="ADMIN">
              {!admin ? <p className="m-muted m-small m-center">{lang === "tr" ? "Sadece admin." : "Admins only."}</p> : Object.entries(flags.data ?? {}).map(([k, v]) => (
                <label key={k} className="m-row" style={{ justifyContent: "space-between" }}><span className="num m-small">{k}</span><input type="checkbox" checked={v} onChange={async (e) => { try { await apiPut("/v1/admin/flags", { [k]: e.target.checked }); void qc.invalidateQueries({ queryKey: ["flags"] }); } catch (err) { toast.error(describeError(err), { from: "LYKO" }); } }} /></label>
              ))}
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
