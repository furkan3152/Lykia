/**
 * What a preflight fix chip does where it is tapped. A re-plan is sent as
 * the owner's own sentence (so it is grounded like any option the owner
 * picks); a pause goes through the row's own Herding control; adding USDC
 * copies the address (it needs no gas from this wallet); the rest open the
 * page that changes it. Nothing here signs.
 */
import type { FindingFix } from "@lykia/core";

import { navigate } from "../../app/routes/history";
import { apiGet, apiPost, describeError } from "../../lib/api";
import { toast } from "../../mosaic";

export interface FixEffects {
  readonly ask?: (sentence: string) => void;
  readonly switchNetwork?: () => Promise<void>;
}

export async function runFix(fix: FindingFix, effects: FixEffects): Promise<void> {
  switch (fix.kind) {
    case "replan":
      if (fix.sentence && effects.ask) effects.ask(fix.sentence);
      else if (fix.sentence) navigate(`/app?intent=${encodeURIComponent(fix.sentence)}`);
      return;
    case "pause":
      if (!fix.path) return;
      try {
        await (fix.method === "get" ? apiGet(fix.path) : apiPost(fix.path, fix.body ?? {}));
        toast.success(`Paused: ${fix.label.replace(/^Pause\s*/u, "")}`, { description: "Resume it in Herding any time.", from: "LYKO" });
      } catch (error) {
        toast.error("Could not pause it", { description: describeError(error), from: "LYKO" });
      }
      return;
    case "add-funds":
      if (fix.address) {
        try {
          await navigator.clipboard.writeText(fix.address);
          toast.success("Address copied", { description: `Send USDC on Arc to ${fix.address}. Receiving needs no gas from this wallet.`, from: "LYKO" });
        } catch {
          toast.info("Send USDC on Arc to this address", { description: fix.address, from: "LYKO" });
        }
      }
      return;
    case "switch-network":
      if (effects.switchNetwork) await effects.switchNetwork().catch((error: unknown) => toast.error("The wallet did not switch", { description: describeError(error), from: "LYKO" }));
      return;
    case "wait":
      toast.info(fix.label, { description: `${fix.detail ?? "It is on its way"}. Ask again once it has landed.`, from: "LYKO" });
      return;
    case "open":
    case "change-fence":
      if (fix.path) navigate(fix.path);
      return;
  }
}
