/**
 * What grows on the ground.
 *
 * Deliberately all standalone: a forest does not have to match its neighbour
 * edge for edge, so making these fragments would buy nothing and cost a rule
 * every consumer would have to obey. Density is the only axis — dense fills the
 * cell and is clipped, a grove is a clump that may lean over the boundary.
 */

import { round } from '../hex.js';
import { between, blob, broadleaf, conifer, scatter, spot } from '../ink.js';
import { defineTile, type Tile } from '../types.js';

export const floraTiles: Tile[] = [
  defineTile({
    id: 'forest-dense',
    group: 'flora',
    layer: 'surface',
    title: 'Лес',
    use: 'Сплошной массив. Заполняет клетку целиком, обрезается по грани.',
    tags: ['лес', 'дерево'],
    on: 'grass-plain',
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      const trees = scatter(rnd, 13, 0.86)
        // Painter's order: what is lower stands in front.
        .sort((a, b) => a.y - b.y);
      for (const tree of trees) {
        parts.push(
          rnd() > 0.45
            ? conifer(tree.x, tree.y, between(rnd, 0.24, 0.34), ink)
            : broadleaf(rnd, tree.x, tree.y, between(rnd, 0.22, 0.3), ink)
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'forest-grove',
    group: 'flora',
    layer: 'relief',
    title: 'Роща',
    use: 'Клумба деревьев в середине клетки — край леса, островок зелени.',
    tags: ['лес', 'дерево'],
    on: 'grass-plain',
    bleed: 0.1,
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts = [
        `<path d="${blob(rnd, 0, 0.15, 0.46, 0.3, 8)}" fill="${ink.grassDeep}" opacity="0.22"/>`,
      ];
      const trees = scatter(rnd, 5, 0.44).sort((a, b) => a.y - b.y);
      for (const tree of trees) {
        parts.push(broadleaf(rnd, tree.x, tree.y + 0.2, between(rnd, 0.32, 0.44), ink));
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'pines',
    group: 'flora',
    layer: 'relief',
    title: 'Ельник',
    use: 'Хвойные — то, что растёт выше и севернее лиственного леса.',
    tags: ['лес', 'дерево', 'хвоя'],
    on: 'grass-plain',
    bleed: 0.1,
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      const trees = scatter(rnd, 6, 0.62).sort((a, b) => a.y - b.y);
      for (const tree of trees) {
        parts.push(conifer(tree.x, tree.y + 0.18, between(rnd, 0.34, 0.5), ink));
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'tree',
    group: 'flora',
    layer: 'overlay',
    title: 'Дерево',
    use: 'Одно дерево крупным планом. Метка места, а не текстура.',
    tags: ['дерево', 'акцент'],
    on: 'grass-plain',
    bleed: 0.15,
    draw: ({ rnd, ink }) => {
      const point = spot(rnd, 0.3);
      return broadleaf(rnd, point.x, point.y + 0.4, 0.85, ink);
    },
  }),

  defineTile({
    id: 'reeds',
    group: 'flora',
    layer: 'overlay',
    title: 'Камыш',
    use: 'Ставится на клетку берега со стороны воды — смягчает шов.',
    tags: ['вода', 'берег', 'трава'],
    on: 'grass-plain',
    variants: 6,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 9; i++) {
        const x = between(rnd, -0.6, 0.6);
        const y = between(rnd, 0.3, 0.66);
        const h = between(rnd, 0.22, 0.38);
        const lean = between(rnd, -0.08, 0.08);
        parts.push(
          `<path d="M${round(x)} ${round(y)}q${round(lean)} ${round(-h * 0.6)} ${round(lean * 2)} ${round(-h)}" ` +
            `fill="none" stroke="${ink.grassDeep}" stroke-width="0.028" stroke-linecap="round"/>` +
            `<ellipse cx="${round(x + lean * 2)}" cy="${round(y - h - 0.02)}" rx="0.022" ry="0.05" ` +
            `fill="${ink.wood}"/>`
        );
      }
      return parts.join('');
    },
  }),
];
