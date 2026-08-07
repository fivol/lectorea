/**
 * Generates the map: continents sized by their content, territories that
 * partition them in the proportions the course counts ask for, and borders that
 * look drawn rather than computed.
 *
 * Runs unchanged in Node (the build) and in the browser (the sandbox), so it
 * imports nothing but a type.
 *
 * Four ideas carry it:
 *
 *  1. **Every cell is assigned, none is grown.** Territories come out of a power
 *     diagram — a cell goes to whoever minimises `distance² − weight` — and the
 *     weights are solved until each territory is the size it is due. Growing
 *     territories outwards from a seed, the obvious alternative, cannot work:
 *     under any fair growth rule a large territory expands faster in absolute
 *     terms than a small neighbour and simply surrounds it, sealing it off at a
 *     fraction of its share.
 *
 *  2. **Shape comes from the metric, not from post-processing.** A plain power
 *     diagram makes convex blobs. Measuring distance through a per-territory
 *     ellipse makes them long, wide or tall; measuring it in a warped copy of
 *     the plane makes them bend. Both happen before the cells are assigned, so
 *     the partition stays exact.
 *
 *  3. **Borders are one shared graph.** Every border vertex exists once and is
 *     smoothed once, so two neighbours cannot disagree about where their
 *     border is. Smoothing each polygon separately — the obvious alternative —
 *     opens a hairline gap along every border on the map.
 *
 *  4. **Nothing is random at runtime.** A seed produces a map; the same seed
 *     always produces the same map. Variants are seeds, not rolls of a die.
 */

import type { Continent, Domain } from './schema.js';

const SQRT3 = Math.sqrt(3);
const TAU = Math.PI * 2;

/* ────────────────────────────────  Config  ─────────────────────────────── */

export type ContinentCharacter = {
  /** width / height of the landmass before its coastline is wobbled. */
  aspect: number;
  /** Vertical offset as a share of canvas height, to break the straight row. */
  drift: number;
};

export type MapConfig = {
  width: number;
  height: number;

  /** Sampling resolution. Smaller = truer areas and finer coast, slower. */
  hexR: number;
  /** Share of the canvas that is land. */
  landFraction: number;
  /** Ocean between continents, in px, before the row is scaled to fit. */
  strait: number;

  /** How irregular a coastline is: amplitude of the silhouette's harmonics. */
  coastComplexity: number;
  character: Record<Continent, ContinentCharacter>;

  /** 0 = every territory round; 1 = strongly elongated, each its own way. */
  anisotropy: number;
  /** Amplitude of the coordinate warp, in px. Bends whole regions coherently. */
  warpAmount: number;
  /** Wavelength of that warp, in px. Large = broad sweeps, small = fussy. */
  warpScale: number;

  /** Extra points inserted along each border before smoothing. */
  subdivisions: number;
  /** Laplacian fairing passes over the border graph. */
  smoothIterations: number;
  /** How far a vertex travels towards its neighbours each pass, 0…1. */
  smoothStrength: number;
  /** Wobble applied before smoothing, in px. Coast is allowed more. */
  coastNoise: number;
  inlandNoise: number;

  /** Weight-solver passes. Below ~40 the smallest territories stay short. */
  solverPasses: number;
  /** Damping of the weight step, 0…1. High oscillates, low crawls. */
  solverRate: number;
  /** Layout attempts; the best-scoring one is kept. */
  restarts: number;
  seed: number;
};

export const defaultConfig: MapConfig = {
  width: 1680,
  height: 980,
  hexR: 5,
  landFraction: 0.5,
  strait: 74,
  coastComplexity: 0.55,
  character: {
    formal: { aspect: 1.15, drift: 0.0 },
    social: { aspect: 0.4, drift: 0.06 },
    humanities: { aspect: 0.78, drift: -0.03 },
  },
  anisotropy: 0.55,
  warpAmount: 34,
  warpScale: 300,
  subdivisions: 1,
  smoothIterations: 14,
  smoothStrength: 0.55,
  coastNoise: 3.4,
  inlandNoise: 1.6,
  solverPasses: 55,
  solverRate: 0.45,
  restarts: 4,
  seed: 7,
};

/* ──────────────────────────────  Determinism  ──────────────────────────── */

/** mulberry32 — small, fast, identical everywhere. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ───────────────────────────────  Geometry  ────────────────────────────── */

export type Point = { x: number; y: number };

const DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

const cellKey = (q: number, r: number): number => (q + 4096) * 16384 + (r + 4096);

/* ───────────────────────────  The coordinate warp  ─────────────────────── */

/**
 * A smooth displacement of the plane. Territories are decided in warped
 * coordinates and drawn in real ones, so a straight border comes out curved and
 * a round territory comes out kidney-shaped — coherently across the whole
 * continent, because neighbours are bent by the same field.
 *
 * Sines rather than value noise: three of them are enough at this scale, they
 * need no tables, and they are exactly reproducible in any language.
 */
type Warp = (x: number, y: number) => Point;

function makeWarp(config: MapConfig, random: () => number): Warp {
  const scale = Math.max(40, config.warpScale);
  const amount = config.warpAmount;
  const waves = [1, 1.7, 2.9].map((frequency) => ({
    frequency,
    phaseX: random() * TAU,
    phaseY: random() * TAU,
    weight: 1 / frequency,
  }));
  const norm = waves.reduce((sum, w) => sum + w.weight, 0) || 1;

  return (x, y) => {
    let dx = 0;
    let dy = 0;
    for (const w of waves) {
      dx += w.weight * Math.sin((y / scale) * w.frequency + w.phaseX);
      dy += w.weight * Math.sin((x / scale) * w.frequency + w.phaseY);
    }
    return { x: x + (amount * dx) / norm, y: y + (amount * dy) / norm };
  };
}

/* ───────────────────────────  Continent silhouettes  ───────────────────── */

export type Silhouette = {
  continent: Continent;
  centre: Point;
  aspect: number;
  radius: (angle: number) => number;
  rx: number;
  ry: number;
};

/**
 * A continent is an ellipse of the required area with its radius modulated by a
 * few low harmonics. Low frequencies only — the coastline's fine detail is
 * added later by the border smoother, and doing it in both places reads as
 * noise rather than as a coast.
 */
function silhouetteFor(
  aspect: number,
  area: number,
  complexity: number,
  random: () => number
): { radius: (angle: number) => number; rx: number; ry: number } {
  const waves = [2, 3, 5].map((frequency) => ({
    frequency,
    amplitude: (complexity * (0.06 + random() * 0.1)) / Math.sqrt(frequency),
    phase: random() * TAU,
  }));

  const shape = (angle: number): number =>
    1 + waves.reduce((sum, w) => sum + w.amplitude * Math.sin(w.frequency * angle + w.phase), 0);

  // The wobble changes the enclosed area, so measure and rescale instead of
  // trusting the ellipse formula — otherwise continents drift off their share.
  const steps = 720;
  let unitArea = 0;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU;
    const a1 = ((i + 1) / steps) * TAU;
    const p0 = { x: shape(a0) * Math.cos(a0) * Math.sqrt(aspect), y: (shape(a0) * Math.sin(a0)) / Math.sqrt(aspect) };
    const p1 = { x: shape(a1) * Math.cos(a1) * Math.sqrt(aspect), y: (shape(a1) * Math.sin(a1)) / Math.sqrt(aspect) };
    unitArea += p0.x * p1.y - p1.x * p0.y;
    maxX = Math.max(maxX, Math.abs(p0.x));
    maxY = Math.max(maxY, Math.abs(p0.y));
  }
  unitArea = Math.abs(unitArea) / 2;

  const scale = Math.sqrt(area / unitArea);
  return { radius: (angle) => shape(angle) * scale, rx: maxX * scale, ry: maxY * scale };
}

function inside(s: Silhouette, x: number, y: number): boolean {
  const dx = (x - s.centre.x) / Math.sqrt(s.aspect);
  const dy = (y - s.centre.y) * Math.sqrt(s.aspect);
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return true;
  return distance <= s.radius(Math.atan2(dy, dx));
}

/**
 * Places the continents in a row, sized by their share of the courses, then
 * scales the arrangement to the canvas. Scaling once at the end keeps the
 * relative areas exact; clamping each continent on its own would not.
 */
function layoutContinents(
  domains: Domain[],
  counts: Map<string, number>,
  config: MapConfig,
  random: () => number
): Silhouette[] {
  const order: Continent[] = ['formal', 'social', 'humanities'];
  const present = order.filter((c) => domains.some((d) => d.continent === c));

  const weight = new Map<Continent, number>(
    present.map((c) => [
      c,
      domains
        .filter((d) => d.continent === c)
        .reduce((sum, d) => sum + Math.max(1, counts.get(d.id) ?? 0), 0),
    ])
  );
  const total = [...weight.values()].reduce((a, b) => a + b, 0) || 1;
  const landArea = config.width * config.height * config.landFraction;

  const shapes = present.map((continent) => {
    const character = config.character[continent];
    const area = (landArea * weight.get(continent)!) / total;
    return {
      continent,
      aspect: character.aspect,
      ...silhouetteFor(character.aspect, area, config.coastComplexity, random),
    };
  });

  const spanX = shapes.reduce((sum, s) => sum + s.rx * 2, 0) + config.strait * (shapes.length - 1);
  const spanY = Math.max(...shapes.map((s) => s.ry * 2));
  const margin = 30;
  const scale = Math.min((config.width - margin * 2) / spanX, (config.height - margin * 2) / spanY);

  const placed: Silhouette[] = [];
  let cursor = (config.width - spanX * scale) / 2;
  for (const shape of shapes) {
    const rx = shape.rx * scale;
    const ry = shape.ry * scale;
    placed.push({
      continent: shape.continent,
      aspect: shape.aspect,
      centre: {
        x: cursor + rx,
        y: config.height / 2 + config.height * config.character[shape.continent].drift,
      },
      radius: (angle) => shape.radius(angle) * scale,
      rx,
      ry,
    });
    cursor += rx * 2 + config.strait * scale;
  }
  return placed;
}

/* ──────────────────────────────  The hex field  ────────────────────────── */

type Cell = {
  q: number;
  r: number;
  x: number;
  y: number;
  /** Position in warped space — what the partition actually measures. */
  wx: number;
  wy: number;
  continent: Continent;
};

function buildField(silhouettes: Silhouette[], config: MapConfig, warp: Warp): Cell[] {
  const { hexR } = config;
  const cells: Cell[] = [];
  const rMax = Math.ceil(config.height / (hexR * 1.5)) + 2;

  for (let r = -2; r <= rMax; r++) {
    const qMin = Math.floor(-r / 2) - 2;
    const qMax = qMin + Math.ceil(config.width / (hexR * SQRT3)) + 4;
    for (let q = qMin; q <= qMax; q++) {
      const x = hexR * SQRT3 * (q + r / 2);
      const y = hexR * 1.5 * r;
      const home = silhouettes.find((s) => inside(s, x, y));
      if (!home) continue;
      const w = warp(x, y);
      cells.push({ q, r, x, y, wx: w.x, wy: w.y, continent: home.continent });
    }
  }
  return cells;
}

/* ─────────────────────────  Per-territory shape  ───────────────────────── */

/**
 * Each territory measures distance through its own ellipse, which is what makes
 * one country long and thin and the next one squat. Derived from the domain id,
 * so it is stable across builds, and from the seed, so a new variant reshuffles
 * every shape at once without touching the proportions.
 */
type Metric = { cos: number; sin: number; e: number };

function metricsFor(domains: Domain[], config: MapConfig): Map<string, Metric> {
  const metrics = new Map<string, Metric>();
  // 1 → circles; 2.1 at full strength, i.e. a territory up to twice as long as
  // it is wide. Beyond that the weight solver starts fighting the metric and
  // territories reach around their neighbours to find room.
  const range = 1 + config.anisotropy * 1.1;

  for (const domain of domains) {
    const local = rng(hash(`${domain.id}#${config.seed}`));
    const angle = local() * Math.PI;
    // Squashed and stretched in equal measure, so the average territory keeps
    // its area budget and only its proportions change.
    const e = Math.exp((local() * 2 - 1) * Math.log(range));
    metrics.set(domain.id, { cos: Math.cos(angle), sin: Math.sin(angle), e });
  }
  return metrics;
}

/* ────────────────────────────  The partition  ──────────────────────────── */

type Growth = { owner: Map<number, string>; sizes: Map<string, number> };

function partition(
  field: Cell[],
  domains: Domain[],
  targets: Map<string, number>,
  anchors: Map<string, Point>,
  metrics: Map<string, Metric>,
  hexArea: number,
  passes: number,
  solverRate: number
): Growth {
  const byContinent = new Map<Continent, Domain[]>();
  for (const domain of domains) {
    byContinent.set(domain.continent, [...(byContinent.get(domain.continent) ?? []), domain]);
  }
  const cellsByContinent = new Map<Continent, Cell[]>();
  for (const cell of field) {
    cellsByContinent.set(cell.continent, [...(cellsByContinent.get(cell.continent) ?? []), cell]);
  }

  const weights = new Map<string, number>(domains.map((d) => [d.id, 0]));
  const owner = new Map<number, string>();
  const sizes = new Map<string, number>();

  for (let pass = 0; pass < passes; pass++) {
    owner.clear();
    sizes.clear();
    for (const domain of domains) sizes.set(domain.id, 0);

    for (const [continent, cells] of cellsByContinent) {
      const here = byContinent.get(continent) ?? [];
      if (!here.length) continue;
      for (const cell of cells) {
        let best: string | null = null;
        let bestCost = Infinity;
        for (const domain of here) {
          const a = anchors.get(domain.id)!;
          const m = metrics.get(domain.id)!;
          const dx = cell.wx - a.x;
          const dy = cell.wy - a.y;
          const u = (dx * m.cos + dy * m.sin) / m.e;
          const v = (-dx * m.sin + dy * m.cos) * m.e;
          const cost = u * u + v * v - (weights.get(domain.id) ?? 0);
          if (cost < bestCost) {
            bestCost = cost;
            best = domain.id;
          }
        }
        if (!best) continue;
        owner.set(cellKey(cell.q, cell.r), best);
        sizes.set(best, (sizes.get(best) ?? 0) + 1);
      }
    }

    if (pass === passes - 1) break;

    // Weights are in units of distance², so a shortfall of n cells converts to
    // the radius² that n cells of area would need: Δ(r²) = ΔA / π.
    //
    // A starved territory's step is already about its own radius², so the rate
    // is a damping factor: too high and the smallest territories oscillate
    // between nothing and twice their due, too low and they never arrive.
    // It opens wide for the first passes to place everyone, then settles.
    const rate = pass < 3 ? 0.85 : solverRate;
    for (const domain of domains) {
      const target = Math.max(1, targets.get(domain.id) ?? 1);
      const deficit = (target - (sizes.get(domain.id) ?? 0)) * hexArea;
      weights.set(domain.id, (weights.get(domain.id) ?? 0) + (rate * deficit) / Math.PI);
    }

    // Lloyd: an anchor follows its territory, which is what keeps shapes
    // compact. A territory that lost all its ground keeps its anchor, so a
    // rising weight can bring it back.
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const cell of field) {
      const id = owner.get(cellKey(cell.q, cell.r));
      if (!id) continue;
      const entry = sums.get(id) ?? { x: 0, y: 0, n: 0 };
      entry.x += cell.wx;
      entry.y += cell.wy;
      entry.n += 1;
      sums.set(id, entry);
    }
    for (const [id, entry] of sums) {
      const a = anchors.get(id)!;
      a.x += (entry.x / entry.n - a.x) * 0.6;
      a.y += (entry.y / entry.n - a.y) * 0.6;
    }
  }

  repairIslands(field, owner, sizes);
  return { owner, sizes };
}

/**
 * A power cell is connected, but clipping it to a wobbled coastline can leave a
 * territory in two pieces. The stray piece goes to whichever neighbour wraps it
 * most: one detached fragment reads as a mistake, and the areas move by a few
 * cells at most.
 */
function repairIslands(field: Cell[], owner: Map<number, string>, sizes: Map<string, number>): void {
  const cellAt = new Map<number, Cell>();
  for (const cell of field) cellAt.set(cellKey(cell.q, cell.r), cell);

  const seen = new Set<number>();
  const componentsOf = new Map<string, number[][]>();

  for (const cell of field) {
    const key = cellKey(cell.q, cell.r);
    if (seen.has(key)) continue;
    const id = owner.get(key);
    if (!id) continue;

    const component: number[] = [];
    const queue = [key];
    seen.add(key);
    while (queue.length) {
      const current = queue.pop()!;
      component.push(current);
      const here = cellAt.get(current)!;
      for (const dir of DIRECTIONS) {
        const nk = cellKey(here.q + dir.q, here.r + dir.r);
        if (seen.has(nk) || owner.get(nk) !== id) continue;
        seen.add(nk);
        queue.push(nk);
      }
    }
    componentsOf.set(id, [...(componentsOf.get(id) ?? []), component]);
  }

  for (const [id, components] of componentsOf) {
    if (components.length < 2) continue;
    components.sort((a, b) => b.length - a.length);
    for (const stray of components.slice(1)) {
      const votes = new Map<string, number>();
      for (const key of stray) {
        const cell = cellAt.get(key)!;
        for (const dir of DIRECTIONS) {
          const other = owner.get(cellKey(cell.q + dir.q, cell.r + dir.r));
          if (!other || other === id) continue;
          votes.set(other, (votes.get(other) ?? 0) + 1);
        }
      }
      let winner: string | null = null;
      let best = 0;
      for (const [other, count] of votes) {
        if (count > best) {
          best = count;
          winner = other;
        }
      }
      if (!winner) continue;
      for (const key of stray) owner.set(key, winner);
      sizes.set(id, (sizes.get(id) ?? 0) - stray.length);
      sizes.set(winner, (sizes.get(winner) ?? 0) + stray.length);
    }
  }
}

/* ─────────────────────────────  Seed placement  ─────────────────────────── */

/**
 * A starting arrangement, not a final one — the solver moves anchors itself.
 * All it has to do is put related domains near each other and keep everyone
 * roughly a territory's width apart, so the solver starts near a good answer
 * instead of finding whichever one is closest to a bad guess.
 */
function computeAnchors(
  domains: Domain[],
  targets: Map<string, number>,
  silhouettes: Silhouette[],
  hexArea: number,
  warp: Warp,
  random: () => number
): Map<string, Point> {
  const anchors = new Map<string, Point>();
  const byId = new Map(domains.map((d) => [d.id, d]));
  const home = new Map(silhouettes.map((s) => [s.continent, s]));
  const radiusOf = (id: string) => Math.sqrt(((targets.get(id) ?? 1) * hexArea) / Math.PI);

  for (const [continent, s] of home) {
    const list = domains.filter((d) => d.continent === continent);
    const spin = random() * TAU;
    list.forEach((domain, index) => {
      // Golden-angle spiral: an even spread that favours no direction, so
      // restarts differ only by the spin.
      const t = (index + 0.5) / list.length;
      const angle = spin + index * 2.399963;
      const p = warp(
        s.centre.x + Math.cos(angle) * s.rx * 0.6 * Math.sqrt(t),
        s.centre.y + Math.sin(angle) * s.ry * 0.6 * Math.sqrt(t)
      );
      anchors.set(domain.id, p);
    });
  }

  for (let pass = 0; pass < 70; pass++) {
    const cooling = 1 - pass / 140;

    for (const domain of domains) {
      const own = anchors.get(domain.id)!;
      const s = home.get(domain.continent)!;
      const sources = domain.dependsOn.filter((id) => byId.get(id)?.continent === domain.continent);
      if (sources.length) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const source of sources) {
          const point = anchors.get(source);
          if (!point) continue;
          sx += point.x;
          sy += point.y;
          n += 1;
        }
        if (n) {
          const pull = (domain.bridge ? 0.15 : 0.07) * cooling;
          own.x += (sx / n - own.x) * pull;
          own.y += (sy / n - own.y) * pull;
        }
      }
      const centre = warp(s.centre.x, s.centre.y);
      own.x += (centre.x - own.x) * 0.03;
      own.y += (centre.y - own.y) * 0.03;
    }

    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        if (domains[i].continent !== domains[j].continent) continue;
        const a = anchors.get(domains[i].id)!;
        const b = anchors.get(domains[j].id)!;
        const wanted = (radiusOf(domains[i].id) + radiusOf(domains[j].id)) * 0.85;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d > wanted) continue;
        if (d < 1e-6) {
          dx = i % 2 ? 0.7 : -0.7;
          dy = j % 2 ? 0.7 : -0.7;
          d = Math.hypot(dx, dy);
        }
        const push = ((wanted - d) / d) * 0.5;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
  }

  return anchors;
}

/* ──────────────────────────  The border graph  ─────────────────────────── */

/**
 * Every border on the map, as one planar graph.
 *
 * A vertex is stored once and smoothed once, so two territories cannot end up
 * with different ideas of where their shared border runs. An arc is the run of
 * border between two junctions, and it belongs to exactly two sides — that is
 * what a territory's outline is chained from.
 */
type Arc = { vertices: number[]; left: string | null; right: string | null };

type BorderGraph = {
  xs: Float64Array;
  ys: Float64Array;
  arcs: Arc[];
  /** Neighbours of each vertex, for the fairing pass. */
  neighbours: number[][];
  isJunction: Uint8Array;
  isCoast: Uint8Array;
};

function cornerOf(cell: Cell, index: number, hexR: number): Point {
  const angle = ((60 * index - 30) * Math.PI) / 180;
  return { x: cell.x + hexR * Math.cos(angle), y: cell.y + hexR * Math.sin(angle) };
}

function buildBorderGraph(field: Cell[], owner: Map<number, string>, config: MapConfig): BorderGraph {
  const cellAt = new Map<number, Cell>();
  for (const cell of field) cellAt.set(cellKey(cell.q, cell.r), cell);

  // Intern the hex corners so a point shared by three cells is one vertex.
  const xs: number[] = [];
  const ys: number[] = [];
  const index = new Map<string, number>();
  const intern = (p: Point): number => {
    const id = `${Math.round(p.x * 8)},${Math.round(p.y * 8)}`;
    let at = index.get(id);
    if (at === undefined) {
      at = xs.length;
      xs.push(p.x);
      ys.push(p.y);
      index.set(id, at);
    }
    return at;
  };

  type Segment = { a: number; b: number; left: string | null; right: string | null };
  const segments: Segment[] = [];

  for (const cell of field) {
    const mine = owner.get(cellKey(cell.q, cell.r)) ?? null;
    if (!mine) continue;
    for (let d = 0; d < 6; d++) {
      const theirs = owner.get(cellKey(cell.q + DIRECTIONS[d].q, cell.r + DIRECTIONS[d].r)) ?? null;
      if (theirs === mine) continue;
      // Record each border once: the side with the smaller id keeps it.
      if (theirs !== null && theirs < mine) continue;
      segments.push({
        a: intern(cornerOf(cell, d, config.hexR)),
        b: intern(cornerOf(cell, (d + 1) % 6, config.hexR)),
        left: mine,
        right: theirs,
      });
    }
  }

  const incident: number[][] = Array.from({ length: xs.length }, () => []);
  segments.forEach((segment, at) => {
    incident[segment.a].push(at);
    incident[segment.b].push(at);
  });

  const pairOf = (s: Segment) => `${s.left ?? '~'}|${s.right ?? '~'}`;
  const isJunction = new Uint8Array(xs.length);
  for (let v = 0; v < xs.length; v++) {
    const list = incident[v];
    if (!list.length) continue;
    isJunction[v] =
      list.length !== 2 || pairOf(segments[list[0]]) !== pairOf(segments[list[1]]) ? 1 : 0;
  }

  // Chain segments into arcs, junction to junction.
  const used = new Set<number>();
  const arcs: Arc[] = [];

  const walk = (start: number, first: number): void => {
    const segment = segments[first];
    let current = segment.a === start ? segment.b : segment.a;
    const vertices = [start, current];
    used.add(first);
    let at = first;

    for (let guard = 0; guard < 1e6; guard++) {
      if (isJunction[current]) break;
      const next = incident[current].find((i) => i !== at && !used.has(i));
      if (next === undefined) break;
      const seg = segments[next];
      used.add(next);
      current = seg.a === current ? seg.b : seg.a;
      vertices.push(current);
      at = next;
    }
    arcs.push({ vertices, left: segment.left, right: segment.right });
  };

  for (let v = 0; v < xs.length; v++) {
    if (!isJunction[v]) continue;
    for (const at of incident[v]) if (!used.has(at)) walk(v, at);
  }
  segments.forEach((segment, at) => {
    if (!used.has(at)) walk(segment.a, at); // closed loop with no junction
  });

  // Subdivide: fairing needs points to move, and a hex edge is too coarse.
  for (let pass = 0; pass < Math.max(0, config.subdivisions); pass++) {
    for (const arc of arcs) {
      const next: number[] = [arc.vertices[0]];
      for (let i = 0; i < arc.vertices.length - 1; i++) {
        const a = arc.vertices[i];
        const b = arc.vertices[i + 1];
        xs.push((xs[a] + xs[b]) / 2);
        ys.push((ys[a] + ys[b]) / 2);
        next.push(xs.length - 1, b);
      }
      arc.vertices = next;
    }
  }

  // Rebuild adjacency over the subdivided arcs — this is what fairing walks.
  const neighbours: number[][] = Array.from({ length: xs.length }, () => []);
  const isCoast = new Uint8Array(xs.length);
  const junction = new Uint8Array(xs.length);
  for (let v = 0; v < isJunction.length; v++) junction[v] = isJunction[v];

  for (const arc of arcs) {
    const coast = arc.left === null || arc.right === null ? 1 : 0;
    for (let i = 0; i < arc.vertices.length; i++) {
      const v = arc.vertices[i];
      if (coast) isCoast[v] = 1;
      if (i > 0) neighbours[v].push(arc.vertices[i - 1]);
      if (i < arc.vertices.length - 1) neighbours[v].push(arc.vertices[i + 1]);
    }
  }

  return {
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    arcs,
    neighbours,
    isJunction: junction,
    isCoast,
  };
}

/**
 * Wobble, then fair.
 *
 * The wobble is what stops a border from looking like a computed boundary; it
 * is seeded from the vertex position, so it is identical on every build. The
 * fairing is plain Laplacian smoothing over the shared graph — each vertex
 * drifts towards the average of its neighbours. Because the graph is shared, a
 * border is smoothed once and both its owners read the same result, which is
 * the property that makes gaps between territories impossible.
 *
 * Junctions move at a fraction of the rate. Left free they drift and the map
 * loses its corners; pinned outright they stay as visible kinks.
 */
function fairBorders(graph: BorderGraph, config: MapConfig): void {
  const { xs, ys, neighbours, isJunction, isCoast } = graph;

  for (let v = 0; v < xs.length; v++) {
    if (!neighbours[v].length) continue;
    const amplitude = isCoast[v] ? config.coastNoise : config.inlandNoise;
    if (amplitude <= 0) continue;
    const local = rng(hash(`${Math.round(xs[v] * 4)}:${Math.round(ys[v] * 4)}:${config.seed}`));
    const angle = local() * TAU;
    const radius = (0.4 + local() * 0.6) * amplitude;
    xs[v] += Math.cos(angle) * radius;
    ys[v] += Math.sin(angle) * radius;
  }

  const nx = new Float64Array(xs.length);
  const ny = new Float64Array(ys.length);

  for (let pass = 0; pass < config.smoothIterations; pass++) {
    for (let v = 0; v < xs.length; v++) {
      const list = neighbours[v];
      if (!list.length) {
        nx[v] = xs[v];
        ny[v] = ys[v];
        continue;
      }
      let sx = 0;
      let sy = 0;
      for (const n of list) {
        sx += xs[n];
        sy += ys[n];
      }
      const strength = config.smoothStrength * (isJunction[v] ? 0.35 : 1);
      nx[v] = xs[v] + (sx / list.length - xs[v]) * strength;
      ny[v] = ys[v] + (sy / list.length - ys[v]) * strength;
    }
    xs.set(nx);
    ys.set(ny);
  }
}

/* ────────────────────────  Outlines and rendering  ─────────────────────── */

/**
 * Ramer–Douglas–Peucker on a closed ring.
 *
 * The open version cannot be pointed at a ring: its baseline runs from the
 * first point to the last, which on a ring is the same point, so every vertex
 * measures zero deviation and the whole outline collapses to nothing. Cutting
 * the ring at its most distant vertex first gives two chains with real
 * baselines, and the two cut points are exactly the ones worth keeping.
 */
function simplifyRing(ring: Point[], tolerance: number): Point[] {
  if (ring.length < 8) return ring;

  let far = 0;
  let farthest = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i].x - ring[0].x) ** 2 + (ring[i].y - ring[0].y) ** 2;
    if (d > farthest) {
      farthest = d;
      far = i;
    }
  }

  const first = simplifyChain(ring.slice(0, far + 1), tolerance);
  const second = simplifyChain(ring.slice(far), tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** Ramer–Douglas–Peucker. Applied per arc, so both owners drop the same points. */
function simplifyChain(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last - first < 2) continue;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let at = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = Math.abs(dy * (points[i].x - a.x) - dx * (points[i].y - a.y)) / length;
      if (distance > worst) {
        worst = distance;
        at = i;
      }
    }
    if (worst <= tolerance || at < 0) continue;
    keep[at] = 1;
    stack.push([first, at], [at, last]);
  }
  return points.filter((_, i) => keep[i]);
}

/** Catmull-Rom through the points, emitted as cubic béziers. */
function toCurve(loop: Point[]): string {
  const n = loop.length;
  if (n < 3) return '';
  const at = (i: number) => loop[((i % n) + n) % n];
  let d = `M${at(0).x.toFixed(1)} ${at(0).y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d +=
      `C${c1.x.toFixed(1)} ${c1.y.toFixed(1)},` +
      `${c2.x.toFixed(1)} ${c2.y.toFixed(1)},` +
      `${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d}Z`;
}

/** Chains a set of arcs into closed loops and renders them as one path. */
function pathFrom(arcs: Arc[], graph: BorderGraph, tolerance: number): string {
  if (!arcs.length) return '';

  const remaining = new Set(arcs.map((_, i) => i));
  const ends = new Map<number, number[]>();
  arcs.forEach((arc, i) => {
    for (const v of [arc.vertices[0], arc.vertices[arc.vertices.length - 1]]) {
      ends.set(v, [...(ends.get(v) ?? []), i]);
    }
  });

  const parts: string[] = [];
  while (remaining.size) {
    const start = remaining.values().next().value as number;
    remaining.delete(start);

    const head = arcs[start].vertices[0];
    let tail = arcs[start].vertices[arcs[start].vertices.length - 1];
    const loop = [...arcs[start].vertices];

    if (head !== tail) {
      for (let guard = 0; guard < 1e5; guard++) {
        const next = (ends.get(tail) ?? []).find((i) => remaining.has(i));
        if (next === undefined) break;
        remaining.delete(next);
        const vertices = arcs[next].vertices;
        const forward = vertices[0] === tail;
        loop.push(...(forward ? vertices : [...vertices].reverse()).slice(1));
        tail = forward ? vertices[vertices.length - 1] : vertices[0];
        if (tail === head) break;
      }
    }

    // The chain comes back with its first vertex repeated at the end; the
    // curve treats the ring as closed and would otherwise double that point.
    if (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();

    const points = simplifyRing(
      loop.map((v) => ({ x: graph.xs[v], y: graph.ys[v] })),
      tolerance
    );
    if (points.length >= 3) parts.push(toCurve(points));
  }
  return parts.join('');
}

/* ──────────────────────────────  Label anchors  ────────────────────────── */

/**
 * Pole of inaccessibility — the centre of the largest circle that fits inside
 * the territory. A centroid lands outside a crescent-shaped region and drops
 * the label on the neighbour's ground; this cannot. The radius that comes with
 * it is what decides the type size and whether an icon fits at all.
 */
function poleOf(
  cells: Cell[],
  owner: Map<number, string>,
  hexR: number
): Map<string, { point: Point; radius: number }> {
  const depth = new Map<number, number>();
  const queue: number[] = [];
  const cellAt = new Map<number, Cell>();
  for (const cell of cells) cellAt.set(cellKey(cell.q, cell.r), cell);

  for (const cell of cells) {
    const key = cellKey(cell.q, cell.r);
    const mine = owner.get(key);
    if (!mine) continue;
    const edge = DIRECTIONS.some(
      (d) => owner.get(cellKey(cell.q + d.q, cell.r + d.r)) !== mine
    );
    if (edge) {
      depth.set(key, 0);
      queue.push(key);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const cell = cellAt.get(key)!;
    const mine = owner.get(key);
    const d = depth.get(key)!;
    for (const dir of DIRECTIONS) {
      const nk = cellKey(cell.q + dir.q, cell.r + dir.r);
      if (depth.has(nk) || owner.get(nk) !== mine) continue;
      depth.set(nk, d + 1);
      queue.push(nk);
    }
  }

  const best = new Map<string, { point: Point; radius: number }>();
  for (const cell of cells) {
    const key = cellKey(cell.q, cell.r);
    const id = owner.get(key);
    if (!id) continue;
    const d = depth.get(key) ?? 0;
    const current = best.get(id);
    const radius = (d + 0.5) * hexR * 1.5;
    if (!current || radius > current.radius) {
      best.set(id, { point: { x: cell.x, y: cell.y }, radius });
    }
  }
  return best;
}

/* ─────────────────────────────────  Scoring  ───────────────────────────── */

function adjacencyOf(field: Cell[], owner: Map<number, string>): Set<string> {
  const pairs = new Set<string>();
  for (const cell of field) {
    const mine = owner.get(cellKey(cell.q, cell.r));
    if (!mine) continue;
    for (const dir of DIRECTIONS) {
      const theirs = owner.get(cellKey(cell.q + dir.q, cell.r + dir.r));
      if (!theirs || theirs === mine) continue;
      pairs.add(mine < theirs ? `${mine}|${theirs}` : `${theirs}|${mine}`);
    }
  }
  return pairs;
}

/**
 * One number per layout, so restarts can be compared. Two things matter and
 * they pull against each other: a territory should be the size its course count
 * asks for, and a domain should touch what it draws from.
 */
function scoreLayout(
  domains: Domain[],
  targets: Map<string, number>,
  growth: Growth,
  adjacency: Set<string>
): { score: number; areaError: number; adjacencyRate: number } {
  let areaError = 0;
  for (const domain of domains) {
    const target = Math.max(1, targets.get(domain.id) ?? 1);
    areaError += Math.abs((growth.sizes.get(domain.id) ?? 0) - target) / target;
  }
  areaError /= domains.length || 1;

  let wanted = 0;
  let realized = 0;
  const byId = new Map(domains.map((d) => [d.id, d]));
  for (const domain of domains) {
    for (const source of domain.dependsOn) {
      if (byId.get(source)?.continent !== domain.continent) continue;
      wanted += 1;
      const pair = domain.id < source ? `${domain.id}|${source}` : `${source}|${domain.id}`;
      if (adjacency.has(pair)) realized += 1;
    }
  }
  const adjacencyRate = wanted ? realized / wanted : 1;

  return { score: areaError * 2 + (1 - adjacencyRate), areaError, adjacencyRate };
}

/* ─────────────────────────────────  Public  ────────────────────────────── */

export type Territory = {
  id: string;
  continent: Continent;
  colour: string;
  bridge: boolean;
  /** Closed, smoothed outline. Shared with the neighbours vertex for vertex. */
  path: string;
  /** Where a label belongs, and how much room it has. */
  label: Point;
  room: number;
  cells: number;
  target: number;
  /** Signed share by which the territory misses its due area. */
  areaError: number;
};

export type MapResult = {
  territories: Territory[];
  coasts: Array<{ continent: Continent; path: string }>;
  /** Straits worth bridging: dependencies that cross from one landmass to another. */
  links: Array<{ from: string; to: string; a: Point; b: Point }>;
  viewBox: string;
  width: number;
  height: number;
  metrics: {
    areaError: number;
    worstAreaError: number;
    adjacencyRate: number;
    cells: number;
    elapsedMs: number;
  };
};

export function generateMap(
  domains: Domain[],
  courseCounts: Map<string, number>,
  overrides: Partial<MapConfig> = {}
): MapResult {
  const started = Date.now();
  const config: MapConfig = {
    ...defaultConfig,
    ...overrides,
    character: { ...defaultConfig.character, ...(overrides.character ?? {}) },
  };
  const hexArea = 1.5 * SQRT3 * config.hexR * config.hexR;

  // The floor is what keeps an empty domain on the map — an untouched outskirt
  // is a task, not a hole — and the multiplier stops the floor from flattening
  // the difference between a large field and a small one.
  const weightOf = (id: string) => 1 + (courseCounts.get(id) ?? 0) * 3;
  const metrics = metricsFor(domains, config);

  let best: {
    growth: Growth;
    field: Cell[];
    silhouettes: Silhouette[];
    targets: Map<string, number>;
    areaError: number;
    adjacencyRate: number;
  } | null = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < Math.max(1, config.restarts); attempt++) {
    const random = rng(config.seed * 7919 + attempt * 104729);
    const warp = makeWarp(config, random);
    const silhouettes = layoutContinents(domains, courseCounts, config, random);
    const field = buildField(silhouettes, config, warp);
    if (!field.length) continue;

    // Targets are absolute cell counts. A continent is partitioned completely,
    // so a domain's due is its share of the cells that actually exist there;
    // computing it from the ideal ellipse leaves every territory chasing a
    // number the ground cannot supply.
    const cellsIn = new Map<Continent, number>();
    for (const cell of field) cellsIn.set(cell.continent, (cellsIn.get(cell.continent) ?? 0) + 1);
    const weightIn = new Map<Continent, number>();
    for (const domain of domains) {
      weightIn.set(domain.continent, (weightIn.get(domain.continent) ?? 0) + weightOf(domain.id));
    }
    const targets = new Map<string, number>(
      domains.map((d) => [
        d.id,
        Math.max(
          1,
          ((cellsIn.get(d.continent) ?? 0) * weightOf(d.id)) / (weightIn.get(d.continent) || 1)
        ),
      ])
    );

    const anchors = computeAnchors(domains, targets, silhouettes, hexArea, warp, random);
    const growth = partition(
      field,
      domains,
      targets,
      anchors,
      metrics,
      hexArea,
      config.solverPasses,
      config.solverRate
    );
    const result = scoreLayout(domains, targets, growth, adjacencyOf(field, growth.owner));

    if (result.score < bestScore) {
      bestScore = result.score;
      best = { growth, field, silhouettes, targets, ...result };
    }
  }

  if (!best) {
    return {
      territories: [],
      coasts: [],
      links: [],
      viewBox: `0 0 ${config.width} ${config.height}`,
      width: config.width,
      height: config.height,
      metrics: { areaError: 1, worstAreaError: 1, adjacencyRate: 0, cells: 0, elapsedMs: 0 },
    };
  }

  const graph = buildBorderGraph(best.field, best.growth.owner, config);
  fairBorders(graph, config);

  const tolerance = config.hexR * 0.12;
  const poles = poleOf(best.field, best.growth.owner, config.hexR);

  const territories: Territory[] = [];
  for (const domain of domains) {
    const mine = graph.arcs.filter((arc) => arc.left === domain.id || arc.right === domain.id);
    if (!mine.length) continue;
    const pole = poles.get(domain.id);
    const target = Math.max(1, best.targets.get(domain.id) ?? 1);
    const cells = best.growth.sizes.get(domain.id) ?? 0;
    territories.push({
      id: domain.id,
      continent: domain.continent,
      colour: domain.color,
      bridge: Boolean(domain.bridge),
      path: pathFrom(mine, graph, tolerance),
      label: pole?.point ?? { x: 0, y: 0 },
      room: pole?.radius ?? 0,
      cells,
      target,
      areaError: (cells - target) / target,
    });
  }

  const coasts = best.silhouettes.map((s) => {
    const ids = new Set(domains.filter((d) => d.continent === s.continent).map((d) => d.id));
    const arcs = graph.arcs.filter(
      (arc) =>
        (arc.left === null && arc.right !== null && ids.has(arc.right)) ||
        (arc.right === null && arc.left !== null && ids.has(arc.left))
    );
    return { continent: s.continent, path: pathFrom(arcs, graph, tolerance) };
  });

  // Dependencies that cross the ocean are where the reference map draws rope
  // bridges. Emitting them as data keeps that a rendering decision.
  const byId = new Map(domains.map((d) => [d.id, d]));
  const anchorOf = new Map(territories.map((t) => [t.id, t.label]));
  const links: MapResult['links'] = [];
  for (const domain of domains) {
    for (const source of domain.dependsOn) {
      const other = byId.get(source);
      if (!other || other.continent === domain.continent) continue;
      const a = anchorOf.get(domain.id);
      const b = anchorOf.get(source);
      if (!a || !b) continue;
      links.push({ from: domain.id, to: source, a, b });
    }
  }

  return {
    territories,
    coasts,
    links,
    viewBox: `0 0 ${config.width} ${config.height}`,
    width: config.width,
    height: config.height,
    metrics: {
      areaError: best.areaError,
      worstAreaError: territories.reduce((worst, t) => Math.max(worst, Math.abs(t.areaError)), 0),
      adjacencyRate: best.adjacencyRate,
      cells: best.field.length,
      elapsedMs: Date.now() - started,
    },
  };
}
