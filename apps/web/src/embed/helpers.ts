/** Pure helpers for the /embed pages (tested without a browser). */
import type { ProjectBrand, ProjectPublicView } from "@lykia/core";

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u;

/** Brand overrides from the frame URL (already checked by the element; checked again here). */
export function brandFromQuery(params: URLSearchParams): ProjectBrand {
  const hex = (k: string) => (/^#[0-9a-fA-F]{6}$/u.test(params.get(k) ?? "") ? (params.get(k) as string) : undefined);
  const colors = Object.fromEntries((["primary", "accent", "background", "foreground"] as const).map((k) => [k, hex(k)]).filter(([, v]) => v));
  const scheme = params.get("scheme");
  const radius = Number(params.get("radius"));
  return {
    ...(Object.keys(colors).length > 0 ? { colors } : {}),
    ...(scheme === "light" || scheme === "dark" || scheme === "auto" ? { scheme } : {}),
    ...(params.has("radius") && Number.isInteger(radius) && radius >= 0 && radius <= 24 ? { radius } : {}),
    ...(params.get("mosaic") === "off" ? { mosaic: false } : params.get("mosaic") === "on" ? { mosaic: true } : {}),
  };
}

/** May this parent frame the project? Verified origins only; local development hosts always. */
export function parentAllowed(parent: string, view: Pick<ProjectPublicView, "frameAncestors">): boolean {
  return view.frameAncestors.includes(parent) || LOCAL.test(parent);
}
