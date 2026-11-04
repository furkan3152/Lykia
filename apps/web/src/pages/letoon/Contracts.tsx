/**
 * Letoon · contracts and deployments: Lykia's contracts created step by step by plain CREATE
 * transactions from the owner's own wallet (so explorers show that wallet as
 * the creator), checked against the artifacts and recorded.
 */
import { useLykiaWallet } from "../../features/wallet/useLykiaWallet";
import { explorerAddress, explorerTx, lykiaContracts, networkFor } from "@lykia/core";
import type { DeploymentRecord } from "@lykia/core/api/platform";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePublicClient, useSendTransaction } from "wagmi";

import { allDeployed, creationBlocker, deployedFromRecords, nextAddress, stepStates } from "../../features/deploy/model";

import { RouterVenuesCard } from "../../features/deploy/RouterVenuesCard";
import { useSiwe } from "../../features/session/useSiwe";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { useEnvironment } from "../../lib/environment";
import { Button, Card, EmptyState, Tag, toast } from "../../mosaic";

/** The deploy plan, the recorded deployments and the router venues. `admin` comes from the server (Letoon checked it). */
export function Contracts({ admin }: { readonly admin: boolean }) {
  const environment = useEnvironment();
  const wallet = useLykiaWallet();
  const { address } = wallet;
  const siwe = useSiwe();
  const qc = useQueryClient();
  const client = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const [busy, setBusy] = useState<string | null>(null);
  const plan = address ? lykiaContracts.deployPlan(environment, address) : null;
  const blocker = creationBlocker(wallet.kind);
  const network = networkFor(environment);
  const nonce = useQuery({
    queryKey: ["nonce", environment, address],
    enabled: Boolean(address && client && wallet.kind === "browser"),
    refetchInterval: 15_000,
    queryFn: async () => (client && address ? client.getTransactionCount({ address, blockTag: "pending" }) : null),
  });
  const deployments = useQuery({ queryKey: ["deployments", environment], queryFn: ({ signal }) => apiGet<{ deployments: DeploymentRecord[] }>("/v1/deployments", { query: { environment }, signal }) });
  const records = deployments.data?.deployments ?? [];
  const deployed = deployedFromRecords(records, environment);
  const states = plan ? stepStates(plan, deployed) : {};
  const ready = plan ? allDeployed(plan, deployed) : false;

  /** One step: a contract-creation transaction from the connected wallet, then a code check and the record. */
  const deploy = async (step: lykiaContracts.DeployStep) => {
    if (!plan || !client || blocker) return;
    setBusy(step.name);
    try {
      if (!admin) throw new Error("Sign in on Arc with an admin wallet first, so the deployment can be recorded.");
      if (wallet.wrongChain) await wallet.switchToArc();
      const tx = lykiaContracts.resolveStep(step, deployed);
      const hash = await sendTransactionAsync({ data: tx.data, chainId: plan.chainId });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${step.name}: the creation transaction did not create a contract.`);
      const code = await client.getCode({ address: receipt.contractAddress });
      if (!code || lykiaContracts.codeMatchesArtifact(step.contract, code) === false) throw new Error(`${step.name}: the code at ${receipt.contractAddress} does not match the artifact. Not recorded.`);
      await apiPost("/v1/admin/deployments", { environment, contract: step.contract, name: step.name, address: receipt.contractAddress, txHash: hash });
      toast.success(`${step.name} created by your wallet`, { description: receipt.contractAddress, from: "LYKO" });
      void qc.invalidateQueries({ queryKey: ["deployments"] });
      void qc.invalidateQueries({ queryKey: ["nonce"] });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  /** Admin calls after deployment (testnet: allowlist the practice venues on the router). */
  const runCall = async (call: lykiaContracts.PlanCall, index: number) => {
    if (!plan) return;
    setBusy(`call-${index}`);
    try {
      const tx = lykiaContracts.resolveCall(call, deployed);
      const [hash] = await wallet.send([{ to: tx.to, data: tx.data, value: 0n, chainId: plan.chainId }]);
      if (hash) await client?.waitForTransactionReceipt({ hash });
      toast.success(call.note, { from: "LYKO" });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
        <div className="flex justify-center gap-2" style={{ marginBottom: 16 }}>
          {siwe.signedIn ? <Tag tone={admin ? "ok" : "ghost"}>{admin ? "ADMIN" : "SIGNED IN · NOT ADMIN"}</Tag> : null}
          <Tag tone="sea">ARC {environment.toUpperCase()}</Tag>
        </div>
      <section>
        <div className="m-grid-2 m-grid-2--l">
          <Card title={"Deploy plan"} kicker={plan ? `${plan.steps.length} STEPS · CREATOR ${plan.deployer.slice(0, 6)}…${plan.deployer.slice(-4)}` : ""}>
            {!plan ? <EmptyState title={"Connect a wallet"} /> : (
              <div className="m-stops">
                {blocker ? <p className="m-note m-note--bad">{blocker}</p> : (
                  <p className="m-note">
                    {"Creator: your wallet "}<a className="num" href={explorerAddress(network, plan.deployer)} target="_blank" rel="noreferrer">{plan.deployer.slice(0, 8)}…{plan.deployer.slice(-6)}</a>
                    {nonce.data != null ? <>{" · next contract lands at "}<span className="num">{nextAddress(plan.deployer, nonce.data).slice(0, 10)}…</span></> : null}
                  </p>
                )}
                {plan.steps.map((s) => {
                  const state = states[s.name];
                  const at = deployed[s.name];
                  const record = records.find((r) => (r.name ?? r.contract) === s.name);
                  return (
                    <div key={s.step} className="m-stop" data-status={state === "done" ? "settled" : "ready"}>
                      <div className="flex justify-between items-start gap-2">
                        <div style={{ minWidth: 0 }}>
                          <b>{s.step}. {s.name}</b>
                          {at ? <small className="num" style={{ overflowWrap: "anywhere" }}><a href={explorerAddress(network, at)} target="_blank" rel="noreferrer">{at}</a></small> : <small>{"Address set when your wallet creates it"}</small>}
                          {record ? <p className="m-small m-muted">{"Created by "}<span className="num">{(record.creator ?? record.recordedBy).slice(0, 8)}…</span>{" · "}<a href={explorerTx(network, record.txHash)} target="_blank" rel="noreferrer">{"transaction"}</a></p> : s.note ? <p className="m-small m-muted">{s.note}</p> : null}
                        </div>
                        {state === "done" ? <Tag tone="ok">RECORDED</Tag> : (
                          <Button size="sm" onClick={() => void deploy(s)} disabled={busy !== null || state !== "next" || blocker !== null}>{busy === s.name ? "…" : state === "next" ? "CREATE" : "WAIT"}</Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {plan.initCalls.length > 0 ? (
                  <div className="m-stop" data-status={ready ? "ready" : "blocked"}>
                    <b>{"After deployment"}</b>
                    {plan.initCalls.map((c, i) => (
                      <div key={c.note} className="flex justify-between items-center gap-2" style={{ marginTop: 8 }}>
                        <span className="m-small">{c.note}</span>
                        <Button size="sm" tone="ghost" disabled={!ready || busy !== null} onClick={() => void runCall(c, i)}>{busy === `call-${i}` ? "…" : "SIGN"}</Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {plan.notes.map((n) => <p key={n} className="m-note">{n}</p>)}
              </div>
            )}
          </Card>
          <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
            <Card title={"Recorded"} kicker="RECEIPT + BYTECODE CHECKED">
              {records.length === 0 ? <p className="m-muted m-center m-small">{"Nothing recorded yet."}</p> : records.map((d) => <div key={d.id} className="m-row"><Tag tone={d.verified ? "ok" : "bad"}>{d.verified ? "OK" : "CODE?"}</Tag><div style={{ minWidth: 0 }}><b>{d.name ?? d.contract}</b><p className="m-small num" style={{ overflowWrap: "anywhere" }}>{d.address}</p>{d.creator ? <p className="m-small m-muted">{"Creator "}<span className="num">{d.creator.slice(0, 8)}…</span></p> : null}</div></div>)}
            </Card>
            <RouterVenuesCard admin={admin} environment={environment} />
          </div>
        </div>
      </section>
    </div>
  );
}
