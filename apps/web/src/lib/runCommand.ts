/**
 * Runs a sheepdog command from the whistle box or the deck. No command
 * moves value: they refresh, re-sniff, advance the deck's next step (which
 * still needs a wallet signature), or blow / release the Whistle. The Whistle
 * is the server's: blowing it pauses every automation, standing order, agent
 * automation, Pack agent, leash and Autopilot the signed-in owner has
 * (POST /v1/whistle); releasing it resumes what it stopped.
 */
import { LYKO_LINES, type CommandAction } from "@lykia/core";

import { queryClient } from "../app/queryClient";
import { navigate } from "../app/routes/history";
import { toast } from "../mosaic/toast";
import { useUiStore } from "../app/state/uiStore";
import { apiPost } from "./api";
import { useLykiaStore } from "./lykiaStore";
import { sessionToken, useSession } from "./session";
import { t } from "../i18n";

/** The signed-in owner the server Whistle acts for; null signed out (the deck's Fence still turns to whistle mode). */
function whistleOwner(): { owner: string; environment: string } | null {
  const session = useSession.getState().session;
  return session && sessionToken() ? { owner: session.address, environment: useUiStore.getState().mode } : null;
}

export function runCommand(action: CommandAction): void {
  const store = useLykiaStore.getState();
  store.issue(action);
  switch (action) {
    case "rescan":
      void queryClient.invalidateQueries({ queryKey: ["flock"] });
      toast.info(t("lib.runCommand.comeByeReCountingTheFlock"), { from: "LYKO", id: "cmd" });
      break;
    case "resniff":
      void queryClient.invalidateQueries({ queryKey: ["scent"] });
      toast.info(t("lib.runCommand.awayToMeReSniffingEvery"), { from: "LYKO", id: "cmd" });
      break;
    case "advance":
      toast.info(t("lib.runCommand.walkUpPreparingTheNextStep"), { from: "LYKO", id: "cmd" });
      if (!window.location.pathname.startsWith("/app")) navigate("/app");
      break;
    case "whistle": {
      store.setWhistle(true);
      const who = whistleOwner();
      if (!who) {
        toast.warning(t("lib.runCommand.lieDownTheWhistleIsBlown"), { description: t("lib.runCommand.signInSoLykiaStopsYour", { resting: LYKO_LINES.resting }), from: "LYKO", id: "cmd" });
        break;
      }
      void apiPost<{ items: { state: string }[] }>("/v1/whistle", { ...who, reason: "Blown from the Fold." })
        .then((r) => {
          const n = r.items.filter((i) => i.state === "paused").length;
          toast.warning(t("lib.runCommand.lieDownTheWhistleIsBlown"), { description: `${t("lib.runCommand.thingsStoppedOnLykiasSide", { n })} ${LYKO_LINES.resting}`, from: "LYKO", id: "cmd" });
        })
        .catch(() => toast.error(t("lib.runCommand.theWhistleDidNotReachLykia"), { description: t("lib.runCommand.yourDeckSFenceIsIn"), from: "LYKO", id: "cmd" }))
        .finally(() => {
          for (const k of ["whistle", "autopilot", "fold-instructions", "pack", "fold-summary"]) void queryClient.invalidateQueries({ queryKey: [k] });
        });
      break;
    }
    case "release": {
      store.setWhistle(false);
      const who = whistleOwner();
      toast.success(t("lib.runCommand.thatLlDoWhistleReleased"), { description: t("lib.runCommand.theFenceRunsOnItsNormal"), from: "LYKO", id: "cmd" });
      if (who)
        void apiPost("/v1/whistle/resume", who)
          .catch(() => undefined)
          .finally(() => {
            for (const k of ["whistle", "autopilot", "fold-instructions", "pack", "fold-summary"]) void queryClient.invalidateQueries({ queryKey: [k] });
          });
      break;
    }
    case "lookback": {
      const last = store.lastOutrun;
      if (last) navigate(`/app/outrun/${encodeURIComponent(last)}`);
      else toast.info(t("lib.runCommand.lookBackNoOutrunYet"), { from: "LYKO", id: "cmd" });
      break;
    }
  }
}
