/**
 * The base fills — the one opaque tile every cell starts from.
 *
 * They are drawn full-bleed and clipped to the hex rather than fitted to it, so
 * two neighbouring cells of the same ground meet without a hairline between
 * them. The map has no borders; the joins must not draw any.
 */

import { round } from '../hex.js';
import { blob, field, scatter, spot, tuft, wave } from '../ink.js';
import { defineTile, type Tile } from '../types.js';

export const groundTiles: Tile[] = [
  defineTile({
    id: 'soil-plain',
    group: 'ground',
    layer: 'ground',
    title: 'Земля',
    use: 'Основа под всё остальное: пашня, пустошь, голая почва.',
    tags: ['земля', 'основа'],
    draw: ({ rnd, ink }) => {
      const parts = [field(ink.soil)];
      for (let i = 0; i < 5; i++) {
        const point = spot(rnd, 0.78);
        parts.push(
          `<path d="${blob(rnd, point.x, point.y, 0.18 + rnd() * 0.22, 0.45, 7)}" ` +
            `fill="${i % 2 ? ink.soilDeep : ink.soilPale}" opacity="0.4"/>`
        );
      }
      for (const point of scatter(rnd, 12, 0.86)) {
        parts.push(
          `<circle cx="${round(point.x)}" cy="${round(point.y)}" ` +
            `r="${round(0.014 + rnd() * 0.018)}" fill="${ink.soilDeep}" opacity="0.5"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'grass-plain',
    group: 'ground',
    layer: 'ground',
    title: 'Луг',
    use: 'Обжитая суша по умолчанию. Под лесом, холмами и дорогами.',
    tags: ['трава', 'суша', 'основа'],
    draw: ({ rnd, ink }) => {
      const parts = [field(ink.grass)];
      for (let i = 0; i < 4; i++) {
        const point = spot(rnd, 0.76);
        parts.push(
          `<path d="${blob(rnd, point.x, point.y, 0.2 + rnd() * 0.24, 0.5, 8)}" ` +
            `fill="${i % 2 ? ink.grassDeep : ink.grassPale}" opacity="0.38"/>`
        );
      }
      for (const point of scatter(rnd, 9, 0.82)) {
        parts.push(tuft(rnd, point.x, point.y, 0.1 + rnd() * 0.05, ink.grassDeep));
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'sand-plain',
    group: 'ground',
    layer: 'ground',
    title: 'Песок',
    use: 'Пляж, отмель, пустыня. Ложится и вплотную к воде, и в глубь суши.',
    tags: ['песок', 'берег', 'основа'],
    draw: ({ rnd, ink }) => {
      const parts = [field(ink.sand)];
      for (let i = 0; i < 3; i++) {
        const y = -0.6 + i * 0.55 + (rnd() - 0.5) * 0.2;
        parts.push(
          `<path d="${wave(rnd, { x: -1, y }, { x: 1, y: y + 0.14 }, 0.1, 5)}" fill="none" ` +
            `stroke="${ink.sandDeep}" stroke-width="0.035" stroke-linecap="round" opacity="0.7"/>`
        );
      }
      for (const point of scatter(rnd, 16, 0.88)) {
        parts.push(
          `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="0.016" ` +
            `fill="${ink.sandDeep}" opacity="0.6"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'rock-plain',
    group: 'ground',
    layer: 'ground',
    title: 'Камень',
    use: 'Голая порода: плато, осыпь, подножие хребта.',
    tags: ['камень', 'основа'],
    draw: ({ rnd, ink }) => {
      const parts = [field(ink.rock)];
      // Facets rather than blobs: stone breaks along straight lines, and the
      // difference is most of what tells it apart from soil at small sizes.
      for (let i = 0; i < 6; i++) {
        const point = spot(rnd, 0.72);
        const size = 0.22 + rnd() * 0.28;
        const angle = rnd() * Math.PI;
        const corners = Array.from({ length: 4 }, (_, k) => {
          const a = angle + (Math.PI / 2) * k + (rnd() - 0.5) * 0.6;
          const r = size * (0.6 + rnd() * 0.6);
          return `${round(point.x + Math.cos(a) * r)} ${round(point.y + Math.sin(a) * r * 0.8)}`;
        });
        parts.push(
          `<path d="M${corners.join('L')}Z" fill="${i % 2 ? ink.rockDeep : ink.rockPale}" opacity="0.35"/>`
        );
      }
      for (let i = 0; i < 3; i++) {
        const from = spot(rnd, 0.7);
        parts.push(
          `<path d="M${round(from.x)} ${round(from.y)}l${round((rnd() - 0.5) * 0.6)} ${round((rnd() - 0.5) * 0.6)}" ` +
            `stroke="${ink.rockDeep}" stroke-width="0.022" stroke-linecap="round" opacity="0.55"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'sea-plain',
    group: 'ground',
    layer: 'ground',
    title: 'Море',
    use: 'Открытая вода. Всё, что не суша и не берег.',
    tags: ['вода', 'море', 'основа'],
    draw: ({ rnd, ink }) => {
      const parts = [field(ink.sea)];
      for (let i = 0; i < 3; i++) {
        const y = -0.55 + i * 0.55;
        parts.push(
          `<path d="${wave(rnd, { x: -1.1, y }, { x: 1.1, y }, 0.09, 4)}" fill="none" ` +
            `stroke="${ink.seaDeep}" stroke-width="0.05" stroke-linecap="round" opacity="0.45"/>`
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'shallow-plain',
    group: 'ground',
    layer: 'ground',
    title: 'Мелководье',
    use: 'Светлая вода между берегом и морем. Кладётся кольцом вокруг суши.',
    tags: ['вода', 'отмель', 'основа'],
    draw: ({ rnd, ink }) => {
      const parts = [field(ink.seaPale)];
      for (let i = 0; i < 4; i++) {
        const point = spot(rnd, 0.75);
        parts.push(
          `<path d="${blob(rnd, point.x, point.y, 0.22 + rnd() * 0.2, 0.5, 8)}" ` +
            `fill="${i % 2 ? ink.sea : ink.foam}" opacity="0.25"/>`
        );
      }
      return parts.join('');
    },
  }),
];
