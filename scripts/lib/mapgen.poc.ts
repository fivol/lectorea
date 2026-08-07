import type { Continent, Domain } from '../../shared/schema.js';

/**
 * Proof of concept for the map pipeline: continents whose area follows their
 * course count, territories partitioning them exactly, and boundaries smoothed
 * on a shared topology so neighbours can never drift apart.
 *
 * The three ideas that make it work:
 *
 *  1. A continent is a silhouette computed from data, not a bag of blobs. Every
 *     cell inside it is owned by someone, so there are no holes between
 *     territories and the coastline is a single curve.
 *  2. Growth is proportional and never stops early: whoever is furthest from
 *     its quota grows next, past 100% as well, so leftover land is shared in
 *     the same ratio instead of falling to whoever happens to be nearest.
 *  3. Borders are extracted as arcs of a planar graph and smoothed once each.
 *     Two territories sharing an arc receive the identical curve, so smoothing
 *     cannot open a gap — which is what a per-polygon smoother always does.
 */

const SQRT3 = Math.sqrt(3);
const TAU = Math.PI * 2;

export type MapConfig = {
  /** Hex radius of the sampling grid. Smaller = truer areas, bigger files. */
  hexR: number;
  width: number;
  height: number;
  /** Share of the canvas that is land. The rest is ocean and straits. */
  landFraction: number;
  /** Gap between continents, in px, before the whole layout is scaled to fit. */
  strait: number;
  /** Corner-cutting passes applied to every border arc. */
  smoothPasses: number;
  /** Wobble amplitude in px: how far a border wanders off the grid. */
  coastNoise: number;
  inlandNoise: number;
  /** Layout attempts; the best-scoring one is kept. */
  restarts: number;
  seed: number;
};

export const defaultConfig: MapConfig = {
  hexR: 5,
  width: 1680,
  height: 980,
  landFraction: 0.46,
  strait: 78,
  smoothPasses: 3,
  coastNoise: 5.5,
  inlandNoise: 2.2,
  restarts: 6,
  seed: 20260807,
};

/** Aspect = width/height of a continent silhouette. Art direction, not data. */
const CONTINENT_ASPECT: Record<Continent, number> = {
  formal: 1.06,
  social: 0.42,
  humanities: 0.86,
};

/** Left-to-right order of the continents across the canvas. */
const CONTINENT_ORDER: Continent[] = ['formal', 'social', 'humanities'];

/** Vertical offset as a share of the canvas height, to break the straight row. */
const CONTINENT_DRIFT: Record<Continent, number> = {
  formal: 0.0,
  social: 0.06,
  humanities: -0.03,
};

/* ──────────────────────────────  Determinism  ──────────────────────────── */

/** mulberry32 — small, fast, and identical on every machine. */
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

/** Stable hash of a string, so a border's wobble depends on who it separates. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ───────────────────────────────  Geometry  ────────────────────────────── */

type Point = { x: number; y: number };

const DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

const cellKey = (q: number, r: number): number => (q + 4096) * 16384 + (r + 4096);

/* ───────────────────────────  Continent silhouettes  ───────────────────── */

export type Silhouette = {
  continent: Continent;
  centre: Point;
  /** Radius as a function of angle — a wobbled ellipse. */
  radius: (angle: number) => number;
  rx: number;
  ry: number;
};

/**
 * A continent is an ellipse of the required area, its radius modulated by a few
 * low harmonics. Low frequencies only: the coastline's fine detail comes from
 * the border smoother later, and adding it twice reads as noise.
 */
function silhouetteFor(
  continent: Continent,
  area: number,
  random: () => number
): { radius: (angle: number) => number; rx: number; ry: number } {
  const aspect = CONTINENT_ASPECT[continent];
  const waves = [2, 3, 5].map((frequency) => ({
    frequency,
    amplitude: (0.05 + random() * 0.06) / Math.sqrt(frequency),
    phase: random() * TAU,
  }));

  const shape = (angle: number): number =>
    1 + waves.reduce((sum, w) => sum + w.amplitude * Math.sin(w.frequency * angle + w.phase), 0);

  // The wobble changes the enclosed area, so measure it and rescale rather than
  // trusting the ellipse formula — otherwise continents drift off their quota.
  const steps = 720;
  let unitArea = 0;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU;
    const a1 = ((i + 1) / steps) * TAU;
    const r0 = shape(a0);
    const r1 = shape(a1);
    // Shoelace on the ellipse-mapped points of the unit shape.
    const x0 = r0 * Math.cos(a0) * Math.sqrt(aspect);
    const y0 = (r0 * Math.sin(a0)) / Math.sqrt(aspect);
    const x1 = r1 * Math.cos(a1) * Math.sqrt(aspect);
    const y1 = (r1 * Math.sin(a1)) / Math.sqrt(aspect);
    unitArea += x0 * y1 - x1 * y0;
  }
  unitArea = Math.abs(unitArea) / 2;

  const scale = Math.sqrt(area / unitArea);
  const rx = scale * Math.sqrt(aspect);
  const ry = scale / Math.sqrt(aspect);

  return {
    radius: (angle: number) => shape(angle) * scale,
    rx: rx * (1 + 0.11),
    ry: ry * (1 + 0.11),
  };
}

/** Is the point inside the silhouette? Radius is compared in ellipse space. */
function inside(s: Silhouette, x: number, y: number): boolean {
  const aspect = CONTINENT_ASPECT[s.continent];
  const dx = (x - s.centre.x) / Math.sqrt(aspect);
  const dy = (y - s.centre.y) * Math.sqrt(aspect);
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-9) return true;
  return distance <= s.radius(Math.atan2(dy, dx));
}

/**
 * Places the continents in a row, sized by their share of the courses, then
 * scales the whole arrangement to fit the canvas. Scaling at the end keeps the
 * relative areas exact — clamping each continent separately would not.
 */
function layoutContinents(
  domains: Domain[],
  counts: Map<string, number>,
  config: MapConfig,
  random: () => number
): Silhouette[] {
  const present = CONTINENT_ORDER.filter((c) => domains.some((d) => d.continent === c));
  const weight = new Map<Continent, number>(
    present.map((c) => [
      c,
      domains
        .filter((d) => d.continent === c)
        .reduce((sum, d) => sum + Math.max(1, counts.get(d.id) ?? 0), 0),
    ])
  );
  const total = [...weight.values()].reduce((a, b) => a + b, 0);
  const landArea = config.width * config.height * config.landFraction;

  const shapes = present.map((continent) => {
    const area = (landArea * weight.get(continent)!) / total;
    return { continent, ...silhouetteFor(continent, area, random) };
  });

  // Lay out left to right, then scale to the canvas with a margin.
  const spanX = shapes.reduce((sum, s) => sum + s.rx * 2, 0) + config.strait * (shapes.length - 1);
  const spanY = Math.max(...shapes.map((s) => s.ry * 2));
  const margin = 26;
  const scale = Math.min(
    (config.width - margin * 2) / spanX,
    (config.height - margin * 2) / spanY
  );

  const placed: Silhouette[] = [];
  let cursor = (config.width - spanX * scale) / 2;
  for (const shape of shapes) {
    const rx = shape.rx * scale;
    const ry = shape.ry * scale;
    placed.push({
      continent: shape.continent,
      centre: {
        x: cursor + rx,
        y: config.height / 2 + config.height * CONTINENT_DRIFT[shape.continent],
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

type Cell = { q: number; r: number; x: number; y: number; continent: Continent };

function buildField(silhouettes: Silhouette[], config: MapConfig): Cell[] {
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
      if (home) cells.push({ q, r, x, y, continent: home.continent });
    }
  }
  return cells;
}

/* ─────────────────────────────  Seed placement  ─────────────────────────── */

/**
 * Anchors: a domain is pulled towards what it depends on and pushed away from
 * everyone else by the radius its own area needs. Same forces as the first
 * generator — the difference is that here they only have to produce a decent
 * *starting* arrangement, because growth fills the continent completely.
 */
function computeAnchors(
  domains: Domain[],
  quotas: Map<string, number>,
  silhouettes: Silhouette[],
  hexArea: number,
  random: () => number
): Map<string, Point> {
  const anchors = new Map<string, Point>();
  const byId = new Map(domains.map((d) => [d.id, d]));
  const home = new Map(silhouettes.map((s) => [s.continent, s]));
  const radiusOf = (id: string) => Math.sqrt(((quotas.get(id) ?? 1) * hexArea) / Math.PI);

  for (const [continent, s] of home) {
    const list = domains.filter((d) => d.continent === continent);
    const spin = random() * TAU;
    list.forEach((domain, index) => {
      // Golden-angle spiral: an even initial spread that does not favour any
      // direction, so restarts differ only by `spin`.
      const t = (index + 0.5) / list.length;
      const angle = spin + index * 2.399963;
      anchors.set(domain.id, {
        x: s.centre.x + Math.cos(angle) * s.rx * 0.62 * Math.sqrt(t),
        y: s.centre.y + Math.sin(angle) * s.ry * 0.62 * Math.sqrt(t),
      });
    });
  }

  for (let pass = 0; pass < 90; pass++) {
    const cooling = 1 - pass / 180;

    for (const domain of domains) {
      const own = anchors.get(domain.id)!;
      const s = home.get(domain.continent)!;

      const sources = domain.dependsOn.filter(
        (id) => byId.get(id)?.continent === domain.continent
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

      own.x += (s.centre.x - own.x) * 0.03;
      own.y += (s.centre.y - own.y) * 0.03;
    }

    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        if (domains[i].continent !== domains[j].continent) continue;
        const a = anchors.get(domains[i].id)!;
        const b = anchors.get(domains[j].id)!;
        const wanted = (radiusOf(domains[i].id) + radiusOf(domains[j].id)) * 0.9;
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

    // Keep anchors on their own continent; growth cannot rescue one that has
    // drifted into the ocean, it just seeds at the nearest coast instead.
    for (const domain of domains) {
      const point = anchors.get(domain.id)!;
      const s = home.get(domain.continent)!;
      if (inside(s, point.x, point.y)) continue;
      const dx = point.x - s.centre.x;
      const dy = point.y - s.centre.y;
      const angle = Math.atan2(dy * Math.sqrt(CONTINENT_ASPECT[domain.continent]), dx / Math.sqrt(CONTINENT_ASPECT[domain.continent]));
      const limit = s.radius(angle) * 0.9;
      const aspect = CONTINENT_ASPECT[domain.continent];
      point.x = s.centre.x + Math.cos(angle) * limit * Math.sqrt(aspect);
      point.y = s.centre.y + (Math.sin(angle) * limit) / Math.sqrt(aspect);
    }
  }

  return anchors;
}

/* ────────────────────────────────  Growth  ─────────────────────────────── */

type Growth = { owner: Map<number, string>; sizes: Map<string, number> };

/**
 * Partitions each continent into territories of the requested size.
 *
 * This is a power diagram solved on the hex grid. Every cell goes to the domain
 * minimising `|cell − anchor|² − weight`, and the weights are the unknowns: a
 * territory that came out too small gets a larger weight and wins more ground
 * next round. Lloyd's relaxation runs alongside it, moving each anchor to the
 * centroid of what it holds, which is what keeps the shapes compact instead of
 * long and clawed.
 *
 * Growing territories greedily from a seed — the obvious approach, and the one
 * this replaces — cannot do this. Under any fair growth rule a big territory
 * expands faster in absolute terms than a small neighbour and simply surrounds
 * it; the small one is then sealed off at a fraction of its due. Assigning
 * every cell at once has no such failure mode, because no territory ever has to
 * travel through another one to reach free land.
 */
function partition(
  field: Cell[],
  domains: Domain[],
  targets: Map<string, number>,
  anchors: Map<string, Point>,
  hexArea: number,
  passes = 26
): Growth {
  const byContinent = new Map<Continent, Domain[]>();
  for (const domain of domains) {
    const list = byContinent.get(domain.continent) ?? [];
    list.push(domain);
    byContinent.set(domain.continent, list);
  }

  const cellsByContinent = new Map<Continent, Cell[]>();
  for (const cell of field) {
    const list = cellsByContinent.get(cell.continent) ?? [];
    list.push(cell);
    cellsByContinent.set(cell.continent, list);
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
          const cost =
            (cell.x - a.x) ** 2 + (cell.y - a.y) ** 2 - (weights.get(domain.id) ?? 0);
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

    // Weights carry units of distance², so a shortfall of n cells converts to
    // the radius² that n cells of area would need: Δ(r²) = ΔA / π.
    const rate = pass < 4 ? 0.9 : 0.55;
    for (const domain of domains) {
      const target = Math.max(1, targets.get(domain.id) ?? 1);
      const size = sizes.get(domain.id) ?? 0;
      const deficit = (target - size) * hexArea;
      weights.set(domain.id, (weights.get(domain.id) ?? 0) + (rate * deficit) / Math.PI);
    }

    // Lloyd: an anchor follows its territory. A territory that lost all its
    // ground keeps its anchor, so a rising weight can bring it back.
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const cell of field) {
      const id = owner.get(cellKey(cell.q, cell.r));
      if (!id) continue;
      const entry = sums.get(id) ?? { x: 0, y: 0, n: 0 };
      entry.x += cell.x;
      entry.y += cell.y;
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
 * A power cell is convex, but clipping it to a wobbled coastline can leave a
 * territory in two pieces. The stray piece is handed to whichever neighbour
 * wraps it most — one detached fragment reads as a mistake, and the areas move
 * by a few cells at most.
 */
function repairIslands(
  field: Cell[],
  owner: Map<number, string>,
  sizes: Map<string, number>
): void {
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

/* ──────────────────────  Border arcs and smoothing  ────────────────────── */

type Arc = {
  /** Polyline from junction to junction, shared by the two sides. */
  points: Point[];
  left: string | null;
  right: string | null;
  /** Set once smoothing has run, so both owners reuse the identical curve. */
  smoothed?: Point[];
};

const pointId = (p: Point): string => `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`;

function cornerOf(cell: Cell, index: number, hexR: number): Point {
  const angle = ((60 * index - 30) * Math.PI) / 180;
  return { x: cell.x + hexR * Math.cos(angle), y: cell.y + hexR * Math.sin(angle) };
}

/**
 * Turns the ownership map into a planar graph of border arcs.
 *
 * An arc runs from one junction (a point where three or more territories meet,
 * or where the coast branches) to the next, and belongs to exactly two sides.
 * That is the whole point: smoothing happens per arc, so the curve a territory
 * draws is byte-for-byte the curve its neighbour draws.
 */
function buildArcs(field: Cell[], owner: Map<number, string>, hexR: number): Arc[] {
  type Segment = { a: Point; b: Point; left: string | null; right: string | null };
  const segments: Segment[] = [];

  for (const cell of field) {
    const key = cellKey(cell.q, cell.r);
    const mine = owner.get(key) ?? null;
    if (!mine) continue;
    for (let d = 0; d < 6; d++) {
      const nk = cellKey(cell.q + DIRECTIONS[d].q, cell.r + DIRECTIONS[d].r);
      const theirs = owner.get(nk) ?? null;
      if (theirs === mine) continue;
      // Record each border once: the side with the smaller id owns the record.
      if (theirs !== null && theirs < mine) continue;
      segments.push({
        a: cornerOf(cell, d, hexR),
        b: cornerOf(cell, (d + 1) % 6, hexR),
        left: mine,
        right: theirs,
      });
    }
  }

  // Adjacency over the segment endpoints.
  const incident = new Map<string, number[]>();
  const at = new Map<string, Point>();
  segments.forEach((segment, index) => {
    for (const point of [segment.a, segment.b]) {
      const id = pointId(point);
      at.set(id, point);
      const list = incident.get(id) ?? [];
      list.push(index);
      incident.set(id, list);
    }
  });

  /** A vertex continues an arc only if exactly two borders of the same pair meet. */
  const pairOf = (segment: Segment) => `${segment.left ?? '~'}|${segment.right ?? '~'}`;
  const isJunction = (id: string): boolean => {
    const list = incident.get(id) ?? [];
    if (list.length !== 2) return true;
    return pairOf(segments[list[0]]) !== pairOf(segments[list[1]]);
  };

  const used = new Set<number>();
  const arcs: Arc[] = [];

  const walk = (startId: string, first: number): void => {
    const segment = segments[first];
    const startPoint = at.get(startId)!;
    let current = pointId(segment.a) === startId ? segment.b : segment.a;
    const points: Point[] = [startPoint, current];
    used.add(first);
    let index = first;

    for (let guard = 0; guard < 200000; guard++) {
      const id = pointId(current);
      if (isJunction(id)) break;
      const next = (incident.get(id) ?? []).find((i) => i !== index && !used.has(i));
      if (next === undefined) break;
      const seg = segments[next];
      used.add(next);
      current = pointId(seg.a) === id ? seg.b : seg.a;
      points.push(current);
      index = next;
    }

    arcs.push({ points, left: segment.left, right: segment.right });
  };

  // Arcs that start at a junction first, so the leftovers are true closed loops.
  for (const [id, list] of incident) {
    if (!isJunction(id)) continue;
    for (const index of list) {
      if (used.has(index)) continue;
      walk(id, index);
    }
  }
  segments.forEach((_, index) => {
    if (used.has(index)) return;
    walk(pointId(segments[index].a), index);
  });

  return arcs;
}

/**
 * Chaikin corner cutting with the endpoints pinned, preceded by a wobble.
 *
 * The wobble is seeded from the pair of territories the arc separates, so it is
 * the same on every build, and it is applied *before* smoothing — displacing a
 * smooth curve makes it ragged, smoothing a displaced one makes it organic.
 */
function smoothArc(arc: Arc, config: MapConfig): Point[] {
  if (arc.smoothed) return arc.smoothed;

  const isCoast = arc.left === null || arc.right === null;
  const amplitude = isCoast ? config.coastNoise : config.inlandNoise;
  const random = rng(hash(`${arc.left ?? '~'}|${arc.right ?? '~'}|${pointId(arc.points[0])}`));

  let points = arc.points.map((p) => ({ ...p }));
  const closed = pointId(points[0]) === pointId(points[points.length - 1]);

  if (amplitude > 0 && points.length > 3) {
    const phase = random() * TAU;
    const frequency = 0.55 + random() * 0.5;
    points = points.map((p, i) => {
      if (!closed && (i === 0 || i === points.length - 1)) return p;
      const prev = points[(i - 1 + points.length) % points.length];
      const next = points[(i + 1) % points.length];
      const tx = next.x - prev.x;
      const ty = next.y - prev.y;
      const length = Math.hypot(tx, ty) || 1;
      // Displace along the normal only: moving along the tangent just
      // redistributes the samples and changes nothing about the shape.
      const wave =
        Math.sin(i * frequency + phase) * 0.65 + Math.sin(i * frequency * 2.3 + phase * 1.7) * 0.35;
      const offset = wave * amplitude;
      return { x: p.x + (-ty / length) * offset, y: p.y + (tx / length) * offset };
    });
  }

  for (let pass = 0; pass < config.smoothPasses; pass++) {
    const next: Point[] = [];
    if (!closed) next.push(points[0]);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!closed) next.push(points[points.length - 1]);
    else next.push(next[0]);
    points = next;
  }

  arc.smoothed = points;
  return points;
}

/* ────────────────────────  Rebuilding the polygons  ────────────────────── */

/**
 * Chains a territory's arcs back into closed loops. Arcs are shared, so this is
 * where the guarantee pays off: the loop is built from the same curves the
 * neighbours use, and adjacent fills meet exactly.
 */
function loopsFor(domainId: string, arcs: Arc[], config: MapConfig): Point[][] {
  const mine = arcs.filter((arc) => arc.left === domainId || arc.right === domainId);
  if (!mine.length) return [];

  const remaining = new Set(mine.map((_, i) => i));
  const endpoints = new Map<string, number[]>();
  mine.forEach((arc, index) => {
    for (const id of [pointId(arc.points[0]), pointId(arc.points[arc.points.length - 1])]) {
      endpoints.set(id, [...(endpoints.get(id) ?? []), index]);
    }
  });

  const loops: Point[][] = [];

  while (remaining.size) {
    const start = remaining.values().next().value as number;
    remaining.delete(start);

    let curve = smoothArc(mine[start], config);
    const startId = pointId(mine[start].points[0]);
    let tailId = pointId(mine[start].points[mine[start].points.length - 1]);
    const loop: Point[] = [...curve];

    if (startId === tailId) {
      loops.push(loop);
      continue;
    }

    for (let guard = 0; guard < 100000; guard++) {
      const next = (endpoints.get(tailId) ?? []).find((i) => remaining.has(i));
      if (next === undefined) break;
      remaining.delete(next);
      curve = smoothArc(mine[next], config);
      const head = pointId(mine[next].points[0]);
      const forward = head === tailId;
      const piece = forward ? curve : [...curve].reverse();
      loop.push(...piece.slice(1));
      tailId = forward
        ? pointId(mine[next].points[mine[next].points.length - 1])
        : pointId(mine[next].points[0]);
      if (tailId === startId) break;
    }

    if (loop.length >= 4) loops.push(loop);
  }

  return loops;
}

const toPath = (loops: Point[][]): string =>
  loops
    .map((loop) => `M${loop.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}Z`)
    .join('');

/* ─────────────────────────────────  Scoring  ───────────────────────────── */

/**
 * One number per layout so restarts can be compared. Two things matter and
 * they trade off: territories should be the size their course count asks for,
 * and a domain should touch what it draws from.
 */
function scoreLayout(
  domains: Domain[],
  quotas: Map<string, number>,
  growth: Growth,
  adjacency: Set<string>
): { score: number; areaError: number; adjacencyRate: number } {
  const totalQuota = domains.reduce((sum, d) => sum + Math.max(1, quotas.get(d.id) ?? 1), 0);
  const totalCells = [...growth.sizes.values()].reduce((a, b) => a + b, 0) || 1;

  let areaError = 0;
  for (const domain of domains) {
    const want = Math.max(1, quotas.get(domain.id) ?? 1) / totalQuota;
    const got = (growth.sizes.get(domain.id) ?? 0) / totalCells;
    areaError += Math.abs(got - want) / want;
  }
  areaError /= domains.length;

  let wanted = 0;
  let realized = 0;
  for (const domain of domains) {
    for (const source of domain.dependsOn) {
      const other = domains.find((d) => d.id === source);
      if (!other || other.continent !== domain.continent) continue;
      wanted += 1;
      const pair = domain.id < source ? `${domain.id}|${source}` : `${source}|${domain.id}`;
      if (adjacency.has(pair)) realized += 1;
    }
  }
  const adjacencyRate = wanted ? realized / wanted : 1;

  return { score: areaError * 2 + (1 - adjacencyRate), areaError, adjacencyRate };
}

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

/* ──────────────────────────────  Label anchors  ────────────────────────── */

/**
 * Pole of inaccessibility: the centre of the largest circle that fits inside
 * the territory. A centroid falls outside a horseshoe-shaped region and drops
 * the label in the neighbour's land; this cannot.
 *
 * Computed on the hex grid by a distance transform, which is exact enough at
 * this cell size and far simpler than the polygon version.
 */
function poleOf(cells: Cell[], owner: Map<number, string>, domainId: string, hexR: number): { point: Point; radius: number } | null {
  const mine = cells.filter((c) => owner.get(cellKey(c.q, c.r)) === domainId);
  if (!mine.length) return null;

  const set = new Set(mine.map((c) => cellKey(c.q, c.r)));
  const depth = new Map<number, number>();
  const queue: number[] = [];

  for (const cell of mine) {
    const key = cellKey(cell.q, cell.r);
    const edge = DIRECTIONS.some((d) => !set.has(cellKey(cell.q + d.q, cell.r + d.r)));
    if (edge) {
      depth.set(key, 0);
      queue.push(key);
    }
  }

  const byKey = new Map(mine.map((c) => [cellKey(c.q, c.r), c]));
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const cell = byKey.get(key)!;
    const d = depth.get(key)!;
    for (const dir of DIRECTIONS) {
      const nk = cellKey(cell.q + dir.q, cell.r + dir.r);
      if (!set.has(nk) || depth.has(nk)) continue;
      depth.set(nk, d + 1);
      queue.push(nk);
    }
  }

  let best: Cell | null = null;
  let bestDepth = -1;
  for (const cell of mine) {
    const d = depth.get(cellKey(cell.q, cell.r)) ?? 0;
    if (d > bestDepth) {
      bestDepth = d;
      best = cell;
    }
  }
  if (!best) return null;
  return { point: { x: best.x, y: best.y }, radius: (bestDepth + 0.5) * hexR * 1.5 };
}

/* ─────────────────────────────────  Public  ────────────────────────────── */

export type Territory = {
  domain: Domain;
  /** Closed loops, already smoothed and shared with the neighbours. */
  path: string;
  label: Point;
  /** Radius of the largest inscribed circle — how much room the label has. */
  room: number;
  cells: number;
  quotaShare: number;
  areaShare: number;
};

export type MapResult = {
  territories: Territory[];
  /** One closed path per continent, for the coastline and the drop shadow. */
  coasts: Array<{ continent: Continent; path: string }>;
  viewBox: string;
  metrics: { areaError: number; adjacencyRate: number; cells: number; attempts: number };
};

export function generateMap(
  domains: Domain[],
  courseCounts: Map<string, number>,
  overrides: Partial<MapConfig> = {}
): MapResult {
  const config = { ...defaultConfig, ...overrides };
  const hexArea = 1.5 * SQRT3 * config.hexR * config.hexR;

  // The weight a domain carries into the layout. The floor is what keeps an
  // empty domain on the map — an untouched outskirt is a task, not a hole —
  // and the multiplier is what stops the floor from flattening the differences.
  const weightOf = (id: string) => 1 + (courseCounts.get(id) ?? 0) * 3;

  let bestGrowth: Growth | null = null;
  let bestField: Cell[] = [];
  let bestSilhouettes: Silhouette[] = [];
  let bestTargets = new Map<string, number>();
  let bestScore = Infinity;
  let bestMetrics = { areaError: 1, adjacencyRate: 0 };

  for (let attempt = 0; attempt < config.restarts; attempt++) {
    const random = rng(config.seed + attempt * 7919);
    const silhouettes = layoutContinents(domains, courseCounts, config, random);
    const field = buildField(silhouettes, config);

    // Targets are absolute cell counts, not abstract quotas. A continent is
    // partitioned completely, so a domain's due is its share of the cells that
    // actually exist there — computing it from the ideal ellipse area instead
    // leaves every territory chasing a number the ground cannot supply.
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

    const anchors = computeAnchors(domains, targets, silhouettes, hexArea, random);
    const growth = partition(field, domains, targets, anchors, hexArea);
    const adjacency = adjacencyOf(field, growth.owner);
    const result = scoreLayout(domains, targets, growth, adjacency);

    if (result.score < bestScore) {
      bestScore = result.score;
      bestGrowth = growth;
      bestField = field;
      bestSilhouettes = silhouettes;
      bestTargets = targets;
      bestMetrics = { areaError: result.areaError, adjacencyRate: result.adjacencyRate };
    }
  }

  const growth = bestGrowth!;
  const arcs = buildArcs(bestField, growth.owner, config.hexR);

  const totalQuota = domains.reduce((sum, d) => sum + Math.max(1, bestTargets.get(d.id) ?? 1), 0);
  const totalCells = [...growth.sizes.values()].reduce((a, b) => a + b, 0) || 1;

  const territories: Territory[] = [];
  for (const domain of domains) {
    const loops = loopsFor(domain.id, arcs, config);
    if (!loops.length) continue;
    const pole = poleOf(bestField, growth.owner, domain.id, config.hexR);
    territories.push({
      domain,
      path: toPath(loops),
      label: pole?.point ?? { x: 0, y: 0 },
      room: pole?.radius ?? 0,
      cells: growth.sizes.get(domain.id) ?? 0,
      quotaShare: Math.max(1, bestTargets.get(domain.id) ?? 1) / totalQuota,
      areaShare: (growth.sizes.get(domain.id) ?? 0) / totalCells,
    });
  }

  // The coastline is the union of a continent's territories, which is exactly
  // the arcs whose other side is the ocean.
  const coasts = bestSilhouettes.map((s) => {
    const ids = new Set(domains.filter((d) => d.continent === s.continent).map((d) => d.id));
    const coastArcs = arcs.filter(
      (arc) =>
        (arc.left === null && arc.right && ids.has(arc.right)) ||
        (arc.right === null && arc.left && ids.has(arc.left))
    );
    const loops: Point[][] = [];
    const remaining = new Set(coastArcs.map((_, i) => i));
    const endpoints = new Map<string, number[]>();
    coastArcs.forEach((arc, index) => {
      for (const id of [pointId(arc.points[0]), pointId(arc.points[arc.points.length - 1])]) {
        endpoints.set(id, [...(endpoints.get(id) ?? []), index]);
      }
    });
    while (remaining.size) {
      const start = remaining.values().next().value as number;
      remaining.delete(start);
      const loop = [...smoothArc(coastArcs[start], config)];
      const startId = pointId(coastArcs[start].points[0]);
      let tailId = pointId(coastArcs[start].points[coastArcs[start].points.length - 1]);
      if (startId !== tailId) {
        for (let guard = 0; guard < 100000; guard++) {
          const next = (endpoints.get(tailId) ?? []).find((i) => remaining.has(i));
          if (next === undefined) break;
          remaining.delete(next);
          const curve = smoothArc(coastArcs[next], config);
          const head = pointId(coastArcs[next].points[0]);
          const forward = head === tailId;
          loop.push(...(forward ? curve : [...curve].reverse()).slice(1));
          tailId = forward
            ? pointId(coastArcs[next].points[coastArcs[next].points.length - 1])
            : pointId(coastArcs[next].points[0]);
          if (tailId === startId) break;
        }
      }
      if (loop.length >= 4) loops.push(loop);
    }
    return { continent: s.continent, path: toPath(loops) };
  });

  return {
    territories,
    coasts,
    viewBox: `0 0 ${config.width} ${config.height}`,
    metrics: { ...bestMetrics, cells: totalCells, attempts: config.restarts },
  };
}
