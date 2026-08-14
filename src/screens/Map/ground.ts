/**
 * The ground inside every territory, and the water around them all: the tile
 * collection, on the real map.
 *
 * The screen asks one question — what does this field look like — and three
 * files answer it. `shared/tiles/biomes.ts` says which biome a domain is (and,
 * on the same line, what colour it is painted), `shared/tiles/plan.ts` works
 * out which hexes the territory owns and what goes on them, and the collection
 * itself draws the pieces. Nothing here knows how a mountain is drawn, and
 * nothing there knows what a domain is.
 *
 * The plan usually arrives read rather than worked out — it is the same answer
 * every time and it is written down next to the map file. This module does not
 * care which: it is handed cells and turns them into pieces of a drawing.
 *
 * The result is markup rather than React elements. A field of relief is a few
 * thousand paths that never change once they are drawn — there is nothing for
 * React to reconcile, and building the components would cost more than the
 * drawing does.
 *
 * It comes out in pieces, and each piece knows the box it covers and how to
 * draw itself when asked. That is the whole of what keeps the map moving on a
 * phone: this is by far the heaviest thing on the screen — six thousand of the
 * map's eight thousand nodes, and every measurable millisecond of a drag — while
 * a phone can see about a quarter of it. Pieces the reader is nowhere near are
 * never built and never mounted, so a gesture costs what is on the screen rather
 * than what is on the map. See `SCENERY_MARGIN` in `MapView`.
 *
 * The territories are still grouped, above the pieces: a field is what answers a
 * filter, and the `opacity` that dims it goes over the whole of it at once.
 */

import {
  fillMarkup,
  findTile,
  groundPlan,
  screenAt,
  terrain as neutral,
  type Cell,
  type GroundPlan,
  type HexGrid,
  type Palette,
  type RenderOptions,
} from '@shared/tiles';
import type { ParsedMap } from '@/lib/map';

/** The clip flat tiles reference. One per document — the map is the document. */
export const HEX_CLIP = 'map-hex-clip';

/** A rectangle of the drawing, in the map's own units. */
export type Box = { x: number; y: number; w: number; h: number };

/**
 * One piece of scenery: where it is, and how to draw it.
 *
 * `markup` is a question rather than a string, and it is only ever asked once —
 * building a piece is the expensive half of it, and a piece the reader never
 * reaches should cost nothing at all. Which is also why the cache lives on the
 * closure rather than in a module-level map: a new drawing of the world is a
 * new set of pieces, and the old answers go with the old ones.
 */
export type Patch = {
  id: string;
  box: Box;
  markup: () => string;
};

/**
 * A territory's ground: in pieces like everything else, but kept together,
 * because the field is what answers a filter and the wash that dims it has to
 * go over the whole of it at once.
 */
export type Field = {
  domainId: string;
  /** Northernmost point of the territory: what the layer is painted in. */
  y: number;
  pieces: Patch[];
};

export type MapGround = {
  /** Every territory's ground, north to south. */
  fields: Field[];
  /** The sea, in pieces: nothing out there answers a pointer or a filter. */
  ocean: Patch[];
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
 * How large a piece of scenery is, in cells.
 *
 * The land is cut on the same grid as the sea, and it has to be: a territory is
 * a thing, but it is not a *small* thing — the largest of them are a third of
 * the map, and a phone that mounted every field it can see a corner of would be
 * drawing almost the whole world again. What stays whole is the field as a
 * unit of *meaning* — the wash that dims it still goes over all its pieces at
 * once — and what gets cut is the drawing.
 *
 * Small enough that a phone mounts only what it can see, large enough that
 * crossing a boundary while dragging brings in a handful of pieces rather than
 * a wall of them. In cells rather than in units because the two maps are drawn
 * on different grids, and a piece is meant to be the same size on both.
 *
 * There is a floor under how fine it is worth cutting, and it is not the
 * drawing: every piece is one more run of the HTML parser when it is mounted,
 * and cutting this to five costs more at the door than the sharper culling wins
 * back on the move. Eight pays for itself and no less does.
 */
const PIECE = 8;

/**
 * How coarse a box has to be to decide what is drawn: one piece, which is the
 * smallest thing that can be added or dropped. Asking a finer question than the
 * answer can be given in only costs the asking.
 */
export const scenerySquare = (radius: number): number => radius * PIECE;

/**
 * How far a tile may reach out of its own cell, in cells.
 *
 * A piece's box is not the box of its cells: relief stands up out of the ground
 * and is drawn above the cell it belongs to, and every tile is allowed a little
 * bleed past the hex besides. Read off the collection's own worst case — a tile
 * is drawn in the unit hex, reaches `1 + bleed` above the centre and
 * `√3/2 + bleed` to the side, and the largest bleed in the atlas is 0.35 — with
 * a little over.
 *
 * Boxes are the only thing the culling has to go on, so this has to be right in
 * both directions: too small and a mountain vanishes a moment before it leaves
 * the screen, too large and the map draws a border of scenery nobody can see.
 */
const LEAN = 1.4;

/** Asked once; after that it is a string. */
function once(make: () => string): () => string {
  let made: string | null = null;
  return () => (made ??= make());
}

/** What `groundPlan` needs, read off a parsed map file. */
export const planSourceOf = (map: ParsedMap, grid: HexGrid) => ({
  shapes: map.shapes.map((shape) => ({
    domainId: shape.domainId,
    continent: shape.continent,
    plan: shape.plan,
  })),
  coasts: map.landmasses.map((mass) => mass.plan),
  width: map.width,
  height: map.height,
  grid,
});

/**
 * @param saved The plan read off `public/map-ground.json`, or null — missing,
 *   unreadable, or drawn from some other map. Null means the three passes run
 *   here instead, which is slower and never different: see `shared/tiles/plan.ts`.
 */
export function groundOf(
  map: ParsedMap,
  scheme: 'light' | 'dark',
  saved: GroundPlan | null
): MapGround {
  // Read when the file was read: the grid is a fact about the map, and the two
  // maps are not drawn on the same one.
  const grid = map.grid;
  if (!grid) return { fields: [], ocean: [] };

  const plan = saved ?? groundPlan(planSourceOf(map, grid));

  // Where each territory begins, for the order they are painted in. Off the
  // shapes rather than the plan: the plan is the map file's own coordinates and
  // this is the drawing's.
  const northOf = new Map(map.shapes.map((shape) => [shape.domainId, shape.y]));

  const fields = plan.fields
    .map(
      (field): Field => ({
        domainId: field.domainId,
        y: northOf.get(field.domainId) ?? 0,
        pieces: piecesOf(field.cells, grid, field.domainId, { clipId: HEX_CLIP }),
      })
    )
    .filter((field) => field.pieces.length > 0)
    // Painted north to south, for the same reason the cells within one
    // territory are: relief leans out of its cell towards the reader, and the
    // nearer piece has to go on top.
    .sort((a, b) => a.y - b.y);

  // Shallow water first and open water after it, as one run each — that is the
  // order the two have always been drawn in. The palette is the theme's, and it
  // is the only thing here that is: the plan says which cell carries a reef, and
  // the theme says what colour a reef is.
  const options = { palette: { ...neutral, ...SEA[scheme] }, clipId: HEX_CLIP };
  const ocean = [
    ...piecesOf(plan.sea.shore, grid, 'shore', options),
    ...piecesOf(plan.sea.open, grid, 'open', options),
  ];

  return { fields, ocean };
}

/**
 * Cells sorted into squares of the grid, each square a piece of its own.
 *
 * The squares are painted north to south and west to east, and the cells inside
 * one keep the order `fillMarkup` gives them, which is the same. So the rule
 * relief has always been drawn by — what is further south is nearer, and goes
 * on top — survives the cutting: it now runs across the whole layer in bands
 * instead of separately inside each field.
 */
function piecesOf(
  cells: Cell[],
  grid: HexGrid,
  name: string,
  options: RenderOptions
): Patch[] {
  const size = grid.r * PIECE;
  const lean = grid.r * LEAN;

  type Square = {
    column: number;
    row: number;
    cells: Cell[];
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  const squares = new Map<string, Square>();

  for (const cell of cells) {
    const at = screenAt(cell, grid);
    const column = Math.floor(at.x / size);
    const row = Math.floor(at.y / size);
    const key = `${column},${row}`;
    const square = squares.get(key);
    if (!square) {
      squares.set(key, { column, row, cells: [cell], x0: at.x, y0: at.y, x1: at.x, y1: at.y });
      continue;
    }
    square.cells.push(cell);
    square.x0 = Math.min(square.x0, at.x);
    square.y0 = Math.min(square.y0, at.y);
    square.x1 = Math.max(square.x1, at.x);
    square.y1 = Math.max(square.y1, at.y);
  }

  return [...squares.values()]
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map((square) => ({
      id: `${name}-${square.column}-${square.row}`,
      // The cells it actually holds, not the square it was sorted into: along
      // the edge of a territory a square catches two or three hexes, and a
      // piece that claims the whole square there is a piece the map keeps
      // drawing for the sake of ground that is nowhere near the window.
      box: {
        x: square.x0 - lean,
        y: square.y0 - lean,
        w: square.x1 - square.x0 + lean * 2,
        h: square.y1 - square.y0 + lean * 2,
      },
      markup: once(() => fillMarkup(square.cells, grid, findTile, options)),
    }));
}
