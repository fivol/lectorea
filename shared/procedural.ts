/**
 * Deterministic procedural artwork for course cards.
 *
 * The same id always yields the same picture, so images are stable between
 * builds and need not be stored in git. 500+ courses through an image API
 * would be money on every run, a style that drifts apart, and no cheap way to
 * regenerate everything when the design changes.
 *
 * Two things about a course decide what it looks like, and they are deliberately
 * different things:
 *
 * - **the field** picks the hue, from the domain's biome, and the *set of
 *   motifs* the picture is allowed to use — see `MOTIFS` below;
 * - **the course id** picks which of those motifs it actually gets, and every
 *   number inside it.
 *
 * So a domain reads as a family — one colour, a handful of related pictures —
 * while no two courses in it are the same card. A motif tied to the id alone
 * would have put a double helix on a course in logic; a motif tied to the domain
 * alone would have made forty identical cards in a column.
 *
 * Lives in `shared/` because two consumers need byte-identical output:
 * `07-images.ts`, which writes files, and the frontend, which inlines the same
 * markup instead of firing 500 requests while the graph is scrolled.
 */

import type { Continent } from './schema.js';

export type Motif =
  | 'orbits'
  | 'grid'
  | 'strata'
  | 'noise'
  | 'lattice'
  | 'wave'
  | 'helix'
  | 'arcs'
  | 'branch'
  | 'flow'
  | 'weave'
  | 'glyphs'
  | 'contour';

/** Which canvas the picture will sit on. Files on disk are always the dark one. */
export type Scheme = 'dark' | 'light';

export type VisualConfig = {
  palette: 'domain' | 'mono' | 'custom';
  motif: Motif | 'auto';
  density: number;
  strokeWidth: number;
  seedSalt: string;
  customColor?: string;
  scheme?: Scheme;
};

export const DEFAULT_VISUAL: VisualConfig = {
  palette: 'domain',
  motif: 'auto',
  density: 0.6,
  strokeWidth: 1.5,
  seedSalt: 'v1',
};

export const ART_WIDTH = 180;
export const ART_HEIGHT = 96;

/**
 * What a picture needs to know about the field its course belongs to.
 *
 * `id` and `continent` choose the motif, `color` draws it. All three come off
 * the same `BuiltDomain`, but the colour arrives already deepened for the card
 * underneath (`inkOn`), which is why it is passed rather than looked up here.
 */
export type ArtDomain = {
  /** Primary domain of the course — `course.domains[0]`. */
  id?: string;
  /** Used only when `id` has no line in `MOTIFS` yet. */
  continent?: Continent;
  /** Base hue, legible on the canvas the card will sit on. */
  color: string;
};

/* ───────────────────────────────  Randomness  ──────────────────────────── */

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─────────────────────────────────  Colour  ────────────────────────────── */

type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) =>
    Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

export function shift(hex: string, dh: number, ds: number, dl: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({
    h: hsl.h + dh,
    s: Math.min(1, Math.max(0, hsl.s + ds)),
    l: Math.min(1, Math.max(0, hsl.l + dl)),
  });
}

/* ────────────────────────────────  Motifs  ─────────────────────────────── */

/**
 * Three tones of one hue. `base` draws the lines, `accent` the marks that
 * should catch the eye, `shade` the quiet third — which way each sits relative
 * to the domain colour is the scheme's business, not the motif's.
 */
type Ctx = {
  rnd: () => number;
  base: string;
  accent: string;
  shade: string;
  stroke: number;
  density: number;
};

function orbits({ rnd, base, accent, stroke, density }: Ctx): string {
  const cx = ART_WIDTH * (0.35 + rnd() * 0.3);
  const cy = ART_HEIGHT * (0.4 + rnd() * 0.25);
  const rings = 3 + Math.round(rnd() * 3 * density * 1.6);
  const parts: string[] = [];
  for (let i = 0; i < rings; i++) {
    const rx = 14 + i * (9 + rnd() * 8);
    const ry = rx * (0.45 + rnd() * 0.4);
    const rot = Math.round(rnd() * 180);
    parts.push(
      `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" ` +
        `transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="none" ` +
        `stroke="${base}" stroke-width="${stroke}" opacity="${(0.75 - i * 0.09).toFixed(2)}"/>`
    );
    const angle = rnd() * Math.PI * 2;
    const px = cx + Math.cos(angle) * rx * Math.cos((rot * Math.PI) / 180);
    const py = cy + Math.sin(angle) * ry;
    parts.push(
      `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(1.6 + rnd() * 2).toFixed(1)}" fill="${accent}" opacity="0.9"/>`
    );
  }
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" fill="${accent}"/>`);
  return parts.join('');
}

function grid({ rnd, base, accent, stroke, density }: Ctx): string {
  const step = 12 + rnd() * 10;
  const rot = -12 + rnd() * 24;
  const parts: string[] = [];
  for (let x = -ART_WIDTH; x < ART_WIDTH * 2; x += step) {
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="-20" x2="${x.toFixed(1)}" y2="${ART_HEIGHT + 20}" stroke="${base}" stroke-width="${stroke}" opacity="0.28"/>`
    );
  }
  for (let y = -20; y < ART_HEIGHT + 20; y += step) {
    parts.push(
      `<line x1="-20" y1="${y.toFixed(1)}" x2="${ART_WIDTH + 20}" y2="${y.toFixed(1)}" stroke="${base}" stroke-width="${stroke}" opacity="0.28"/>`
    );
  }
  const cells = Math.round(3 + rnd() * 6 * density * 1.6);
  for (let i = 0; i < cells; i++) {
    const cx = Math.floor(rnd() * (ART_WIDTH / step)) * step;
    const cy = Math.floor(rnd() * (ART_HEIGHT / step)) * step;
    parts.push(
      `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${step.toFixed(1)}" height="${step.toFixed(1)}" fill="${accent}" opacity="${(0.18 + rnd() * 0.4).toFixed(2)}"/>`
    );
  }
  return `<g transform="rotate(${rot.toFixed(1)} ${ART_WIDTH / 2} ${ART_HEIGHT / 2})">${parts.join('')}</g>`;
}

function strata({ rnd, base, accent, shade, density }: Ctx): string {
  const parts: string[] = [];
  const bands = Math.round(4 + rnd() * 5 * density * 1.6);
  let y = 0;
  for (let i = 0; i < bands && y < ART_HEIGHT; i++) {
    const h = 4 + rnd() * (ART_HEIGHT / bands);
    const skew = -6 + rnd() * 12;
    const colour = i % 3 === 0 ? accent : i % 3 === 1 ? base : shade;
    parts.push(
      `<path d="M0 ${y.toFixed(1)} L${ART_WIDTH} ${(y + skew).toFixed(1)} L${ART_WIDTH} ${(y + skew + h).toFixed(1)} L0 ${(y + h).toFixed(1)} Z" ` +
        `fill="${colour}" opacity="${(0.16 + rnd() * 0.34).toFixed(2)}"/>`
    );
    y += h + 2 + rnd() * 5;
  }
  return parts.join('');
}

function noise({ rnd, base, accent, stroke, density }: Ctx): string {
  const count = Math.round(14 + rnd() * 22 * density * 1.6);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = rnd() * ART_WIDTH;
    const y = rnd() * ART_HEIGHT;
    const r = 1 + rnd() * 4;
    const filled = rnd() > 0.55;
    parts.push(
      filled
        ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${accent}" opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`
        : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${base}" stroke-width="${stroke}" opacity="${(0.3 + rnd() * 0.4).toFixed(2)}"/>`
    );
  }
  return parts.join('');
}

function lattice({ rnd, base, accent, stroke, density }: Ctx): string {
  const nodes = Array.from({ length: Math.round(7 + rnd() * 7 * density * 1.6) }, () => ({
    x: 12 + rnd() * (ART_WIDTH - 24),
    y: 12 + rnd() * (ART_HEIGHT - 24),
  }));
  // Every node reaches for its two nearest neighbours rather than for random
  // partners: what comes out has a shape you could redraw from memory, which is
  // the difference between a network and a tangle.
  const edges: string[] = [];
  const drawn = new Set<string>();
  nodes.forEach((node, i) => {
    const nearest = nodes
      .map((other, j) => ({ j, d: Math.hypot(other.x - node.x, other.y - node.y) }))
      .filter((entry) => entry.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of nearest) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      edges.push(
        `<line x1="${node.x.toFixed(1)}" y1="${node.y.toFixed(1)}" ` +
          `x2="${nodes[j].x.toFixed(1)}" y2="${nodes[j].y.toFixed(1)}" ` +
          `stroke="${base}" stroke-width="${stroke}" opacity="0.45"/>`
      );
    }
  });
  const marks = nodes.map(
    (node, i) =>
      `<circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${(2 + (i % 3) * 0.9).toFixed(1)}" ` +
      `fill="${i % 3 === 0 ? accent : base}" opacity="${i % 3 === 0 ? '0.95' : '0.6'}"/>`
  );
  return edges.join('') + marks.join('');
}

function wave({ rnd, base, accent, shade, stroke, density }: Ctx): string {
  const lines = Math.round(3 + rnd() * 3 * density * 1.6);
  const parts: string[] = [];
  for (let i = 0; i < lines; i++) {
    const amp = 5 + rnd() * 16;
    const period = 34 + rnd() * 70;
    const phase = rnd() * Math.PI * 2;
    const mid = ART_HEIGHT / 2 + (rnd() - 0.5) * (ART_HEIGHT / 2 - amp);
    const points: string[] = [];
    for (let x = 0; x <= ART_WIDTH; x += 5) {
      points.push(`${x},${(mid + Math.sin((x / period) * Math.PI * 2 + phase) * amp).toFixed(1)}`);
    }
    const colour = i % 3 === 0 ? accent : i % 3 === 1 ? base : shade;
    parts.push(
      `<polyline points="${points.join(' ')}" fill="none" stroke="${colour}" ` +
        `stroke-width="${(stroke * (i === 0 ? 1.6 : 1)).toFixed(2)}" opacity="${(0.8 - i * 0.09).toFixed(2)}"/>`
    );
  }
  return parts.join('');
}

function helix({ rnd, base, accent, shade, stroke, density }: Ctx): string {
  const mid = ART_HEIGHT / 2 + (rnd() - 0.5) * 14;
  const amp = 13 + rnd() * 13;
  const period = 60 + rnd() * 50;
  const phase = rnd() * Math.PI * 2;
  const at = (x: number, offset: number) =>
    mid + Math.sin((x / period) * Math.PI * 2 + phase + offset) * amp;
  const strand = (offset: number, colour: string) => {
    const points: string[] = [];
    for (let x = 0; x <= ART_WIDTH; x += 5) points.push(`${x},${at(x, offset).toFixed(1)}`);
    return (
      `<polyline points="${points.join(' ')}" fill="none" stroke="${colour}" ` +
      `stroke-width="${(stroke * 1.3).toFixed(2)}" opacity="0.8"/>`
    );
  };
  // The rungs are what say helix rather than two stray waves, and they fade
  // where the strands cross — as they do in any drawing of one.
  const rungs = Math.round(6 + rnd() * 7 * density * 1.6);
  const bars: string[] = [];
  for (let i = 0; i < rungs; i++) {
    const x = ((i + 0.5) * ART_WIDTH) / rungs;
    const top = at(x, 0);
    const bottom = at(x, Math.PI);
    bars.push(
      `<line x1="${x.toFixed(1)}" y1="${top.toFixed(1)}" x2="${x.toFixed(1)}" y2="${bottom.toFixed(1)}" ` +
        `stroke="${shade}" stroke-width="${stroke}" ` +
        `opacity="${(0.2 + (Math.abs(top - bottom) / (2 * amp)) * 0.5).toFixed(2)}"/>`
    );
  }
  return bars.join('') + strand(0, base) + strand(Math.PI, accent);
}

function arcs({ rnd, base, accent, shade, stroke, density }: Ctx): string {
  const springing = ART_HEIGHT * (0.5 + rnd() * 0.18);
  // Legs down to the bottom edge, so the curve is carrying something. An arc
  // on its own is a rainbow; an arc standing on two piers is architecture.
  const arch = (cx: number, radius: number, colour: string, opacity: number) =>
    `<path d="M${(cx - radius).toFixed(1)} ${ART_HEIGHT} L${(cx - radius).toFixed(1)} ${springing.toFixed(1)} ` +
    `A${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${(cx + radius).toFixed(1)} ${springing.toFixed(1)} ` +
    `L${(cx + radius).toFixed(1)} ${ART_HEIGHT}" fill="none" stroke="${colour}" ` +
    `stroke-width="${stroke}" opacity="${opacity.toFixed(2)}"/>`;
  // The keystone. Outlines with nothing at the crown read as a ripple; one
  // filled mark up there makes the same lines an arch.
  const keystone = (cx: number, radius: number) =>
    `<circle cx="${cx.toFixed(1)}" cy="${(springing - radius).toFixed(1)}" r="2.4" fill="${accent}" opacity="0.9"/>`;

  const parts: string[] = [];
  // Two ways to look at the same building — along the wall, and head on. One
  // shape drawn one way would be forty identical cards in a column.
  if (rnd() > 0.45) {
    const bays = 2 + Math.round(rnd() * 3 * density * 1.6);
    const bay = ART_WIDTH / bays;
    const radius = bay / 2 - 1 - rnd() * 3;
    for (let i = 0; i < bays; i++) {
      const cx = bay * (i + 0.5);
      parts.push(arch(cx, radius, i % 3 === 1 ? shade : base, 0.72), keystone(cx, radius));
    }
    return parts.join('');
  }

  const cx = ART_WIDTH * (0.32 + rnd() * 0.36);
  const count = Math.round(3 + rnd() * 3 * density * 1.6);
  let radius = 11 + rnd() * 7;
  const inner = radius;
  for (let i = 0; i < count; i++) {
    parts.push(arch(cx, radius, i % 3 === 1 ? shade : base, 0.75 - i * 0.09));
    radius += 9 + rnd() * 9;
  }
  parts.push(keystone(cx, inner));
  return parts.join('');
}

function branch({ rnd, base, accent, stroke, density }: Ctx): string {
  const depth = 3 + Math.round(rnd() * 2 * density * 1.6);
  const spread = 0.42 + rnd() * 0.4;
  const parts: string[] = [];
  const grow = (x: number, y: number, angle: number, len: number, level: number): void => {
    const nx = x + Math.cos(angle) * len;
    const ny = y + Math.sin(angle) * len;
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" ` +
        `stroke="${base}" stroke-width="${(stroke * (1 - level / (depth + 2))).toFixed(2)}" ` +
        `opacity="${(0.8 - level * 0.07).toFixed(2)}" stroke-linecap="round"/>`
    );
    if (level >= depth) {
      parts.push(
        `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${(1.4 + rnd() * 1.6).toFixed(1)}" fill="${accent}" opacity="0.9"/>`
      );
      return;
    }
    grow(nx, ny, angle - spread * (0.6 + rnd() * 0.8), len * (0.64 + rnd() * 0.16), level + 1);
    grow(nx, ny, angle + spread * (0.6 + rnd() * 0.8), len * (0.64 + rnd() * 0.16), level + 1);
  };
  // Rooted just below the frame, so the trunk is a stem rather than a stub.
  grow(
    ART_WIDTH * (0.34 + rnd() * 0.32),
    ART_HEIGHT + 4,
    -Math.PI / 2 + (rnd() - 0.5) * 0.3,
    22 + rnd() * 9,
    0
  );
  return parts.join('');
}

function flow({ rnd, base, accent, shade, stroke, density }: Ctx): string {
  const lines = Math.round(4 + rnd() * 4 * density * 1.6);
  const kx = 0.02 + rnd() * 0.03;
  const ky = 0.015 + rnd() * 0.03;
  const phase = rnd() * Math.PI * 2;
  const parts: string[] = [];
  for (let i = 0; i < lines; i++) {
    const lane = ((i + 0.5) * ART_HEIGHT) / lines + (rnd() - 0.5) * 8;
    let x = -6;
    let y = lane;
    const points: Array<[number, number]> = [[x, y]];
    while (x < ART_WIDTH - 12) {
      x += 9;
      // The pull back towards the lane keeps a streamline curving instead of
      // wandering off the card — the field it traces is bounded, so it is too.
      y += Math.sin(x * kx + y * ky + phase) * 5 + (lane - y) * 0.08;
      points.push([x, y]);
    }
    const colour = i % 3 === 0 ? accent : i % 3 === 1 ? base : shade;
    parts.push(
      `<polyline points="${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" ` +
        `fill="none" stroke="${colour}" stroke-width="${stroke}" opacity="${(0.4 + rnd() * 0.4).toFixed(2)}"/>`
    );
    // The arrowhead is the point of the motif: a field has a direction, and a
    // bare squiggle does not say which way anything is going.
    const [ax, ay] = points[points.length - 2];
    const [bx, by] = points[points.length - 1];
    const heading = Math.atan2(by - ay, bx - ax);
    const tip = 5.5;
    parts.push(
      `<path d="M${bx.toFixed(1)} ${by.toFixed(1)} ` +
        `L${(bx - Math.cos(heading - 0.4) * tip).toFixed(1)} ${(by - Math.sin(heading - 0.4) * tip).toFixed(1)} ` +
        `L${(bx - Math.cos(heading + 0.4) * tip).toFixed(1)} ${(by - Math.sin(heading + 0.4) * tip).toFixed(1)} Z" ` +
        `fill="${colour}" opacity="0.85"/>`
    );
  }
  return parts.join('');
}

function weave({ rnd, base, accent, shade, stroke, density }: Ctx): string {
  const step = 14 - density * 6 + rnd() * 5;
  const cols = Math.ceil(ART_WIDTH / step);
  const rows = Math.ceil(ART_HEIGHT / step);
  // Both sets of threads run the whole way, faintly — that is the cloth seen
  // through itself.
  const ghost: string[] = [];
  for (let i = 0; i <= cols; i++) {
    const x = (i * step).toFixed(1);
    ghost.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${ART_HEIGHT}" stroke="${base}" stroke-width="${stroke.toFixed(2)}" opacity="0.2"/>`
    );
  }
  for (let j = 0; j <= rows; j++) {
    const y = (j * step).toFixed(1);
    ghost.push(
      `<line x1="0" y1="${y}" x2="${ART_WIDTH}" y2="${y}" stroke="${base}" stroke-width="${stroke.toFixed(2)}" opacity="0.2"/>`
    );
  }
  // On top of that, one thread at a time is drawn *over* the other, alternating
  // cell by cell. That over-under is the whole of it: without it the same lines
  // are a grid, with it they are cloth.
  const over: string[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const weft = (i + j) % 2 === 0;
      const x = i * step;
      const y = j * step;
      const colour = weft ? (j % 3 === 0 ? shade : base) : i % 4 === 0 ? accent : base;
      over.push(
        weft
          ? `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + step).toFixed(1)}" y2="${y.toFixed(1)}" ` +
            `stroke="${colour}" stroke-width="${(stroke * 1.7).toFixed(2)}" stroke-linecap="round" ` +
            `opacity="${(0.5 + rnd() * 0.3).toFixed(2)}"/>`
          : `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + step).toFixed(1)}" ` +
            `stroke="${colour}" stroke-width="${(stroke * 1.7).toFixed(2)}" stroke-linecap="round" ` +
            `opacity="${(0.5 + rnd() * 0.3).toFixed(2)}"/>`
      );
    }
  }
  return ghost.join('') + over.join('');
}

function glyphs({ rnd, base, accent, shade, stroke, density }: Ctx): string {
  const rows = Math.round(3 + rnd() * 3 * density * 1.6);
  const gap = ART_HEIGHT / (rows + 1);
  const parts: string[] = [];
  for (let r = 0; r < rows; r++) {
    const y = gap * (r + 1);
    let x = 10 + rnd() * 12;
    // A ragged right edge, because a page of writing has one and a bar chart
    // does not.
    const until = ART_WIDTH - 14 - rnd() * 30;
    while (x < until) {
      const w = 4 + rnd() * 11;
      const tone = rnd();
      const colour = tone > 0.86 ? accent : tone > 0.42 ? base : shade;
      const kind = rnd();
      if (kind < 0.6) {
        parts.push(
          `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${y.toFixed(1)}" ` +
            `stroke="${colour}" stroke-width="${(stroke * 1.6).toFixed(2)}" stroke-linecap="round" ` +
            `opacity="${(0.5 + rnd() * 0.4).toFixed(2)}"/>`
        );
      } else if (kind < 0.86) {
        // A hook: the mark that reads as a letter rather than a dash.
        parts.push(
          `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q${(w / 2).toFixed(1)} ${(-3 - rnd() * 4).toFixed(1)} ${w.toFixed(1)} 0" ` +
            `fill="none" stroke="${colour}" stroke-width="${(stroke * 1.4).toFixed(2)}" stroke-linecap="round" ` +
            `opacity="${(0.5 + rnd() * 0.4).toFixed(2)}"/>`
        );
      } else {
        parts.push(
          `<circle cx="${(x + w / 2).toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.2 + rnd() * 1.2).toFixed(1)}" ` +
            `fill="${colour}" opacity="0.9"/>`
        );
      }
      x += w + 3 + rnd() * 4;
    }
  }
  return parts.join('');
}

function contour({ rnd, base, accent, shade, stroke, density }: Ctx): string {
  const cx = ART_WIDTH * (0.28 + rnd() * 0.44);
  const cy = ART_HEIGHT * (0.3 + rnd() * 0.4);
  // One outline is a blob; what makes them isolines is that they are all the
  // same blob. So lobes, wobble and squash are drawn once and every ring wears
  // them — only the radius grows.
  const lobes = 2 + Math.floor(rnd() * 3);
  const wobble = 0.14 + rnd() * 0.2;
  const turn = rnd() * Math.PI * 2;
  const squash = 0.5 + rnd() * 0.18;
  const rings = Math.round(4 + rnd() * 4 * density * 1.6);
  const parts: string[] = [];
  let r = 7 + rnd() * 4;
  for (let i = 0; i < rings; i++) {
    const points: string[] = [];
    for (let k = 0; k < 30; k++) {
      const a = (k / 30) * Math.PI * 2;
      const radius = r * (1 + wobble * Math.sin(lobes * a + turn));
      points.push(
        `${(cx + Math.cos(a) * radius).toFixed(1)},${(cy + Math.sin(a) * radius * squash).toFixed(1)}`
      );
    }
    parts.push(
      `<polygon points="${points.join(' ')}" fill="none" ` +
        `stroke="${i % 3 === 2 ? shade : base}" stroke-width="${stroke}" opacity="${(0.7 - i * 0.055).toFixed(2)}"/>`
    );
    r += 7 + rnd() * 6;
  }
  parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.2" fill="${accent}"/>`);
  return parts.join('');
}

/* ────────────────────────  Which picture fits which field  ─────────────── */

type MotifSpec = {
  /** Domains this picture suits. A field may appear under several motifs. */
  domains: readonly string[];
  draw: (ctx: Ctx) => string;
};

/**
 * The correspondence between a field of knowledge and the pictures that can
 * stand for it — the one thing about course art a person maintains by hand.
 *
 * Read as *motif → the fields it suits*, and deliberately many-to-many. A field
 * needs several motifs or every card in its column is the same card; a motif
 * needs several fields or thirty-nine drawings have to be invented and kept
 * apart. Three motifs per field is what the table aims for: enough that a
 * column of forty courses does not repeat itself, few enough that the picture
 * still says something true about the subject.
 *
 * Keyed on the domain id, which is data, and never on the course, of which
 * there are hundreds and which nobody would keep in step. A domain added to
 * `data/domains.yaml` and forgotten here falls back to its continent — so it is
 * never blank — and `tests/motifs.test.ts` names the line that is missing.
 */
const MOTIFS: Record<Motif, MotifSpec> = {
  /*
   * Bodies going round something: shells, orbits, a system with a centre.
   */
  orbits: {
    domains: [
      'physics',
      'astronomy',
      'chemistry', // electron shells — the same picture, one scale down
      'biochemistry',
      'quantum-chemistry',
      'psychology',
      'cognitive-science',
      'philosophy', // a fixed centre and everything circling it
      'history-of-science',
    ],
    draw: orbits,
  },

  /* Ruled ground: coordinates, tables, cells that are either filled or not. */
  grid: {
    domains: [
      'math',
      'logic', // truth tables
      'probability',
      'cs',
      'engineering',
      'bioinformatics',
      'machine-learning',
      'economics',
      'management',
      'human-geography',
      'econometrics',
      'film-studies', // frames on a strip
      'computational-linguistics',
    ],
    draw: grid,
  },

  /* Layers read from the side — the section, and time in it. */
  strata: {
    domains: [
      'earth-science',
      'anthropology',
      'law', // precedent on precedent
      'history',
      'archaeology',
      'classics',
      'history-of-science',
    ],
    draw: strata,
  },

  /* A scatter: many small facts, and a shape only in the aggregate. */
  noise: {
    domains: [
      'probability',
      'astronomy', // a star field
      'biology',
      'medicine',
      'machine-learning',
      'sociology',
      'psychology',
      'econometrics',
      'cognitive-science',
      'film-studies',
    ],
    draw: noise,
  },

  /* Nodes and the edges between them: structure that is nothing but relations. */
  lattice: {
    domains: [
      'math',
      'logic',
      'cs',
      'chemistry',
      'engineering',
      'biochemistry',
      'bioinformatics',
      'quantum-chemistry',
      'machine-learning',
      'sociology', // the other kind of network, made of people
      'cognitive-science',
      'linguistics',
      'musicology',
      'computational-linguistics',
    ],
    draw: lattice,
  },

  /* Waves laid over one another: periods, signals, spectra. */
  wave: {
    domains: [
      'physics',
      'astronomy',
      'medicine',
      'engineering',
      'quantum-chemistry',
      'economics', // cycles
      'econometrics',
      'musicology',
      'film-studies',
    ],
    draw: wave,
  },

  /* Two strands and the rungs between them: the fields that read sequences. */
  helix: {
    domains: ['chemistry', 'biology', 'medicine', 'biochemistry', 'bioinformatics', 'bioethics'],
    draw: helix,
  },

  /* Arches: what was built, and the fields that study what was built. */
  arcs: {
    domains: [
      'political-science', // an institution is a vault that has to hold
      'philosophy',
      'history',
      'literature',
      'art-history',
      'religion',
      'archaeology',
      'classics',
      'bioethics',
    ],
    draw: arcs,
  },

  /* Branching: one thing splitting into cases, species, clauses, consequences. */
  branch: {
    domains: [
      'math',
      'logic',
      'cs',
      'biology',
      'law',
      'management',
      'education',
      'linguistics',
      'history-of-science',
    ],
    draw: branch,
  },

  /* Streamlines with a direction: movement, exchange, transport. */
  flow: {
    domains: [
      'physics',
      'earth-science',
      'economics',
      'political-science',
      'management',
      'human-geography',
    ],
    draw: flow,
  },

  /* Warp and weft: what is made of many threads and falls apart without them. */
  weave: {
    domains: [
      'sociology',
      'political-science',
      'anthropology',
      'education',
      'literature',
      'art-history',
      'religion',
    ],
    draw: weave,
  },

  /* Rows of marks: the fields whose material is a text. */
  glyphs: {
    domains: [
      'anthropology',
      'law',
      'education',
      'philosophy',
      'history',
      'linguistics',
      'literature',
      'musicology', // a score is writing too
      'religion',
      'classics',
      'computational-linguistics',
    ],
    draw: glyphs,
  },

  /* Isolines: a surface described by where it is level. */
  contour: {
    domains: [
      'math',
      'probability',
      'earth-science',
      'psychology',
      'human-geography',
      'art-history',
      'archaeology',
      'bioethics',
    ],
    draw: contour,
  },
};

/**
 * The order motifs are picked in. Written out rather than read off `MOTIFS`,
 * because the seed indexes into it: a key reordered in the table above would
 * otherwise redraw half the catalogue as a side effect.
 */
const MOTIF_ORDER: readonly Motif[] = [
  'orbits',
  'grid',
  'strata',
  'noise',
  'lattice',
  'wave',
  'helix',
  'arcs',
  'branch',
  'flow',
  'weave',
  'glyphs',
  'contour',
];

/**
 * What a field gets when `MOTIFS` has not caught up with `data/domains.yaml`.
 *
 * Three motifs of the right temper rather than the whole set, so a field nobody
 * has written a line for still looks like it belongs on its continent: the
 * formal one measures and connects, the social one counts and moves, the
 * humanities read and build.
 */
const MOTIFS_BY_CONTINENT: Record<Continent, readonly Motif[]> = {
  formal: ['grid', 'lattice', 'orbits'],
  social: ['grid', 'noise', 'flow'],
  humanities: ['glyphs', 'arcs', 'weave'],
};

/** Every motif a field may be drawn with, in the order the seed indexes them. */
export function motifsFor(domainId?: string, continent?: Continent): readonly Motif[] {
  const fitted = domainId
    ? MOTIF_ORDER.filter((motif) => MOTIFS[motif].domains.includes(domainId))
    : [];
  if (fitted.length > 0) return fitted;
  return (continent && MOTIFS_BY_CONTINENT[continent]) || MOTIF_ORDER;
}

/** Every field the table above knows — what `tests/motifs.test.ts` checks. */
export function motifDomains(): string[] {
  return [...new Set(MOTIF_ORDER.flatMap((motif) => MOTIFS[motif].domains))];
}

/* ─────────────────────────────────  Public  ────────────────────────────── */

export type Artwork = { viewBox: string; inner: string; motif: Motif };

export function courseArt(
  courseId: string,
  domain: ArtDomain,
  config: VisualConfig = DEFAULT_VISUAL
): Artwork {
  const seed = hashString(`${config.seedSalt}:${courseId}`);
  const rnd = mulberry32(seed);

  const hue =
    config.palette === 'mono'
      ? '#8AA0C0'
      : config.palette === 'custom'
        ? (config.customColor ?? domain.color)
        : domain.color;

  // The field says which pictures are allowed; the course says which of them it
  // gets. Both halves matter — see the note at the top of the file.
  const fitting = motifsFor(domain.id, domain.continent);
  const motif: Motif =
    config.motif === 'auto' ? fitting[seed % fitting.length] : config.motif;

  /*
   * The palette in `domains.yaml` is chosen against the dark canvas: pale,
   * bright hues laid as glowing marks over a darkened slab of their own colour.
   * Put that slab on a white card and it turns into grey mush with the marks
   * barely on it — the very thing lightness was supposed to buy.
   *
   * So the light scheme inverts the direction rather than introducing a second
   * palette to keep in sync: the slab becomes a pale wash of the hue and every
   * mark is deepened until it reads against it.
   */
  const pale = config.scheme === 'light';

  const ctx: Ctx = {
    rnd,
    base: pale ? shift(hue, 0, 0.1, -0.22) : hue,
    accent: shift(hue, 6, pale ? 0.16 : 0.05, pale ? -0.14 : 0.14),
    // Saturation has to rise with every step down in lightness, or the darkest
    // of the three lands on grey and the card looks like a fault rather than a
    // picture — which is exactly how the dark-canvas values read on white.
    shade: shift(hue, -8, pale ? 0.2 : -0.05, pale ? -0.26 : -0.18),
    stroke: config.strokeWidth,
    density: config.density,
  };

  const backdrop = pale
    ? `<rect width="${ART_WIDTH}" height="${ART_HEIGHT}" fill="${shift(hue, 0, -0.05, 0.3)}" opacity="0.55"/>`
    : `<rect width="${ART_WIDTH}" height="${ART_HEIGHT}" fill="${shift(hue, 0, -0.45, -0.42)}" opacity="0.55"/>`;

  return {
    viewBox: `0 0 ${ART_WIDTH} ${ART_HEIGHT}`,
    inner: backdrop + MOTIFS[motif].draw(ctx),
    motif,
  };
}

/** Full standalone document — what `07-images.ts` writes to disk. */
export function courseArtSvg(
  courseId: string,
  domain: ArtDomain,
  config: VisualConfig = DEFAULT_VISUAL
): string {
  const art = courseArt(courseId, domain, config);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${art.viewBox}" ` +
    `width="${ART_WIDTH}" height="${ART_HEIGHT}" role="img" aria-label="${courseId}">` +
    art.inner +
    `</svg>`
  );
}
