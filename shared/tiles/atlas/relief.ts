/**
 * Land relief — the shape of the ground, drawn without covering it.
 *
 * Not one of these carries a fill of its own. A land cell already has a colour:
 * the territory it belongs to, which on this map is the whole point. So a
 * mountain here is a lit face, a shaded face and a crest line, and it reads the
 * same over green, purple or pink. That is also why the pieces are cheap — five
 * or six shapes each, because a cell is about 30 px across on the finished map
 * and anything finer is mud.
 *
 * Relief has a top: the range pieces may be mirrored to face the other way,
 * never turned, which is what `upright` records. And it is taller than its
 * cell, so it is not clipped and declares its `bleed`.
 *
 * A range joins at a fixed height. Every piece leaves its cell across the east
 * and west edge midpoints with a short flat run at y = 0, and its foot with
 * another at y = 0.55, so two pieces laid side by side share a silhouette
 * whatever happened in between.
 */

import { round, type Point } from '../hex.js';
import { between, blob, dim, edge, lit, smooth, type Palette } from '../ink.js';
import { defineTile, type Tile } from '../types.js';

/** Where a range hands over to the next cell. Never varied. */
const RIDGE_Y = 0;
const FOOT_Y = 0.55;
const EDGE = 0.87;
const FLAT = 0.72;

/** Outline from a ridge line, closed along the foot. */
function massif(rnd: () => number, ridge: Point[], footFrom: number, footTo: number): string {
  const foot: Point[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = footFrom + (footTo - footFrom) * t;
    const sag = Math.sin(t * Math.PI) * (rnd() - 0.5) * 0.22;
    foot.push({ x, y: FOOT_Y + sag });
  }
  return `${smooth([...ridge, ...foot], false)}Z`;
}

/** A ridge line across the whole cell, peaking `height` above the handover. */
function ridgeAcross(rnd: () => number, height: number, peaks: number): Point[] {
  const points: Point[] = [
    { x: -EDGE, y: RIDGE_Y },
    { x: -FLAT, y: RIDGE_Y - 0.04 },
  ];
  for (let i = 0; i < peaks; i++) {
    const t = (i + 0.5) / peaks;
    const x = -FLAT + FLAT * 2 * t;
    const own = height * between(rnd, 0.72, 1);
    points.push({ x: x - 0.16, y: RIDGE_Y - own * 0.55 });
    points.push({ x, y: RIDGE_Y - own });
    points.push({ x: x + 0.18, y: RIDGE_Y - own * 0.5 });
  }
  points.push({ x: FLAT, y: RIDGE_Y - 0.04 }, { x: EDGE, y: RIDGE_Y });
  return points;
}

/**
 * The three marks that turn a silhouette into a mountain: the whole mass a
 * shade darker than the ground, the west flank lit, the crest drawn.
 */
function faces(rnd: () => number, ink: Palette, ridge: Point[], cap: boolean): string {
  const top = ridge.reduce((best, point, i) => (point.y < ridge[best].y ? i : best), 0);
  const summit = ridge[top];
  const parts: string[] = [];

  // A lit band hanging off the crest, and the drawn crest itself. Both follow
  // the ridge, so a run of pieces reads as one range rather than as a row of
  // separately shaded triangles.
  const below = ridge.map((point) => ({ x: point.x, y: point.y + 0.3 }));
  parts.push(
    lit(`${smooth([...ridge, ...[...below].reverse()], false)}Z`, ink, 0.4),
    edge(smooth(ridge, false), ink, 0.04, 0.5)
  );

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
    const w = 0.2 + rnd() * 0.08;
    const drop = apex.y + 0.26 + rnd() * 0.1;
    const x = apex.x;
    parts.push(
      `<path d="M${round(x - w)} ${round(drop)}L${round(x)} ${round(apex.y + 0.01)}` +
        `L${round(x + w)} ${round(drop + 0.05)}` +
        `Q${round(x + w * 0.4)} ${round(drop + 0.13)} ${round(x)} ${round(drop + 0.03)}` +
        `Q${round(x - w * 0.45)} ${round(drop - 0.05)} ${round(x - w)} ${round(drop)}Z" ` +
        `fill="${ink.snow}" opacity="0.92"/>`
    );
  }
  return parts.join('');
}

const capOption = {
  values: ['snow', 'bare'] as const,
  fallback: 'snow',
  note: 'Снежная шапка на вершине или голая порода.',
};

/** A rounded upland: lit crown, shaded lee, a drawn brow. */
function mound(ink: Palette, x: number, base: number, w: number, h: number): string {
  const crown =
    `M${round(x - w)} ${round(base)}Q${round(x - w * 0.5)} ${round(base - h * 1.5)} ` +
    `${round(x)} ${round(base - h)}Q${round(x + w * 0.55)} ${round(base - h * 1.45)} ` +
    `${round(x + w)} ${round(base)}Z`;
  const lee =
    `M${round(x)} ${round(base - h)}Q${round(x + w * 0.55)} ${round(base - h * 1.45)} ` +
    `${round(x + w)} ${round(base)}Q${round(x + w * 0.35)} ${round(base - h * 0.35)} ` +
    `${round(x)} ${round(base - h)}Z`;
  return lit(crown, ink, 0.34) + dim(lee, ink, 0.3) + edge(crown, ink, 0.03, 0.42);
}

export const reliefTiles: Tile[] = [
  defineTile({
    id: 'mountain-peak',
    group: 'relief',
    layer: 'relief',
    title: 'Вершина',
    use: 'Середина хребта. Ставится между склонами, сама по себе не читается.',
    tags: ['горы', 'хребет'],
    seams: [{ edges: [0, 3], meets: 'ridge' }],
    options: { cap: capOption },
    bleed: 0.35,
    draw: ({ rnd, ink, opt }) => {
      const ridge = ridgeAcross(rnd, 1.05, 1);
      return (
        dim(massif(rnd, ridge, EDGE, -EDGE), ink, 0.24) + faces(rnd, ink, ridge, opt('cap') === 'snow')
      );
    },
  }),

  defineTile({
    id: 'mountain-slope',
    group: 'relief',
    layer: 'relief',
    title: 'Склон',
    use: 'Плечо хребта. Между вершиной и краем; повторяется сколько нужно.',
    tags: ['горы', 'хребет'],
    seams: [{ edges: [0, 3], meets: 'ridge' }],
    options: { cap: { ...capOption, fallback: 'bare' } },
    bleed: 0.2,
    draw: ({ rnd, ink, opt }) => {
      const ridge = ridgeAcross(rnd, 0.62, 2);
      return (
        dim(massif(rnd, ridge, EDGE, -EDGE), ink, 0.24) + faces(rnd, ink, ridge, opt('cap') === 'snow')
      );
    },
  }),

  defineTile({
    id: 'mountain-foot',
    group: 'relief',
    layer: 'relief',
    title: 'Окончание хребта',
    use: 'Хребет сходит на нет. Закрывает ряд с запада; на восток — отражением.',
    tags: ['горы', 'хребет', 'край'],
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
      return dim(massif(rnd, ridge, 0.46, -EDGE), ink, 0.24) + faces(rnd, ink, ridge, false);
    },
  }),

  defineTile({
    id: 'hills',
    group: 'relief',
    layer: 'relief',
    title: 'Холмы',
    use: 'Мелкая неровность. Заполняет промежутки между хребтами, ни с чем не стыкуется.',
    tags: ['холмы', 'рельеф'],
    bleed: 0.08,
    draw: ({ rnd, ink }) => {
      const count = 2 + Math.floor(rnd() * 2);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const x = -0.42 + (i * 0.9) / Math.max(1, count - 1) + between(rnd, -0.08, 0.08);
        parts.push(
          mound(ink, x, 0.38 - i * 0.1, between(rnd, 0.3, 0.42), between(rnd, 0.3, 0.46))
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'plateau',
    group: 'relief',
    layer: 'relief',
    title: 'Плато',
    use: 'Приподнятая столовая земля: ровный верх и обрыв по краю.',
    tags: ['плато', 'рельеф'],
    seams: [{ edges: [0, 3], meets: 'scarp' }],
    clip: true,
    draw: ({ rnd, ink }) => {
      // The scarp crosses at a fixed height so a run of them lines up.
      const lip: Point[] = [
        { x: -EDGE, y: 0.1 },
        { x: -FLAT, y: 0.08 },
        { x: -0.2, y: between(rnd, -0.04, 0.06) },
        { x: 0.3, y: between(rnd, 0.04, 0.14) },
        { x: FLAT, y: 0.08 },
        { x: EDGE, y: 0.1 },
      ];
      const line = smooth(lip, false);
      const below = lip.map((point) => ({ x: point.x, y: point.y + 0.22 }));
      // A terrace above the lip rather than a brightened cell: filling to the
      // top of the hex draws the hex, and the map has no borders.
      const terrace = lip.map((point) => ({ x: point.x, y: point.y - 0.5 }));
      return (
        lit(`${smooth([...lip, ...[...terrace].reverse()], false)}Z`, ink, 0.22) +
        dim(`${smooth([...lip, ...[...below].reverse()], false)}Z`, ink, 0.3) +
        edge(line, ink, 0.045, 0.5) +
        // Gullies cut into the wall, which is what says it is a cliff and not
        // a band of colour.
        [0, 1, 2]
          .map((i) => {
            const x = -0.5 + i * 0.5 + between(rnd, -0.1, 0.1);
            return edge(`M${round(x)} 0.1v${round(between(rnd, 0.1, 0.2))}`, ink, 0.025, 0.35);
          })
          .join('')
      );
    },
  }),

  defineTile({
    id: 'canyon',
    group: 'relief',
    layer: 'relief',
    title: 'Каньон',
    use: 'Разлом через клетку. Стыкуется по востоку и западу, тянется рядом.',
    tags: ['каньон', 'разлом'],
    seams: [{ edges: [0, 3], meets: 'scarp' }],
    clip: true,
    draw: ({ rnd, ink }) => {
      const spine = [
        { x: -EDGE, y: 0 },
        { x: -0.3, y: between(rnd, -0.22, -0.05) },
        { x: 0.3, y: between(rnd, 0.05, 0.22) },
        { x: EDGE, y: 0 },
      ];
      const north = spine.map((point) => ({ x: point.x, y: point.y - 0.13 }));
      const south = spine.map((point) => ({ x: point.x, y: point.y + 0.13 }));
      // One open path down one rim and back along the other: both ends stay
      // exact, which is where the next cell's canyon picks it up.
      const floor = `${smooth([...north, ...[...south].reverse()], false)}Z`;
      return (
        dim(floor, ink, 0.36) +
        lit(
          `${smooth(
            [...north, ...north.map((point) => ({ x: point.x, y: point.y - 0.1 })).reverse()],
            false
          )}Z`,
          ink,
          0.3
        ) +
        edge(smooth(north, false), ink, 0.032, 0.45) +
        edge(smooth(south, false), ink, 0.032, 0.32)
      );
    },
  }),

  defineTile({
    id: 'dunes',
    group: 'relief',
    layer: 'relief',
    title: 'Дюны',
    use: 'Сухая земля: серпы гребней, светлая наветренная сторона.',
    tags: ['песок', 'рельеф'],
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const y = -0.42 + i * 0.44 + between(rnd, -0.06, 0.06);
        const w = between(rnd, 0.5, 0.78);
        const x = between(rnd, -0.2, 0.2);
        const crest =
          `M${round(x - w)} ${round(y + 0.12)}Q${round(x - w * 0.3)} ${round(y - 0.16)} ` +
          `${round(x)} ${round(y - 0.02)}Q${round(x + w * 0.45)} ${round(y + 0.14)} ` +
          `${round(x + w)} ${round(y + 0.04)}`;
        parts.push(edge(crest, ink, 0.03, 0.28));
        parts.push(lit(`${crest}L${round(x - w)} ${round(y + 0.12)}Z`, ink, 0.22));
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'volcano',
    group: 'relief',
    layer: 'relief',
    title: 'Вулкан',
    use: 'Одиночный конус с кратером. Заметная точка, а не фон.',
    tags: ['вулкан', 'горы'],
    bleed: 0.25,
    draw: ({ rnd, ink }) => {
      const w = 0.72;
      const top = -0.62;
      const notch = 0.16;
      const cone =
        `M${round(-w)} 0.5L${round(-notch)} ${round(top)}L${round(notch)} ${round(top + 0.03)}` +
        `L${round(w)} 0.52Z`;
      return (
        dim(cone, ink, 0.22) +
        lit(`M${round(-w)} 0.5L${round(-notch)} ${round(top)}L0 ${round(top + 0.05)}L0 0.5Z`, ink, 0.38) +
        dim(`M0 ${round(top + 0.05)}L${round(notch)} ${round(top + 0.03)}L${round(w)} 0.52L0 0.5Z`, ink, 0.26) +
        edge(cone, ink, 0.04, 0.52) +
        // The caldera: a shallow ellipse and a lick of heat inside it.
        `<ellipse cx="0" cy="${round(top + 0.01)}" rx="${round(notch)}" ry="0.05" ` +
        `fill="${ink.shade}" opacity="0.4"/>` +
        `<path d="${blob(rnd, 0, top + 0.01, 0.07, 0.4, 6)}" fill="${ink.light}" opacity="0.35"/>`
      );
    },
  }),

  defineTile({
    id: 'crags',
    group: 'relief',
    layer: 'relief',
    title: 'Скалы',
    use: 'Голая порода: перевал, останец, каменистый мыс.',
    tags: ['камень', 'рельеф'],
    bleed: 0.08,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const x = -0.36 + i * 0.36 + between(rnd, -0.06, 0.06);
        const h = between(rnd, 0.3, 0.6);
        const w = between(rnd, 0.16, 0.24);
        const lean = between(rnd, -0.08, 0.08);
        const block =
          `M${round(x - w)} 0.42L${round(x - w * 0.6)} ${round(0.42 - h * 0.7)}` +
          `L${round(x + lean)} ${round(0.42 - h)}L${round(x + w)} ${round(0.42 - h * 0.45)}` +
          `L${round(x + w * 0.9)} 0.42Z`;
        parts.push(
          lit(block, ink, 0.32),
          dim(
            `M${round(x + lean)} ${round(0.42 - h)}L${round(x + w)} ${round(0.42 - h * 0.45)}` +
              `L${round(x + w * 0.9)} 0.42L${round(x + lean * 0.4)} ${round(0.42 - h * 0.5)}Z`,
            ink,
            0.3
          ),
          edge(block, ink, 0.03, 0.45)
        );
      }
      return parts.join('');
    },
  }),
];
