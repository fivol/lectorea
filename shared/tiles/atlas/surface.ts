/**
 * Texture laid over a ground tile.
 *
 * These carry no fill of their own on purpose. Stacking two of them on one cell
 * — pebbles over furrows, foam over ripples — is how a handful of pieces covers
 * far more ground than a folder of finished cell pictures would.
 */

import { round } from '../hex.js';
import { blob, scatter, spot, stone, tuft, wave } from '../ink.js';
import { defineTile, type Tile } from '../types.js';

export const surfaceTiles: Tile[] = [
  defineTile({
    id: 'grass-tufts',
    group: 'surface',
    layer: 'surface',
    title: 'Травка',
    use: 'Оживляет землю и песок. Кладётся поверх любой суши.',
    tags: ['трава', 'узор'],
    on: 'soil-plain',
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (const point of scatter(rnd, 14, 0.84)) {
        parts.push(tuft(rnd, point.x, point.y, 0.12 + rnd() * 0.07, ink.grassDeep));
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'pebbles',
    group: 'surface',
    layer: 'surface',
    title: 'Камешки',
    use: 'Осыпь у подножия гор, галька на берегу, каменистая пустошь.',
    tags: ['камень', 'узор'],
    on: 'soil-plain',
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (const point of scatter(rnd, 7, 0.8)) {
        parts.push(stone(rnd, point.x, point.y, 0.05 + rnd() * 0.045, ink));
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'furrows',
    group: 'surface',
    layer: 'surface',
    title: 'Пашня',
    use: 'Обработанная земля. Читается как «здесь живут» без единого дома.',
    tags: ['поле', 'узор'],
    on: 'soil-plain',
    draw: ({ rnd, ink }) => {
      const tilt = (rnd() - 0.5) * 24;
      const rows: string[] = [];
      for (let y = -0.9; y <= 0.9; y += 0.17) {
        rows.push(
          `<path d="${wave(rnd, { x: -1.2, y }, { x: 1.2, y }, 0.02, 3)}" fill="none" ` +
            `stroke="${ink.soilDeep}" stroke-width="0.03" opacity="0.55"/>`
        );
      }
      return `<g transform="rotate(${round(tilt)})">${rows.join('')}</g>`;
    },
  }),

  defineTile({
    id: 'flowers',
    group: 'surface',
    layer: 'surface',
    title: 'Цветы',
    use: 'Точка цвета на лугу. Единственный тёплый акцент среди зелени.',
    tags: ['трава', 'акцент'],
    on: 'grass-plain',
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (const point of scatter(rnd, 11, 0.78)) {
        const size = 0.028 + rnd() * 0.022;
        parts.push(
          `<path d="M${round(point.x)} ${round(point.y)}v${round(-size * 2.4)}" ` +
            `stroke="${ink.grassDeep}" stroke-width="0.018" stroke-linecap="round" opacity="0.8"/>` +
            `<circle cx="${round(point.x)}" cy="${round(point.y - size * 2.6)}" r="${round(size)}" ` +
            `fill="${rnd() > 0.45 ? ink.bloomA : ink.bloomB}"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'ripples',
    group: 'surface',
    layer: 'surface',
    title: 'Рябь',
    use: 'Поверх воды. Показывает, что море живое, не заливка.',
    tags: ['вода', 'узор'],
    on: 'sea-plain',
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (const point of scatter(rnd, 12, 0.82)) {
        const w = 0.09 + rnd() * 0.07;
        parts.push(
          `<path d="M${round(point.x - w)} ${round(point.y)}q${round(w)} ${round(-w * 0.55)} ${round(w * 2)} 0" ` +
            `fill="none" stroke="${ink.foam}" stroke-width="0.028" stroke-linecap="round" opacity="0.75"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'swell',
    group: 'surface',
    layer: 'surface',
    title: 'Волна',
    use: 'Длинная зыбь для открытого моря — крупнее ряби, реже на клетку.',
    tags: ['вода', 'узор'],
    on: 'sea-plain',
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const y = -0.45 + i * 0.45 + (rnd() - 0.5) * 0.12;
        parts.push(
          `<path d="${wave(rnd, { x: -1.05, y }, { x: 1.05, y }, 0.12, 5)}" fill="none" ` +
            `stroke="${ink.foam}" stroke-width="0.04" stroke-linecap="round" opacity="0.6"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'snow-patch',
    group: 'surface',
    layer: 'surface',
    title: 'Снег',
    use: 'Пятна на камне и на вершинах. Высота без второй палитры.',
    tags: ['снег', 'узор'],
    on: 'rock-plain',
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const point = spot(rnd, 0.7);
        parts.push(
          `<path d="${blob(rnd, point.x, point.y, 0.18 + rnd() * 0.22, 0.55, 8)}" ` +
            `fill="${ink.snow}" opacity="${round(0.6 + rnd() * 0.3)}"/>`
        );
      }
      return parts.join('');
    },
  }),
];
