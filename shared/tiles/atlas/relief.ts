/**
 * Things with volume: a range crossing several cells, and the lumps that stand
 * on their own.
 *
 * Relief is the reason a tile is not simply a hexagonal picture. A mountain is
 * taller than its cell, so these are not clipped and they overhang their
 * neighbours a little. And relief has a top: the range pieces may be mirrored
 * to face the other way, never turned, which is what `upright` records.
 *
 * The range joins at a fixed height. Every piece leaves its cell across the
 * east and west edge midpoints with a short flat run at y = 0, and its foot
 * with another at y = 0.55, so two pieces laid side by side share a silhouette
 * whatever happened in between.
 */

import { round, type Point } from '../hex.js';
import { between, blob, smooth, type Palette } from '../ink.js';
import { defineTile, type Tile } from '../types.js';

/** Where a range hands over to the next cell. Never varied. */
const RIDGE_Y = 0;
const FOOT_Y = 0.55;
const EDGE = 0.95;
const FLAT = 0.72;

/** Outline from a ridge line, closed along the foot. */
function massif(rnd: () => number, ridge: Point[], footFrom: number, footTo: number): string {
  const foot: Point[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = footFrom + (footTo - footFrom) * t;
    const sag = Math.sin(t * Math.PI) * (rnd() - 0.5) * 0.1;
    foot.push({ x, y: FOOT_Y + sag });
  }
  return `${smooth([...ridge, ...foot], false)}Z`;
}

/** A ridge line across the whole cell, peaking `height` above the handover. */
function ridgeAcross(rnd: () => number, height: number, peaks: number): Point[] {
  const points: Point[] = [{ x: -EDGE, y: RIDGE_Y }, { x: -FLAT, y: RIDGE_Y - 0.04 }];
  for (let i = 0; i < peaks; i++) {
    const t = (i + 0.5) / peaks;
    const x = -FLAT + (FLAT * 2) * t;
    const own = height * between(rnd, 0.72, 1);
    points.push({ x: x - 0.16, y: RIDGE_Y - own * 0.55 });
    points.push({ x, y: RIDGE_Y - own });
    points.push({ x: x + 0.18, y: RIDGE_Y - own * 0.5 });
  }
  points.push({ x: FLAT, y: RIDGE_Y - 0.04 }, { x: EDGE, y: RIDGE_Y });
  return points;
}

/** The lit side, the shaded side and — if asked for — the cap. */
function faces(rnd: () => number, ink: Palette, ridge: Point[], cap: boolean): string {
  const top = ridge.reduce((best, point, i) => (point.y < ridge[best].y ? i : best), 0);
  const summit = ridge[top];
  const parts: string[] = [];

  // Shade everything east of the summit: one light source for the whole map,
  // and the flat fills would read as paper cut-outs without it.
  const east = ridge.filter((point) => point.x >= summit.x);
  if (east.length > 1) {
    parts.push(
      `<path d="${smooth(east, false)}L${round(east[east.length - 1].x)} ${round(FOOT_Y)}` +
        `L${round(summit.x)} ${round(FOOT_Y)}Z" fill="${ink.rockDeep}" opacity="0.34"/>`
    );
  }

  if (cap) {
    // The cap sits on the *drawn* summit, not on the point that defined it:
    // `smooth` rounds the corner, so the silhouette peaks a little lower than
    // the ridge point does, and a cap put at the point floats above the rock.
    const before = ridge[Math.max(0, top - 1)];
    const after = ridge[Math.min(ridge.length - 1, top + 1)];
    const apex = {
      x: (before.x + summit.x * 2 + after.x) / 4,
      y: (before.y + summit.y * 2 + after.y) / 4,
    };

    // A sharp top and a ragged hem: the peak has to stay the peak, but a
    // straight snowline would read as a paper triangle glued on.
    const w = 0.2 + rnd() * 0.08;
    const drop = apex.y + 0.24 + rnd() * 0.1;
    const x = apex.x;
    parts.push(
      `<path d="M${round(x - w)} ${round(drop)}L${round(x)} ${round(apex.y + 0.01)}` +
        `L${round(x + w)} ${round(drop + 0.05)}` +
        `Q${round(x + w * 0.4)} ${round(drop + 0.13)} ${round(x)} ${round(drop + 0.03)}` +
        `Q${round(x - w * 0.45)} ${round(drop - 0.05)} ${round(x - w)} ${round(drop)}Z" ` +
        `fill="${ink.snow}"/>`
    );
  }
  return parts.join('');
}

const capOption = {
  values: ['snow', 'bare'] as const,
  fallback: 'snow',
  note: 'Снежная шапка на вершине или голая порода.',
};

export const reliefTiles: Tile[] = [
  defineTile({
    id: 'mountain-peak',
    group: 'relief',
    layer: 'relief',
    title: 'Вершина',
    use: 'Середина хребта. Ставится между склонами, сама по себе не читается.',
    tags: ['гора', 'хребет'],
    on: 'rock-plain',
    seams: [{ edges: [0, 3], meets: 'ridge' }],
    options: { cap: capOption },
    bleed: 0.35,
    draw: ({ rnd, ink, opt }) => {
      const ridge = ridgeAcross(rnd, 1.05, 1);
      return (
        `<path d="${massif(rnd, ridge, EDGE, -EDGE)}" fill="${ink.rock}"/>` +
        faces(rnd, ink, ridge, opt('cap') === 'snow')
      );
    },
  }),

  defineTile({
    id: 'mountain-slope',
    group: 'relief',
    layer: 'relief',
    title: 'Склон',
    use: 'Плечо хребта. Между вершиной и краем; повторяется сколько нужно.',
    tags: ['гора', 'хребет'],
    on: 'rock-plain',
    seams: [{ edges: [0, 3], meets: 'ridge' }],
    options: { cap: { ...capOption, fallback: 'bare' } },
    bleed: 0.2,
    draw: ({ rnd, ink, opt }) => {
      const ridge = ridgeAcross(rnd, 0.62, 2);
      return (
        `<path d="${massif(rnd, ridge, EDGE, -EDGE)}" fill="${ink.rock}"/>` +
        faces(rnd, ink, ridge, opt('cap') === 'snow')
      );
    },
  }),

  defineTile({
    id: 'mountain-foot',
    group: 'relief',
    layer: 'relief',
    title: 'Окончание хребта',
    use: 'Хребет сходит на нет. Закрывает ряд с запада; на восток — отражением.',
    tags: ['гора', 'хребет', 'край'],
    on: 'rock-plain',
    seams: [{ edges: [3], meets: 'ridge' }],
    bleed: 0.15,
    draw: ({ rnd, ink }) => {
      const ridge: Point[] = [
        { x: -EDGE, y: RIDGE_Y },
        { x: -FLAT, y: RIDGE_Y - 0.04 },
        { x: -0.3, y: RIDGE_Y - 0.3 },
        { x: 0.12, y: RIDGE_Y + 0.1 },
        { x: 0.46, y: FOOT_Y - 0.08 },
      ];
      return (
        `<path d="${massif(rnd, ridge, 0.46, -EDGE)}" fill="${ink.rock}"/>` +
        faces(rnd, ink, ridge, false)
      );
    },
  }),

  defineTile({
    id: 'hill',
    group: 'relief',
    layer: 'relief',
    title: 'Холм',
    use: 'Самостоятельная неровность. Кладётся на любую сушу, ни с чем не стыкуется.',
    tags: ['холм', 'рельеф'],
    on: 'grass-plain',
    bleed: 0.1,
    draw: ({ rnd, ink }) => {
      const mounds = 1 + Math.floor(rnd() * 2);
      const parts: string[] = [];
      for (let i = 0; i < mounds; i++) {
        const x = mounds === 1 ? between(rnd, -0.12, 0.12) : -0.3 + i * 0.6;
        const w = between(rnd, 0.34, 0.5);
        const h = between(rnd, 0.36, 0.56);
        const base = 0.42 - i * 0.06;
        parts.push(
          `<path d="M${round(x - w)} ${round(base)}Q${round(x - w * 0.5)} ${round(base - h * 1.5)} ` +
            `${round(x)} ${round(base - h)}Q${round(x + w * 0.55)} ${round(base - h * 1.45)} ` +
            `${round(x + w)} ${round(base)}Z" fill="${ink.grass}"/>` +
            `<path d="M${round(x)} ${round(base - h)}Q${round(x + w * 0.55)} ${round(base - h * 1.45)} ` +
            `${round(x + w)} ${round(base)}Q${round(x + w * 0.3)} ${round(base - h * 0.4)} ` +
            `${round(x)} ${round(base - h)}Z" fill="${ink.grassDeep}" opacity="0.45"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'crag',
    group: 'relief',
    layer: 'relief',
    title: 'Скалы',
    use: 'Обломки породы: перевал, отдельный останец, каменистый мыс.',
    tags: ['камень', 'рельеф'],
    on: 'rock-plain',
    bleed: 0.1,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const x = -0.34 + i * 0.34 + between(rnd, -0.06, 0.06);
        const h = between(rnd, 0.3, 0.62);
        const w = between(rnd, 0.14, 0.22);
        const lean = between(rnd, -0.08, 0.08);
        parts.push(
          `<path d="M${round(x - w)} 0.42L${round(x - w * 0.6)} ${round(0.42 - h * 0.7)}` +
            `L${round(x + lean)} ${round(0.42 - h)}L${round(x + w)} ${round(0.42 - h * 0.45)}` +
            `L${round(x + w * 0.9)} 0.42Z" fill="${ink.rock}"/>` +
            `<path d="M${round(x + lean)} ${round(0.42 - h)}L${round(x + w)} ${round(0.42 - h * 0.45)}` +
            `L${round(x + w * 0.9)} 0.42L${round(x + lean * 0.4)} ${round(0.42 - h * 0.5)}Z" ` +
            `fill="${ink.rockDeep}" opacity="0.5"/>`
        );
      }
      parts.push(
        `<path d="${blob(rnd, 0, 0.44, 0.5, 0.3, 7)}" fill="${ink.rockDeep}" opacity="0.18"/>`
      );
      return parts.join('');
    },
  }),
];
