/**
 * LykiaRouter venue allowlist (GET /v1/admin/router): which venues the
 * deployed router may call, and the owner's unsigned `setVenue` calls for
 * the ones still missing. Split swaps run atomically through the router only
 * once both legs' venues are allowlisted; until then they run as separate steps.
 */
import { explorerAddress, networkFor, type ArcEnvironment, type UnsignedTransaction } from "@lykia/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { apiGet, describeError } from "../../lib/api";
import { Button, Card, Tag, toast } from "../../mosaic";
import { t } from "../../i18n";

interface RouterStatusView {
  readonly address: string | null;
  readonly owner: string | null;
  readonly paused: boolean | null;
  readonly venues: readonly { venue: string; label: string; address: string; allowed: boolean | null }[];
  readonly adminCalls: readonly UnsignedTransaction[];
}

export function RouterVenuesCard({ admin, environment }: { readonly admin: boolean; readonly environment: ArcEnvironment }) {
  const wallet = useLykiaWallet();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const status = useQuery({ queryKey: ["admin-router", environment], enabled: admin, queryFn: ({ signal }) => apiGet<RouterStatusView>("/v1/admin/router", { query: { environment }, signal }) });
  const network = networkFor(environment);
  const isOwner = Boolean(wallet.address && status.data?.owner && wallet.address.toLowerCase() === status.data.owner.toLowerCase());

  const sign = async (tx: UnsignedTransaction, i: number) => {
    setBusy(i);
    try {
      if (wallet.wrongChain) await wallet.switchToArc();
      await wallet.send([{ to: tx.to, data: tx.data, value: 0n, chainId: tx.chainId }]);
      toast.success(tx.label ?? t("deploy.routerVenuesCard.venueAllowlisted"), { from: "LYKO" });
      void qc.invalidateQueries({ queryKey: ["admin-router", environment] });
    } catch (e) {
      toast.error(describeError(e), { from: "LYKO" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={t("deploy.routerVenuesCard.lykiarouterVenues")} kicker={status.data?.paused ? "PAUSED" : t("deploy.routerVenuesCard.splitSwapsOneTransaction")}>
      {!admin ? <p className="m-muted m-small m-center">{t("deploy.routerVenuesCard.adminsOnly")}</p> : !status.data ? <p className="m-muted m-small m-center">{status.isError ? describeError(status.error) : t("deploy.routerVenuesCard.readingTheRouter")}</p> : !status.data.address ? (
        <p className="m-muted m-small">{t("deploy.routerVenuesCard.lykiarouterIsNotDeployedOnThis")}</p>
      ) : (
        <>
          <p className="m-small m-muted">
            {t("deploy.routerVenuesCard.router")}<a className="num" href={explorerAddress(network, status.data.address)} target="_blank" rel="noreferrer">{status.data.address.slice(0, 10)}…</a>
            {status.data.owner ? <>{t("deploy.routerVenuesCard.owner")}<span className="num">{status.data.owner.slice(0, 8)}…</span></> : null}
          </p>
          {status.data.venues.map((v) => (
            <div key={v.address} className="m-row" style={{ justifyContent: "space-between" }}>
              <span className="m-small">{v.label}</span>
              <Tag tone={v.allowed ? "ok" : v.allowed === false ? "ghost" : "bad"}>{v.allowed ? "ALLOWED" : v.allowed === false ? t("deploy.routerVenuesCard.notAllowed") : "UNKNOWN"}</Tag>
            </div>
          ))}
          {status.data.adminCalls.map((tx, i) => (
            <div key={tx.data} className="flex justify-between items-center gap-2" style={{ marginTop: 8 }}>
              <span className="m-small">{tx.label}</span>
              <Button size="sm" tone="ghost" disabled={!isOwner || busy !== null} onClick={() => void sign(tx, i)}>{busy === i ? "…" : "SIGN"}</Button>
            </div>
          ))}
          {status.data.adminCalls.length > 0 && !isOwner ? <p className="m-note">{t("deploy.routerVenuesCard.connectTheRouterOwnerSWallet")}</p> : null}
          {status.data.adminCalls.length === 0 ? <p className="m-note">{t("deploy.routerVenuesCard.everyVenueIsAllowlistedSplitSwaps")}</p> : <p className="m-note">{t("deploy.routerVenuesCard.untilTheseAreSignedSplitSwaps")}</p>}
        </>
      )}
    </Card>
  );
}
