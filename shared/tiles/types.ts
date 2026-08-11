/**
 * The vocabulary of the tile collection.
 *
 * A tile is one drawing sized to one hex of the map. A hex may carry several of
 * them stacked, which is why no tile is a picture of a whole cell.
 *
 * Scale decides what belongs here. A cell is around 30 px across on the map, so
 * the collection is at the altitude of a mountain range, a river, a reef — not
 * a tree. And a land cell already has a colour, the territory's own, so land
 * pieces add relief to it rather than covering it. Only water is painted.
 *
 * `seams` is the part that makes a tile a piece of something larger. A river
 * fragment without it is a squiggle nobody can place; with it, the collection
 * itself says which edges the channel crosses and what has to be on the far
 * side. Everything needed to assemble the pieces travels with them — that is
 * the contract the exported manifest keeps.
 */

import type { Palette } from './ink.js';

/** Which shelf of the collection a tile sits on. Organisation, not behaviour. */
export type TileGroup = 'relief' | 'coast' | 'hydro' | 'water';

/**
 * Paint order within one hex, bottom to top.
 *
 * - `plate` — an opaque fill for the whole cell. Only the sea needs one: land
 *   cells are already filled with their territory's colour.
 * - `surface` — something flat on top: a river, a shoal, a current.
 * - `relief` — volume. Light and shade, and it may rise past the cell's edge.
 * - `overlay` — a small mark above everything else.
 */
export type TileLayer = 'plate' | 'surface' | 'relief' | 'overlay';

export const LAYER_ORDER: TileLayer[] = ['plate', 'surface', 'relief', 'overlay'];

/** What the cell under the piece is. Decides what the gallery puts beneath it. */
export type Over = 'land' | 'water';

/** `solo` stands on its own; `part` is a fragment and needs its neighbours. */
export type TileKind = 'solo' | 'part';

/** What has to lie across a seam for the drawing to continue correctly. */
export type Meets = 'water' | 'land' | 'channel' | 'ridge' | 'scarp' | 'current';

/** Hex edges the drawing runs across, and what belongs on the other side. */
export type Seam = { edges: number[]; meets: Meets };

/** A knob a placement may turn — how a coast is told which water it borders. */
export type TileOption = { values: readonly string[]; fallback: string; note: string };

export type DrawContext = {
  rnd: () => number;
  ink: Palette;
  variant: number;
  /** The placement's value for a declared option, or the tile's fallback. */
  opt: (name: string) => string;
};

export type Tile = {
  id: string;
  group: TileGroup;
  kind: TileKind;
  layer: TileLayer;
  /** Russian, for the viewer and the manifest. */
  title: string;
  /** One line on what the piece is for. Travels with the collection. */
  use: string;
  tags: string[];
  seams: Seam[];
  options: Record<string, TileOption>;
  /** Land or water. Land pieces must survive being drawn over any hue. */
  over: Over;
  /** Room the drawing needs outside the hex, in hex radii. */
  bleed: number;
  /** Clip to the hex outline. Flat things do; things with volume do not. */
  clip: boolean;
  /** Gravity applies: mirror it, never turn it. */
  upright: boolean;
  /** How many deterministic variants the drawing can produce. */
  variants: number;
  draw: (context: DrawContext) => string;
};

type Defaulted =
  | 'kind'
  | 'tags'
  | 'seams'
  | 'options'
  | 'over'
  | 'bleed'
  | 'clip'
  | 'upright'
  | 'variants';

type TileSpec = Omit<Tile, Defaulted> & Partial<Pick<Tile, Defaulted>>;

/**
 * Fills in what the layer already implies, so a tile declares only what is
 * peculiar to it. A piece with seams is a fragment by definition; a flat piece
 * is clipped; anything with volume has a top and cannot be turned upside down.
 */
export function defineTile(spec: TileSpec): Tile {
  const flat = spec.layer === 'plate' || spec.layer === 'surface';
  return {
    kind: spec.seams?.length ? 'part' : 'solo',
    tags: [],
    seams: [],
    options: {},
    over: 'land',
    bleed: 0,
    clip: flat,
    upright: !flat,
    variants: 4,
    ...spec,
  };
}

/* ─────────────────────────────  Assembled objects  ─────────────────────── */

/** One tile put on one cell, with the turns and knobs the object needs. */
export type Placement = {
  tile: string;
  /** Sixths of a turn clockwise. Refused by `upright` tiles. */
  rotate?: number;
  /** Mirror left to right. The only transform relief accepts. */
  flip?: boolean;
  variant?: number;
  opts?: Record<string, string>;
};

/** One hex of an object: its offset from the anchor, and its stack. */
export type Cell = { q: number; r: number; stack: Placement[] };

/**
 * A thing made of several hexes — a range, a coast, a river reaching the sea.
 *
 * The recipe is data, not code, so it survives being exported to JSON: a
 * consumer that has the tiles and this list can rebuild the object without
 * knowing anything about how it was drawn.
 */
export type Assembly = {
  id: string;
  title: string;
  /** Why the object is more than the sum of its cells. Shown in the viewer. */
  note: string;
  /** What the cells sit on, so the viewer knows which backdrop to use. */
  over: Over;
  cells: Cell[];
};

/** Terser authoring for the atlas: `at(0, 0, 'hills', { tile: 'canyon' })`. */
export function at(q: number, r: number, ...stack: Array<string | Placement>): Cell {
  return {
    q,
    r,
    stack: stack.map((entry) => (typeof entry === 'string' ? { tile: entry } : entry)),
  };
}
