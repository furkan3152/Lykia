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
      toast.info("Come bye: re-counting the flock", { from: "LYKO", id: "cmd" });
      break;
    case "resniff":
      void queryClient.invalidateQueries({ queryKey: ["scent"] });
      toast.info("Away to me: re-sniffing every token", { from: "LYKO", id: "cmd" });
      break;
    case "advance":
      toast.info("Walk up: preparing the next step; you still sign it", { from: "LYKO", id: "cmd" });
      if (!window.location.pathname.startsWith("/app")) navigate("/app");
      break;
    case "whistle": {
      store.setWhistle(true);
      const who = whistleOwner();
      if (!who) {
        toast.warning("Lie down: the whistle is blown", { description: `${LYKO_LINES.resting} Sign in so Lykia stops your automations, agents and leashes on its side too.`, from: "LYKO", id: "cmd" });
        break;
      }
      void apiPost<{ items: { state: string }[] }>("/v1/whistle", { ...who, reason: "Blown from the Fold." })
        .then((r) => {
          const n = r.items.filter((i) => i.state === "paused").length;
          toast.warning("Lie down: the whistle is blown", { description: `${n} thing${n === 1 ? "" : "s"} stopped on Lykia's side. ${LYKO_LINES.resting}`, from: "LYKO", id: "cmd" });
        })
        .catch(() => toast.error("The Whistle did not reach Lykia", { description: "Your deck's Fence is in whistle mode; try again to stop things on the server.", from: "LYKO", id: "cmd" }))
        .finally(() => {
          for (const k of ["whistle", "autopilot", "fold-instructions", "pack", "fold-summary"]) void queryClient.invalidateQueries({ queryKey: [k] });
        });
      break;
    }
    case "release": {
      store.setWhistle(false);
      const who = whistleOwner();
      toast.success("That'll do: whistle released", { description: "The Fence runs on its normal rules again, and what the Whistle stopped runs again.", from: "LYKO", id: "cmd" });
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
      else toast.info("Look back: no outrun yet", { from: "LYKO", id: "cmd" });
      break;
    }
  }
}
