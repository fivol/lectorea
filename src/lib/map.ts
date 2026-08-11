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
 */

export type MapShape = {
  shapeId: string;
  domainId: string;
  continent: string;
  /** Where a label sits — the point inside with the most room around it. */
  cx: number;
  cy: number;
  /** Distance from that point to the nearest border: how tall a label can be. */
  room: number;
  /** Width of the territory at that point: how long a line of it can be. */
  span: number;
  d: string;
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

  const shapes: MapShape[] = [];
  const landmasses: MapLandmass[] = [];
  for (const match of text.matchAll(PATH_RE)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(ATTR_RE)) {
      attributes[attribute[1]] = attribute[2];
    }
    if (!attributes.id || !attributes.d) continue;

    if (attributes.class === LAND_CLASS) {
      landmasses.push({
        continent: attributes['data-continent'] ?? 'formal',
        kind: attributes['data-kind'] === 'island' ? 'island' : 'continent',
        d: attributes.d,
        ...extentOf(attributes.d),
      });
      continue;
    }

    shapes.push({
      shapeId: attributes.id,
      domainId: attributes['data-domain'] ?? attributes.id.replace(/^shape-/, ''),
      continent: attributes['data-continent'] ?? 'formal',
      cx: Number(attributes['data-cx'] ?? 0),
      cy: Number(attributes['data-cy'] ?? 0),
      room: Number(attributes['data-room'] ?? 0),
      span: Number(attributes['data-span'] ?? 0),
      d: attributes.d,
      ...extentOf(attributes.d),
    });
  }

  return { viewBox, width: widthRaw || 1680, height: heightRaw || 980, shapes, landmasses };
}
