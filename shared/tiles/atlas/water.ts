/**
 * The sea, and what happens on it.
 *
 * The only group that owns a colour: the sea is one flat field behind the whole
 * map, so a water plate can simply be that colour, and everything else here is
 * a mark on top of it. Override `palette.sea` to match a map painted a
 * different blue and the whole group follows.
 *
 * These are what fills the space between landmasses, which on a map of islands
 * is most of the picture. A shoal, a reef, a whirlpool say "shallow here",
 * "danger here", "something is happening here" at a size where a drawing of a
 * wave would be three grey pixels.
 */

import { edgeMid, round, type Point } from '../hex.js';
import {
  between,
  blob,
  field,
  scatter,
  smooth,
  spot,
  waterColours,
  wave,
  WATERS,
  type Palette,
} from '../ink.js';
import { defineTile, type Tile } from '../types.js';

const waterOption = {
  values: WATERS,
  fallback: 'sea',
  note: 'Оттенок: открытое море, мелководье или глубина.',
};

/** Just past the edge, so the hex clip cuts the line instead of its cap. */
const mouthOf = (edge: number): Point => {
  const mid = edgeMid(edge);
  return { x: mid.x * 1.1, y: mid.y * 1.1 };
};

/** Three parallel streaks running the arc from one edge to another. */
function flow(rnd: () => number, ink: Palette, edges: number[]): string {
  const from = mouthOf(edges[0]);
  const to = mouthOf(edges[1]);
  const parts: string[] = [];
  for (let lane = -1; lane <= 1; lane++) {
    const offset = lane * 0.19;
    // Offset perpendicular to the chord, so the lanes stay parallel where they
    // cross the edge — that is where the next cell's current has to meet them.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * offset;
    const ny = (dx / length) * offset;
    const line = smooth(
      [
        { x: from.x + nx, y: from.y + ny },
        { x: (from.x + to.x) / 2 + nx * 1.6 + between(rnd, -0.08, 0.08), y: (from.y + to.y) / 2 + ny * 1.6 },
        { x: to.x + nx, y: to.y + ny },
      ],
      false
    );
    parts.push(
      `<path d="${line}" fill="none" stroke="${ink.foam}" stroke-width="${round(0.05 - Math.abs(lane) * 0.014)}" ` +
        `stroke-linecap="round" opacity="${round(0.7 - Math.abs(lane) * 0.2)}"/>`
    );
  }
  return parts.join('');
}

export const waterTiles: Tile[] = [
  defineTile({
    id: 'water-plain',
    group: 'water',
    layer: 'plate',
    title: 'Море',
    use: 'Открытая вода. Основа любой морской клетки, поверх неё всё остальное.',
    tags: ['вода', 'основа'],
    over: 'water',
    options: { water: waterOption },
    draw: ({ rnd, ink, opt }) => {
      const wet = waterColours(ink, opt('water'));
      const parts = [field(wet.body)];
      for (let i = 0; i < 2; i++) {
        const y = -0.35 + i * 0.7;
        parts.push(
          `<path d="${wave(rnd, { x: -1.1, y }, { x: 1.1, y }, 0.1, 4)}" fill="none" ` +
            `stroke="${wet.deep}" stroke-width="0.05" stroke-linecap="round" opacity="0.35"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'shallows',
    group: 'water',
    layer: 'surface',
    title: 'Мелководье',
    use: 'Светлая отмель. Кладётся кольцом вокруг суши — она объясняет, где кончается дно.',
    tags: ['вода', 'отмель'],
    over: 'water',
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const point = spot(rnd, 0.68);
        parts.push(
          `<path d="${blob(rnd, point.x, point.y, between(rnd, 0.34, 0.55), 0.5, 8)}" ` +
            `fill="${ink.seaShallow}" opacity="0.55"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'deep',
    group: 'water',
    layer: 'surface',
    title: 'Глубина',
    use: 'Тёмное пятно вдали от берега. Противовес отмели: карта перестаёт быть плоской.',
    tags: ['вода', 'глубина'],
    over: 'water',
    draw: ({ rnd, ink }) => {
      const point = spot(rnd, 0.5);
      return (
        `<path d="${blob(rnd, point.x, point.y, between(rnd, 0.55, 0.8), 0.45, 9)}" ` +
        `fill="${ink.seaDeep}" opacity="0.5"/>`
      );
    },
  }),

  defineTile({
    id: 'reef',
    group: 'water',
    layer: 'surface',
    title: 'Риф',
    use: 'Гряда под водой: рваные дуги и пена над ними. Ставится вдоль берега.',
    tags: ['вода', 'риф', 'опасность'],
    over: 'water',
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 4; i++) {
        const point = spot(rnd, 0.7);
        const w = between(rnd, 0.18, 0.34);
        const arc =
          `M${round(point.x - w)} ${round(point.y)}` +
          `Q${round(point.x)} ${round(point.y - w * between(rnd, 0.5, 1))} ${round(point.x + w)} ${round(point.y)}`;
        parts.push(
          `<path d="${arc}" fill="none" stroke="${ink.reef}" stroke-width="0.07" ` +
            `stroke-linecap="round" opacity="0.8"/>`,
          `<path d="${arc}" fill="none" stroke="${ink.foam}" stroke-width="0.025" ` +
            `stroke-linecap="round" opacity="0.55" transform="translate(0 -0.05)"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'skerries',
    group: 'water',
    layer: 'overlay',
    title: 'Островки',
    use: 'Камни над водой с пенным кольцом. Разбивает пустое море, не занимая клетку.',
    tags: ['вода', 'камень'],
    over: 'water',
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (const point of scatter(rnd, 4, 0.62)) {
        const r = between(rnd, 0.07, 0.13);
        parts.push(
          `<ellipse cx="${round(point.x)}" cy="${round(point.y)}" rx="${round(r * 1.9)}" ry="${round(r * 0.9)}" ` +
            `fill="none" stroke="${ink.foam}" stroke-width="0.022" opacity="0.7"/>`,
          `<path d="${blob(rnd, point.x, point.y - r * 0.3, r, 0.5, 6)}" fill="${ink.shade}" opacity="0.55"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'whirlpool',
    group: 'water',
    layer: 'overlay',
    title: 'Водоворот',
    use: 'Одна воронка на клетку. Метка места, вокруг которой строят маршрут.',
    tags: ['вода', 'опасность'],
    over: 'water',
    variants: 3,
    draw: ({ rnd, ink }) => {
      // An Archimedean spiral sampled and smoothed: two and a half turns is
      // the least that still reads as a spiral rather than as a comma.
      const turns = 2.5;
      const steps = 34;
      const radius = between(rnd, 0.5, 0.62);
      const spin = rnd() > 0.5 ? 1 : -1;
      const points: Point[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = spin * t * turns * Math.PI * 2;
        const r = radius * (1 - t) ** 0.85;
        points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.82 });
      }
      const path = smooth(points, false);
      return (
        `<ellipse cx="0" cy="0" rx="${round(radius)}" ry="${round(radius * 0.82)}" ` +
        `fill="${ink.seaDeep}" opacity="0.32"/>` +
        `<path d="${path}" fill="none" stroke="${ink.foam}" stroke-width="0.05" ` +
        `stroke-linecap="round" opacity="0.85"/>` +
        `<circle cx="0" cy="0" r="0.05" fill="${ink.ink}" opacity="0.45"/>`
      );
    },
  }),

  defineTile({
    id: 'current-straight',
    group: 'water',
    layer: 'surface',
    title: 'Течение',
    use: 'Полосы воды через клетку. Тянется от клетки к клетке — море со своим направлением.',
    tags: ['вода', 'течение'],
    over: 'water',
    seams: [{ edges: [0, 3], meets: 'current' }],
    draw: ({ rnd, ink }) => flow(rnd, ink, [3, 0]),
  }),

  defineTile({
    id: 'current-bend',
    group: 'water',
    layer: 'surface',
    title: 'Изгиб течения',
    use: 'Поворот полос через клетку — вход и выход через грани 0 и 2.',
    tags: ['вода', 'течение'],
    over: 'water',
    seams: [{ edges: [0, 2], meets: 'current' }],
    draw: ({ rnd, ink }) => flow(rnd, ink, [0, 2]),
  }),

  defineTile({
    id: 'swell',
    group: 'water',
    layer: 'surface',
    title: 'Зыбь',
    use: 'Длинные волны для пустого моря. Самая дешёвая плитка, кладётся пачками.',
    tags: ['вода', 'узор'],
    over: 'water',
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const y = -0.45 + i * 0.45 + between(rnd, -0.08, 0.08);
        parts.push(
          `<path d="${wave(rnd, { x: -1.05, y }, { x: 1.05, y }, 0.12, 5)}" fill="none" ` +
            `stroke="${ink.foam}" stroke-width="0.04" stroke-linecap="round" opacity="0.5"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'ice-floes',
    group: 'water',
    layer: 'surface',
    title: 'Льдины',
    use: 'Битый лёд на воде. Северный край карты без второй палитры.',
    tags: ['вода', 'лёд'],
    over: 'water',
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (const point of scatter(rnd, 6, 0.74)) {
        const r = between(rnd, 0.12, 0.26);
        const corners = Array.from({ length: 5 }, (_, k) => {
          const a = (Math.PI * 2 * k) / 5 + rnd() * 0.5;
          const own = r * between(rnd, 0.7, 1.2);
          return `${round(point.x + Math.cos(a) * own)} ${round(point.y + Math.sin(a) * own * 0.8)}`;
        });
        parts.push(`<path d="M${corners.join('L')}Z" fill="${ink.ice}" opacity="0.85"/>`);
      }
      return parts.join('');
    },
  }),
];
