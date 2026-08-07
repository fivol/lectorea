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
import type { Landform } from './domain-graph.js';

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

  /** How far a peninsula's lobe reaches out of its continent. */
  peninsulaReach: number;
  /** Ocean kept between an island and anything else, in px. */
  islandGap: number;
  /** How far an island may drift from the midpoint its links imply. */
  islandScatter: number;

  /**
   * How territories are decided.
   *
   * `power` solves a weighted diagram: exact areas, calm convex shapes.
   * `organic` claims hexes one at a time in a wandering direction: coastlines
   * and borders with real character, areas corrected afterwards.
   */
  mode: 'power' | 'organic';
  /** organic: pull towards the territory's own centre. 0 = tendrils, 1 = discs. */
  roundness: number;
  /** organic: how strongly a territory keeps growing the way it was going. */
  wander: number;
  /** organic: how much terrain noise steers the claim. */
  wildness: number;
  /** organic: size of that noise's features, in px. */
  grain: number;
  /** organic: passes of area correction after growth. */
  rebalancePasses: number;

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
  coastComplexity: 0.7,
  peninsulaReach: 1.1,
  islandGap: 16,
  islandScatter: 90,
  character: {
    formal: { aspect: 1.15, drift: 0.0 },
    social: { aspect: 0.4, drift: 0.06 },
    humanities: { aspect: 0.78, drift: -0.03 },
  },
  mode: 'organic',
  roundness: 0.55,
  wander: 0.5,
  wildness: 0.8,
  grain: 34,
  rebalancePasses: 24,
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

/* ──────────────────────────────  Landmasses  ───────────────────────────── */

/**
 * A piece of land with a coastline of its own: one of the three continents, or
 * an island out in the strait. Territories are partitioned inside a landmass
 * and never across one, which is what keeps the ocean an ocean.
 */
export type Landmass = {
  id: string;
  kind: 'continent' | 'island';
  continent: Continent;
  /** Domains that live here. An island holds exactly one. */
  members: string[];
  centre: Point;
  aspect: number;
  radius: (angle: number) => number;
  rx: number;
  ry: number;
  /** Bearings of the peninsulas, so each one can be seeded inside its own. */
  lobes: Lobe[];
};

/** A peninsula: a bump added to the continent's radius at one bearing. */
type Lobe = { id: string; angle: number; height: number; width: number };

type Shape = {
  radius: (angle: number) => number;
  rx: number;
  ry: number;
  /** True extent around the centre. A lobe makes the outline lopsided, and
   *  laying continents out by half-widths alone walks them off the canvas. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

/**
 * An ellipse of the required area, its radius modulated by a few low harmonics
 * and by one bump per peninsula.
 *
 * Low frequencies only for the harmonics — the coastline's fine detail is added
 * later by the border smoother, and doing it in both places reads as noise
 * rather than as a coast. The bumps are separate and deliberately narrow: that
 * is the difference between a lumpy continent and one with peninsulas.
 *
 * The area is measured numerically and the whole shape rescaled, because both
 * the harmonics and the bumps change it and no formula survives the bumps.
 */
function shapeFor(
  aspect: number,
  area: number,
  complexity: number,
  lobes: Lobe[],
  random: () => number
): Shape {
  const waves = [2, 3, 5].map((frequency) => ({
    frequency,
    amplitude: (complexity * (0.06 + random() * 0.1)) / Math.sqrt(frequency),
    phase: random() * TAU,
  }));

  const shape = (angle: number): number => {
    let r = 1 + waves.reduce((sum, w) => sum + w.amplitude * Math.sin(w.frequency * angle + w.phase), 0);
    for (const lobe of lobes) {
      // Shortest angular distance, so a bump at 350° still reaches 10°.
      let delta = ((angle - lobe.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
      delta /= lobe.width;
      r += lobe.height * Math.exp(-0.5 * delta * delta);
    }
    return Math.max(0.15, r);
  };

  const steps = 1440;
  let unitArea = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU;
    const a1 = ((i + 1) / steps) * TAU;
    const p0 = {
      x: shape(a0) * Math.cos(a0) * Math.sqrt(aspect),
      y: (shape(a0) * Math.sin(a0)) / Math.sqrt(aspect),
    };
    const p1 = {
      x: shape(a1) * Math.cos(a1) * Math.sqrt(aspect),
      y: (shape(a1) * Math.sin(a1)) / Math.sqrt(aspect),
    };
    unitArea += p0.x * p1.y - p1.x * p0.y;
    minX = Math.min(minX, p0.x);
    maxX = Math.max(maxX, p0.x);
    minY = Math.min(minY, p0.y);
    maxY = Math.max(maxY, p0.y);
  }
  unitArea = Math.abs(unitArea) / 2 || 1;

  const scale = Math.sqrt(area / unitArea);
  return {
    radius: (angle) => shape(angle) * scale,
    rx: Math.max(Math.abs(minX), Math.abs(maxX)) * scale,
    ry: Math.max(Math.abs(minY), Math.abs(maxY)) * scale,
    bounds: {
      minX: minX * scale,
      maxX: maxX * scale,
      minY: minY * scale,
      maxY: maxY * scale,
    },
  };
}

function inside(mass: Landmass, x: number, y: number): boolean {
  const dx = (x - mass.centre.x) / Math.sqrt(mass.aspect);
  const dy = (y - mass.centre.y) * Math.sqrt(mass.aspect);
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return true;
  return distance <= mass.radius(Math.atan2(dy, dx));
}

/**
 * Builds the world: three continents in a row, each carrying its mainland and
 * its peninsulas, plus one island per domain the graph says belongs offshore.
 *
 * Area is shared out by course count across everything at once, so an island
 * costs its continent exactly the ground it takes away. The continents are laid
 * out and scaled to the canvas first; islands are then floated into the ocean
 * that is left, because their whole job is to sit in water the continents did
 * not claim.
 */
function layoutWorld(
  domains: Domain[],
  weightOf: (id: string) => number,
  landform: (id: string) => Landform,
  reachesOf: (id: string) => Continent[],
  config: MapConfig,
  random: () => number
): Landmass[] {
  const order: Continent[] = ['formal', 'social', 'humanities'];
  const totalWeight = domains.reduce((sum, d) => sum + weightOf(d.id), 0) || 1;
  const landArea = config.width * config.height * config.landFraction;
  const perWeight = landArea / totalWeight;

  const islanders = domains.filter((d) => landform(d.id) === 'island');
  const present = order.filter((c) =>
    domains.some((d) => d.continent === c && landform(d.id) !== 'island')
  );

  /* ── continents ── */

  const cores = present.map((continent) => {
    const members = domains.filter(
      (d) => d.continent === continent && landform(d.id) !== 'island'
    );
    const weight = members.reduce((sum, d) => sum + weightOf(d.id), 0);
    const character = config.character[continent];

    // One bump per peninsula, spread by the golden angle so two lobes never
    // land on top of each other, and sized by the domain's share of the coast.
    const peninsulas = members.filter((d) => landform(d.id) === 'peninsula');
    const spin = random() * TAU;
    const lobes: Lobe[] = peninsulas.map((domain, index) => ({
      id: domain.id,
      angle: spin + index * 2.399963,
      height: Math.min(
        0.75,
        config.peninsulaReach * Math.sqrt(weightOf(domain.id) / Math.max(1, weight)) * 2.6
      ),
      width: 0.36 + 0.3 * Math.sqrt(weightOf(domain.id) / Math.max(1, weight)),
    }));

    return {
      continent,
      members: members.map((d) => d.id),
      aspect: character.aspect,
      lobes,
      ...shapeFor(character.aspect, perWeight * weight, config.coastComplexity, lobes, random),
    };
  });

  const widthOf = (c: (typeof cores)[number]) => c.bounds.maxX - c.bounds.minX;
  const spanX = cores.reduce((sum, c) => sum + widthOf(c), 0) + config.strait * (cores.length - 1);
  const spanY = Math.max(...cores.map((c) => c.bounds.maxY - c.bounds.minY), 1);
  const margin = 30;
  const scale = Math.min((config.width - margin * 2) / spanX, (config.height - margin * 2) / spanY);

  const world: Landmass[] = [];
  let cursor = (config.width - spanX * scale) / 2;
  for (const core of cores) {
    const rx = core.rx * scale;
    const ry = core.ry * scale;
    // The centre sits where the outline's own left edge lands on the cursor,
    // so a continent with a lobe on one side still fits the row it was given.
    world.push({
      id: core.continent,
      kind: 'continent',
      continent: core.continent,
      members: core.members,
      centre: {
        x: cursor - core.bounds.minX * scale,
        y: config.height / 2 + config.height * config.character[core.continent].drift,
      },
      aspect: core.aspect,
      radius: (angle) => core.radius(angle) * scale,
      rx,
      ry,
      lobes: core.lobes,
    });
    cursor += widthOf(core) * scale + config.strait * scale;
  }

  /* ── islands ── */

  const continentAt = new Map(world.map((m) => [m.continent, m]));

  const islands: Landmass[] = islanders.map((domain, index) => {
    const local = rng(hash(`${domain.id}#island#${config.seed}`));
    const shape = shapeFor(
      0.75 + local() * 0.7,
      perWeight * weightOf(domain.id) * scale * scale,
      config.coastComplexity * 0.8,
      [],
      local
    );

    // An island starts where its links average out: between its own continent
    // and the ones it reaches. That is the claim it exists to make.
    const pull = [domain.continent, ...reachesOf(domain.id)]
      .map((c) => continentAt.get(c))
      .filter((m): m is Landmass => Boolean(m));
    const start = pull.length
      ? {
          x: pull.reduce((sum, m) => sum + m.centre.x, 0) / pull.length,
          y: pull.reduce((sum, m) => sum + m.centre.y, 0) / pull.length,
        }
      : { x: config.width / 2, y: config.height / 2 };

    const spread = config.islandScatter;
    return {
      id: `island:${domain.id}`,
      kind: 'island' as const,
      continent: domain.continent,
      members: [domain.id],
      centre: {
        x: start.x + (local() * 2 - 1) * spread,
        y: start.y + (local() * 2 - 1) * spread + index * 0.01,
      },
      aspect: 1,
      radius: shape.radius,
      rx: shape.rx,
      ry: shape.ry,
      lobes: [],
    };
  });

  // Float them clear of the land. An island overlapping a continent is not an
  // island, and two overlapping islands are one island with a strange outline.
  for (let pass = 0; pass < 260; pass++) {
    for (const island of islands) {
      const reach = Math.max(island.rx, island.ry) + config.islandGap;

      for (const mass of world) {
        const dx = island.centre.x - mass.centre.x;
        const dy = island.centre.y - mass.centre.y;
        const angle = Math.atan2(dy / Math.sqrt(mass.aspect), dx * Math.sqrt(mass.aspect));
        const wanted = mass.radius(angle) + reach;
        const distance = Math.hypot(dx / Math.sqrt(mass.aspect), dy * Math.sqrt(mass.aspect));
        if (distance >= wanted) continue;
        const push = (wanted - distance) * 0.5;
        const length = Math.hypot(dx, dy) || 1;
        island.centre.x += (dx / length) * push;
        island.centre.y += (dy / length) * push;
      }

      for (const other of islands) {
        if (other === island) continue;
        const dx = island.centre.x - other.centre.x;
        const dy = island.centre.y - other.centre.y;
        const distance = Math.hypot(dx, dy);
        const wanted = reach + Math.max(other.rx, other.ry) + config.islandGap;
        if (distance >= wanted) continue;
        const length = distance || 1;
        const push = ((wanted - distance) / length) * 0.3;
        island.centre.x += dx * push;
        island.centre.y += dy * push;
        other.centre.x -= dx * push;
        other.centre.y -= dy * push;
      }

      const pad = Math.max(island.rx, island.ry) + 6;
      island.centre.x = Math.min(config.width - pad, Math.max(pad, island.centre.x));
      island.centre.y = Math.min(config.height - pad, Math.max(pad, island.centre.y));
    }
  }

  return [...world, ...islands];
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
  /** Which landmass this cell belongs to; territories never cross one. */
  mass: string;
};

function buildField(world: Landmass[], config: MapConfig, warp: Warp): Cell[] {
  const { hexR } = config;
  const cells: Cell[] = [];
  const rMax = Math.ceil(config.height / (hexR * 1.5)) + 2;

  for (let r = -2; r <= rMax; r++) {
    const qMin = Math.floor(-r / 2) - 2;
    const qMax = qMin + Math.ceil(config.width / (hexR * SQRT3)) + 4;
    for (let q = qMin; q <= qMax; q++) {
      const x = hexR * SQRT3 * (q + r / 2);
      const y = hexR * 1.5 * r;
      const home = world.find((mass) => inside(mass, x, y));
      if (!home) continue;
      const w = warp(x, y);
      cells.push({ q, r, x, y, wx: w.x, wy: w.y, mass: home.id });
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
  homeOf: Map<string, string>,
  hexArea: number,
  passes: number,
  solverRate: number
): Growth {
  const byMass = new Map<string, Domain[]>();
  for (const [id, mass] of homeOf) {
    const domain = domains.find((d) => d.id === id);
    if (domain) byMass.set(mass, [...(byMass.get(mass) ?? []), domain]);
  }
  const cellsByMass = new Map<string, Cell[]>();
  for (const cell of field) {
    cellsByMass.set(cell.mass, [...(cellsByMass.get(cell.mass) ?? []), cell]);
  }

  const weights = new Map<string, number>(domains.map((d) => [d.id, 0]));
  const owner = new Map<number, string>();
  const sizes = new Map<string, number>();

  for (let pass = 0; pass < passes; pass++) {
    owner.clear();
    sizes.clear();
    for (const domain of domains) sizes.set(domain.id, 0);

    for (const [mass, cells] of cellsByMass) {
      const here = byMass.get(mass) ?? [];
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

/* ─────────────────────────────  Organic growth  ────────────────────────── */

/** Value noise on an integer lattice — no tables, identical in any language. */
function lattice(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = lattice(xi, yi, seed);
  const b = lattice(xi + 1, yi, seed);
  const c = lattice(xi, yi + 1, seed);
  const d = lattice(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Two octaves is enough at this scale: one for the shape, one for the edge. */
function fbm(x: number, y: number, seed: number): number {
  return noise2(x, y, seed) * 0.67 + noise2(x * 2.3, y * 2.3, seed + 101) * 0.33;
}

type Plot = {
  id: string;
  size: number;
  /** The seed cell, in warped space. Compactness is measured from here. */
  origin: Point;
  heading: number;
  frontier: Set<number>;
  noiseSeed: number;
};

/**
 * Grows every territory a hex at a time until the land runs out.
 *
 * The shape comes from what a territory prefers when it claims: pull towards
 * its own centre keeps it compact, a slowly turning heading makes it reach in
 * one direction, and terrain noise gives it an edge that does not look drawn by
 * a compass. Those three are the knobs; the mix is what makes one map read as a
 * pie chart and another as a coastline.
 *
 * Whose turn it is, though, is not up for negotiation: whoever is furthest
 * behind its quota goes next. Growth alone still cannot guarantee the areas —
 * a territory can be walled in before it has had its share — so `rebalance`
 * settles the accounts afterwards. Letting shape and area fight for the same
 * rule is what makes hand-rolled versions of this either honest or pretty,
 * never both.
 */
function growOrganic(
  field: Cell[],
  domains: Domain[],
  targets: Map<string, number>,
  anchors: Map<string, Point>,
  homeOf: Map<string, string>,
  hexArea: number,
  config: MapConfig
): Growth {
  const cellAt = new Map<number, Cell>();
  for (const cell of field) cellAt.set(cellKey(cell.q, cell.r), cell);

  const owner = new Map<number, string>();
  const plots = new Map<string, Plot>();
  const grain = Math.max(4, config.grain);

  const targetOf = (id: string) => Math.max(1, targets.get(id) ?? 1);
  const idealRadius = (id: string) => Math.sqrt((targetOf(id) * hexArea) / Math.PI) || 1;

  const claim = (key: number, plot: Plot): void => {
    const cell = cellAt.get(key)!;
    owner.set(key, plot.id);
    plot.size += 1;
    plot.frontier.delete(key);

    for (const dir of DIRECTIONS) {
      const nk = cellKey(cell.q + dir.q, cell.r + dir.r);
      if (owner.has(nk)) continue;
      const neighbour = cellAt.get(nk);
      // A territory never leaves its landmass: the ocean between them is what
      // makes separate landmasses read as separate.
      if (!neighbour || neighbour.mass !== cell.mass) continue;
      plot.frontier.add(nk);
    }
  };

  // Seed each domain on the free cell nearest its anchor, largest first so the
  // big fields get the open ground rather than the leftovers.
  const order = [...domains].sort((a, b) => targetOf(b.id) - targetOf(a.id));
  for (const domain of order) {
    const mass = homeOf.get(domain.id);
    if (!mass) continue;
    const anchor = anchors.get(domain.id)!;
    let best: Cell | null = null;
    let bestDistance = Infinity;
    for (const cell of field) {
      if (cell.mass !== mass) continue;
      const key = cellKey(cell.q, cell.r);
      if (owner.has(key)) continue;
      const d = (cell.wx - anchor.x) ** 2 + (cell.wy - anchor.y) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = cell;
      }
    }
    if (!best) continue;
    const plot: Plot = {
      id: domain.id,
      size: 0,
      origin: { x: best.wx, y: best.wy },
      heading: fbm(best.x / grain, best.y / grain, hash(domain.id)) * TAU,
      frontier: new Set(),
      noiseSeed: hash(`${domain.id}#${config.seed}`) % 100000,
    };
    plots.set(domain.id, plot);
    claim(cellKey(best.q, best.r), plot);
  }

  const active = new Set(plots.keys());

  while (active.size) {
    let chosen: Plot | null = null;
    let lowest = Infinity;
    for (const id of active) {
      const plot = plots.get(id)!;
      const fill = plot.size / targetOf(id);
      if (fill < lowest) {
        lowest = fill;
        chosen = plot;
      }
    }
    if (!chosen) break;

    // Stale frontier entries are cheaper to drop here than to keep in sync.
    for (const key of [...chosen.frontier]) if (owner.has(key)) chosen.frontier.delete(key);
    if (!chosen.frontier.size) {
      active.delete(chosen.id);
      continue;
    }

    // Distance is measured from the seed, which does not move, and never from
    // the running centroid. A centroid follows whatever the territory just
    // claimed, so growing a tendril drags the centre after it and *lowers* the
    // penalty for extending the same tendril — the feedback loop that turns
    // this whole family of algorithms into a plate of spaghetti.
    const origin = chosen.origin;
    const ideal = idealRadius(chosen.id);
    const cos = Math.cos(chosen.heading);
    const sin = Math.sin(chosen.heading);

    let pick = -1;
    let bestScore = -Infinity;
    for (const key of chosen.frontier) {
      const cell = cellAt.get(key)!;
      const dx = cell.wx - origin.x;
      const dy = cell.wy - origin.y;
      const distance = Math.hypot(dx, dy) || 1;

      // How much of the cell's ring the territory already holds. Filling a
      // notch costs nothing; reaching out on a single contact is expensive.
      let support = 0;
      for (const dir of DIRECTIONS) {
        if (owner.get(cellKey(cell.q + dir.q, cell.r + dir.r)) === chosen.id) support += 1;
      }

      const compact = -((distance / ideal) ** 2);
      const heading = (dx * cos + dy * sin) / distance;
      const terrain = fbm(cell.x / grain, cell.y / grain, chosen.noiseSeed) - 0.5;

      const score =
        config.roundness * (2.4 * compact + 0.7 * support) +
        config.wander * heading +
        config.wildness * terrain;
      if (score > bestScore) {
        bestScore = score;
        pick = key;
      }
    }
    if (pick < 0) {
      active.delete(chosen.id);
      continue;
    }

    claim(pick, chosen);
    // The heading turns slowly and by terrain, not by a dice roll: a territory
    // that changes its mind every cell just grows in a circle again.
    chosen.heading +=
      (fbm(chosen.size * 0.06, chosen.noiseSeed * 0.01, chosen.noiseSeed) - 0.5) * 0.9;
  }

  const sizes = new Map<string, number>();
  for (const [id, plot] of plots) sizes.set(id, plot.size);

  rebalance(field, cellAt, owner, sizes, targets, config.rebalancePasses);
  repairIslands(field, owner, sizes);
  return { owner, sizes };
}

/**
 * Moves border cells from territories that took too much to neighbours that got
 * too little, until the areas match what the course counts asked for.
 *
 * Two guards keep this from undoing the shapes growth just made. A cell is only
 * given up if its owner stays in one piece without it — the standard simple-
 * point test, counting how many separate runs of same-owner neighbours surround
 * it — and only taken if the receiver already holds two of its neighbours, so
 * nobody grows a one-cell spike into somebody else's land.
 */
function rebalance(
  field: Cell[],
  cellAt: Map<number, Cell>,
  owner: Map<number, string>,
  sizes: Map<string, number>,
  targets: Map<string, number>,
  passes: number
): void {
  const targetOf = (id: string) => Math.max(1, targets.get(id) ?? 1);
  const fill = (id: string) => (sizes.get(id) ?? 0) / targetOf(id);

  // A stable order: iteration over a Map follows insertion, which follows the
  // scan of the field, which would bias every correction to one side.
  const keys = field.map((cell) => cellKey(cell.q, cell.r)).sort((a, b) => a - b);

  for (let pass = 0; pass < passes; pass++) {
    let moved = 0;

    for (const key of keys) {
      const mine = owner.get(key);
      if (!mine) continue;
      const cell = cellAt.get(key)!;
      if (fill(mine) <= 1) continue;

      const ring = DIRECTIONS.map((dir) => owner.get(cellKey(cell.q + dir.q, cell.r + dir.r)));

      // Simple-point test: exactly one run of my own cells around the ring, or
      // removing this one splits my territory in two.
      let runs = 0;
      let ours = 0;
      for (let i = 0; i < 6; i++) {
        const here = ring[i] === mine;
        const before = ring[(i + 5) % 6] === mine;
        if (here) ours += 1;
        if (here && !before) runs += 1;
      }
      if (runs !== 1 || ours < 2) continue;

      let taker: string | null = null;
      let takerFill = fill(mine) - 0.02;
      for (let i = 0; i < 6; i++) {
        const other = ring[i];
        if (!other || other === mine) continue;
        // Two of the receiver's cells must touch it, so the border stays a
        // border instead of sprouting a finger.
        const touching = ring.filter((x) => x === other).length;
        if (touching < 2) continue;
        const theirs = fill(other);
        if (theirs < takerFill) {
          takerFill = theirs;
          taker = other;
        }
      }
      if (!taker) continue;

      owner.set(key, taker);
      sizes.set(mine, (sizes.get(mine) ?? 0) - 1);
      sizes.set(taker, (sizes.get(taker) ?? 0) + 1);
      moved += 1;
    }

    if (!moved) break;
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
  world: Landmass[],
  homeOf: Map<string, string>,
  hexArea: number,
  warp: Warp,
  random: () => number
): Map<string, Point> {
  const anchors = new Map<string, Point>();
  const massById = new Map(world.map((m) => [m.id, m]));
  const radiusOf = (id: string) => Math.sqrt(((targets.get(id) ?? 1) * hexArea) / Math.PI);
  const homeMass = (id: string) => massById.get(homeOf.get(id) ?? '')!;

  for (const mass of world) {
    const spin = random() * TAU;
    const lobeOf = new Map(mass.lobes.map((lobe) => [lobe.id, lobe]));

    mass.members.forEach((id, index) => {
      const lobe = lobeOf.get(id);
      if (lobe) {
        // A peninsula is seeded out in its own lobe. Left in the spiral with
        // everyone else it stays inland and the lobe falls to whichever
        // neighbour happens to be nearest — a bulge belonging to nobody.
        const reach = mass.radius(lobe.angle) * 0.82;
        anchors.set(
          id,
          warp(
            mass.centre.x + Math.cos(lobe.angle) * reach * Math.sqrt(mass.aspect),
            mass.centre.y + (Math.sin(lobe.angle) * reach) / Math.sqrt(mass.aspect)
          )
        );
        return;
      }
      const t = (index + 0.5) / mass.members.length;
      const angle = spin + index * 2.399963;
      anchors.set(
        id,
        warp(
          mass.centre.x + Math.cos(angle) * mass.rx * 0.55 * Math.sqrt(t),
          mass.centre.y + Math.sin(angle) * mass.ry * 0.55 * Math.sqrt(t)
        )
      );
    });
  }

  for (let pass = 0; pass < 70; pass++) {
    const cooling = 1 - pass / 140;

    for (const domain of domains) {
      const own = anchors.get(domain.id)!;
      const s = homeMass(domain.id);
      if (!s) continue;
      const sources = domain.dependsOn.filter(
        (id) => homeOf.get(id) === homeOf.get(domain.id)
      );
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
        if (homeOf.get(domains[i].id) !== homeOf.get(domains[j].id)) continue;
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
  adjacency: Set<string>,
  homeOf: Map<string, string>
): { score: number; areaError: number; adjacencyRate: number } {
  let areaError = 0;
  for (const domain of domains) {
    const target = Math.max(1, targets.get(domain.id) ?? 1);
    areaError += Math.abs((growth.sizes.get(domain.id) ?? 0) - target) / target;
  }
  areaError /= domains.length || 1;

  let wanted = 0;
  let realized = 0;
  for (const domain of domains) {
    for (const source of domain.dependsOn) {
      // Only pairs that share a landmass can be scored on adjacency: a link to
      // an island is meant to cross water, and counting it as a miss would push
      // every restart towards dragging islands back ashore.
      if (homeOf.get(source) !== homeOf.get(domain.id)) continue;
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
  coasts: Array<{ id: string; kind: 'continent' | 'island'; continent: Continent; path: string }>;
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

export type MapInput = {
  domains: Domain[];
  courseCounts: Map<string, number>;
  /** Where the graph says each domain belongs. Absent = everyone inland. */
  landform?: Map<string, Landform>;
  /** Continents an offshore domain links to, so its island sits between them. */
  reaches?: Map<string, Continent[]>;
  /** Weighted domain graph, used to place territories beside their relatives. */
  edges?: Array<{ a: string; b: string; weight: number }>;
};

export function generateMap(
  input: MapInput,
  overrides: Partial<MapConfig> = {}
): MapResult {
  const { domains, courseCounts } = input;
  const landformOf = (id: string): Landform => input.landform?.get(id) ?? 'mainland';
  const reachesOf = (id: string): Continent[] => input.reaches?.get(id) ?? [];
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
    world: Landmass[];
    targets: Map<string, number>;
    areaError: number;
    adjacencyRate: number;
  } | null = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < Math.max(1, config.restarts); attempt++) {
    const random = rng(config.seed * 7919 + attempt * 104729);
    const warp = makeWarp(config, random);
    const world = layoutWorld(domains, weightOf, landformOf, reachesOf, config, random);
    const field = buildField(world, config, warp);
    if (!field.length) continue;

    const homeOf = new Map<string, string>();
    for (const mass of world) for (const id of mass.members) homeOf.set(id, mass.id);

    // Targets are absolute cell counts. A landmass is partitioned completely,
    // so a domain's due is its share of the cells that actually exist there;
    // computing it from the ideal ellipse leaves every territory chasing a
    // number the ground cannot supply.
    const cellsIn = new Map<string, number>();
    for (const cell of field) cellsIn.set(cell.mass, (cellsIn.get(cell.mass) ?? 0) + 1);
    const weightIn = new Map<string, number>();
    for (const domain of domains) {
      const mass = homeOf.get(domain.id);
      if (!mass) continue;
      weightIn.set(mass, (weightIn.get(mass) ?? 0) + weightOf(domain.id));
    }
    const targets = new Map<string, number>(
      domains.map((d) => {
        const mass = homeOf.get(d.id) ?? '';
        return [
          d.id,
          Math.max(1, ((cellsIn.get(mass) ?? 0) * weightOf(d.id)) / (weightIn.get(mass) || 1)),
        ];
      })
    );

    const anchors = computeAnchors(domains, targets, world, homeOf, hexArea, warp, random);
    const growth = config.mode === 'organic'
      ? growOrganic(field, domains, targets, anchors, homeOf, hexArea, config)
      : partition(
      field,
      domains,
      targets,
      anchors,
      metrics,
      homeOf,
      hexArea,
      config.solverPasses,
      config.solverRate
    );
    const result = scoreLayout(
      domains,
      targets,
      growth,
      adjacencyOf(field, growth.owner),
      homeOf
    );

    if (result.score < bestScore) {
      bestScore = result.score;
      best = { growth, field, world, targets, ...result };
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

  const coasts = best.world.map((mass) => {
    const ids = new Set(mass.members);
    const arcs = graph.arcs.filter(
      (arc) =>
        (arc.left === null && arc.right !== null && ids.has(arc.right)) ||
        (arc.right === null && arc.left !== null && ids.has(arc.left))
    );
    return {
      id: mass.id,
      kind: mass.kind,
      continent: mass.continent,
      path: pathFrom(arcs, graph, tolerance),
    };
  });

  // Links that cross open water are where the reference map draws rope bridges.
  // Now that islands exist these are the interesting ones — a bridge to an
  // island is the picture of why that island is offshore at all. Emitted as
  // data so that drawing them stays a rendering decision.
  const finalHome = new Map<string, string>();
  for (const mass of best.world) for (const id of mass.members) finalHome.set(id, mass.id);
  const anchorOf = new Map(territories.map((t) => [t.id, t.label]));
  const seen = new Set<string>();
  const links: MapResult['links'] = [];

  const candidates = input.edges?.length
    ? input.edges.map((edge) => ({ from: edge.a, to: edge.b, weight: edge.weight }))
    : domains.flatMap((d) => d.dependsOn.map((to) => ({ from: d.id, to, weight: 1 })));

  for (const edge of candidates) {
    if (finalHome.get(edge.from) === finalHome.get(edge.to)) continue;
    const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
    if (seen.has(key)) continue;
    const a = anchorOf.get(edge.from);
    const b = anchorOf.get(edge.to);
    if (!a || !b) continue;
    seen.add(key);
    links.push({ from: edge.from, to: edge.to, a, b });
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
