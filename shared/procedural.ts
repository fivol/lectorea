/**
 * Deterministic procedural artwork for course cards.
 *
 * The same id always yields the same picture, so images are stable between
 * builds and need not be stored in git. 500+ courses through an image API
 * would be money on every run, a style that drifts apart, and no cheap way to
 * regenerate everything when the design changes.
 *
 * Lives in `shared/` because two consumers need byte-identical output:
 * `07-images.ts`, which writes files, and the frontend, which inlines the same
 * markup instead of firing 500 requests while the graph is scrolled.
 */

export type Motif = 'orbits' | 'grid' | 'strata' | 'noise';

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

const MOTIFS: Motif[] = ['orbits', 'grid', 'strata', 'noise'];

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

const RENDERERS: Record<Motif, (ctx: Ctx) => string> = { orbits, grid, strata, noise };

/* ─────────────────────────────────  Public  ────────────────────────────── */

export type Artwork = { viewBox: string; inner: string; motif: Motif };

export function courseArt(
  id: string,
  domainColor: string,
  config: VisualConfig = DEFAULT_VISUAL
): Artwork {
  const seed = hashString(`${config.seedSalt}:${id}`);
  const rnd = mulberry32(seed);

  const hue =
    config.palette === 'mono'
      ? '#8AA0C0'
      : config.palette === 'custom'
        ? (config.customColor ?? domainColor)
        : domainColor;

  const motif: Motif =
    config.motif === 'auto' ? MOTIFS[seed % MOTIFS.length] : config.motif;

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
    inner: backdrop + RENDERERS[motif](ctx),
    motif,
  };
}

/** Full standalone document — what `07-images.ts` writes to disk. */
export function courseArtSvg(
  id: string,
  domainColor: string,
  config: VisualConfig = DEFAULT_VISUAL
): string {
  const art = courseArt(id, domainColor, config);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${art.viewBox}" ` +
    `width="${ART_WIDTH}" height="${ART_HEIGHT}" role="img" aria-label="${id}">` +
    art.inner +
    `</svg>`
  );
}
