/**
 * What a piece of ground is made of, as a recipe rather than as a picture.
 *
 * A terrain says which tiles may land on a cell and how densely — never where.
 * `fill.ts` is what turns a recipe plus a polygon into cells, and that split is
 * the point: a recipe cannot go stale with the geometry, because it never knew
 * any.
 *
 * Two things are written in this vocabulary. The land is `shared/tiles/
 * biomes.ts`, where a recipe comes with the colour the territory is painted in
 * — the ground and its colour are one decision and live on one line. The water
 * is `OCEAN`, below: the sea has no biome, because the app paints it itself in
 * a colour that follows the theme.
 */

/** One piece that may land on a cell of its own. */
export type Scatter = {
  tile: string;
  /** Share of the draw, against the other entries. */
  weight: number;
  /** A landmark: at most one per territory, however large. */
  once?: boolean;
  opts?: Record<string, string>;
};

export type ChainPiece = { tile: string; opts?: Record<string, string> };

/**
 * A run of cells laid west to east out of pieces that join along their east and
 * west edges — a mountain range, a scarp, a canyon.
 *
 * Runs are the reason the collection has seams at all, and the reason a
 * territory reads as landscape rather than as confetti: five separate mountain
 * tiles scattered about are five mountains, and the same five in a row are a
 * range. Ends are mirrored rather than turned, because relief has a top.
 */
export type Chain = {
  /** How often a free cell starts a run, 0…1. */
  share: number;
  min: number;
  max: number;
  /** The west end, drawn mirrored. Without one the run just starts. */
  head?: ChainPiece;
  /** Repeated for everything between the ends. */
  body: ChainPiece;
  /** The middle of a run long enough to have one. */
  crown?: ChainPiece;
  tail?: ChainPiece;
};

export type Terrain = {
  id: string;
  /** Russian, for the docs and the viewer. */
  title: string;
  /** What this ground looks like, in one line. */
  note: string;
  /** Share of the cells left over after the runs that carry anything at all. */
  cover: number;
  chain?: Chain;
  scatter: Scatter[];
};

/* ─────────────────────────────────  The sea  ────────────────────────────── */

/**
 * Everything that is not a territory, in two bands.
 *
 * The sea is the largest thing on the map and the emptiest, so it is the one
 * place where the density has to be argued down rather than up: the reader is
 * looking for a field of knowledge, and every mark out here is competing with
 * the names of the islands too small to write on.
 *
 * Two bands rather than one recipe, because water says different things at
 * different distances from a coast. Near land it explains the edge — where the
 * bottom comes up, where a reef is, where the rocks break the surface. Out in
 * the open there is nothing to explain, and swell is enough to say the surface
 * is water rather than paper.
 *
 * No plate: the app paints its own sea, in a colour that follows the theme, and
 * these are marks laid on top of it. `shore` is in hex radii.
 */
export const OCEAN: { shore: number; near: Terrain; open: Terrain } = {
  shore: 2.4,
  near: {
    id: 'shore-water',
    title: 'Прибрежная вода',
    note: 'Отмели, рифы и камни у берега — там, где дно поднимается.',
    cover: 0.34,
    scatter: [
      { tile: 'shallows', weight: 5 },
      { tile: 'reef', weight: 2 },
      { tile: 'skerries', weight: 2 },
      { tile: 'swell', weight: 2 },
    ],
  },
  open: {
    id: 'open-water',
    title: 'Открытое море',
    note: 'Зыбь, редкая глубина и одно течение на несколько клеток.',
    cover: 0.15,
    // Rare on purpose: a share is per free cell, and the open sea has thousands
    // of them. This is a dozen streaks across the whole map.
    chain: { share: 0.004, min: 3, max: 6, body: { tile: 'current-straight' } },
    scatter: [
      { tile: 'swell', weight: 7 },
      { tile: 'deep', weight: 3 },
      { tile: 'skerries', weight: 1 },
      { tile: 'whirlpool', weight: 1, once: true },
    ],
  },
};
