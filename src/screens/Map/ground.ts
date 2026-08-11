/**
 * The ground inside every territory: the tile collection, on the real map.
 *
 * The screen asks one question — what does this field look like — and three
 * files answer it. `shared/tiles/terrain.ts` says which terrain a domain has,
 * `shared/tiles/fill.ts` works out which hexes the territory owns and what goes
 * on them, and the collection itself draws the pieces. Nothing here knows how a
 * mountain is drawn, and nothing there knows what a domain is.
 *
 * The result is markup rather than React elements. A field of relief is a few
 * thousand paths that never change once they are drawn — there is nothing for
 * React to reconcile, and building the components would cost more than the
 * drawing does. What does change with a filter is one `opacity` on the group,
 * which is why the markup is cut per territory instead of coming out as one
 * string for the whole map.
 */

import { ringOf } from '@shared/polygon';
import { cellsIn, fillCells, fillMarkup, findTile, hexGridOf, terrainFor } from '@shared/tiles';
import type { MapShape } from '@/lib/map';

/** The clip flat tiles reference. One per document — the map is the document. */
export const HEX_CLIP = 'map-hex-clip';

export type Ground = {
  domainId: string;
  /** Northernmost point of the territory: what the layer is painted in. */
  y: number;
  markup: string;
};

/**
 * Every territory's ground, north to south.
 *
 * Painted in that order for the same reason the cells within one territory are:
 * relief leans out of its cell towards the reader, and the nearer piece has to
 * go on top. Territories are the same rule one size up.
 *
 * Returns nothing at all when the map file cannot be read as a hex map — a
 * plain coloured map is a fine map, and tiles scattered off the grid are not.
 */
export function groundOf(shapes: MapShape[]): Ground[] {
  const grid = hexGridOf(shapes.map((shape) => shape.plan));
  if (!grid) return [];

  return shapes
    .map((shape) => {
      const ring = ringOf(shape.plan);
      const cells = fillCells(
        cellsIn(ring, grid),
        terrainFor(shape.domainId, shape.continent),
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
    .filter((ground) => ground.markup.length > 0)
    .sort((a, b) => a.y - b.y);
}
