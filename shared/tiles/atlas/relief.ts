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
 * The map is seen from above and a little to the side, and this is the group
 * where that shows. These pieces are the only ones authored standing up, in
 * screen coordinates: the placement transform lays the flat pieces back for
 * them, but height is the one thing it must not touch, or a mountain range is a
 * smear. The rule for reading the numbers below is short — a position on the
 * ground goes through `flat()` or comes from `rim()`, and a height is a plain
 * number subtracted from one.
 *
 * `rim(x)` is where the ground ends nearest the reader, and it is what every
 * piece stands on. Drawn level instead, a foot floats above the cell in the
 * middle and hangs over its edge at the sides, which is exactly the tell that
 * says a picture was flattened rather than laid back.
 *
 * Relief has a top: the range pieces may be mirrored to face the other way,
 * never turned, which is what `upright` records. And it is taller than its
 * cell, so it is not clipped and declares its `bleed`.
 *
 * A range joins at a fixed height. Every piece leaves its cell across the east
 * and west edge midpoints at `RIDGE_Y` with a short flat run either side, so
 * two pieces laid side by side share a silhouette whatever happened in between.
 */

import { flat, rim, round, type Point } from '../hex.js';
import { between, blob, dim, edge, lit, smooth, spot, type Palette } from '../ink.js';
import { defineTile, type Tile } from '../types.js';

/**
 * Where a range hands over to the next cell.
 *
 * On the cell's own centre line and at no height at all, which is the one
 * place the two spaces agree: `flat(0)` is 0, so a crest crossing here lands in
 * the same spot whether its neighbour worked in ground or in screen.
 */
const RIDGE_Y = 0;
const EDGE = 0.87;
const FLAT = 0.72;

/** The ground a piece stands on, pulled in so a foot sits on the cell. */
const foot = (x: number): number => rim(x) * 0.94;

/** Outline from a ridge line, closed along the ground it stands on. */
function massif(rnd: () => number, ridge: Point[], footFrom: number, footTo: number): string {
  const base: Point[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = footFrom + (footTo - footFrom) * t;
    const sag = Math.sin(t * Math.PI) * (rnd() - 0.5) * 0.12;
    base.push({ x, y: foot(x) + sag });
  }
  return `${smooth([...ridge, ...base], false)}Z`;
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

/**
 * One tree, at the only altitude a 30 px cell allows: a silhouette and a lit
 * west side, and nothing else. Branches, or a texture on the foliage, are four
 * pixels of mud on the finished map.
 *
 * A cone, because that is the shape that survives being three pixels tall. A
 * round crown at this size is a dot, and a dot in a row of dots is scree.
 */
function tree(rnd: () => number, ink: Palette, x: number, base: number, h: number): string {
  const w = h * between(rnd, 0.3, 0.38);
  const tip = base - h;
  // Two tiers, so the outline breaks once on the way down and reads as foliage
  // rather than as a triangle.
  const skirt = base - h * 0.16;
  const body =
    `M${round(x)} ${round(tip)}` +
    `L${round(x + w * 0.62)} ${round(base - h * 0.52)}` +
    `L${round(x + w * 0.34)} ${round(base - h * 0.5)}` +
    `L${round(x + w)} ${round(skirt)}` +
    `L${round(x - w)} ${round(skirt)}` +
    `L${round(x - w * 0.34)} ${round(base - h * 0.5)}` +
    `L${round(x - w * 0.62)} ${round(base - h * 0.52)}Z`;
  const west =
    `M${round(x)} ${round(tip)}L${round(x)} ${round(skirt)}L${round(x - w)} ${round(skirt)}` +
    `L${round(x - w * 0.34)} ${round(base - h * 0.5)}L${round(x - w * 0.62)} ${round(base - h * 0.52)}Z`;
  return (
    edge(`M${round(x)} ${round(base)}V${round(skirt)}`, ink, 0.026, 0.4) +
    dim(body, ink, 0.3) +
    lit(west, ink, 0.34) +
    edge(body, ink, 0.022, 0.38)
  );
}

/**
 * A flat, irregular patch lying on the ground — a puddle, a snowfield.
 *
 * `blob` is round; this is deliberately much wider than it is deep, because
 * anything lying flat is seen at the map's angle and a circle on the ground
 * arrives on screen as an ellipse. A round one reads as a stone.
 */
function patch(
  rnd: () => number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  count = 8
): string {
  const points: Point[] = [];
  const turn = (Math.PI * 2) / count;
  const phase = rnd() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const angle = phase + turn * i;
    const wobble = 0.82 + rnd() * 0.36;
    points.push({ x: cx + Math.cos(angle) * rx * wobble, y: cy + Math.sin(angle) * ry * wobble });
  }
  return smooth(points, true);
}

/**
 * One line combed across the whole cell, as points.
 *
 * Grass is drawn at the altitude everything else here is: not a tuft but a
 * field of it, seen from far enough away that the only thing left is the way
 * the wind lies in it. Which is a set of long lines, and a lit band hanging
 * under each one.
 */
function comb(rnd: () => number, y: number, amplitude: number, steps = 6): Point[] {
  const phase = rnd() * Math.PI * 2;
  const turns = between(rnd, 1.1, 2.2);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { x: -0.98 + 1.96 * t, y: y + Math.sin(phase + t * Math.PI * turns) * amplitude };
  });
}

/**
 * A palm: a leaning trunk under a heavy crown. The islands' one tree.
 *
 * The crown is a filled shape rather than a fan of drawn fronds. Five hairlines
 * meeting at a point is a spider at any size under 40 px; a solid mass with
 * three notches cut into its underside is a palm at 16.
 */
function palm(rnd: () => number, ink: Palette, x: number, base: number, h: number): string {
  const lean = between(rnd, -0.2, 0.2);
  const tip = { x: x + lean, y: base - h };

  /** One frond: out from the crown and down, with a little width to it. */
  const frond = (side: number, length: number, rise: number): string => {
    const end = { x: tip.x + side * length, y: tip.y + Math.abs(side) * length * 0.42 + 0.02 };
    const lift = { x: tip.x + side * length * 0.5, y: tip.y - rise };
    return (
      `M${round(tip.x)} ${round(tip.y)}` +
      `Q${round(lift.x)} ${round(lift.y)} ${round(end.x)} ${round(end.y)}` +
      `Q${round(lift.x)} ${round(lift.y + 0.1)} ${round(tip.x)} ${round(tip.y + 0.06)}Z`
    );
  };

  const spread = h * between(rnd, 0.46, 0.58);
  const fronds = [-1, -0.58, 0.05, 0.6, 1].map((side) =>
    frond(side, spread * between(rnd, 0.86, 1.1), h * between(rnd, 0.2, 0.32))
  );
  return (
    edge(
      `M${round(x)} ${round(base)}Q${round(x + lean * 0.3)} ${round(base - h * 0.62)} ` +
        `${round(tip.x)} ${round(tip.y)}`,
      ink,
      0.048,
      0.5
    ) +
    fronds.map((d) => dim(d, ink, 0.28) + edge(d, ink, 0.02, 0.34)).join('') +
    // The two western fronds catch the light, which is what turns a black star
    // into a crown with a near side and a far one.
    fronds
      .slice(0, 2)
      .map((d) => lit(d, ink, 0.3))
      .join('')
  );
}

/* ────────────────────────────────  The plateau  ─────────────────────────── */

/**
 * Where a tableland's edge crosses a cell, and how far it drops.
 *
 * The lip is a position on the ground and the scarp is a height, which is the
 * whole reason a plateau had to stop being a flat piece: laid back with
 * everything else, its wall came out a fifth of the height it was drawn at and
 * the tableland read as a smudge on the grass rather than as ground standing
 * above other ground.
 */
const LIP_Y = flat(-0.06);
const SCARP = 0.3;

/* ─────────────────────────────────  The tiles  ──────────────────────────── */

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
        { x: 0.12, y: RIDGE_Y + 0.08 },
        { x: 0.46, y: foot(0.46) - 0.05 },
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
        // Each mound a little further back than the last, so a group of them
        // has depth instead of standing in a row along one line.
        parts.push(
          mound(
            ink,
            x,
            foot(x) - i * flat(0.16),
            between(rnd, 0.3, 0.42),
            between(rnd, 0.3, 0.46)
          )
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'forest',
    group: 'relief',
    layer: 'relief',
    title: 'Лес',
    use: 'Массив леса. Кладётся подряд по нескольким клеткам, ни с чем не стыкуется.',
    tags: ['лес', 'рельеф'],
    bleed: 0.12,
    draw: ({ rnd, ink }) => {
      // Back row first, so the near trees overlap the far ones and the stand
      // reads as a wood rather than as a row of separate trees.
      const rows = [
        { back: 0.66, count: 5, h: 0.3 },
        { back: 0.33, count: 4, h: 0.36 },
        { back: 0, count: 4, h: 0.42 },
      ];
      const parts: string[] = [];
      for (const row of rows) {
        for (let i = 0; i < row.count; i++) {
          const spread = 0.62 - row.back * 0.28;
          const x = -spread + (i * spread * 2) / Math.max(1, row.count - 1) + between(rnd, -0.07, 0.07);
          parts.push(
            tree(rnd, ink, x, foot(x) - flat(row.back), row.h * between(rnd, 0.86, 1.12))
          );
        }
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'grove',
    group: 'relief',
    layer: 'relief',
    title: 'Роща',
    use: 'Несколько деревьев. Край леса или одинокий островок зелени.',
    tags: ['лес', 'рельеф'],
    bleed: 0.1,
    draw: ({ rnd, ink }) => {
      const count = 3 + Math.floor(rnd() * 2);
      const parts: Array<{ back: number; markup: string }> = [];
      for (let i = 0; i < count; i++) {
        const x = between(rnd, -0.46, 0.46);
        const back = between(rnd, 0, 0.55);
        parts.push({
          back,
          markup: tree(rnd, ink, x, foot(x) - flat(back), between(rnd, 0.3, 0.44)),
        });
      }
      // Furthest first: a near tree has to overlap the one behind it, and the
      // draw order is the only depth this projection has.
      return parts
        .sort((a, b) => b.back - a.back)
        .map((entry) => entry.markup)
        .join('');
    },
  }),

  defineTile({
    id: 'canopy',
    group: 'relief',
    layer: 'relief',
    title: 'Полог',
    use: 'Сомкнутый лес с круглыми кронами. Влажный лес — противоположность ельника.',
    tags: ['лес', 'рельеф'],
    bleed: 0.14,
    draw: ({ rnd, ink }) => {
      // Round crowns where `forest` has cones — the other kind of wood, and the
      // only difference two woods can hold at 16 px without drawing a leaf.
      // Small and spaced rather than large and piled: two translucent crowns
      // laid over each other double their opacity, and a cell of big ones comes
      // out as a heap of bubbles with a dark seam on every join.
      const rows = [
        { back: 0.5, count: 4, r: 0.2 },
        { back: 0.12, count: 3, r: 0.25 },
      ];
      const parts: string[] = [];
      for (const row of rows) {
        for (let i = 0; i < row.count; i++) {
          const spread = 0.6 - row.back * 0.2;
          const x =
            -spread + (i * spread * 2) / Math.max(1, row.count - 1) + between(rnd, -0.04, 0.04);
          const base = foot(x) - flat(row.back);
          const r = row.r * between(rnd, 0.9, 1.1);
          const body = blob(rnd, x, base - r * 1.05, r, 0.42, 9);
          parts.push(
            dim(body, ink, 0.26),
            lit(blob(rnd, x - r * 0.34, base - r * 1.28, r * 0.5, 0.4, 7), ink, 0.36),
            edge(body, ink, 0.024, 0.36),
            // A stub of trunk under each crown, so the wood stands on the
            // ground instead of floating over it.
            edge(
              `M${round(x)} ${round(base)}V${round(base - r * 0.6)}`,
              ink,
              0.026,
              0.34
            )
          );
        }
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'palms',
    group: 'relief',
    layer: 'relief',
    title: 'Пальмы',
    use: 'Пальмовая группа. Только на островах — единственное дерево со своим силуэтом.',
    tags: ['лес', 'остров', 'рельеф'],
    bleed: 0.18,
    draw: ({ rnd, ink }) => {
      const count = 3 + Math.floor(rnd() * 2);
      const parts: Array<{ back: number; markup: string }> = [];
      for (let i = 0; i < count; i++) {
        const x = between(rnd, -0.44, 0.44);
        const back = between(rnd, 0, 0.5);
        parts.push({
          back,
          markup: palm(rnd, ink, x, foot(x) - flat(back), between(rnd, 0.42, 0.62)),
        });
      }
      return parts
        .sort((a, b) => b.back - a.back)
        .map((entry) => entry.markup)
        .join('');
    },
  }),

  defineTile({
    id: 'plateau',
    group: 'relief',
    layer: 'relief',
    title: 'Плато',
    use: 'Приподнятая столовая земля: ровный верх и обрыв по краю. Тянется рядом.',
    tags: ['плато', 'рельеф'],
    seams: [{ edges: [0, 3], meets: 'scarp' }],
    bleed: 0.1,
    draw: ({ rnd, ink }) => {
      // The lip crosses at a fixed place and the wall is a fixed height, so a
      // run of them lines up whatever each one did in between.
      const lip: Point[] = [
        { x: -EDGE, y: LIP_Y },
        { x: -FLAT, y: LIP_Y - 0.01 },
        { x: -0.2, y: LIP_Y + between(rnd, -0.04, 0.03) },
        { x: 0.3, y: LIP_Y + between(rnd, 0.01, 0.06) },
        { x: FLAT, y: LIP_Y - 0.01 },
        { x: EDGE, y: LIP_Y },
      ];
      const line = smooth(lip, false);
      const below = lip.map((point) => ({ x: point.x, y: point.y + SCARP }));
      // The tableland behind the lip, up towards the far edge of the cell. Not
      // a fill of the whole hex — filling to the top draws the hex, and this
      // map has no cell borders anywhere.
      const terrace = lip.map((point) => ({ x: point.x, y: point.y - flat(0.62) }));
      return (
        lit(`${smooth([...lip, ...[...terrace].reverse()], false)}Z`, ink, 0.24) +
        dim(`${smooth([...lip, ...[...below].reverse()], false)}Z`, ink, 0.34) +
        edge(line, ink, 0.045, 0.5) +
        // Gullies down the wall, which is what says it is a cliff and not a
        // band of colour.
        [0, 1, 2]
          .map((i) => {
            const x = -0.5 + i * 0.5 + between(rnd, -0.1, 0.1);
            const top = LIP_Y + between(rnd, 0.02, 0.06);
            return edge(
              `M${round(x)} ${round(top)}V${round(top + SCARP * between(rnd, 0.5, 0.9))}`,
              ink,
              0.025,
              0.35
            );
          })
          .join('')
      );
    },
  }),

  defineTile({
    id: 'terraces',
    group: 'relief',
    layer: 'relief',
    title: 'Ступени',
    use: 'Земля поднимается уступами. Одиночная клетка между низом и плато.',
    tags: ['плато', 'рельеф'],
    bleed: 0.1,
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      const steps = 3;
      for (let i = 0; i < steps; i++) {
        // Each step is narrower and higher than the one in front of it.
        const width = 0.78 - i * 0.16;
        const y = foot(0) - flat(0.24) - i * 0.2;
        const lip: Point[] = [
          { x: -width, y: y + between(rnd, -0.02, 0.02) },
          { x: 0, y: y - between(rnd, 0, 0.04) },
          { x: width, y: y + between(rnd, -0.02, 0.02) },
        ];
        const wall = lip.map((point) => ({ x: point.x, y: point.y + 0.2 }));
        parts.push(
          dim(`${smooth([...lip, ...[...wall].reverse()], false)}Z`, ink, 0.26),
          lit(
            `${smooth([...lip, ...[...lip].reverse().map((p) => ({ x: p.x * 0.94, y: p.y - 0.09 }))], false)}Z`,
            ink,
            0.26
          ),
          edge(smooth(lip, false), ink, 0.032, 0.45)
        );
      }
      return parts.join('');
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
    id: 'arch',
    group: 'relief',
    layer: 'relief',
    title: 'Арка',
    use: 'Скальные ворота. Приметная одиночная точка, ставится по одной.',
    tags: ['камень', 'рельеф'],
    bleed: 0.2,
    draw: ({ rnd, ink }) => {
      const base = foot(0);
      const w = between(rnd, 0.52, 0.6);
      const top = base - between(rnd, 0.86, 1);
      const pier = 0.16;
      const span = w - pier * 1.6;
      // Drawn as one outline with the opening cut out of it by the even-odd
      // rule: two separate legs and a lintel would show their joins as soon as
      // the whole thing was tinted.
      const body =
        `M${round(-w)} ${round(base)}L${round(-w + 0.03)} ${round(top + 0.1)}` +
        `Q0 ${round(top - 0.06)} ${round(w - 0.03)} ${round(top + 0.12)}` +
        `L${round(w)} ${round(base)}L${round(w - pier)} ${round(base)}` +
        `L${round(w - pier)} ${round(base - 0.3)}` +
        `Q0 ${round(base - 0.3 - span * 0.7)} ${round(-w + pier)} ${round(base - 0.3)}` +
        `L${round(-w + pier)} ${round(base)}Z`;
      const west =
        `M${round(-w)} ${round(base)}L${round(-w + 0.03)} ${round(top + 0.1)}` +
        `Q${round(-w * 0.4)} ${round(top + 0.02)} ${round(-w * 0.2)} ${round(top + 0.04)}` +
        `L${round(-w * 0.2)} ${round(top + 0.2)}L${round(-w + pier)} ${round(base - 0.3)}` +
        `L${round(-w + pier)} ${round(base)}Z`;
      return dim(body, ink, 0.3) + lit(west, ink, 0.34) + edge(body, ink, 0.034, 0.48);
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
        const base = foot(x) - between(rnd, 0, flat(0.3));
        const h = between(rnd, 0.3, 0.6);
        const w = between(rnd, 0.16, 0.24);
        const lean = between(rnd, -0.08, 0.08);
        const block =
          `M${round(x - w)} ${round(base)}L${round(x - w * 0.6)} ${round(base - h * 0.7)}` +
          `L${round(x + lean)} ${round(base - h)}L${round(x + w)} ${round(base - h * 0.45)}` +
          `L${round(x + w * 0.9)} ${round(base)}Z`;
        parts.push(
          lit(block, ink, 0.32),
          dim(
            `M${round(x + lean)} ${round(base - h)}L${round(x + w)} ${round(base - h * 0.45)}` +
              `L${round(x + w * 0.9)} ${round(base)}L${round(x + lean * 0.4)} ${round(base - h * 0.5)}Z`,
            ink,
            0.3
          ),
          edge(block, ink, 0.03, 0.45)
        );
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
      // The base follows the near rim: the cone stands on a round patch of
      // ground, and a level base would sink it into the cell at the sides.
      const left = foot(-w);
      const right = foot(w) + 0.02;
      const top = foot(0) - 0.95;
      const notch = 0.16;
      const cone =
        `M${round(-w)} ${round(left)}L${round(-notch)} ${round(top)}L${round(notch)} ${round(top + 0.03)}` +
        `L${round(w)} ${round(right)}Z`;
      return (
        dim(cone, ink, 0.22) +
        lit(
          `M${round(-w)} ${round(left)}L${round(-notch)} ${round(top)}L0 ${round(top + 0.05)}` +
            `L0 ${round(foot(0))}Z`,
          ink,
          0.38
        ) +
        dim(
          `M0 ${round(top + 0.05)}L${round(notch)} ${round(top + 0.03)}L${round(w)} ${round(right)}` +
            `L0 ${round(foot(0))}Z`,
          ink,
          0.26
        ) +
        edge(cone, ink, 0.04, 0.52) +
        // The caldera: a shallow ellipse and a lick of heat inside it.
        `<ellipse cx="0" cy="${round(top + 0.01)}" rx="${round(notch)}" ry="0.05" ` +
        `fill="${ink.shade}" opacity="0.4"/>` +
        `<path d="${blob(rnd, 0, top + 0.01, 0.07, 0.4, 6)}" fill="${ink.light}" opacity="0.35"/>`
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
    clip: true,
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
    id: 'scree',
    group: 'relief',
    layer: 'surface',
    title: 'Осыпь',
    use: 'Каменистая земля. Ровное место, по которому видно, что оно голое.',
    tags: ['камень', 'поверхность'],
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 26; i++) {
        const x = between(rnd, -0.86, 0.86);
        const y = between(rnd, -0.94, 0.94);
        const r = between(rnd, 0.05, 0.13);
        // A shadow under the stone and a lit crown on it. Without the pair a
        // stone is a smudge; with it, a cell of them reads as loose rock.
        parts.push(
          dim(blob(rnd, x, y + r * 0.25, r, 0.45, 5), ink, 0.34),
          lit(blob(rnd, x - r * 0.22, y - r * 0.3, r * 0.72, 0.45, 5), ink, 0.42)
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'grass',
    group: 'relief',
    layer: 'surface',
    title: 'Травостой',
    use: 'Открытая трава: длинные полосы, причёсанные ветром. Степь, саванна, луг.',
    tags: ['трава', 'поверхность'],
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const line = comb(rnd, -0.68 + i * 0.34 + between(rnd, -0.05, 0.05), between(rnd, 0.05, 0.1));
        const lift = between(rnd, 0.07, 0.12);
        const above = line.map((point) => ({ x: point.x, y: point.y - lift }));
        parts.push(
          lit(`${smooth([...above, ...[...line].reverse()], false)}Z`, ink, 0.2),
          edge(smooth(line, false), ink, 0.022, 0.24)
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'marsh',
    group: 'relief',
    layer: 'surface',
    title: 'Марь',
    use: 'Мокрая земля: стоячая вода пятнами. Не озеро — вода на карте только у берега.',
    tags: ['вода', 'поверхность'],
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 4; i++) {
        const centre = spot(rnd, 0.58);
        const rx = between(rnd, 0.24, 0.4);
        const ry = rx * between(rnd, 0.34, 0.46);
        // The dark ring is the wet ground the water stands in; without it a lit
        // patch on a coloured field is a smudge rather than a puddle.
        parts.push(
          dim(patch(rnd, centre.x, centre.y + ry * 0.3, rx * 1.16, ry * 1.3), ink, 0.24),
          lit(patch(rnd, centre.x, centre.y, rx, ry), ink, 0.42)
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'snowfield',
    group: 'relief',
    layer: 'surface',
    title: 'Снежник',
    use: 'Пятна снега между камнями. Верхний пояс: ледники и тундра.',
    tags: ['снег', 'поверхность'],
    draw: ({ rnd, ink }) => {
      const parts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const centre = spot(rnd, 0.52);
        const rx = between(rnd, 0.36, 0.56);
        const ry = rx * between(rnd, 0.3, 0.42);
        const lying = patch(rnd, centre.x, centre.y, rx, ry, 9);
        parts.push(
          // A shadow slid south, so the snow lies *on* the ground instead of
          // hovering as a white hole in it.
          dim(patch(rnd, centre.x, centre.y + ry * 0.34, rx * 0.96, ry), ink, 0.16),
          lit(lying, ink, 0.52),
          edge(lying, ink, 0.018, 0.14)
        );
      }
      return parts.join('');
    },
  }),

  defineTile({
    id: 'cracked',
    group: 'relief',
    layer: 'surface',
    title: 'Солончак',
    use: 'Сухая растрескавшаяся земля. Плоская поверхность, читается фактурой.',
    tags: ['сушь', 'поверхность'],
    draw: ({ rnd, ink }) => {
      // A lattice with every node shaken off its place, joined to the node east
      // of it and the node below it. Scattering points and linking whatever
      // landed close enough leaves bare patches and knots of lines in equal
      // measure; a shaken grid cracks the whole cell exactly once.
      const cols = 5;
      const rows = 5;
      const step = 1.9 / (cols - 1);
      const node = (i: number, j: number) => ({
        x: -0.95 + i * step + between(rnd, -0.16, 0.16),
        y: -0.95 + j * step + between(rnd, -0.16, 0.16),
      });
      const grid = Array.from({ length: rows }, (_, j) =>
        Array.from({ length: cols }, (_, i) => node(i, j))
      );
      const parts: string[] = [];
      const crack = (a: Point, b: Point) => {
        const midX = (a.x + b.x) / 2 + between(rnd, -0.08, 0.08);
        const midY = (a.y + b.y) / 2 + between(rnd, -0.08, 0.08);
        parts.push(
          edge(
            `M${round(a.x)} ${round(a.y)}Q${round(midX)} ${round(midY)} ${round(b.x)} ${round(b.y)}`,
            ink,
            0.022,
            0.34
          )
        );
      };
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          // One join in ten left out, so the network has ends in it and does
          // not read as a mesh somebody drew on purpose.
          if (i + 1 < cols && rnd() > 0.1) crack(grid[j][i], grid[j][i + 1]);
          if (j + 1 < rows && rnd() > 0.1) crack(grid[j][i], grid[j + 1][i]);
        }
      }
      return parts.join('');
    },
  }),
];
