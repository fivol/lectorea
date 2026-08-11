/**
 * The seam between land and water.
 *
 * All four pieces are one routine with different arguments, because a coastline
 * only has one rule: it enters the cell at a corner and leaves at a corner.
 * Corners are shared by three hexes, so a shoreline that starts and ends there
 * continues into its neighbours without a gap, whatever each of them drew in
 * between. That is why these are the only tiles the lake and the island rings
 * need — the arc of water edges rotates, the rule does not.
 */

import { corner, edgeMid, round, type Point } from '../hex.js';
import {
  between,
  field,
  groundColours,
  smooth,
  waterColours,
  GROUNDS,
  WATERS,
  type Palette,
} from '../ink.js';
import { defineTile, type Tile } from '../types.js';

/**
 * The line itself, pinned to `corner(start)` and `corner(start + span)`.
 *
 * `bow` bends it: positive pushes the land out into the water, negative bites a
 * bay out of the land. The ends never move — they are the handshake.
 */
export function shorePoints(
  rnd: () => number,
  start: number,
  span: number,
  bow: number,
  steps = 6
): Point[] {
  const from = corner(start);
  const to = corner(start + span);

  // Which way the water lies, averaged over the arc it occupies.
  let ox = 0;
  let oy = 0;
  for (let i = 0; i < span; i++) {
    const mid = edgeMid(start + i);
    ox += mid.x;
    oy += mid.y;
  }
  const length = Math.hypot(ox, oy) || 1;
  ox /= length;
  oy /= length;

  const points: Point[] = [];
  // Enough wander that a ring of six pieces reads as a lake rather than as the
  // hexagon it is laid out on. The ends stay pinned, so it costs no continuity.
  const wander = 0.42;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const swell = Math.sin(t * Math.PI);
    const jitter = swell * (rnd() - 0.5) * wander;
    const push = swell * bow + jitter;
    points.push({
      x: from.x + (to.x - from.x) * t + ox * push,
      y: from.y + (to.y - from.y) * t + oy * push,
    });
  }
  return points;
}

/** The shoreline closed back along the hex edges the water occupies. */
export function waterShape(points: Point[], start: number, span: number): string {
  const back: string[] = [];
  for (let i = start + span - 1; i > start; i--) {
    const c = corner(i);
    back.push(`L${round(c.x)} ${round(c.y)}`);
  }
  return `${smooth(points, false)}${back.join('')}Z`;
}

const waterOption = {
  values: WATERS,
  fallback: 'sea',
  note: 'Какая вода за швом: море, озеро или мелководье.',
};

const landOption = {
  values: GROUNDS,
  fallback: 'grass',
  note: 'Что за суша позади берега.',
};

/** Land, beach, water, surf — in that order, always. */
function coast(
  rnd: () => number,
  ink: Palette,
  land: string,
  water: string,
  start: number,
  span: number,
  bow: number
): string {
  const soil = groundColours(ink, land);
  const wet = waterColours(ink, water);
  // The bow is a starting point, not a value: pieces are laid next to each
  // other, and a bow pushed hard enough towards the water flattens the shore
  // onto the hex edge — six of those in a ring and the lake is a hexagon.
  // Varying it per variant is what keeps a run of the same piece from reading
  // as geometry.
  const points = shorePoints(rnd, start, span, bow + between(rnd, -0.18, 0.18));
  const line = smooth(points, false);

  // Which way is out. Used to drop marks on the right side of the line
  // without having to work out which side of a curve a point falls on.
  const mid = edgeMid(start + (span - 1) / 2);
  const length = Math.hypot(mid.x, mid.y) || 1;
  const ox = mid.x / length;
  const oy = mid.y / length;

  const marks: string[] = [];
  for (let i = 0; i < 3; i++) {
    const along = -0.5 + i * 0.5;
    const w = 0.07 + rnd() * 0.05;
    const x = -oy * along + ox * (0.62 + rnd() * 0.22);
    const y = ox * along + oy * (0.62 + rnd() * 0.22);
    marks.push(
      `<path d="M${round(x - w)} ${round(y)}q${round(w)} ${round(-w * 0.6)} ${round(w * 2)} 0" ` +
        `fill="none" stroke="${wet.pale}" stroke-width="0.03" stroke-linecap="round" opacity="0.7"/>`
    );
  }

  return (
    field(soil.body) +
    `<path d="${line}" fill="none" stroke="${ink.sand}" stroke-width="0.13" stroke-linecap="round"/>` +
    `<path d="${waterShape(points, start, span)}" fill="${wet.body}"/>` +
    `<path d="${line}" fill="none" stroke="${ink.foam}" stroke-width="0.045" ` +
    `stroke-linecap="round" opacity="0.85"/>` +
    marks.join('')
  );
}

export const coastTiles: Tile[] = [
  defineTile({
    id: 'coast-shore',
    group: 'coast',
    layer: 'ground',
    title: 'Берег',
    use: 'Прямой участок побережья: вода занимает две смежные грани.',
    tags: ['берег', 'вода', 'суша'],
    seams: [
      { edges: [1, 2], meets: 'water' },
      { edges: [3, 4, 5, 0], meets: 'land' },
    ],
    options: { water: waterOption, land: landOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('land'), opt('water'), 1, 2, 0.04),
  }),

  defineTile({
    id: 'coast-corner',
    group: 'coast',
    layer: 'ground',
    title: 'Поворот берега',
    use: 'Вода только за одной гранью — здесь береговая линия сворачивает.',
    tags: ['берег', 'вода', 'суша'],
    seams: [
      { edges: [1], meets: 'water' },
      { edges: [2, 3, 4, 5, 0], meets: 'land' },
    ],
    options: { water: waterOption, land: landOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('land'), opt('water'), 1, 1, -0.12),
  }),

  defineTile({
    id: 'coast-cape',
    group: 'coast',
    layer: 'ground',
    title: 'Мыс',
    use: 'Суша сужается: вода за тремя гранями подряд.',
    tags: ['берег', 'мыс', 'вода'],
    seams: [
      { edges: [1, 2, 3], meets: 'water' },
      { edges: [4, 5, 0], meets: 'land' },
    ],
    options: { water: waterOption, land: landOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('land'), opt('water'), 1, 3, 0.12),
  }),

  defineTile({
    id: 'coast-cove',
    group: 'coast',
    layer: 'ground',
    title: 'Бухта',
    use: 'Тот же шов, что и у берега, но вода вгрызается в сушу.',
    tags: ['берег', 'бухта', 'вода'],
    seams: [
      { edges: [1, 2], meets: 'water' },
      { edges: [3, 4, 5, 0], meets: 'land' },
    ],
    options: { water: waterOption, land: landOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('land'), opt('water'), 1, 2, -0.42),
  }),
];
