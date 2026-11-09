/**
 * Fence · Safety. What used to be its own page, as three tesserae panels
 * inside the Fence tab:
 *
 *   Approvals     allowances left open to Arc venues, each with Revoke
 *                 (one transaction the owner signs)
 *   Token checks  what the Fence requires of a token, and a check of any
 *                 token before it is touched (Scent: never "safe")
 *   Pauses        what is paused in Lykia for the owner (the wallet, an
 *                 agent), with Resume, and "Pause my wallet in Lykia"
 *
 * Every figure here is read from the API; nothing is guessed.
 */
import type { Insight } from "@lykia/core/api/agents";
import type { Fence } from "@lykia/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { navigate } from "../../../app/routes/history";
import { PixelIcon, type PixelIconName } from "../../../city/PixelIcon";
import { apiGet, apiPost, describeError } from "../../../lib/api";
import { Button, Input, Tag, cx, toast } from "../../../mosaic";
import { useLykiaWallet } from "../../wallet/useLykiaWallet";
import type { FoldOwner } from "../data";

interface Pause {
  readonly subject: string;
  readonly reason: string;
  readonly by: string;
  readonly at: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Panel({ icon, tone, title, kick, children }: { readonly icon: PixelIconName; readonly tone: "sea" | "ochre" | "olive" | "terra" | "navy"; readonly title: string; readonly kick: string; readonly children: React.ReactNode }) {
  return (
    <section className="fd-safe__panel" data-tone={tone} aria-label={title}>
      <header className="fd-safe__head">
        <span className="fd-safe__tile" aria-hidden="true"><PixelIcon name={icon} size={20} /></span>
        <div>
          <h4>{title}</h4>
          <span className="fd-safe__kick">{kick}</span>
        </div>
      </header>
      <div className="fd-safe__body">{children}</div>
    </section>
  );
}

export function SafetySection({ owner, fence }: { readonly owner: FoldOwner; readonly fence: Fence }) {
  const wallet = useLykiaWallet();
  const qc = useQueryClient();
  const personal = owner.signedIn;
  const approvals = useQuery({ queryKey: ["security-approvals", owner.address, owner.environment], enabled: Boolean(owner.address), queryFn: ({ signal }) => apiGet<{ approvals: Insight[] }>("/v1/security/approvals", { signal, query: { owner: owner.address, environment: owner.environment } }) });
  const pauses = useQuery({ queryKey: ["security-pauses", owner.address], enabled: personal, queryFn: ({ signal }) => apiGet<{ pauses: Pause[] }>("/v1/security/pauses", { signal }) });
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const open = approvals.data?.approvals ?? [];
  const held = pauses.data?.pauses ?? [];
  const scent = fence.scent?.require ?? "no-red-flags";

  const revoke = async (a: Insight) => {
    if (owner.sample) return void toast.info("This is the sample flock", { description: "Connect a wallet to see and revoke your own approvals.", from: "LYKO" });
    setBusy(a.id);
    try {
      await wallet.sendForSubmit(a.transactions ?? []);
      toast.success("Allowance revoked", { description: a.title, from: "LYKO" });
      await qc.invalidateQueries({ queryKey: ["security-approvals"] });
    } catch (e) {
      toast.error("Revoke did not go through", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  const act = async (path: string, body: Record<string, string>, done: string) => {
    setBusy(path);
    try {
      await apiPost(path, body);
      toast.success(done, { from: "LYKO" });
      await qc.invalidateQueries({ queryKey: ["security-pauses"] });
    } catch (e) {
      toast.error("No change", { description: describeError(e), from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="fd-card m-frame m-frame--thin fd-safe" id="safety" aria-labelledby="safety-h">
      <header className="fd-safe__top">
        <h3 id="safety-h">{"Safety"}</h3>
        <span className="m-small m-muted">{"Approvals, token checks and pauses: the guards between a plan and your wallet."}</span>
      </header>
      <div className="fd-safe__grid">
        <Panel icon="key" tone="terra" title="Approvals" kick={!owner.address ? "SAMPLE: CONNECT TO SEE YOURS" : approvals.isLoading ? "READING…" : `${open.length} OPEN`}>
          {!owner.address ? (
            <p className="m-small m-muted">{"Allowances you left open to Arc venues show here, each with Revoke. Lykia itself approves exact amounts that the same transaction spends."}</p>
          ) : approvals.isLoading ? (
            <div className="m-skel" style={{ height: 60 }} />
          ) : open.length === 0 ? (
            <p className="fd-safe__calm"><PixelIcon name="check" size={14} />{" No allowance left open."}</p>
          ) : (
            <ul className="fd-safe__list">
              {open.slice(0, 4).map((a) => (
                <li key={a.id}>
                  <Tag tone={a.severity === "act" ? "bad" : "ochre"}>{a.severity === "act" ? "unlimited" : "open"}</Tag>
                  <span className="fd-safe__what"><b>{a.title}</b><small>{a.detail}</small></span>
                  <Button size="sm" tone="terra" disabled={busy === a.id} onClick={() => void revoke(a)}>{"REVOKE"}</Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel icon="eye" tone="olive" title="Token checks" kick={scent === "verified" ? "VERIFIED TOKENS ONLY" : scent === "off" ? "CHECKS OFF" : "NO RED FLAGS"}>
          <p className="m-small">{scent === "verified" ? "Your Fence lets Lyko touch registry-verified tokens only." : "Your Fence refuses any token with a red flag: a look-alike, a blocklist hit or a trap in its code."}</p>
          <form
            className="fd-safe__check"
            onSubmit={(e) => {
              e.preventDefault();
              const t = token.trim();
              if (/^0x[0-9a-fA-F]{40}$/u.test(t) || /^[A-Za-z0-9.]{2,12}$/u.test(t)) navigate(`/app/scent/${encodeURIComponent(t)}`);
            }}
          >
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token address or symbol" aria-label="Token to check" spellCheck={false} />
            <Button size="sm" tone="ghost" disabled={token.trim().length < 2}>{"CHECK"}</Button>
          </form>
          <small className="m-muted">{"What can be proven about it, never a promise that it is safe."}</small>
        </Panel>
        <Panel icon="shield" tone="navy" title="Pauses" kick={!personal ? "SIGN IN TO SEE YOURS" : `${held.length} PAUSED`}>
          {!personal ? (
            <p className="m-small m-muted">{"When Lykia's monitors or you pause your wallet or an agent, it shows here with Resume."}</p>
          ) : held.length === 0 ? (
            <p className="fd-safe__calm"><PixelIcon name="check" size={14} />{" Nothing is paused."}</p>
          ) : (
            <ul className="fd-safe__list">
              {held.map((p) => (
                <li key={p.subject}>
                  <Tag tone="bad">{"paused"}</Tag>
                  <span className="fd-safe__what"><b>{short(p.subject)}</b><small>{`${p.by} · ${p.reason}`}</small></span>
                  <Button size="sm" tone="sea" disabled={busy !== null} onClick={() => void act("/v1/security/resume", { subject: p.subject }, "Resumed")}>{"RESUME"}</Button>
                </li>
              ))}
            </ul>
          )}
          {personal && owner.address && !held.some((p) => p.subject.toLowerCase() === owner.address!.toLowerCase()) ? (
            <Button size="sm" tone="ghost" className={cx("fd-safe__pause")} disabled={busy !== null} onClick={() => void act("/v1/security/pause", { subject: owner.address!, reason: "Paused by the owner from the Fence" }, "Your wallet is paused in Lykia")}>{"PAUSE MY WALLET IN LYKIA"}</Button>
          ) : null}
        </Panel>
      </div>
    </section>
  );
}
