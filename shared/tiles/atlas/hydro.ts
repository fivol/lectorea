/**
 * Fresh water: a channel that crosses cells, and the body it ends up in.
 *
 * A river piece is the clearest case of a fragment. It carries no ground of its
 * own, it is clipped to the hex, and every arm runs from the centre out through
 * an edge midpoint at a fixed width — so whichever piece the next cell holds,
 * the channel continues at the same place and the same size. `seams` names the
 * edges it leaves by, which is the whole of what a consumer needs to lay a
 * river out.
 */

import { edgeMid, round, type Point } from '../hex.js';
import {
  between,
  blob,
  field,
  smooth,
  stone,
  waterColours,
  WATERS,
  type Palette,
} from '../ink.js';
import { defineTile, type Tile } from '../types.js';
import { shorePoints, waterShape } from './coast.js';

/** One width for the whole collection, or the channel steps at every join. */
const CHANNEL = 0.17;

const waterOption = {
  values: WATERS,
  fallback: 'lake',
  note: 'Оттенок воды — чтобы река и озеро совпали с морем, в которое впадают.',
};

/** Just past the edge, so the hex clip cuts the line instead of its cap. */
const mouthOf = (edge: number): Point => {
  const mid = edgeMid(edge);
  return { x: mid.x * 1.1, y: mid.y * 1.1 };
};

/** Arms from the centre out through the given edges, drawn as one channel. */
function channel(rnd: () => number, ink: Palette, water: string, edges: number[]): string {
  const wet = waterColours(ink, water);
  const heart: Point = { x: between(rnd, -0.1, 0.1), y: between(rnd, -0.1, 0.1) };
  const arms = edges.map((edge) => {
    const end = mouthOf(edge);
    const bend = between(rnd, -0.12, 0.12);
    return smooth(
      [
        heart,
        { x: heart.x + (end.x - heart.x) * 0.5 - end.y * bend, y: heart.y + (end.y - heart.y) * 0.5 + end.x * bend },
        end,
      ],
      false
    );
  });
  const d = arms.join('');
  return (
    `<path d="${d}" fill="none" stroke="${wet.deep}" stroke-width="${round(CHANNEL + 0.05)}" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>` +
    `<path d="${d}" fill="none" stroke="${wet.body}" stroke-width="${round(CHANNEL)}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${ink.foam}" stroke-width="${round(CHANNEL * 0.28)}" ` +
    `stroke-linecap="round" opacity="0.45"/>`
  );
}

export const hydroTiles: Tile[] = [
  defineTile({
    id: 'river-straight',
    group: 'hydro',
    layer: 'surface',
    title: 'Река',
    use: 'Прямой участок русла. Кладётся поверх любой суши, поворачивается на грань.',
    tags: ['река', 'вода'],
    on: 'grass-plain',
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
    on: 'grass-plain',
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
    on: 'grass-plain',
    seams: [{ edges: [0, 2, 4], meets: 'channel' }],
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => channel(rnd, ink, opt('water'), [0, 2, 4]),
  }),

  defineTile({
    id: 'river-spring',
    group: 'hydro',
    layer: 'surface',
    title: 'Исток',
    use: 'Начало реки. Единственный шов — русло уходит наружу через одну грань.',
    tags: ['река', 'вода', 'край'],
    on: 'rock-plain',
    seams: [{ edges: [0], meets: 'channel' }],
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => {
      const wet = waterColours(ink, opt('water'));
      return (
        channel(rnd, ink, opt('water'), [0]) +
        `<path d="${blob(rnd, -0.12, 0, 0.2, 0.35, 8)}" fill="${wet.body}"/>` +
        `<path d="${blob(rnd, -0.14, -0.03, 0.11, 0.35, 7)}" fill="${ink.foam}" opacity="0.6"/>` +
        stone(rnd, -0.4, 0.12, 0.11, ink) +
        stone(rnd, -0.3, -0.22, 0.08, ink)
      );
    },
  }),

  defineTile({
    id: 'river-mouth',
    group: 'hydro',
    layer: 'ground',
    title: 'Устье',
    use: 'Река встречает открытую воду: один шов — русло, два — море.',
    tags: ['река', 'берег', 'вода'],
    seams: [
      { edges: [3], meets: 'channel' },
      { edges: [0, 1], meets: 'water' },
    ],
    options: {
      water: { ...waterOption, fallback: 'sea' },
      land: { values: ['grass', 'soil', 'sand'] as const, fallback: 'grass', note: 'Суша по берегам устья.' },
    },
    bleed: 0,
    draw: ({ rnd, ink, opt }) => {
      const wet = waterColours(ink, opt('water'));
      const land =
        opt('land') === 'soil' ? ink.soil : opt('land') === 'sand' ? ink.sand : ink.grass;
      const shore = shorePoints(rnd, 0, 2, 0.06);

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
        field(land) +
        `<path d="${smooth(shore, false)}" fill="none" stroke="${ink.sand}" stroke-width="0.13" stroke-linecap="round"/>` +
        `<path d="${waterShape(shore, 0, 2)}" fill="${wet.body}"/>` +
        `<path d="${delta}" fill="${wet.body}"/>` +
        `<path d="${smooth(shore, false)}" fill="none" stroke="${ink.foam}" stroke-width="0.04" opacity="0.7"/>`
      );
    },
  }),

  defineTile({
    id: 'lake-water',
    group: 'hydro',
    layer: 'ground',
    title: 'Гладь',
    use: 'Нутро озера. Само по себе — просто вода; берег кладут вокруг «Поворотом берега».',
    tags: ['озеро', 'вода'],
    seams: [{ edges: [0, 1, 2, 3, 4, 5], meets: 'water' }],
    options: { water: { ...waterOption, fallback: 'lake' } },
    draw: ({ rnd, ink, opt }) => {
      const wet = waterColours(ink, opt('water'));
      const parts = [field(wet.body)];
      for (let i = 0; i < 3; i++) {
        const y = -0.4 + i * 0.4;
        parts.push(
          `<path d="M-0.6 ${round(y)}q0.3 -0.1 0.6 0" fill="none" stroke="${ink.foam}" ` +
            `stroke-width="0.035" stroke-linecap="round" opacity="${round(0.35 + rnd() * 0.3)}"/>`
        );
      }
      return parts.join('');
    },
  }),
];
