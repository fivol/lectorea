/**
 * Turning tiles into SVG.
 *
 * One function does the drawing and everything else — a single file, a sprite,
 * an assembled object, the viewer — goes through it, so what the exporter
 * writes is what the viewer showed. Size is applied as a transform rather than
 * baked into the coordinates: stroke widths then scale with the drawing, which
 * is the whole reason tiles are authored in a unit hex.
 */

import {
  centreOf,
  flipEdge,
  hexPath,
  HEX_W,
  rotateEdge,
  round,
  type Point,
} from './hex.js';
import { hash, rng, terrain, type Palette } from './ink.js';
import { LAYER_ORDER, type Assembly, type Cell, type Placement, type Seam, type Tile } from './types.js';

/** Salt for every seed in the collection. Change it and the whole set redraws. */
export const SEED_SALT = 'v1';

export type RenderOptions = {
  /** Hex circumradius in output units. */
  size?: number;
  palette?: Palette;
  seed?: string;
  /**
   * Id of the clip path the flat tiles reference. A document needs its own:
   * several inline SVGs on one HTML page share an id space, and `url(#…)`
   * resolves to whichever came first — every plate after the first would then
   * be clipped by a shape from another picture, or not at all.
   */
  clipId?: string;
};

const DEFAULTS = { size: 64, palette: terrain, seed: SEED_SALT, clipId: 'hex-clip' };

/** The clip every flat tile uses. Emit once per document, with its own id. */
export const hexClipDefs = (id: string = DEFAULTS.clipId): string =>
  `<defs><clipPath id="${id}"><path d="${hexPath(1.001)}"/></clipPath></defs>`;

/* ─────────────────────────────────  Drawing  ───────────────────────────── */

/** The tile's own markup, in unit-hex coordinates and with no transform. */
export function tileBody(
  tile: Tile,
  placement: Omit<Placement, 'tile'> = {},
  options: RenderOptions = {}
): string {
  const ink = options.palette ?? DEFAULTS.palette;
  const seed = options.seed ?? DEFAULTS.seed;
  const variant = (((placement.variant ?? 0) % tile.variants) + tile.variants) % tile.variants;
  const chosen = placement.opts ?? {};

  const opt = (name: string): string => {
    const declared = tile.options[name];
    if (!declared) return chosen[name] ?? '';
    const value = chosen[name];
    return value !== undefined && declared.values.includes(value) ? value : declared.fallback;
  };

  return tile.draw({ rnd: rng(hash(`${seed}:${tile.id}:${variant}`)), ink, variant, opt });
}

/**
 * The tile placed: turned, mirrored, scaled and — if it is flat — clipped.
 *
 * Mirroring is applied before turning, and `placedSeams` maps the edges the
 * same way round. The clip sits on an inner group so that it is resolved in the
 * scaled coordinate system, where the unit hex is the right size.
 */
export function placementMarkup(
  tile: Tile,
  placement: Omit<Placement, 'tile'>,
  at: Point,
  size: number,
  options: RenderOptions = {}
): string {
  const turn = placement.rotate ? ` rotate(${round(60 * placement.rotate)})` : '';
  const mirror = placement.flip ? ' scale(-1 1)' : '';
  const body = tileBody(tile, placement, options);
  const clip = options.clipId ?? DEFAULTS.clipId;
  const inner = tile.clip ? `<g clip-path="url(#${clip})">${body}</g>` : body;
  return (
    `<g transform="translate(${round(at.x)} ${round(at.y)}) scale(${round(size)})${turn}${mirror}" ` +
    `data-tile="${tile.id}">${inner}</g>`
  );
}

/** Where the tile's seams end up once it has been turned and mirrored. */
export function placedSeams(tile: Tile, placement: Omit<Placement, 'tile'> = {}): Seam[] {
  return tile.seams.map((seam) => ({
    meets: seam.meets,
    edges: seam.edges.map((edge) =>
      rotateEdge(placement.flip ? flipEdge(edge) : edge, placement.rotate ?? 0)
    ),
  }));
}

/* ──────────────────────────────────  Stacks  ───────────────────────────── */

/** Bottom to top. Within one layer the author's order wins. */
export function sortStack(stack: Placement[], find: (id: string) => Tile | undefined): Placement[] {
  return stack
    .map((placement, index) => ({ placement, index, tile: find(placement.tile) }))
    .filter((entry): entry is { placement: Placement; index: number; tile: Tile } => Boolean(entry.tile))
    .sort(
      (a, b) =>
        LAYER_ORDER.indexOf(a.tile.layer) - LAYER_ORDER.indexOf(b.tile.layer) || a.index - b.index
    )
    .map((entry) => entry.placement);
}

/** One hex carrying a whole stack, drawn at `at`. */
export function stackMarkup(
  stack: Placement[],
  find: (id: string) => Tile | undefined,
  at: Point,
  size: number,
  options: RenderOptions = {}
): string {
  return sortStack(stack, find)
    .map((placement) => {
      const tile = find(placement.tile)!;
      return placementMarkup(tile, placement, at, size, options);
    })
    .join('');
}

/* ─────────────────────────────────  Documents  ─────────────────────────── */

type Box = { x: number; y: number; width: number; height: number };

const viewBoxOf = (box: Box) =>
  `${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}`;

export function tileBox(tile: Tile, size: number): Box {
  const width = (HEX_W + tile.bleed * 2) * size;
  const height = (2 + tile.bleed * 2) * size;
  return { x: -width / 2, y: -height / 2, width, height };
}

/** A standalone file for one tile — what `--formats=svg` writes. */
export function tileSvg(
  tile: Tile,
  placement: Omit<Placement, 'tile'> = {},
  options: RenderOptions = {}
): string {
  const size = options.size ?? DEFAULTS.size;
  const box = tileBox(tile, size);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxOf(box)}" ` +
    `width="${round(box.width)}" height="${round(box.height)}" role="img" aria-label="${tile.title}">` +
    (tile.clip ? hexClipDefs(options.clipId) : '') +
    placementMarkup(tile, placement, { x: 0, y: 0 }, size, options) +
    `</svg>`
  );
}

export function assemblyBox(
  assembly: Assembly,
  find: (id: string) => Tile | undefined,
  size: number,
  pad = 0.08
): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of assembly.cells) {
    const centre = centreOf(cell.q, cell.r, size);
    const bleed =
      Math.max(0, ...cell.stack.map((placement) => find(placement.tile)?.bleed ?? 0)) * size;
    minX = Math.min(minX, centre.x - (HEX_W / 2) * size - bleed);
    maxX = Math.max(maxX, centre.x + (HEX_W / 2) * size + bleed);
    minY = Math.min(minY, centre.y - size - bleed);
    maxY = Math.max(maxY, centre.y + size + bleed);
  }
  const margin = size * pad;
  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}

/** Every cell of an object, painted in reading order and by layer within a cell. */
export function assemblyMarkup(
  assembly: Assembly,
  find: (id: string) => Tile | undefined,
  size: number,
  options: RenderOptions = {}
): string {
  // North to south, so that anything rising out of a cell is painted over its
  // northern neighbour rather than sliced by it.
  const cells = [...assembly.cells].sort((a, b) => a.r - b.r || a.q - b.q);
  return cells
    .map((cell) => {
      const centre = centreOf(cell.q, cell.r, size);
      return (
        `<g data-cell="${cell.q},${cell.r}">` +
        stackMarkup(cell.stack, find, centre, size, options) +
        `</g>`
      );
    })
    .join('');
}

export function assemblySvg(
  assembly: Assembly,
  find: (id: string) => Tile | undefined,
  options: RenderOptions = {}
): string {
  const size = options.size ?? DEFAULTS.size;
  const box = assemblyBox(assembly, find, size);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxOf(box)}" ` +
    `width="${round(box.width)}" height="${round(box.height)}" role="img" aria-label="${assembly.title}">` +
    hexClipDefs(options.clipId) +
    assemblyMarkup(assembly, find, size, options) +
    `</svg>`
  );
}

/** The hex outlines of an object's footprint, for showing where the cells are. */
export function gridMarkup(cells: Cell[], size: number, colour = '#6b7a86'): string {
  return cells
    .map((cell) => {
      const centre = centreOf(cell.q, cell.r, size);
      return (
        `<path d="${hexPath(size)}" transform="translate(${round(centre.x)} ${round(centre.y)})" ` +
        `fill="none" stroke="${colour}" stroke-width="${round(size * 0.02)}" opacity="0.45"/>`
      );
    })
    .join('');
}

/**
 * Every tile as a `<symbol>`, for consumers that would rather `<use>` one file
 * than fetch a folder. Variants get their own symbol: they are separate
 * pictures, and picking one at random at display time would make the map
 * flicker between renders.
 */
export function spriteSvg(tiles: Tile[], options: RenderOptions = {}): string {
  const size = options.size ?? DEFAULTS.size;
  const symbols = tiles
    .flatMap((tile) =>
      Array.from({ length: tile.variants }, (_, variant) => {
        const box = tileBox(tile, size);
        return (
          `<symbol id="tile-${tile.id}-${variant}" viewBox="${viewBoxOf(box)}">` +
          placementMarkup(tile, { variant }, { x: 0, y: 0 }, size, options) +
          `</symbol>`
        );
      })
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="display:none">${hexClipDefs(options.clipId)}${symbols}</svg>`;
}
