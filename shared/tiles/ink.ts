/**
 * The pen: the terrain palette, the randomness, and the few marks that more
 * than one tile draws.
 *
 * Everything here works in the unit hex of `hex.ts`, so a "small stone" is
 * 0.08 of a cell rather than a number of pixels.
 *
 * The generator is a private copy of mulberry32 rather than an import, which is
 * what `mapgen.ts`, `domain-graph.ts` and `procedural.ts` each do too: it is
 * eight lines, and a shared one would tie four unrelated modules to the same
 * file for nothing.
 */

import { inside, round, type Point } from './hex.js';

/* ─────────────────────────────────  Colour  ────────────────────────────── */

export type Palette = {
  soil: string;
  soilDeep: string;
  soilPale: string;
  grass: string;
  grassDeep: string;
  grassPale: string;
  sand: string;
  sandDeep: string;
  rock: string;
  rockDeep: string;
  rockPale: string;
  snow: string;
  sea: string;
  seaDeep: string;
  seaPale: string;
  lake: string;
  foam: string;
  wood: string;
  leaf: string;
  leafDeep: string;
  pine: string;
  bloomA: string;
  bloomB: string;
  ink: string;
};

/**
 * One palette for the whole collection, so pieces drawn months apart still
 * belong to the same map. Warm, slightly desaturated: the tiles have to sit
 * under labels and route lines without shouting over them.
 */
export const terrain: Palette = {
  soil: '#c8a578',
  soilDeep: '#a3814f',
  soilPale: '#ddc79c',
  grass: '#8ab765',
  grassDeep: '#5d8c45',
  grassPale: '#aed187',
  sand: '#e7d4a6',
  sandDeep: '#ccb17f',
  rock: '#9aa2a8',
  rockDeep: '#6c747b',
  rockPale: '#c4cace',
  snow: '#f3f7fa',
  sea: '#4c8fb4',
  seaDeep: '#2e6b90',
  seaPale: '#7fb5d3',
  lake: '#5fa9cb',
  foam: '#dff0f7',
  wood: '#7a5a3c',
  leaf: '#5f9a52',
  leafDeep: '#3f7440',
  pine: '#3c6b4a',
  bloomA: '#e2746a',
  bloomB: '#efc453',
  ink: '#3b4a52',
};

/** Named water bodies, so a coast can be told which one it borders. */
export const WATERS = ['sea', 'lake', 'shallow'] as const;
/** Named grounds, so a coast can be told what the land behind it is. */
export const GROUNDS = ['grass', 'soil', 'sand', 'rock'] as const;

export function waterColours(ink: Palette, name: string): { body: string; deep: string; pale: string } {
  if (name === 'lake') return { body: ink.lake, deep: ink.sea, pale: ink.foam };
  if (name === 'shallow') return { body: ink.seaPale, deep: ink.sea, pale: ink.foam };
  return { body: ink.sea, deep: ink.seaDeep, pale: ink.seaPale };
}

export function groundColours(ink: Palette, name: string): { body: string; deep: string; pale: string } {
  if (name === 'soil') return { body: ink.soil, deep: ink.soilDeep, pale: ink.soilPale };
  if (name === 'sand') return { body: ink.sand, deep: ink.sandDeep, pale: ink.soilPale };
  if (name === 'rock') return { body: ink.rock, deep: ink.rockDeep, pale: ink.rockPale };
  return { body: ink.grass, deep: ink.grassDeep, pale: ink.grassPale };
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
 * and an overshoot would show up as a notch between two neighbouring cells.
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

/** A closed, irregular round shape — a patch of soil, a stone, a treetop. */
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

/** A blade cluster. Three strokes is the least that still reads as grass. */
export function tuft(rnd: () => number, x: number, y: number, size: number, colour: string): string {
  const blades: string[] = [];
  for (let i = -1; i <= 1; i++) {
    const lean = i * size * 0.5 + (rnd() - 0.5) * size * 0.3;
    blades.push(
      `M${round(x)} ${round(y)}q${round(lean * 0.5)} ${round(-size * 0.6)} ${round(lean)} ${round(-size)}`
    );
  }
  return (
    `<path d="${blades.join('')}" fill="none" stroke="${colour}" ` +
    `stroke-width="${round(size * 0.22)}" stroke-linecap="round" opacity="0.85"/>`
  );
}

/** A conifer: trunk plus two stacked skirts. */
export function conifer(x: number, y: number, size: number, ink: Palette): string {
  const w = size * 0.52;
  return (
    `<path d="M${round(x)} ${round(y)}v${round(-size * 0.22)}" stroke="${ink.wood}" ` +
    `stroke-width="${round(size * 0.14)}" stroke-linecap="round"/>` +
    `<path d="M${round(x)} ${round(y - size)}L${round(x + w * 0.72)} ${round(y - size * 0.45)}` +
    `L${round(x - w * 0.72)} ${round(y - size * 0.45)}Z" fill="${ink.pine}"/>` +
    `<path d="M${round(x)} ${round(y - size * 0.62)}L${round(x + w)} ${round(y - size * 0.18)}` +
    `L${round(x - w)} ${round(y - size * 0.18)}Z" fill="${ink.leafDeep}"/>`
  );
}

/** A broadleaf: trunk plus a lopsided crown with one lit side. */
export function broadleaf(
  rnd: () => number,
  x: number,
  y: number,
  size: number,
  ink: Palette
): string {
  const cy = y - size * 0.66;
  return (
    `<path d="M${round(x)} ${round(y)}v${round(-size * 0.4)}" stroke="${ink.wood}" ` +
    `stroke-width="${round(size * 0.15)}" stroke-linecap="round"/>` +
    `<path d="${blob(rnd, x, cy, size * 0.46, 0.3, 8)}" fill="${ink.leafDeep}"/>` +
    `<path d="${blob(rnd, x - size * 0.1, cy - size * 0.1, size * 0.3, 0.3, 7)}" fill="${ink.leaf}"/>`
  );
}

/** A stone with a lit top, so the flat map still reads as having a sun. */
export function stone(
  rnd: () => number,
  x: number,
  y: number,
  size: number,
  ink: Palette
): string {
  return (
    `<path d="${blob(rnd, x, y, size, 0.4, 6)}" fill="${ink.rockDeep}"/>` +
    `<path d="${blob(rnd, x - size * 0.14, y - size * 0.2, size * 0.6, 0.4, 6)}" fill="${ink.rockPale}" opacity="0.9"/>`
  );
}

/** A full-bleed fill. Flat tiles are clipped to the hex, so it may overrun. */
export function field(colour: string): string {
  return `<rect x="-1.1" y="-1.1" width="2.2" height="2.2" fill="${colour}"/>`;
}
