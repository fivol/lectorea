/**
 * How the map is looked at: from above and a little to the side.
 *
 * One projection, in one file, because two of them would drift. The map screen
 * flattens `public/map.svg` with it and the tile collection draws in it, and a
 * mountain that stood at a different angle from the coast it stands on would be
 * the first thing anybody noticed.
 *
 * It is deliberately the cheapest projection that reads as a view rather than a
 * plan: the ground is squashed north to south and height goes straight up the
 * screen. Nothing is turned. That matters more than it sounds — a true
 * isometric rotates the grid, and every hex formula in `mapgen.ts`, every
 * coastline in the map file and every seam in the tile collection is written
 * against an unrotated axial grid. Squashing keeps all of it exact: a cell's
 * neighbours, a river's crossing point, a coast pinned to a corner. Only the
 * distances change, and they change by one multiplication.
 *
 *     screen.x = x
 *     screen.y = y · GROUND − z
 *
 * So `x` and `y` are still where a thing is on the ground, `z` is how far it
 * stands off it, and the two are separate all the way to the last line of
 * drawing code. A tile that draws its base with `y` and its crest with `z` is
 * one that a change of angle here redraws for free.
 */

export type Point = { x: number; y: number };

/**
 * How flat the ground lies: a unit of north-south ground is this much screen.
 *
 * At 1 the map is a plan and the collection has nothing to stand up in; at 0 it
 * is a horizon. High, on purpose: the reader is looking down at the map and
 * only leaning a little, so the ground barely foreshortens and the thickness of
 * the land does the rest. Pushed towards a real isometric the continents grow
 * wide and squat, and a territory's outline — which is what says how big a
 * field is — stops being comparable with the one next to it.
 */
export const GROUND = 0.82;

/**
 * The land's thickness, in hex radii.
 *
 * The continents are slabs standing in the water rather than pools of colour
 * poured onto it, and this is the height of the cliff between the ground on top
 * and the waterline. One radius: enough that the coast reads as an edge with a
 * side to it, little enough that the wall never hides the field behind it.
 */
export const SLAB = 1;

/** A point on the ground, `z` units above it, as it lands on the screen. */
export function project(x: number, y: number, z = 0): Point {
  return { x, y: y * GROUND - z };
}

/** Just the vertical part: ground distance to screen distance. */
export const flat = (y: number): number => y * GROUND;

/**
 * The same squash applied to a path.
 *
 * Every number in the path is taken to be one half of an x,y pair, which holds
 * for `M`, `L`, `Q`, `C` and `Z` and does not for `A`, `H` or `V`. The map file
 * is written with the first set only — `src/lib/map.ts` already measures it on
 * the same assumption — and the tile collection never emits a path this way at
 * all, it projects its points before it writes them.
 */
export function flattenPath(d: string): string {
  let index = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, (number) => {
    const value = Number(number);
    const projected = index++ % 2 === 1 ? value * GROUND : value;
    return Number(projected.toFixed(2)).toString();
  });
}
