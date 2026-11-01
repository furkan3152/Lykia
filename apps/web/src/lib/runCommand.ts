/**
 * Runs a sheepdog command from the whistle box or the deck. No command
 * moves value: they refresh, re-sniff, advance the deck's next step (which
 * still needs a wallet signature), or blow / release the Whistle.
 */
import { LYKO_LINES, type CommandAction } from "@lykia/core";

import { queryClient } from "../app/queryClient";
import { navigate } from "../app/routes/history";
import { toast } from "../mosaic/toast";
import { useLykiaStore } from "./lykiaStore";

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
    case "whistle":
      store.setWhistle(true);
      toast.warning("Lie down: the whistle is blown", { description: (LYKO_LINES.resting).en, from: "LYKO", id: "cmd" });
      break;
    case "release":
      store.setWhistle(false);
      toast.success("That'll do: whistle released", { description: "The Fence runs on its normal rules again.", from: "LYKO", id: "cmd" });
      break;
    case "lookback": {
      const last = store.lastOutrun;
      if (last) navigate(`/app/outrun/${encodeURIComponent(last)}`);
      else toast.info("Look back: no outrun yet", { from: "LYKO", id: "cmd" });
      break;
    }
  }
}
