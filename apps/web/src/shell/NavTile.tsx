/**
 * The three primary areas as Mosaic objects: a small hand-drawn pixel icon
 * set in a stone plate, and the name. No visible subtitle: the plain word
 * ("your agent") rides in the accessible name and the tooltip instead.
 * The active tile is an inlaid, lit plate with a meander that draws in.
 */
import { NavIcon } from "../mosaic/PixelArt";
import { navTileText, type NavArea } from "./nav";

/** The inside of a tile (icon plate, name, badge, meander); the Link around it is the shell's. */
export function NavTileBody({ area, badge = 0, short = false }: { readonly area: Pick<NavArea, "id" | "label" | "sub" | "tab">; readonly badge?: number; readonly short?: boolean }) {
  const text = navTileText(area, badge);
  return (
    <>
      <span className="m-navtile__plate" aria-hidden="true">
        <NavIcon name={area.id} size={short ? 26 : 24} />
        {badge > 0 ? <span className="m-navtile__badge">{badge > 9 ? "9+" : badge}</span> : null}
      </span>
      <span className="m-navtile__l" aria-hidden="true">
        {short ? text.visibleShort : text.visible}
      </span>
      <span className="m-navtile__key" aria-hidden="true" />
    </>
  );
}
