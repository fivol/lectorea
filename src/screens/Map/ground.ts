/**
 * The ground inside every territory, and the water around them all: the tile
 * collection, on the real map.
 *
 * The screen asks one question — what does this field look like — and three
 * files answer it. `shared/tiles/biomes.ts` says which biome a domain is (and,
 * on the same line, what colour it is painted), `shared/tiles/fill.ts` works
 * out which hexes the territory owns and what goes on them, and the collection
 * itself draws the pieces. Nothing here knows how a mountain is drawn, and
 * nothing there knows what a domain is.
 *
 * The result is markup rather than React elements. A field of relief is a few
 * thousand paths that never change once they are drawn — there is nothing for
 * React to reconcile, and building the components would cost more than the
 * drawing does. What does change with a filter is one `opacity` on the group,
 * which is why the markup is cut per territory instead of coming out as one
 * string for the whole map.
 */

import { ringOf } from '@shared/polygon';
import {
  biomeFor,
  cellsIn,
  fillCells,
  fillMarkup,
  findTile,
  oceanCells,
  terrain as neutral,
  OCEAN,
  type HexGrid,
  type Palette,
} from '@shared/tiles';
import { GROUND } from '@shared/view';
import type { ParsedMap } from '@/lib/map';

/** The clip flat tiles reference. One per document — the map is the document. */
export const HEX_CLIP = 'map-hex-clip';

export type Ground = {
  domainId: string;
  /** Northernmost point of the territory: what the layer is painted in. */
  y: number;
  markup: string;
};

export type MapGround = {
  /** Every territory's ground, north to south. */
  fields: Ground[];
  /** The sea, as one string: nothing out there answers a pointer or a filter. */
  ocean: string;
};

/**
 * The sea's colours, one set per theme.
 *
 * In here rather than in `index.css` for the reason `useResolvedTheme` exists
 * at all: this markup is generated, and generated SVG cannot reach a CSS
 * variable. They are read off the map's own blues — `--map-sea` and the surf
 * over it — so if those move, move these.
 *
 * Only the water group's fields are set. The land trio stays neutral: relief
 * has to read over thirty-nine territory hues and does not belong to a theme.
 */
const SEA: Record<'light' | 'dark', Partial<Palette>> = {
  light: {
    foam: '#f2fbff',
    seaShallow: '#a7dfec',
    seaDeep: '#3f9bb5',
    reef: '#4fb39a',
    shade: '#4d7f92',
    ink: '#16323f',
  },
  dark: {
    foam: '#6fb0cf',
    seaShallow: '#1b4d63',
    seaDeep: '#05161e',
    reef: '#2f7f70',
    shade: '#030f16',
    ink: '#cfe6f0',
  },
};

/**
 * How far past the map's own box the water is drawn, as a share of it.
 *
 * The drawing is fitted into the window with `meet`, so on any window that is
 * not exactly the map's shape there is a band of viewport left over above and
 * below, or left and right — and an SVG clips to its viewport, not to its
 * viewBox. Water drawn out here fills those bands, which is the difference
 * between a sea and a picture of a sea on a coloured page.
 */
const SEA_MARGIN = 0.22;

export function groundOf(map: ParsedMap, scheme: 'light' | 'dark'): MapGround {
  // Read when the file was read: the grid is a fact about the map, and the two
  // maps are not drawn on the same one.
  const grid = map.grid;
  if (!grid) return { fields: [], ocean: '' };

  const fields = map.shapes
    .map((shape) => {
      const cells = fillCells(
        cellsIn(ringOf(shape.plan), grid),
        biomeFor(shape.domainId, shape.continent),
        // Seeded on the field, not on its place: a redrawn map moves the
        // territory without redrawing the ground it already had.
        shape.domainId
      );
      return {
        domainId: shape.domainId,
        y: shape.y,
        markup: fillMarkup(cells, grid, findTile, { clipId: HEX_CLIP }),
      };
    })
    // Painted north to south, for the same reason the cells within one
    // territory are: relief leans out of its cell towards the reader, and the
    // nearer piece has to go on top.
    .filter((ground) => ground.markup.length > 0)
    .sort((a, b) => a.y - b.y);

  return { fields, ocean: oceanMarkup(map, grid, scheme) };
}

function oceanMarkup(
  map: ParsedMap,
  grid: HexGrid,
  scheme: 'light' | 'dark'
): string {
  // The map file is a plan; its height on screen is already laid back, so the
  // area the water covers has to be measured back up before the cells are
  // worked out and projected again.
  const width = map.width;
  const height = map.height / GROUND;
  const area = {
    x: -width * SEA_MARGIN,
    y: -height * SEA_MARGIN,
    width: width * (1 + SEA_MARGIN * 2),
    height: height * (1 + SEA_MARGIN * 2),
  };

  const coasts = map.landmasses.map((mass) => ringOf(mass.plan));
  const cells = oceanCells(area, coasts, grid);
  const shore = cells.filter((cell) => cell.depth < OCEAN.shore);
  const open = cells.filter((cell) => cell.depth >= OCEAN.shore);

  const palette = { ...neutral, ...SEA[scheme] };
  const options = { palette, clipId: HEX_CLIP };
  return (
    fillMarkup(fillCells(shore, OCEAN.near, 'shore'), grid, findTile, options) +
    fillMarkup(fillCells(open, OCEAN.open, 'open'), grid, findTile, options)
  );
}
