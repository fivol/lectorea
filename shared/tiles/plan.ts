/**
 * The scenery's plan: which cell of the map carries which tiles.
 *
 * Everything the ground and the sea are made of comes out of three passes —
 * which hexes a territory owns, which hexes are water and how deep, and what
 * grows on each of them. All three are pure functions of the map file and the
 * tables in this folder: no theme, no language, no window, no clock. They are
 * also the expensive half of drawing the map, and on a phone they are a fifth of
 * a second spent working out an answer that has not changed since the map was
 * last redrawn.
 *
 * So the answer is written down. `pnpm map:ground` runs the passes and saves the
 * result next to the map file it was drawn from, the app reads it instead of
 * doing the work, and the whole plan comes to about 50 KB — a tenth of the
 * markup it turns into, and a third of a millisecond to read.
 *
 * `shared/tiles/fill.ts` opens with the argument against exactly this:
 *
 *   > Store the cells in a file instead and the next import silently puts every
 *   > mountain in the wrong place.
 *
 * That objection is about the word *silently*, and it is answered here rather
 * than ignored. A plan carries two fingerprints — of the map file it was drawn
 * from, and of the tables that decided what grows where — and the app checks
 * both before trusting a single cell of it. A plan that does not match is not
 * used: the app works the answer out the old way and says so in the console, so
 * a forgotten `pnpm map:ground` costs a slow first paint and can never cost a
 * mountain in the sea. CI holds the other end, so "slow" does not ship either.
 *
 * The one thing the fingerprints cannot see is a change to `hash` or `rng` in
 * `ink.ts` — the plan is seeded through them, and they are code rather than
 * data. `PLAN_VERSION` is the hand-turned answer to that: touch those two
 * functions, and bump it.
 */

import { ringOf } from '../polygon.js';
import {
  BIOME_BY_CONTINENT,
  BIOME_BY_DOMAIN,
  BIOMES,
  biomeFor,
  DEFAULT_BIOME,
} from './biomes.js';
import { cellsIn, fillCells, INSET, oceanCells, type HexGrid } from './fill.js';
import { GROUND } from './hex.js';
import { hash } from './ink.js';
import { OCEAN } from './terrain.js';
import type { Cell } from './types.js';

/** Bumped by hand when `hash` or `rng` changes — see the note above. */
const PLAN_VERSION = 1;

/**
 * How far past the map's own box the water is drawn, as a share of it.
 *
 * The drawing is fitted into the window with `meet`, so on any window that is
 * not exactly the map's shape there is a band of viewport left over above and
 * below, or left and right — and an SVG clips to its viewport, not to its
 * viewBox. Water drawn out here fills those bands, which is the difference
 * between a sea and a picture of a sea on a coloured page.
 *
 * Here rather than on the screen because it decides which cells of water exist
 * at all, and that is a fact about the plan.
 */
export const SEA_MARGIN = 0.22;

/** What the passes need: the map file's own geometry, before it is laid back. */
export type PlanSource = {
  /** Territory outlines as the file wrote them — `MapShape.plan`. */
  shapes: Array<{ domainId: string; continent: string; plan: string }>;
  /** Coastlines, likewise. */
  coasts: string[];
  width: number;
  /** The map's height *on screen*; laid back to the plan inside. */
  height: number;
  grid: HexGrid;
};

export type GroundPlan = {
  version: number;
  /** Fingerprint of the map file this was drawn from. */
  map: string;
  /** Fingerprint of the tables that decided what grows where. */
  recipe: string;
  /** One entry per territory, in the file's order. */
  fields: Array<{ domainId: string; cells: Cell[] }>;
  /**
   * The water, in the two runs it has always been drawn in: what is near enough
   * to a coast to say so, and the open sea. Kept apart because they are painted
   * in that order and the shallows have to go down first.
   */
  sea: { shore: Cell[]; open: Cell[] };
};

/** A short, printable fingerprint. For staleness, not for secrets. */
export const stampOf = (text: string): string => hash(text).toString(36);

/**
 * Everything besides the map file that decides the plan.
 *
 * Data rather than a version number, so that editing a biome's recipe or the
 * sea's is enough on its own to retire every saved plan — nobody has to
 * remember to say that they did.
 */
export const recipeStamp = (): string =>
  stampOf(
    JSON.stringify({
      PLAN_VERSION,
      BIOMES,
      BIOME_BY_DOMAIN,
      BIOME_BY_CONTINENT,
      DEFAULT_BIOME,
      OCEAN,
      INSET,
      SEA_MARGIN,
    })
  );

/** Whether a saved plan is the plan for this map, drawn by these tables. */
export const planFits = (plan: GroundPlan | null, mapText: string): boolean =>
  Boolean(
    plan &&
      plan.version === PLAN_VERSION &&
      plan.map === stampOf(mapText) &&
      plan.recipe === recipeStamp()
  );

/**
 * The three passes, once.
 *
 * Called by `pnpm map:ground` to write the file, and by the app itself whenever
 * the file is missing or does not fit — the saved plan is a cache, and the code
 * that would have to exist without it stays the code that runs.
 *
 * @param mapText The map file, for the fingerprint. Omitted by the app, which
 *   is about to use the plan and not to write it down: a plan with no
 *   fingerprint is one that could never be mistaken for a saved one.
 */
export function groundPlan(source: PlanSource, mapText = ''): GroundPlan {
  const { grid } = source;

  const fields = source.shapes.map((shape) => ({
    domainId: shape.domainId,
    cells: fillCells(
      cellsIn(ringOf(shape.plan), grid),
      biomeFor(shape.domainId, shape.continent),
      // Seeded on the field, not on its place: a redrawn map moves the
      // territory without redrawing the ground it already had.
      shape.domainId
    ),
  }));

  // The map file is a plan; its height on screen is already laid back, so the
  // area the water covers has to be measured back up before the cells are
  // worked out and projected again.
  const height = source.height / GROUND;
  const area = {
    x: -source.width * SEA_MARGIN,
    y: -height * SEA_MARGIN,
    width: source.width * (1 + SEA_MARGIN * 2),
    height: height * (1 + SEA_MARGIN * 2),
  };

  const water = oceanCells(area, source.coasts.map(ringOf), grid);

  return {
    version: PLAN_VERSION,
    map: stampOf(mapText),
    recipe: recipeStamp(),
    fields,
    sea: {
      shore: fillCells(
        water.filter((cell) => cell.depth < OCEAN.shore),
        OCEAN.near,
        'shore'
      ),
      open: fillCells(
        water.filter((cell) => cell.depth >= OCEAN.shore),
        OCEAN.open,
        'open'
      ),
    },
  };
}
