/**
 * Review and sign for LykiaOrders, in the same modal as a plan: the order a
 * chat drafted (rebuilt and re-checked against the Fence and the beta cap
 * as it opens, then the allowance and one EIP-712 signature), and the cancel
 * of an open order from Herding (one transaction the maker sends).
 */
import type { AnswerBlock } from "@lykia/core/api/answer";
import type { ArcEnvironment } from "@lykia/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { apiGet, apiPost, describeError } from "../../lib/api";
import { toast } from "../../mosaic";
import { useLykiaWallet, type WalletTx } from "../wallet/useLykiaWallet";
import { useWallet } from "../wallet/store";
import { ReviewDialog } from "./ReviewModal";
import { cancelReviewView, orderReviewView, signableOrder, type OrderDraft, type OrderStepState } from "./orderReview";
import { classifyTxError, type TxFailure } from "./txErrors";
import type { ReviewPhase } from "./useReviewFlow";

type OrderBlock = Extract<AnswerBlock, { kind: "order" }>;

export function OrderReviewModal({ block, open, onClose, onArmed }: { readonly block: OrderBlock; readonly open: boolean; readonly onClose: () => void; readonly onArmed?: () => void }) {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const qc = useQueryClient();
  const [phase, setPhase] = useState<ReviewPhase>("idle");
  const [failure, setFailure] = useState<TxFailure | null>(null);
  const [states, setStates] = useState<{ approval: OrderStepState; sign: OrderStepState }>({ approval: "pending", sign: "pending" });
  const [confirmed, setConfirmed] = useState(false);
  // Rebuilt as the modal opens: a fresh nonce and deadline, and the Fence and beta verdict judged again for this owner.
  const drafted = useQuery({
    queryKey: ["order-draft", wallet.address, block.environment, block.input],
    enabled: open && Boolean(wallet.address),
    staleTime: 60_000,
    retry: false,
    queryFn: () => apiPost<OrderDraft>("/v1/orders/draft", { owner: wallet.address, environment: block.environment, ...block.input }, { timeoutMs: 20_000 }),
  });
  const draft = drafted.data ?? null;
  const draftFailure: TxFailure | null = drafted.isError ? { kind: "fence", title: "The order could not be prepared", detail: describeError(drafted.error), retry: "none", retryLabel: null, sent: false, raw: String(drafted.error) } : null;
  const shownPhase: ReviewPhase = drafted.isFetching && !draft ? "quoting" : draftFailure ? "failed" : phase;

  const view = useMemo(() => orderReviewView(block, draft, states), [block, draft, states]);

  const sign = async () => {
    if (!draft || !wallet.address) return;
    try {
      setFailure(null);
      if (draft.approval && states.approval !== "settled") {
        setPhase("signing");
        await wallet.send([draft.approval as unknown as WalletTx]);
        setStates((s) => ({ ...s, approval: "settled" }));
      }
      setPhase("signing");
      const signature = await wallet.signTypedData(signableOrder(draft.typedData));
      setPhase("submitting");
      await apiPost("/v1/orders", { environment: block.environment, kind: block.input.kind, summary: draft.summary, order: draft.order, signature });
      setStates({ approval: "settled", sign: "settled" });
      setPhase("settled");
      toast.success("Order armed", { description: draft.summary, from: "LYKO" });
      await qc.invalidateQueries({ queryKey: ["fold-instructions"] });
      onArmed?.();
    } catch (e) {
      setFailure(classifyTxError(e, "sign"));
      setPhase("failed");
    }
  };

  return (
    <ReviewDialog
      open={open}
      onClose={onClose}
      title={draft?.summary ?? block.summary}
      view={view}
      phase={shownPhase}
      failure={failure ?? draftFailure}
      security={null}
      refreshes={0}
      quotedAt={drafted.dataUpdatedAt || null}
      lastTx={null}
      connected={Boolean(wallet.address)}
      walletLabel={wallet.kind === "passkey" ? "passkey" : null}
      confirmed={confirmed}
      onConfirm={setConfirmed}
      onSign={() => void sign()}
      onRetry={() => (draft ? void sign() : void drafted.refetch())}
      onConnect={openModal}
      txCount={draft ? (draft.approval && states.approval !== "settled" ? 1 : 0) : null}
    />
  );
}

/** Cancel an open order from Herding: one transaction, reviewed in the same modal. Mount one per order (key by hash). */
export function CancelOrderModal({ order, open, onClose }: { readonly order: { readonly hash: string; readonly name: string; readonly environment: ArcEnvironment } | null; readonly open: boolean; readonly onClose: () => void }) {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const qc = useQueryClient();
  const [phase, setPhase] = useState<ReviewPhase>("idle");
  const [failure, setFailure] = useState<TxFailure | null>(null);
  const [state, setState] = useState<OrderStepState>("pending");
  const [lastTx, setLastTx] = useState<`0x${string}` | null>(null);
  if (!order) return null;
  const view = cancelReviewView(order, state);
  const sign = async () => {
    try {
      setFailure(null);
      setPhase("quoting");
      const tx = await apiGet<WalletTx & { label: string }>(`/v1/orders/${order.hash}/cancel-tx`, { query: { environment: order.environment } });
      setPhase("signing");
      const [hash] = await wallet.send([tx]);
      setLastTx(hash ?? null);
      setState("settled");
      setPhase("settled");
      toast.success("Order cancelled", { description: order.name, from: "LYKO" });
      await qc.invalidateQueries({ queryKey: ["fold-instructions"] });
    } catch (e) {
      setFailure(classifyTxError(e, "sign"));
      setPhase("failed");
    }
  };
  return (
    <ReviewDialog
      open={open}
      onClose={onClose}
      title={`Cancel: ${order.name}`}
      view={view}
      phase={phase}
      failure={failure}
      security={null}
      refreshes={0}
      quotedAt={null}
      lastTx={lastTx}
      connected={Boolean(wallet.address)}
      walletLabel={wallet.kind === "passkey" ? "passkey" : null}
      confirmed
      onConfirm={() => undefined}
      onSign={() => void sign()}
      onRetry={() => void sign()}
      onConnect={openModal}
      txCount={1}
    />
  );
}
