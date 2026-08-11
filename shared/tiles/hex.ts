/**
 * Unit-hex geometry: circumradius 1, centred on the origin, corner pointing up.
 *
 * The formulas repeat `shared/mapgen.ts` exactly, and deliberately so — a tile
 * has to land on the cell the map generator produced, and two hex conventions
 * in one repository is a redesign waiting to happen.
 *
 * Authoring in a unit hex is what makes a tile a function of size rather than
 * an asset: `scale(size)` turns the same drawing into a 20 px overview cell and
 * a 200 px close-up, stroke widths included.
 *
 * Two spaces live in here, and telling them apart is most of the collection's
 * geometry. **Ground** is the plan: the hex the generator laid out, where a
 * neighbour is one step away in whichever direction and a coast meets a coast
 * at a shared corner. **Screen** is that ground seen from above and a little to
 * the side — `shared/view.ts` — where the same hex is squat and the same
 * neighbour is closer than it was. Everything that has to agree with another
 * cell is worked out on the ground and projected at the end; nothing is ever
 * measured back the other way.
 */

import { flat, project } from '../view.js';

export type Point = { x: number; y: number };

const SQRT3 = Math.sqrt(3);

/** Centre to corner. Every other measurement is derived from it. */
export const HEX_R = 1;
/** Flat to flat, across the pointy-top hex. */
export const HEX_W = SQRT3;
/** Point to point. */
export const HEX_H = 2;

/**
 * Neighbour directions in axial coordinates, ordered so that direction `d`
 * crosses the edge between corners `d` and `d + 1`.
 */
export const DIRECTIONS: ReadonlyArray<{ q: number; r: number }> = [
  { q: 1, r: 0 }, // 0 · east
  { q: 0, r: 1 }, // 1 · south-east
  { q: -1, r: 1 }, // 2 · south-west
  { q: -1, r: 0 }, // 3 · west
  { q: 0, r: -1 }, // 4 · north-west
  { q: 1, r: -1 }, // 5 · north-east
];

/** Human names for the six edges, for the viewer and the manifest. */
export const EDGE_NAMES = ['В', 'ЮВ', 'ЮЗ', 'З', 'СЗ', 'СВ'] as const;

export function corner(index: number, r: number = HEX_R): Point {
  const angle = ((60 * (((index % 6) + 6) % 6) - 30) * Math.PI) / 180;
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

/** The two corners edge `index` runs between. */
export function edgeCorners(index: number, r: number = HEX_R): [Point, Point] {
  return [corner(index, r), corner(index + 1, r)];
}

export function edgeMid(index: number, r: number = HEX_R): Point {
  const [a, b] = edgeCorners(index, r);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The hex outline as a closed path. Used as the clip for anything flat. */
export function hexPath(r: number = HEX_R): string {
  const points = Array.from({ length: 6 }, (_, i) => corner(i, r));
  return `M${points.map((p) => `${round(p.x)} ${round(p.y)}`).join('L')}Z`;
}

/** Centre of cell (q, r) on a grid of hexes with the given circumradius. */
export function centreOf(q: number, r: number, size: number = HEX_R): Point {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

export function neighbour(q: number, r: number, edge: number): { q: number; r: number } {
  const d = DIRECTIONS[((edge % 6) + 6) % 6];
  return { q: q + d.q, r: r + d.r };
}

/** Where edge `edge` ends up after the tile is turned `steps` sixths of a turn. */
export function rotateEdge(edge: number, steps: number): number {
  return (((edge + steps) % 6) + 6) % 6;
}

/**
 * Where edge `edge` ends up after the tile is mirrored left to right.
 *
 * Mirroring exists because relief has gravity: a mountain shoulder that runs
 * out to the west cannot be turned into its eastern twin by rotation without
 * standing the mountain on its head, but it can be flipped.
 */
export function flipEdge(edge: number): number {
  return (((3 - edge) % 6) + 6) % 6;
}

/* ──────────────────────────────  On the screen  ────────────────────────── */

/**
 * The cell as the reader sees it: the same hex, laid back.
 *
 * Squat, so the corners still point north and south but only `GROUND` as far,
 * and the flats still run east and west at full width. Nothing is rotated, so
 * corner `i` is still corner `i` and edge `i` is still edge `i` — which is what
 * lets the seams keep working with no second table.
 */
export const flatCorner = (index: number, r: number = HEX_R): Point => {
  const c = corner(index, r);
  return { x: c.x, y: flat(c.y) };
};

/** The outline of that cell. The clip for anything lying on the ground. */
export function flatHexPath(r: number = HEX_R): string {
  const points = Array.from({ length: 6 }, (_, i) => flatCorner(i, r));
  return `M${points.map((p) => `${round(p.x)} ${round(p.y)}`).join('L')}Z`;
}

/** Where cell (q, r) lands on the screen, `z` above the ground. */
export function cellAt(q: number, r: number, size: number = HEX_R, z = 0): Point {
  const c = centreOf(q, r, size);
  return project(c.x, c.y, z);
}

/**
 * The near rim of the cell at a given `x`: how far down the ground reaches
 * where a thing standing on it has to end.
 *
 * The south of a squat hex is two slopes meeting at a point, not a straight
 * line, so a mountain whose foot is drawn level either floats off the ground at
 * the middle or hangs over the edge at the sides. Off the cell to either side
 * the rim is held at the corners' height rather than run on down: relief bleeds
 * past its cell and should not go on falling while it does.
 */
export function rim(x: number, r: number = HEX_R): number {
  const half = (Math.sqrt(3) / 2) * r;
  const t = Math.min(1, Math.abs(x) / half);
  return flat(r * (1 - t / 2));
}

/**
 * How thick a cell of land is, in hex radii — the wall between the ground on
 * top of it and whatever it stands in. The map uses the same number for its
 * continents, so a tile and the coast it sits behind agree about the drop.
 */
export { flat, GROUND, project, SLAB } from '../view.js';

/** Is the point inside the hex? Three slab tests, one per pair of edges. */
export function inside(p: Point, r: number = HEX_R): boolean {
  const k = (SQRT3 / 2) * r;
  const a = (SQRT3 / 2) * p.y;
  return (
    Math.abs(p.x) <= k && Math.abs(0.5 * p.x + a) <= k && Math.abs(0.5 * p.x - a) <= k
  );
}

/** Three decimals at most, and no trailing zeros — the collection is text. */
export function round(value: number): string {
  return Number(value.toFixed(3)).toString();
}
