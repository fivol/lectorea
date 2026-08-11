/**
 * The pen: the palette, the randomness, and the marks more than one tile draws.
 *
 * Only water has a colour of its own. Land does not: on this map a hex belongs
 * to a territory, and the territory's colour is the data — paint an opaque
 * ground over it and the map stops saying anything. So relief is *light and
 * shade*, not pigment: a white face at low opacity and a cool dark one read as
 * a mountain over green, purple or pink alike.
 *
 * Everything works in the unit hex of `hex.ts`, so a ridge is 0.6 of a cell
 * rather than a number of pixels.
 *
 * The generator is a private copy of mulberry32 rather than an import, which is
 * what `mapgen.ts`, `domain-graph.ts` and `procedural.ts` each do too: it is
 * eight lines, and a shared one would tie four unrelated modules together.
 */

import { inside, round, type Point } from './hex.js';

/* ─────────────────────────────────  Colour  ────────────────────────────── */

export type Palette = {
  /** The sea, as the app paints it. Override to match a different map. */
  sea: string;
  seaDeep: string;
  seaShallow: string;
  foam: string;
  ice: string;
  reef: string;
  river: string;
  /** The relief trio. Neutral on purpose — they go over any territory hue. */
  light: string;
  shade: string;
  ink: string;
  snow: string;
  sand: string;
};

export const terrain: Palette = {
  sea: '#6a9cb8',
  seaDeep: '#4a7d9c',
  seaShallow: '#95c2d6',
  foam: '#e9f4f9',
  ice: '#dcebf3',
  reef: '#6fae9f',
  river: '#7fb6d2',
  light: '#ffffff',
  shade: '#10303f',
  ink: '#0d2431',
  snow: '#ffffff',
  sand: '#e6d6b2',
};

/** Named water bodies, so a piece can be told which one it borders. */
export const WATERS = ['sea', 'shallow', 'deep'] as const;

export function waterColours(
  ink: Palette,
  name: string
): { body: string; deep: string; pale: string } {
  if (name === 'shallow') return { body: ink.seaShallow, deep: ink.sea, pale: ink.foam };
  if (name === 'deep') return { body: ink.seaDeep, deep: ink.ink, pale: ink.sea };
  return { body: ink.sea, deep: ink.seaDeep, pale: ink.seaShallow };
}

/* ──────────────────────────────  Determinism  ──────────────────────────── */

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (rnd: () => number, lo: number, hi: number): number => lo + rnd() * (hi - lo);

export function pick<T>(rnd: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rnd() * items.length))];
}

/* ─────────────────────────────────  Curves  ────────────────────────────── */

const p = (point: Point): string => `${round(point.x)} ${round(point.y)}`;
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * A path through the points with every corner rounded off.
 *
 * Quadratics anchored on the midpoints rather than a spline: it never
 * overshoots, which matters because these shapes are cut off at the hex edge
 * and an overshoot shows up as a notch between two neighbouring cells.
 */
export function smooth(points: Point[], closed: boolean): string {
  if (points.length < 3) return `M${points.map(p).join('L')}`;
  const parts: string[] = [];
  if (closed) {
    parts.push(`M${p(mid(points[points.length - 1], points[0]))}`);
    for (let i = 0; i < points.length; i++) {
      const next = points[(i + 1) % points.length];
      parts.push(`Q${p(points[i])} ${p(mid(points[i], next))}`);
    }
    parts.push('Z');
  } else {
    parts.push(`M${p(points[0])}`);
    for (let i = 1; i < points.length - 1; i++) {
      parts.push(`Q${p(points[i])} ${p(mid(points[i], points[i + 1]))}`);
    }
    parts.push(`L${p(points[points.length - 1])}`);
  }
  return parts.join('');
}

/** A closed, irregular round shape — a shoal, a floe, a hilltop. */
export function blob(
  rnd: () => number,
  cx: number,
  cy: number,
  radius: number,
  wobble = 0.35,
  count = 7
): string {
  const points: Point[] = [];
  const turn = (Math.PI * 2) / count;
  const phase = rnd() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = phase + turn * i;
    const r = radius * (1 - wobble / 2 + rnd() * wobble);
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.86 });
  }
  return smooth(points, true);
}

/** A hand-drawn-looking line from a to b, waving about its own axis. */
export function wave(
  rnd: () => number,
  from: Point,
  to: Point,
  amplitude: number,
  steps = 5
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Ends are pinned: they are where the neighbouring cell picks the line up.
    const swing = Math.sin(t * Math.PI) * (rnd() - 0.5) * 2 * amplitude;
    points.push({ x: from.x + dx * t + nx * swing, y: from.y + dy * t + ny * swing });
  }
  return smooth(points, false);
}

/** Points scattered inside the hex, rejection-sampled so nothing sits outside. */
export function scatter(rnd: () => number, count: number, spread = 0.92): Point[] {
  const points: Point[] = [];
  for (let guard = 0; guard < count * 40 && points.length < count; guard++) {
    const candidate = { x: (rnd() * 2 - 1) * spread, y: (rnd() * 2 - 1) * spread };
    if (inside(candidate, spread)) points.push(candidate);
  }
  return points;
}

/** One point inside the hex. */
export function spot(rnd: () => number, spread = 0.92): Point {
  return scatter(rnd, 1, spread)[0] ?? { x: 0, y: 0 };
}

/* ──────────────────────────────────  Marks  ────────────────────────────── */

/** A lit face. The sun is in the north-west for the whole collection. */
export const lit = (d: string, ink: Palette, opacity = 0.32): string =>
  `<path d="${d}" fill="${ink.light}" opacity="${opacity}"/>`;

/** A shaded face. */
export const dim = (d: string, ink: Palette, opacity = 0.22): string =>
  `<path d="${d}" fill="${ink.shade}" opacity="${opacity}"/>`;

/** A drawn edge — a ridge crest, a scarp, the lip of a crater. */
export const edge = (d: string, ink: Palette, width = 0.035, opacity = 0.35): string =>
  `<path d="${d}" fill="none" stroke="${ink.ink}" stroke-width="${round(width)}" ` +
  `stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;

/** A full-bleed fill. Flat tiles are clipped to the hex, so it may overrun. */
export function field(colour: string, opacity = 1): string {
  return (
    `<rect x="-1.1" y="-1.1" width="2.2" height="2.2" fill="${colour}"` +
    (opacity === 1 ? '' : ` opacity="${opacity}"`) +
    `/>`
  );
}
