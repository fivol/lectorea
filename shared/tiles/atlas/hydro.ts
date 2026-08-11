/**
 * Rivers: the only water allowed inland, because a river is a line rather than
 * a field and it does not cover the territory underneath.
 *
 * A river piece is the clearest case of a fragment. It carries no ground of its
 * own, it is clipped to the hex, and every arm runs from the centre out through
 * an edge midpoint at a fixed width — so whichever piece the next cell holds,
 * the channel continues at the same place and the same size. `seams` names the
 * edges it leaves by, which is the whole of what a consumer needs to lay a
 * river out.
 *
 * The channel is drawn over a darker casing. Over a pale territory the casing
 * is what gives it an edge; over a dark one the water itself is the light part.
 * Either way it reads without knowing the colour underneath.
 */

import { edgeMid, round, type Point } from '../hex.js';
import {
  between,
  blob,
  dim,
  edge as inkEdge,
  smooth,
  waterColours,
  WATERS,
  type Palette,
} from '../ink.js';
import { defineTile, type Tile } from '../types.js';
import { shorePoints, waterShape } from './coast.js';

/** One width for the whole collection, or the channel steps at every join. */
const CHANNEL = 0.15;

const waterOption = {
  values: WATERS,
  fallback: 'sea',
  note: 'Оттенок воды — чтобы река совпала с морем, в которое впадает.',
};

/** Just past the edge, so the hex clip cuts the line instead of its cap. */
const mouthOf = (index: number): Point => {
  const mid = edgeMid(index);
  return { x: mid.x * 1.1, y: mid.y * 1.1 };
};

/** Arms from the centre out through the given edges, drawn as one channel. */
function channel(rnd: () => number, ink: Palette, water: string, edges: number[]): string {
  const wet = waterColours(ink, water);
  const heart: Point = { x: between(rnd, -0.1, 0.1), y: between(rnd, -0.1, 0.1) };
  const arms = edges.map((index) => {
    const end = mouthOf(index);
    const bend = between(rnd, -0.12, 0.12);
    return smooth(
      [
        heart,
        {
          x: heart.x + (end.x - heart.x) * 0.5 - end.y * bend,
          y: heart.y + (end.y - heart.y) * 0.5 + end.x * bend,
        },
        end,
      ],
      false
    );
  });
  const d = arms.join('');
  return (
    `<path d="${d}" fill="none" stroke="${ink.ink}" stroke-width="${round(CHANNEL + 0.07)}" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity="0.22"/>` +
    `<path d="${d}" fill="none" stroke="${wet.body}" stroke-width="${round(CHANNEL)}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${ink.foam}" stroke-width="${round(CHANNEL * 0.3)}" ` +
    `stroke-linecap="round" opacity="0.4"/>`
  );
}

export const hydroTiles: Tile[] = [
  defineTile({
    id: 'river-straight',
    group: 'hydro',
    layer: 'surface',
    title: 'Река',
    use: 'Прямой участок русла. Кладётся на любую сушу, поворачивается на грань.',
    tags: ['река', 'вода'],
    seams: [{ edges: [0, 3], meets: 'channel' }],
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => channel(rnd, ink, opt('water'), [0, 3]),
  }),

  defineTile({
    id: 'river-bend',
    group: 'hydro',
    layer: 'surface',
    title: 'Излучина',
    use: 'Поворот русла через клетку — вход и выход через грани 0 и 2.',
    tags: ['река', 'вода'],
    seams: [{ edges: [0, 2], meets: 'channel' }],
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => channel(rnd, ink, opt('water'), [0, 2]),
  }),

  defineTile({
    id: 'river-fork',
    group: 'hydro',
    layer: 'surface',
    title: 'Слияние',
    use: 'Три рукава в одной клетке: два притока и русло.',
    tags: ['река', 'вода'],
    seams: [{ edges: [0, 2, 4], meets: 'channel' }],
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => channel(rnd, ink, opt('water'), [0, 2, 4]),
  }),

  defineTile({
    id: 'river-spring',
    group: 'hydro',
    layer: 'surface',
    title: 'Исток',
    use: 'Начало реки в горах. Единственный шов — русло уходит через одну грань.',
    tags: ['река', 'вода', 'край'],
    seams: [{ edges: [0], meets: 'channel' }],
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => {
      const wet = waterColours(ink, opt('water'));
      const pool = blob(rnd, -0.16, 0, 0.22, 0.35, 8);
      return (
        channel(rnd, ink, opt('water'), [0]) +
        dim(pool, ink, 0.24) +
        `<path d="${pool}" fill="${wet.body}"/>` +
        inkEdge('M-0.58 -0.12q0.14 0.16 0.22 0.26', ink, 0.03, 0.3) +
        inkEdge('M-0.52 0.28q0.16 -0.1 0.26 -0.13', ink, 0.03, 0.25)
      );
    },
  }),

  defineTile({
    id: 'river-mouth',
    group: 'hydro',
    layer: 'plate',
    title: 'Устье',
    use: 'Река встречает открытую воду: один шов — русло, два — море.',
    tags: ['река', 'берег', 'вода'],
    seams: [
      { edges: [3], meets: 'channel' },
      { edges: [0, 1], meets: 'water' },
    ],
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => {
      const wet = waterColours(ink, opt('water'));
      const shore = shorePoints(rnd, 0, 2, 0.06);
      const line = smooth(shore, false);

      // The delta is a filled shape, not a stroke: it has to widen, and a
      // stroke has exactly one width along its whole length.
      const from = mouthOf(3);
      const to = { x: 0.25, y: 0.42 };
      const left: Point[] = [];
      const right: Point[] = [];
      const steps = 5;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t + Math.sin(t * Math.PI) * 0.06;
        const half = (CHANNEL / 2) * (1 - t) + 0.3 * t;
        left.push({ x: x - half * 0.35, y: y - half });
        right.push({ x: x + half * 0.35, y: y + half });
      }
      // One open path down one bank and back up the other: the two ends stay
      // exact, which is where the channel from the previous cell arrives.
      const delta = `${smooth([...left, ...[...right].reverse()], false)}Z`;

      return (
        `<path d="${line}" fill="none" stroke="${ink.light}" stroke-width="0.12" ` +
        `stroke-linecap="round" opacity="0.55"/>` +
        `<path d="${waterShape(shore, 0, 2)}" fill="${wet.body}"/>` +
        `<path d="${delta}" fill="${wet.body}"/>` +
        `<path d="${line}" fill="none" stroke="${ink.foam}" stroke-width="0.04" opacity="0.7"/>`
      );
    },
  }),
];
