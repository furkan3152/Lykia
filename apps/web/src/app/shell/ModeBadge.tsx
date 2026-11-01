import { cx, FOCUS_RING } from "../../ui/cx";
import { Popover } from "../../ui/Popover";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { modeAvailability, type NetworkMode } from "../state/uiPrefs";
import { useUiStore } from "../state/uiStore";

/**
 * The network-mode chip: "PRACTICE PASTURE · TESTNET" or "ARC MAINNET".
 * Testnet and mainnet capital never share an intent.
 */
export function ModeBadge({ className, compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  const mainnet = modeAvailability("mainnet");
  return (
    <Popover
      label="Network mode"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={cx(
            "inline-flex h-6 shrink-0 items-center gap-2 px-2.5 font-tag text-[11px] uppercase px-btn px-btn-thin",
            mode === "testnet" ? "px-btn-signal text-[#1B1714]" : "px-btn-ink text-paper",
            FOCUS_RING,
            className,
          )}
        >
          {mode === "testnet" ? (compact ? "TESTNET" : "PRACTICE PASTURE · TESTNET") : "ARC MAINNET"}
          <span aria-hidden="true">▾</span>
        </button>
      )}
    >
      {() => (
        <div className="flex w-[290px] flex-col gap-3">
          <p className="caption !text-ink">Network mode</p>
          <SegmentedControl<NetworkMode>
            label="Network mode"
            value={mode}
            onChange={(next) => setMode(next)}
            fullWidth
            options={[
              { value: "testnet", label: "Practice pasture" },
              { value: "mainnet", label: "Mainnet", disabled: !mainnet.available, hint: mainnet.reason ?? undefined },
            ]}
          />
          <p className="text-[13px] leading-relaxed text-ink-2">
            {mainnet.available
              ? "Mainnet uses real funds. The practice pasture and mainnet never share an intent."
              : (mainnet.reason ?? "Mainnet is not available yet.")}
          </p>
          <p className="font-mono text-xs text-ink-3">Arc testnet 5042002 · Arc mainnet 5042 · separate capital</p>
        </div>
      )}
    </Popover>
  );
}
