import type { ArcEnvironment } from "@lykia/core";

import { useUiStore } from "../app/state/uiStore";

/** The Arc environment the interface reads and plans on (the header's mode chip). */
export function useEnvironment(): ArcEnvironment {
  return useUiStore((s) => s.mode);
}
