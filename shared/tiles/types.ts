/**
 * The vocabulary of the tile collection.
 *
 * A tile is one drawing sized to one hex of the map. A hex may carry several of
 * them stacked, which is why no tile is a picture of a whole cell: the ground
 * is one tile, the grass on it another, the mountain standing on both a third.
 *
 * `seams` is the part that makes a tile a piece of something larger. A river
 * fragment without it is a squiggle nobody can place; with it, the collection
 * itself says which edges the channel crosses and what has to be on the far
 * side. Everything needed to assemble the pieces travels with them — that is
 * the contract the exported manifest keeps.
 */

import type { Palette } from './ink.js';

/** Which shelf of the collection a tile sits on. Organisation, not behaviour. */
export type TileGroup = 'ground' | 'surface' | 'coast' | 'relief' | 'hydro' | 'flora';

/**
 * Paint order within one hex, bottom to top.
 *
 * - `ground` — an opaque fill for the whole cell. One per hex.
 * - `surface` — texture laid on the ground. Any number.
 * - `relief` — something with volume that stands on the ground and may rise
 *   past the cell's top edge.
 * - `overlay` — a small mark on top of everything else.
 */
export type TileLayer = 'ground' | 'surface' | 'relief' | 'overlay';

export const LAYER_ORDER: TileLayer[] = ['ground', 'surface', 'relief', 'overlay'];

/** `solo` stands on its own; `part` is a fragment and needs its neighbours. */
export type TileKind = 'solo' | 'part';

/** What has to lie across a seam for the drawing to continue correctly. */
export type Meets = 'water' | 'land' | 'shore' | 'channel' | 'ridge' | 'canopy';

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
  /**
   * The ground this piece is normally laid on, or `null` when it is the ground.
   * Advice, not a constraint — but it is what the gallery puts underneath, and
   * without it half the collection previews as marks on an empty page.
   */
  on: string | null;
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

type Defaulted = 'kind' | 'tags' | 'seams' | 'options' | 'on' | 'bleed' | 'clip' | 'upright' | 'variants';

type TileSpec = Omit<Tile, Defaulted> & Partial<Pick<Tile, Defaulted>>;

/**
 * Fills in what the layer already implies, so a tile declares only what is
 * peculiar to it. A piece with seams is a fragment by definition; a flat piece
 * is clipped; anything with volume has a top and cannot be turned upside down.
 */
export function defineTile(spec: TileSpec): Tile {
  const flat = spec.layer === 'ground' || spec.layer === 'surface';
  return {
    kind: spec.seams?.length ? 'part' : 'solo',
    tags: [],
    seams: [],
    options: {},
    on: null,
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
 * A thing made of several hexes — a range, a lake, a river reaching the sea.
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
  cells: Cell[];
};

/** Terser authoring for the atlas: `at(0, 0, 'grass-plain', { tile: 'hill' })`. */
export function at(q: number, r: number, ...stack: Array<string | Placement>): Cell {
  return {
    q,
    r,
    stack: stack.map((entry) => (typeof entry === 'string' ? { tile: entry } : entry)),
  };
}
