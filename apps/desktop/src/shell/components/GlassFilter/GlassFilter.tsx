/** The refraction filters behind the app's glass surfaces.
 *
 * Blur alone is frosted plastic, not glass. What reads as glass is *lensing*: the content behind
 * the edge of the pane bends, the way it does through the rim of a lens, while the middle stays
 * straight. CSS has no primitive for that, so it is done with an SVG filter that feeds a
 * displacement map to `backdrop-filter`.
 *
 * Mounted once, at the root, rather than by each surface that uses it: a filter is addressed by a
 * document-wide id, so a copy per instance would be a duplicate id whose lifetime is tied to
 * whichever instance happened to mount first. */

interface RefractionProps {
  id: string;
  /** The proportions the map is drawn at. It is stretched to whatever it is applied to, so these
   *  set how the rim's thickness divides between the long side and the short one. */
  width: number;
  height: number;
  /** How far in the flat centre starts, in the map's own units — the width of the rim. */
  inset: number;
  /** The centre's corner radius, matched to the surface's own so the bend follows its outline
   *  rather than cutting a different shape across it. */
  radius: number;
  /** How far the rim bends, in pixels. Raising it thickens the lens; flipping the sign turns the
   *  surface from convex to concave. */
  scale: number;
  /** The frost, as the blur's standard deviation — roughly half a CSS `blur()` radius. This is what
   *  decides whether the surface reads as glass or as a dirty window: too little and the rows
   *  behind stay legible as *text* through the pane, which is the single thing that made the first
   *  cut look cheap. */
  frost: number;
}

/** One filter, and the displacement map it reads.
 *
 * `feDisplacementMap` moves each pixel by how far its map colour is from the middle: red drives x,
 * green drives y, and 0.5 (#808080) means "leave it alone". So the map is a red ramp
 * left-to-right and a green ramp top-to-bottom — pushing content outward near every edge — with a
 * neutral rounded rect laid over the middle to hold the centre flat. `screen` is what lets the two
 * ramps occupy one image without overwriting each other. */
function Refraction({ id, width, height, inset, radius, scale, frost }: RefractionProps) {
  const map = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="x" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000"/>
      <stop offset="1" stop-color="#f00"/>
    </linearGradient>
    <linearGradient id="y" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000"/>
      <stop offset="1" stop-color="#0f0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#000"/>
  <rect width="${width}" height="${height}" fill="url(#x)" style="mix-blend-mode:screen"/>
  <rect width="${width}" height="${height}" fill="url(#y)" style="mix-blend-mode:screen"/>
  <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${radius}" fill="#808080"/>
</svg>`;

  return (
    /* The region is pinned to the element rather than left at the default -10%/120%: an oversized
       region on a backdrop filter samples past the surface and drags the edge of what it bends in
       with it. sRGB because the map's channels are being read as numbers, and linearRGB — the
       default — would rescale them on the way in. */
    <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feImage
        href={`data:image/svg+xml;utf8,${encodeURIComponent(map)}`}
        preserveAspectRatio="none"
        result="map"
      />
      {/* Softens the seam where the ramps meet the flat centre, so the rim eases into the
          undistorted middle instead of stepping into it. */}
      <feGaussianBlur in="map" stdDeviation="2" result="softMap" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="softMap"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="G"
        result="bent"
      />
      {/* The frost and the lift in colour, applied after the bend — in the filter rather than in
          the CSS, because a `backdrop-filter` that mixes `url()` with the shorthand functions is
          the shakiest part of the feature across engines. */}
      <feGaussianBlur in="bent" stdDeviation={frost} result="frosted" />
      <feColorMatrix in="frosted" type="saturate" values="1.7" />
    </filter>
  );
}

/** Two, because the bend has to follow the outline of what it is bending around, and the app's
 *  glass comes in two outlines: the capsule of the loading pill, and the 8–12px rounded rect every
 *  menu, bubble and toast is drawn as. One map stretched across both put a capsule's corners on a
 *  rectangle's. */
function GlassFilter() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      // Present but not laid out. `display: none` would take the filters down with it.
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        <Refraction
          id="mixdb-glass-pill"
          width={200}
          height={56}
          inset={9}
          radius={19}
          scale={20}
          frost={8}
        />
        {/* Squarer proportions, a wider rim and a much shallower bend than the pill. A menu or a
            toast is a far bigger pane, so the same displacement that reads as a lens on a capsule
            drags whole table cells into a panel's edge — which is what made the panels look coarse
            beside the pill. Widening the rim and softening the bend spreads the same effect over
            more pixels, and the heavier frost keeps what it drags in from being readable. */}
        <Refraction
          id="mixdb-glass-panel"
          width={100}
          height={100}
          inset={9}
          radius={8}
          scale={8}
          frost={10}
        />
      </defs>
    </svg>
  );
}

export default GlassFilter;
