/**
 * Reads public/map.svg into plain data.
 *
 * The file is parsed rather than injected as markup so the territories can be
 * ordinary React elements with ordinary event handlers, instead of a DOM blob
 * that has to be patched by hand after every render.
 *
 * It carries geometry and nothing else: the outline of every territory, and the
 * coastline of every landmass those territories tile. Colour, lettering and the
 * sea are the screen's, so a territory can change colour when a filter runs
 * without the map being redrawn. `pnpm map:import` writes the file.
 *
 * The file is a plan, drawn straight down; the screen is a view from above and
 * to the side. The angle is applied here, once, as the geometry is read — the
 * shapes that come out of this module are already where they will be drawn, so
 * everything downstream goes on measuring, placing labels and hit-testing in
 * plain screen coordinates and never has to know the map is tilted. Height is
 * the one thing the projection leaves to the screen: how thick the land is, and
 * what stands on it, are drawing decisions rather than facts about the file.
 */

import { flat, flattenPath, GROUND } from '@shared/view';

export type MapShape = {
  shapeId: string;
  domainId: string;
  continent: string;
  /** Where a label sits — the point inside with the most room around it. */
  cx: number;
  cy: number;
  /**
   * Distance from that point to the nearest border: how big the territory is
   * around its label point, and so how loudly it may be named. Unprojected —
   * it is a measure of the field, not of the room on screen.
   */
  room: number;
  /**
   * The same distance as the reader sees it, once the ground has been laid
   * back. What a name or an icon actually has to fit into vertically: `room`
   * says a field is large, `headroom` says how much of that survived the angle.
   */
  headroom: number;
  /** Width of the territory at that point: how long a line of it can be. */
  span: number;
  d: string;
  /**
   * The same outline as the file wrote it, before the ground was laid back.
   *
   * The one thing downstream that needs the plan rather than the view: the
   * territory's hexes. The grid is regular in the plan and squashed on the
   * screen, so the cells are worked out there and projected afterwards — the
   * same order everything else in `shared/tiles` follows.
   */
  plan: string;
  /** Bounding box — what the label placer treats as occupied ground. */
  width: number;
  height: number;
  x: number;
  y: number;
};

/** One coastline: a continent's mainland, or one of its offshore islands. */
export type MapLandmass = {
  continent: string;
  kind: 'continent' | 'island';
  d: string;
  /** The coastline as the file wrote it — see `MapShape.plan`. */
  plan: string;
  width: number;
  height: number;
  x: number;
  y: number;
};

export type ParsedMap = {
  viewBox: string;
  width: number;
  height: number;
  shapes: MapShape[];
  landmasses: MapLandmass[];
};

/** The paths in the file that are ground rather than a territory. */
const LAND_CLASS = 'coastline';

const PATH_RE = /<path\b([^>]*)\/>/g;
const ATTR_RE = /(\w[\w-]*)="([^"]*)"/g;
const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

function extentOf(d: string): { width: number; height: number; x: number; y: number } {
  const numbers = d.match(NUMBER_RE)?.map(Number) ?? [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    minX = Math.min(minX, numbers[i]);
    maxX = Math.max(maxX, numbers[i]);
    minY = Math.min(minY, numbers[i + 1]);
    maxY = Math.max(maxY, numbers[i + 1]);
  }
  return Number.isFinite(minX)
    ? { width: maxX - minX, height: maxY - minY, x: minX, y: minY }
    : { width: 0, height: 0, x: 0, y: 0 };
}

export function parseMapSvg(text: string): ParsedMap {
  const viewBox = /viewBox="([^"]+)"/.exec(text)?.[1] ?? '0 0 1680 980';
  const [, , widthRaw, heightRaw] = viewBox.split(/\s+/).map(Number);
  const width = widthRaw || 1680;
  const height = flat(heightRaw || 980);

  const shapes: MapShape[] = [];
  const landmasses: MapLandmass[] = [];
  for (const match of text.matchAll(PATH_RE)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(ATTR_RE)) {
      attributes[attribute[1]] = attribute[2];
    }
    if (!attributes.id || !attributes.d) continue;

    // Laid back onto the ground plane before anything is measured off it: an
    // extent taken from the plan would be the wrong shape by the time it was
    // used, and the label placer works in nothing but extents.
    const d = flattenPath(attributes.d);

    if (attributes.class === LAND_CLASS) {
      landmasses.push({
        continent: attributes['data-continent'] ?? 'formal',
        kind: attributes['data-kind'] === 'island' ? 'island' : 'continent',
        d,
        plan: attributes.d,
        ...extentOf(d),
      });
      continue;
    }

    const room = Number(attributes['data-room'] ?? 0);
    shapes.push({
      shapeId: attributes.id,
      domainId: attributes['data-domain'] ?? attributes.id.replace(/^shape-/, ''),
      continent: attributes['data-continent'] ?? 'formal',
      cx: Number(attributes['data-cx'] ?? 0),
      cy: flat(Number(attributes['data-cy'] ?? 0)),
      room,
      headroom: room * GROUND,
      span: Number(attributes['data-span'] ?? 0),
      d,
      plan: attributes.d,
      ...extentOf(d),
    });
  }

  return { viewBox: `0 0 ${width} ${height}`, width, height, shapes, landmasses };
}
