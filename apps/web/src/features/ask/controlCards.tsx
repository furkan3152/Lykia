/**
 * Two cards that keep Ask honest about whose money it is and what it may
 * change:
 *
 *   SampleCard    no wallet is connected: the answer is about a sample
 *                 address, said first, with the Connect action on it.
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

type SampleBlock = Extract<AnswerBlock, { kind: "sample" }>;
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

export function SampleCard({ block }: { readonly block: SampleBlock }) {
  const openModal = useWallet((s) => s.openModal);
  const { connected } = useLykiaWallet();
  return (
    <aside className="m-sample" role="note" aria-label="Sample address, not your wallet">
      <SampleBand />
      <div className="m-sample__body">
        <span className="m-sample__k">{"SAMPLE ADDRESS · NOT YOUR WALLET"}</span>
        <p className="m-sample__line">{block.line}</p>
        <code className="m-sample__addr" title={block.address}>{`${block.address.slice(0, 6)}…${block.address.slice(-4)}`}</code>
      </div>
      {connected ? (
        <span className="m-sample__done">{"Wallet connected: ask again for your own"}</span>
      ) : (
        <button type="button" className="m-mini m-mini--solid m-sample__cta" onClick={openModal}>
          <PixelIcon name="key" size={14} />
          {block.cta}
        </button>
      )}
    </aside>
  );
}

const DONE: Readonly<Record<string, string>> = { pause: "Paused", resume: "Running again", stop: "Stopped", cancel: "Cancelled" };
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
      else toast.info("Sign in first", { description: "One message, no transaction: it proves the wallet is yours.", from: "LYKO" });
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
      toast.success(c.label === "Revoke" ? "Key stopped" : (DONE[c.action] ?? "Done"), { description: item.name, from: "LYKO" });
    } catch (e) {
      setState("idle");
      toast.error("No change", { description: describeError(e), from: "LYKO" });
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
        <Link to="/app/fold/herding" className="m-mini">{"Open Herding"}</Link>
      ) : c.sign === "order-cancel" ? (
        // Cancelling an order is a transaction built for that order: Herding holds its review.
        <Link to="/app/fold/herding?show=orders" className="m-mini m-mini--stop">{"Cancel in Herding"}</Link>
      ) : state === "done" ? (
        <span className="m-run__done">{c.label === "Revoke" ? "Key stopped" : (DONE[c.action] ?? "Done")}</span>
      ) : (
        <button type="button" className={cx("m-mini", stop ? "m-mini--stop" : "m-mini--solid")} disabled={state === "busy"} onClick={() => void run()} title={c.sign === "revoke-session" ? "The key stops at once; then your wallet ends its session on chain" : "Nothing changes until you press this"}>
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
          <span className="m-card2__kick">{"HERDING · YOU CONFIRM"}</span>
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
          <Link to="/app/fold/herding" className="m-mini">{"Open Herding"}</Link>
        </div>
      </div>
    </section>
  );
}
