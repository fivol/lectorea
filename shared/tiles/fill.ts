/**
 * Putting the collection on the map: which cells a territory owns, and what
 * goes on them.
 *
 * The map file (`public/map.svg`) carries outlines and nothing else — no cells,
 * no grid, not even the hex radius it was laid out at. It does not have to:
 * every one of those outlines is a chain of hex edges, so the grid is *in* the
 * geometry and can be read back off it. `hexGridOf` does that, and it is what
 * lets a redrawn map keep working. Store the cells in a file instead and the
 * next import silently puts every mountain in the wrong place.
 *
 * Everything here works in the plan — the map file's own coordinates, before
 * the ground is laid back. The angle is applied once, at the end, when a cell
 * centre is turned into a place on the screen, exactly as `cellAt` does it for
 * the viewer.
 */

import { boxOf, insideRing, signedDistance, type Point } from '../polygon.js';
import { centreOf, GROUND, HEX_W } from './hex.js';
import { hash, rng } from './ink.js';
import { stackMarkup, type RenderOptions } from './render.js';
import type { Chain, Scatter, Terrain } from './terrain.js';
import type { Cell, Placement, Tile } from './types.js';

/** The grid a map was laid out on: hex radius, and where cell (0, 0) sits. */
export type HexGrid = { r: number; x: number; y: number };

export type Axial = { q: number; r: number };

/* ──────────────────────────  Reading the grid back  ─────────────────────── */

/**
 * The corners of the outlines: the control point of every quadratic.
 *
 * The importer rounds each corner with one `Q` whose control point is the
 * corner itself, so the control points are the only exact lattice points in the
 * file — the `M` and `L` points are pulled back along the edges by the rounding
 * radius and would fit no grid at all.
 */
const CORNER_RE = /Q\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g;

const median = (values: number[]): number =>
  values.length ? [...values].sort((a, b) => a - b)[values.length >> 1] : NaN;

/**
 * The phase of a set of values against a period, averaged the only way a phase
 * can be: as an angle. A plain mean of `x mod p` is wrong whenever the values
 * straddle zero, which half of them do.
 */
function phaseOf(values: number[], period: number): number {
  let sx = 0;
  let sy = 0;
  for (const value of values) {
    const angle = (2 * Math.PI * (((value % period) + period) % period)) / period;
    sx += Math.cos(angle);
    sy += Math.sin(angle);
  }
  const mean = Math.atan2(sy, sx) / (2 * Math.PI);
  return ((mean * period) % period + period) % period;
}

const away = (value: number, period: number): number => {
  const offset = (((value % period) + period) % period) / period;
  return Math.min(offset, 1 - offset) * period;
};

/**
 * Recovers the hex grid the map was drawn on from the map's own outlines.
 *
 * Three facts do all the work. A hexagon's edge is exactly its circumradius, so
 * the distance between two corners in a row along an outline *is* the radius.
 * Every corner then lies on a lattice of `√3/2 · r` across and `r/2` down, which
 * pins the phase. And the last ambiguity — the phase leaves six candidate
 * origins, five of which put "cell centres" on corners or on edge midpoints —
 * is settled by measuring: a real centre is a whole radius from the nearest
 * corner, a false one is half that or less.
 *
 * Returns `null` when the file does not answer, which is the honest outcome for
 * a map that has stopped being a hex map. The caller draws no ground rather
 * than a field of tiles landing anywhere.
 */
export function hexGridOf(paths: string[]): HexGrid | null {
  const rings: Point[][] = [];
  for (const d of paths) {
    const corners: Point[] = [];
    for (const match of d.matchAll(CORNER_RE)) {
      corners.push({ x: Number(match[1]), y: Number(match[2]) });
    }
    if (corners.length >= 3) rings.push(corners);
  }
  const all = rings.flat();
  if (all.length < 12) return null;

  const edges: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      edges.push(Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  const r = median(edges);
  if (!Number.isFinite(r) || r <= 0) return null;

  const across = (HEX_W / 2) * r;
  const down = r / 2;
  const x = phaseOf(all.map((point) => point.x), across);
  const y = phaseOf(all.map((point) => point.y), down);

  // Every corner has to be on the lattice, not just most of them: a fifth of a
  // radius out is a map that was drawn some other way, and half a cell of drift
  // is worse than no tiles at all.
  const slack = r * 0.06;
  for (const point of all) {
    if (away(point.x - x, across) > slack || away(point.y - y, down) > slack) return null;
  }

  // Six candidate origins; the one whose cell centres keep their distance from
  // the corners is the grid the map was laid out on.
  let best: HexGrid | null = null;
  let bestScore = 0;
  const sample = all.filter((_, index) => index % 7 === 0).slice(0, 48);
  for (let step = 0; step < 2; step++) {
    for (let row = 0; row < 3; row++) {
      const grid = { r, x: x + step * across, y: y + row * down };
      const distances = sample.map((point) => {
        const centre = centreAt(snap(point, grid), grid);
        let nearest = Infinity;
        for (const corner of all) {
          nearest = Math.min(nearest, Math.hypot(corner.x - centre.x, corner.y - centre.y));
        }
        return nearest;
      });
      const score = median(distances);
      if (score > bestScore) {
        bestScore = score;
        best = grid;
      }
    }
  }
  return bestScore >= r * 0.8 ? best : null;
}

/** Centre of cell (q, r) in the plan. */
export function centreAt(cell: Axial, grid: HexGrid): Point {
  const centre = centreOf(cell.q, cell.r, grid.r);
  return { x: grid.x + centre.x, y: grid.y + centre.y };
}

/** Where that cell lands on the screen, once the ground is laid back. */
export function screenAt(cell: Axial, grid: HexGrid): Point {
  const centre = centreAt(cell, grid);
  return { x: centre.x, y: centre.y * GROUND };
}

/** The cell a point falls in — near enough for snapping, not a hit test. */
export function snap(point: Point, grid: HexGrid): Axial {
  const row = Math.round((point.y - grid.y) / (1.5 * grid.r));
  const step = Math.round((point.x - grid.x) / ((HEX_W / 2) * grid.r));
  // A row only carries every other column of the fine lattice: `2q + r` runs
  // over the integers of one parity, the row's own.
  const aligned = (((step - row) % 2) + 2) % 2 === 0 ? step : step + 1;
  return { q: (aligned - row) / 2, r: row };
}

/* ────────────────────────────  Cells of a shape  ────────────────────────── */

/**
 * How far inside the border a cell centre has to be, in hex radii.
 *
 * Relief stands up out of its cell and leans north; a piece on a cell whose
 * centre is a hair inside the outline hangs over the neighbouring territory, or
 * over the sea. Half a radius keeps it home — and where nothing at all is that
 * far inside, the sliver still gets its cells, because a territory drawn with
 * no ground on it looks like a hole rather than like a small field.
 */
export const INSET = 0.45;

export function cellsIn(ring: Point[], grid: HexGrid, inset: number = INSET): Axial[] {
  const box = boxOf(ring);
  if (!box.width || !box.height) return [];

  const first = snap({ x: box.x, y: box.y }, grid);
  const last = snap({ x: box.x + box.width, y: box.y + box.height }, grid);
  // Columns of the fine lattice — `2q + r` — that the box reaches across. Each
  // row uses every other one of them, the ones of its own parity.
  const from = Math.floor((box.x - grid.x) / ((HEX_W / 2) * grid.r)) - 1;
  const to = Math.ceil((box.x + box.width - grid.x) / ((HEX_W / 2) * grid.r)) + 1;

  const collect = (margin: number): Axial[] => {
    const found: Axial[] = [];
    for (let row = first.r - 1; row <= last.r + 1; row++) {
      for (let step = from; step <= to; step++) {
        if ((((step - row) % 2) + 2) % 2 !== 0) continue;
        const cell = { q: (step - row) / 2, r: row };
        const centre = centreAt(cell, grid);
        if (margin <= 0) {
          if (insideRing(centre, ring)) found.push(cell);
        } else if (signedDistance(centre, ring) >= margin) {
          found.push(cell);
        }
      }
    }
    return found;
  };

  const inside = collect(inset * grid.r);
  return inside.length ? inside : collect(0);
}

/* ────────────────────────────  Cells of the sea  ────────────────────────── */

/**
 * Beyond this many radii from a coastline nothing about the shore matters, so
 * the exact distance is not worth computing: the cell is open sea.
 */
const HORIZON = 5;

/** Distance from a point to a box, zero inside it. */
function toBox(point: Point, box: { x: number; y: number; width: number; height: number }): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

/**
 * Every cell of water in an area, with how far from land each one is.
 *
 * `depth` is in hex radii and only accurate near a coast — past the horizon it
 * is reported as the horizon, because the only question out there is "open
 * sea?" and the answer is yes. That cut-off is also what makes this cheap: a
 * cell more than a few radii from every landmass's *box* needs no polygon test
 * at all, and on this map most of the water is exactly that.
 *
 * `clearance` keeps the water off the shore, in radii: the coastline is drawn
 * heavily and the land stands on a cliff, so a shoal drawn right up against it
 * lands on the wall rather than in the water.
 */
export function oceanCells(
  area: { x: number; y: number; width: number; height: number },
  coasts: Point[][],
  grid: HexGrid,
  clearance = 1
): Array<Axial & { depth: number }> {
  const boxes = coasts.map(boxOf);
  const horizon = HORIZON * grid.r;
  const first = snap({ x: area.x, y: area.y }, grid);
  const last = snap({ x: area.x + area.width, y: area.y + area.height }, grid);
  const from = Math.floor((area.x - grid.x) / ((HEX_W / 2) * grid.r));
  const to = Math.ceil((area.x + area.width - grid.x) / ((HEX_W / 2) * grid.r));

  const found: Array<Axial & { depth: number }> = [];
  for (let row = first.r; row <= last.r; row++) {
    for (let step = from; step <= to; step++) {
      if ((((step - row) % 2) + 2) % 2 !== 0) continue;
      const cell = { q: (step - row) / 2, r: row };
      const centre = centreAt(cell, grid);

      let nearest = horizon;
      let land = false;
      for (let i = 0; i < coasts.length && !land; i++) {
        if (toBox(centre, boxes[i]) > nearest) continue;
        const distance = signedDistance(centre, coasts[i]);
        if (distance >= 0) land = true;
        else nearest = Math.min(nearest, -distance);
      }
      if (land || nearest < clearance * grid.r) continue;
      found.push({ ...cell, depth: nearest / grid.r });
    }
  }
  return found;
}

/* ──────────────────────────────  The filling  ───────────────────────────── */

const key = (cell: Axial): string => `${cell.q},${cell.r}`;

/** A tile's variant, picked from the same stream as everything else. */
const variantOf = (rnd: () => number): number => Math.floor(rnd() * 8);

function pickScatter(rnd: () => number, pool: Scatter[]): Scatter | null {
  const total = pool.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return null;
  let ticket = rnd() * total;
  for (const entry of pool) {
    ticket -= Math.max(0, entry.weight);
    if (ticket <= 0) return entry;
  }
  return pool[pool.length - 1];
}

/**
 * One run of a chain, west to east.
 *
 * The ends are the same piece mirrored, never turned: relief has a top, and a
 * range end rotated half a turn is a mountain standing on its head. The crown
 * goes in the middle if there is a middle, and the slopes on the eastern half
 * are mirrored so that a shoulder drawn running west reads as running east.
 */
function chainRun(chain: Chain, length: number, rnd: () => number): Placement[] {
  const middle = (length - 1) / 2;
  return Array.from({ length }, (_, index) => {
    const head = index === 0 && chain.head;
    const tail = index === length - 1 && chain.tail;
    const crown = chain.crown && length >= 3 && index === Math.round(middle);
    const piece = head || tail || (crown ? chain.crown! : chain.body);
    // The west end faces the wrong way round, and so does a shoulder on the
    // eastern half of the run. The crown and the east end are drawn facing east
    // already.
    const flip = Boolean(head) || (!tail && !crown && index > middle);
    return {
      tile: piece.tile,
      opts: piece.opts,
      variant: variantOf(rnd),
      ...(flip ? { flip: true } : {}),
    };
  });
}

/**
 * Turns a terrain and a set of cells into a stack per cell.
 *
 * Seeded on the domain and the cell, so the same field grows the same ground on
 * every render and on every machine — and so that a territory losing a cell to
 * a redrawn border does not reshuffle the rest of it.
 */
export function fillCells(cells: Axial[], terrain: Terrain, seed: string): Cell[] {
  const ordered = [...cells].sort((a, b) => a.r - b.r || a.q - b.q);
  const free = new Set(ordered.map(key));
  const taken = new Set<string>();
  const spent = new Set<string>();
  const out: Cell[] = [];

  if (terrain.chain) {
    const chain = terrain.chain;
    for (const cell of ordered) {
      if (taken.has(key(cell))) continue;
      const rnd = rng(hash(`${seed}:chain:${key(cell)}`));
      if (rnd() >= chain.share) continue;

      let length = 0;
      while (
        length < chain.max &&
        free.has(key({ q: cell.q + length, r: cell.r })) &&
        !taken.has(key({ q: cell.q + length, r: cell.r }))
      ) {
        length += 1;
      }
      if (length < chain.min) continue;

      const run = chainRun(chain, length, rnd);
      run.forEach((placement, index) => {
        const at = { q: cell.q + index, r: cell.r };
        taken.add(key(at));
        out.push({ ...at, stack: [placement] });
      });
    }
  }

  for (const cell of ordered) {
    if (taken.has(key(cell))) continue;
    const rnd = rng(hash(`${seed}:cell:${key(cell)}`));
    if (rnd() >= terrain.cover) continue;
    // A landmark is one to a territory: a second volcano is not twice the
    // landmark, it is a field of volcanoes.
    const pool = terrain.scatter.filter((entry) => !(entry.once && spent.has(entry.tile)));
    const chosen = pickScatter(rnd, pool);
    if (!chosen) continue;
    if (chosen.once) spent.add(chosen.tile);
    out.push({
      ...cell,
      stack: [{ tile: chosen.tile, opts: chosen.opts, variant: variantOf(rnd) }],
    });
  }

  // A quiet terrain on a small field can come out empty, and an empty
  // territory between full ones reads as one whose ground failed to load
  // rather than as a plain. The middle cell gets a piece regardless.
  if (!out.length && ordered.length) {
    const cell = ordered[ordered.length >> 1];
    const rnd = rng(hash(`${seed}:lone:${key(cell)}`));
    const chosen = pickScatter(rnd, terrain.scatter.filter((entry) => !entry.once));
    if (chosen) {
      out.push({ ...cell, stack: [{ tile: chosen.tile, variant: variantOf(rnd) }] });
    }
  }

  return out;
}

/**
 * The filled cells as markup, north to south.
 *
 * Reading order is the only depth this projection has: a piece standing on a
 * southern cell has to be painted over its northern neighbour, or a range comes
 * out sliced along every seam.
 */
export function fillMarkup(
  cells: Cell[],
  grid: HexGrid,
  find: (id: string) => Tile | undefined,
  options: RenderOptions = {}
): string {
  return [...cells]
    .sort((a, b) => a.r - b.r || a.q - b.q)
    .map((cell) => stackMarkup(cell.stack, find, screenAt(cell, grid), grid.r, options))
    .join('');
}

/**
 * Everything at once: one territory outline, in the plan, becomes the ground
 * inside it. `ring` is the outline flattened by `ringOf`.
 */
export function terrainMarkup(
  ring: Point[],
  grid: HexGrid,
  terrain: Terrain,
  seed: string,
  find: (id: string) => Tile | undefined,
  options: RenderOptions = {}
): string {
  return fillMarkup(fillCells(cellsIn(ring, grid), terrain, seed), grid, find, options);
}
