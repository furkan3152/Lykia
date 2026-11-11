/**
 * Lykia's protocol fee, as the API reports it (GET /v1/fees), with the
 * core defaults while the API is unreachable.
 */
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_FEE_BPS, FEE_POLICY_TEXT, feePercent } from "@lykia/core";

import { apiGet } from "../../lib/api";
import { Card, Tag } from "../../mosaic";
import { t } from "../../i18n";

interface FeesView {
  readonly bps: number;
  readonly percent: string;
  readonly recipient: string;
  readonly policy: string;
  readonly exempt: readonly string[];
}

export function FeesCard({ compact = false }: { readonly compact?: boolean }) {
  const q = useQuery({ queryKey: ["fees"], queryFn: ({ signal }) => apiGet<FeesView>("/v1/fees", { signal }), staleTime: 300_000 });
  const percent = q.data?.percent ?? feePercent(DEFAULT_FEE_BPS);
  return (
    <Card title={t("fees.feesCard.fees")} kicker={t("fees.feesCard.perStepPaidOnChain", { percent })}>
      <p className="m-small">{q.data?.policy ?? FEE_POLICY_TEXT}</p>
      {!compact ? (
        <>
          <div className="flex gap-1 flex-wrap" style={{ marginTop: 8 }}>
            {["send", "swap", "FX", "deposit", "supply", "borrow", "bridge"].map((k) => (
              <Tag key={k} tone="ghost">{`${k.toUpperCase()} · ${percent}`}</Tag>
            ))}
            {(q.data?.exempt ?? ["repay", "withdraw", "approve", "revoke"]).map((k) => (
              <Tag key={k} tone="ok">{t("fees.feesCard.free", { k: k.toUpperCase() })}</Tag>
            ))}
          </div>
          <p className="m-small m-muted" style={{ marginTop: 8 }}>
            {t("fees.feesCard.theFeeIsATokenTransfer")}
          </p>
        </>
      ) : null}
    </Card>
  );
}
