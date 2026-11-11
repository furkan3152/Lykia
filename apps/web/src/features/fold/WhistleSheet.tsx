/**
 * The Whistle's answer, from the server: exactly what it stopped (every
 * automation, standing order, agent automation, Pack agent, leash and
 * Autopilot), each with Resume, a Resume-everything, and the blowWhistle()
 * transaction for the owner's LykiaAccount so the on-chain sessions stop
 * too. The sheet sits at night, like the Fold while the Whistle is blown.
 */
import type { WhistleItem, WhistleResponse } from "@lykia/core/api/fold";
import { useState } from "react";

import { Sheet } from "../../city/Sheet";
import { PixelIcon } from "../../city/PixelIcon";
import { describeError } from "../../lib/api";
import { Button, Tag, toast } from "../../mosaic";
import { useLykiaWallet } from "../wallet/useLykiaWallet";
import { useWallet } from "../wallet/store";
import { whistleGroups } from "./model";
import { t as msg } from "../../i18n";

export function WhistleSheet({ open, onClose, state, busyId, onResume, onResumeAll }: { readonly open: boolean; readonly onClose: () => void; readonly state: WhistleResponse | undefined; readonly busyId: string | null; readonly onResume: (i: WhistleItem) => void; readonly onResumeAll: () => void }) {
  const wallet = useLykiaWallet();
  const openModal = useWallet((s) => s.openModal);
  const [sent, setSent] = useState<string | null>(null);
  const items = state?.items ?? [];
  const held = items.filter((i) => i.state === "paused");
  const signOnChain = async () => {
    if (!state?.transaction) return;
    if (!wallet.connected) return openModal();
    try {
      const t = state.transaction;
      const [hash] = await wallet.send([{ to: t.to, data: t.data, value: t.value, chainId: t.chainId }]);
      setSent(hash ?? "sent");
      toast.success(msg("fold.whistleSheet.whistleBlownOnChain"), { description: msg("fold.whistleSheet.everySessionOnYourLykiaaccountStops"), from: "LYKO" });
    } catch (e) {
      toast.error(msg("fold.whistleSheet.notSent"), { description: describeError(e), from: "LYKO" });
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={held.length > 0 ? msg("fold.whistleSheet.theWhistleIsBlown") : msg("fold.whistleSheet.theWhistle")}>
      <div className="fd-whistle" data-blown={held.length > 0 || undefined}>
        <div className="fd-whistle__head">
          <span className="fd-whistle__icon" aria-hidden="true"><PixelIcon name="whistle" size={30} /></span>
          <div>
            <b className="fd-whistle__count">{held.length === 0 ? msg("fold.whistleSheet.nothingIsHeld") : msg("fold.whistleSheet.thingsStopped", { n: held.length })}</b>
            <p className="m-small">{state?.note ?? msg("fold.whistleSheet.readingWhatTheWhistleHolds")}</p>
          </div>
        </div>
        {whistleGroups(items).map((g) => (
          <section key={g.kind} className="fd-whistle__group" aria-label={g.label}>
            <span className="m-kick">{g.label.toUpperCase()}</span>
            <ul>
              {g.items.map((i, n) => (
                <li key={i.id} className="fd-whistle__row" data-state={i.state} style={{ "--i": n } as React.CSSProperties}>
                  <span className="fd-whistle__tile" aria-hidden="true" />
                  <span className="fd-whistle__name">
                    <b>{i.label}</b>
                    <small>{i.environment ? `Arc ${i.environment}` : msg("fold.whistleSheet.everyNetwork")}</small>
                  </span>
                  {i.state === "paused" ? (
                    <Button size="sm" tone="ghost" disabled={busyId === i.id} onClick={() => onResume(i)}>{busyId === i.id ? "…" : "RESUME"}</Button>
                  ) : (
                    <Tag tone="ok">{msg("fold.whistleSheet.runningAgain")}</Tag>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {state?.transaction ? (
          <div className="fd-whistle__chain">
            <span className="m-kick">{msg("fold.whistleSheet.onChain")}</span>
            <p className="m-small">{msg("fold.whistleSheet.stillAcceptsSessions", { account: state.account ? `${state.account.slice(0, 6)}…${state.account.slice(-4)}` : "" })}</p>
            <Button size="sm" disabled={Boolean(sent)} onClick={() => void signOnChain()}>{sent ? "SENT" : msg("fold.whistleSheet.signCall", { call: "blowWhistle()" })}</Button>
          </div>
        ) : held.length > 0 ? (
          <p className="m-small m-muted">{msg("fold.whistleSheet.noLykiaaccountYetSoThereIs")}</p>
        ) : null}
        {held.length > 0 ? (
          <div className="fd-whistle__foot">
            <Button tone="ochre" onClick={onResumeAll} disabled={busyId === "all"}>{busyId === "all" ? "…" : msg("fold.whistleSheet.releaseResumeEverything")}</Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
