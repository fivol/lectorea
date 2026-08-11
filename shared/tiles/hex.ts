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
 */

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
