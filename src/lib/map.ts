/**
 * Reads public/map.svg into plain data.
 *
 * The file is parsed rather than injected as markup so the territories can be
 * ordinary React elements with ordinary event handlers, instead of a DOM blob
 * that has to be patched by hand after every render.
 */

export type MapShape = {
  shapeId: string;
  domainId: string;
  continent: string;
  /** Centroid, written by the generator — where the label goes. */
  cx: number;
  cy: number;
  d: string;
  /** Rough extent, used to decide whether a label fits. */
  width: number;
  height: number;
};

export type ParsedMap = {
  viewBox: string;
  width: number;
  height: number;
  shapes: MapShape[];
};

const PATH_RE = /<path\b([^>]*)\/>/g;
const ATTR_RE = /(\w[\w-]*)="([^"]*)"/g;
const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

function extentOf(d: string): { width: number; height: number } {
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
    ? { width: maxX - minX, height: maxY - minY }
    : { width: 0, height: 0 };
}

export function parseMapSvg(text: string): ParsedMap {
  const viewBox = /viewBox="([^"]+)"/.exec(text)?.[1] ?? '0 0 1680 980';
  const [, , widthRaw, heightRaw] = viewBox.split(/\s+/).map(Number);

  const shapes: MapShape[] = [];
  for (const match of text.matchAll(PATH_RE)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(ATTR_RE)) {
      attributes[attribute[1]] = attribute[2];
    }
    if (!attributes.id || !attributes.d) continue;
    const extent = extentOf(attributes.d);
    shapes.push({
      shapeId: attributes.id,
      domainId: attributes['data-domain'] ?? attributes.id.replace(/^shape-/, ''),
      continent: attributes['data-continent'] ?? 'formal',
      cx: Number(attributes['data-cx'] ?? 0),
      cy: Number(attributes['data-cy'] ?? 0),
      d: attributes.d,
      ...extent,
    });
  }

  return { viewBox, width: widthRaw || 1680, height: heightRaw || 980, shapes };
}
