/**
 * The seam between land and water — the only place water belongs.
 *
 * All five pieces are one routine with different arguments, because a coastline
 * has one rule: it enters the cell at a corner and leaves at a corner. Corners
 * are shared by three hexes, so a shoreline pinned to them continues into its
 * neighbours without a gap, whatever each drew in between. That is why these
 * are the only pieces an island ring needs — the arc of water edges rotates,
 * the rule does not.
 *
 * The land half is left unpainted. The cell already has a colour — the
 * territory it belongs to — so the piece paints the sea, lays a pale band of
 * surf along the line, and leaves the rest alone.
 */

import { corner, edgeMid, round, type Point } from '../hex.js';
import { between, field, smooth, waterColours, WATERS, type Palette } from '../ink.js';
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
  // Enough wander that a ring of six pieces reads as an island rather than as
  // the hexagon it is laid out on. The ends stay pinned, so it costs nothing.
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
  note: 'Какая вода за швом: море, мелководье или глубина.',
};

/** Surf, sea, foam — in that order, over whatever colour the land already is. */
function coast(
  rnd: () => number,
  ink: Palette,
  water: string,
  start: number,
  span: number,
  bow: number,
  cliff: boolean
): string {
  const wet = waterColours(ink, water);
  // The bow is a starting point, not a value: pieces are laid next to each
  // other, and a bow pushed hard enough towards the water flattens the shore
  // onto the hex edge — six of those in a ring and the island is a hexagon.
  const points = shorePoints(rnd, start, span, bow + between(rnd, -0.18, 0.18));
  const line = smooth(points, false);

  // Which way is out. Used to drop marks on the right side of the line without
  // working out which side of a curve a point falls on.
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

  // The band under the water fill: half of it is covered when the sea is
  // painted, so what is left is a strip on the land side only — a beach when
  // it is pale, a cliff top when it is dark.
  const band = cliff
    ? `<path d="${line}" fill="none" stroke="${ink.shade}" stroke-width="0.16" stroke-linecap="round" opacity="0.4"/>`
    : `<path d="${line}" fill="none" stroke="${ink.light}" stroke-width="0.12" stroke-linecap="round" opacity="0.55"/>`;

  return (
    band +
    `<path d="${waterShape(points, start, span)}" fill="${wet.body}"/>` +
    (cliff
      ? // A cliff throws its shadow onto the water instead of running out into
        // a beach, which is the whole difference between the two at this size.
        `<path d="${line}" fill="none" stroke="${ink.ink}" stroke-width="0.09" ` +
        `stroke-linecap="round" opacity="0.3"/>` +
        `<path d="${line}" fill="none" stroke="${ink.ink}" stroke-width="0.03" ` +
        `stroke-linecap="round" opacity="0.5"/>`
      : `<path d="${line}" fill="none" stroke="${ink.foam}" stroke-width="0.045" ` +
        `stroke-linecap="round" opacity="0.85"/>`) +
    marks.join('')
  );
}

const seams = (span: number) => {
  const water = Array.from({ length: span }, (_, i) => 1 + i);
  const land = [0, 1, 2, 3, 4, 5].filter((edge) => !water.includes(edge));
  return [
    { edges: water, meets: 'water' as const },
    { edges: land, meets: 'land' as const },
  ];
};

export const coastTiles: Tile[] = [
  defineTile({
    id: 'coast-shore',
    group: 'coast',
    layer: 'plate',
    title: 'Берег',
    use: 'Прямой участок побережья: вода занимает две смежные грани.',
    tags: ['берег', 'вода'],
    seams: seams(2),
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('water'), 1, 2, 0.04, false),
  }),

  defineTile({
    id: 'coast-corner',
    group: 'coast',
    layer: 'plate',
    title: 'Поворот берега',
    use: 'Вода только за одной гранью — здесь береговая линия сворачивает.',
    tags: ['берег', 'вода'],
    seams: seams(1),
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('water'), 1, 1, -0.12, false),
  }),

  defineTile({
    id: 'coast-cape',
    group: 'coast',
    layer: 'plate',
    title: 'Мыс',
    use: 'Суша сужается: вода за тремя гранями подряд. Из шести таких выходит остров.',
    tags: ['берег', 'мыс', 'вода'],
    seams: seams(3),
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('water'), 1, 3, 0.12, false),
  }),

  defineTile({
    id: 'coast-cove',
    group: 'coast',
    layer: 'plate',
    title: 'Бухта',
    use: 'Тот же шов, что и у берега, но вода вгрызается в сушу.',
    tags: ['берег', 'бухта', 'вода'],
    seams: seams(2),
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('water'), 1, 2, -0.42, false),
  }),

  defineTile({
    id: 'coast-cliff',
    group: 'coast',
    layer: 'plate',
    title: 'Обрыв',
    use: 'Скалистый берег: тень в воду вместо пляжа. Ставится там, где к морю выходят горы.',
    tags: ['берег', 'скалы', 'вода'],
    seams: seams(2),
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => coast(rnd, ink, opt('water'), 1, 2, 0.1, true),
  }),

  defineTile({
    id: 'coast-open',
    group: 'coast',
    layer: 'plate',
    title: 'Вода без берега',
    use: 'Клетка целиком в воде, но в ряду берега — чтобы ряд не рвался на углу.',
    tags: ['берег', 'вода'],
    over: 'water',
    seams: [{ edges: [0, 1, 2, 3, 4, 5], meets: 'water' }],
    options: { water: waterOption },
    draw: ({ ink, opt }) => field(waterColours(ink, opt('water')).body),
  }),
];
