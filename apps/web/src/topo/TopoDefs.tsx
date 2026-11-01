/**
 * Shared SVG filters, mounted once by each layout (site and app):
 *   #el-ink    rubber-stamp ink: a rough edge plus voids where the pad ran dry
 *   #el-rough  a slightly uneven printed edge for single large shapes
 *   #el-grain  riso stipple, for art overlays (Grain)
 * Without these defs a stamp simply prints clean. Never animate an element
 * inside a filtered group; animate the group's parent.
 */
export function TopoDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      <defs>
        <filter id="el-ink" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={2} seed={4} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale={2.6} xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves={2} seed={9} result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -9 0 0 0 6.2" result="voids" />
          <feComposite in="rough" in2="voids" operator="in" />
        </filter>
        <filter id="el-rough" x="-4%" y="-4%" width="108%" height="108%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves={2} seed={2} result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale={1.6} xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="el-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={11} stitchTiles="stitch" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.1" />
        </filter>
      </defs>
    </svg>
  );
}
