/**
 * Turning tiles into SVG.
 *
 * One function does the drawing and everything else — a single file, a sprite,
 * an assembled object, the viewer — goes through it, so what the exporter
 * writes is what the viewer showed. Size is applied as a transform rather than
 * baked into the coordinates: stroke widths then scale with the drawing, which
 * is the whole reason tiles are authored in a unit hex.
 *
 * The angle is applied here too, and where it is applied is the whole design.
 * A piece that lies on the ground — a plate, a river, a shoal, anything cut to
 * the cell — is drawn as a plan and laid back by the placement transform, so
 * its author never thinks about the projection at all. A piece with volume is
 * not: it is authored standing up, in screen coordinates, because the one thing
 * it is for is the height that the projection would otherwise flatten. `clip`
 * is the switch, and it already meant exactly this — cut to the cell, or
 * sticking out of it.
 */

import {
  cellAt,
  DIRECTIONS,
  flatCorner,
  flatHexPath,
  flipEdge,
  GROUND,
  hexPath,
  HEX_W,
  rotateEdge,
  round,
  SLAB,
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
  // Read right to left, which is the order the geometry goes through them: the
  // piece is mirrored, then turned — both on the ground, where the six edges
  // are still six equal edges and a turn is still a turn — and only then is the
  // ground laid back. Squashing first and turning after would swing a river arm
  // off the edge midpoint it is supposed to leave through.
  const lay = tile.clip ? ` scale(1 ${round(GROUND)})` : '';
  const turn = placement.rotate ? ` rotate(${round(60 * placement.rotate)})` : '';
  const mirror = placement.flip ? ' scale(-1 1)' : '';
  const body = tileBody(tile, placement, options);
  const clip = options.clipId ?? DEFAULTS.clipId;
  const inner = tile.clip ? `<g clip-path="url(#${clip})">${body}</g>` : body;
  return (
    `<g transform="translate(${round(at.x)} ${round(at.y)}) scale(${round(size)})${lay}${turn}${mirror}" ` +
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

/**
 * How far above and below its cell centre a piece reaches, in hex radii.
 *
 * Not symmetrical any more, and that is the projection showing through: a piece
 * lying on the ground is as squat as the cell is, while one with volume keeps
 * its full height upwards and gains nothing downwards, because height only ever
 * goes up. A single number for both would give every mountain an equal band of
 * empty sky under its feet.
 */
export function tileReach(tile: Tile): { up: number; down: number } {
  return {
    up: (tile.clip ? GROUND : 1) + tile.bleed,
    down: GROUND + tile.bleed,
  };
}

export function tileBox(tile: Tile, size: number): Box {
  const reach = tileReach(tile);
  const width = (HEX_W + tile.bleed * 2) * size;
  return {
    x: -width / 2,
    y: -reach.up * size,
    width,
    height: (reach.up + reach.down) * size,
  };
}

/* ───────────────────────────────  The slab  ─────────────────────────────── */

/**
 * The wall of ground a run of land cells shows where the earth beside it ends.
 *
 * Only the two edges facing the reader — south-east and south-west — are ever
 * drawn. Under a squash with no turn an east or west edge is exactly side-on:
 * sweeping it downwards produces a line with no width, so a wall there would be
 * an invisible shape at best and a stray hairline at worst.
 *
 * And only where nothing is next to it. A land cell has no plate of its own —
 * the ground is already the territory's colour, and painting over it is the one
 * thing the collection does not do — so a wall drawn between two cells of one
 * landmass has nothing to hide behind and shows up as a fence across the middle
 * of the field.
 */
export function slabPath(cells: Cell[], size: number, depth = SLAB): string {
  const present = new Set(cells.map((cell) => `${cell.q},${cell.r}`));
  const drop = depth * size;
  const faces: string[] = [];

  for (const cell of cells) {
    const centre = cellAt(cell.q, cell.r, size);
    for (const edge of [1, 2]) {
      const step = DIRECTIONS[edge];
      if (present.has(`${cell.q + step.q},${cell.r + step.r}`)) continue;
      const a = flatCorner(edge, size);
      const b = flatCorner(edge + 1, size);
      faces.push(
        `M${round(centre.x + a.x)} ${round(centre.y + a.y)}` +
          `L${round(centre.x + b.x)} ${round(centre.y + b.y)}` +
          `L${round(centre.x + b.x)} ${round(centre.y + b.y + drop)}` +
          `L${round(centre.x + a.x)} ${round(centre.y + a.y + drop)}Z`
      );
    }
  }
  // One path rather than one per face: neighbouring faces share an edge, and
  // two translucent quads meeting there draw a seam down every join.
  return faces.join('');
}

/** The wall, shaded. Over ground already carrying the territory's colour. */
export function slabMarkup(cells: Cell[], size: number, ink: Palette, depth = SLAB): string {
  const d = slabPath(cells, size, depth);
  return d ? `<path d="${d}" fill="${ink.shade}" opacity="0.42"/>` : '';
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
  // Land stands on its wall, and the wall hangs below the southernmost cell.
  const foot = assembly.over === 'land' ? SLAB : 0;
  for (const cell of assembly.cells) {
    const centre = cellAt(cell.q, cell.r, size);
    const stack = cell.stack.flatMap((placement) => find(placement.tile) ?? []);
    const bleed = Math.max(0, ...stack.map((tile) => tile.bleed));
    const up = Math.max(GROUND, ...stack.map((tile) => tileReach(tile).up));
    minX = Math.min(minX, centre.x - (HEX_W / 2 + bleed) * size);
    maxX = Math.max(maxX, centre.x + (HEX_W / 2 + bleed) * size);
    minY = Math.min(minY, centre.y - up * size);
    maxY = Math.max(maxY, centre.y + (GROUND + bleed + foot) * size);
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
  const ink = options.palette ?? DEFAULTS.palette;
  const wall = assembly.over === 'land' ? slabMarkup(assembly.cells, size, ink) : '';
  return (
    wall +
    cells
      .map((cell) => {
        const centre = cellAt(cell.q, cell.r, size);
        return (
          `<g data-cell="${cell.q},${cell.r}">` +
          stackMarkup(cell.stack, find, centre, size, options) +
          `</g>`
        );
      })
      .join('')
  );
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
      const centre = cellAt(cell.q, cell.r, size);
      return (
        `<path d="${flatHexPath(size)}" transform="translate(${round(centre.x)} ${round(centre.y)})" ` +
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
