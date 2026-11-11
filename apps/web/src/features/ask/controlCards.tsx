/**
 * Two cards that keep Ask honest about whose money it is and what it may
 * change:
 *
 *   SampleBar     no wallet is connected: one slim line at the top of the
 *                 conversation, with the Connect action on it.
 *   RunningCard   something running that the owner named, with the same one
 *                 control its row has in Herding. Nothing changes until the
 *                 owner presses it; a control that needs a signature opens
 *                 the wallet, exactly as it does in the Fold.
 */
import type { UnsignedTransaction } from "@lykia/core";
import type { AnswerBlock } from "@lykia/core/api/agents";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Link } from "../../app/routes/Link";
import { PixelIcon } from "../../city/PixelIcon";
import { apiDelete, apiGet, apiPost, describeError } from "../../lib/api";
import { useSession } from "../../lib/session";
import { toast } from "../../mosaic";
import { cx } from "../../mosaic/cx";
import { useWallet } from "../wallet/store";
import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { t } from "../../i18n";

type RunningBlock = Extract<AnswerBlock, { kind: "running" }>;
type RunningItem = RunningBlock["items"][number];

/** A row of hatched tesserae: the mark Lykia uses wherever a figure is a sample. */
function SampleBand() {
  return (
    <span className="m-sample__band" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** No wallet: one slim line at the top of the conversation, with Connect. Answers never repeat it. */
export function SampleBar() {
  const openModal = useWallet((s) => s.openModal);
  return (
    <aside className="m-sample m-sample--bar" role="note">
      <SampleBand />
      <p className="m-sample__line">{t("ask.controlCards.sampleModeNoWalletIsConnected")}</p>
      <button type="button" className="m-mini m-mini--solid m-sample__cta" onClick={openModal}>
        <PixelIcon name="key" size={14} />
        {t("ask.controlCards.connect")}
      </button>
    </aside>
  );
}

const DONE: Readonly<Record<string, string>> = { pause: t("ask.controlCards.paused"), resume: t("ask.controlCards.runningAgain"), stop: t("ask.controlCards.stopped"), cancel: t("ask.controlCards.cancelled") };
const ICON: Readonly<Record<string, "repeat" | "order" | "eye" | "leash" | "pilot" | "plan" | "coin">> = { automation: "repeat", standing: "repeat", recurring: "coin", order: "order", watch: "eye", alert: "eye", leash: "leash", "pack-agent": "leash", autopilot: "pilot", "autopilot-task": "pilot", plan: "plan" };

function RunningRow({ item }: { readonly item: RunningItem }) {
  const qc = useQueryClient();
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const session = useSession((st) => st.session);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const c = item.control;
  const signedIn = Boolean(session && wallet.address && session.address.toLowerCase() === wallet.address.toLowerCase());
  const run = async () => {
    if (!c || state !== "idle") return;
    if (!signedIn) {
      if (!wallet.connected) openModal();
      else toast.info(t("ask.controlCards.signInFirst"), { description: t("ask.controlCards.oneMessageNoTransactionItProves"), from: "LYKO" });
      return;
    }
    setState("busy");
    try {
      const options = c.query ? { query: c.query } : {};
      const r = c.method === "delete" ? await apiDelete<unknown>(c.path, options) : c.method === "get" ? await apiGet<unknown>(c.path, options) : await apiPost<{ transaction?: UnsignedTransaction | null }>(c.path, c.body ?? {}, options);
      for (const k of ["fold-instructions", "fold-summary", "fold-insights", "pack", "leashes", "autopilot", "fold-positions"]) void qc.invalidateQueries({ queryKey: [k] });
      const tx = (r as { transaction?: UnsignedTransaction | null } | null)?.transaction;
      // A leash's key dies at the API at once; the session on chain ends with one signature.
      if (c.sign === "revoke-session" && tx) await wallet.send([{ to: tx.to, data: tx.data, value: tx.value, chainId: tx.chainId }]);
      setState("done");
      toast.success(c.label === "Revoke" ? t("ask.controlCards.keyStopped") : (DONE[c.action] ?? t("ask.controlCards.done")), { description: item.name, from: "LYKO" });
    } catch (e) {
      setState("idle");
      toast.error(t("ask.controlCards.noChange"), { description: describeError(e), from: "LYKO" });
    }
  };
  const stop = c && (c.action === "stop" || c.action === "cancel");
  return (
    <li className="m-run__row" data-status={item.status} data-done={state === "done" || undefined}>
      <span className="m-run__icon" aria-hidden="true"><PixelIcon name={ICON[item.source] ?? "repeat"} size={18} /></span>
      <span className="m-run__text">
        <span className="m-run__k">{`${item.sourceLabel} · ${item.status}`}</span>
        <b>{item.name}</b>
        {item.nextLine ? <span className="m-run__next">{item.nextLine}</span> : null}
      </span>
      {!c ? (
        <Link to="/app/fold/herding" className="m-mini">{t("ask.controlCards.openHerding")}</Link>
      ) : c.sign === "order-cancel" ? (
        // Cancelling an order is a transaction built for that order: Herding holds its review.
        <Link to="/app/fold/herding?show=orders" className="m-mini m-mini--stop">{t("ask.controlCards.cancelInHerding")}</Link>
      ) : state === "done" ? (
        <span className="m-run__done">{c.label === "Revoke" ? t("ask.controlCards.keyStopped") : (DONE[c.action] ?? t("ask.controlCards.done"))}</span>
      ) : (
        <button type="button" className={cx("m-mini", stop ? "m-mini--stop" : "m-mini--solid")} disabled={state === "busy"} onClick={() => void run()} title={c.sign === "revoke-session" ? t("ask.controlCards.theKeyStopsAtOnceThen") : t("ask.controlCards.nothingChangesUntilYouPressThis")}>
          {state === "busy" ? "…" : c.label}
        </button>
      )}
    </li>
  );
}

export function RunningCard({ block }: { readonly block: RunningBlock }) {
  return (
    <section className="m-card2 m-run" data-kind="running" data-tone="navy">
      <header className="m-card2__head">
        <span className="m-card2__icon" aria-hidden="true"><PixelIcon name="list" size={20} /></span>
        <span className="m-card2__titles">
          <span className="m-card2__kick">{t("ask.controlCards.herdingYouConfirm")}</span>
          <span className="m-card2__title">{block.title}</span>
        </span>
      </header>
      <div className="m-card2__body">
        <ul className="m-run__list">
          {block.items.map((item) => (
            <RunningRow key={`${item.source}:${item.id}`} item={item} />
          ))}
        </ul>
        {block.note ? <p className="m-card2__note">{block.note}</p> : null}
        <div className="m-card2__acts">
          <Link to="/app/fold/herding" className="m-mini">{t("ask.controlCards.openHerding")}</Link>
        </div>
      </div>
    </section>
  );
}
