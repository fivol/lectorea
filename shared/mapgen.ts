import type { Continent, Domain } from './schema.js';
import type { Landform } from './domain-graph.js';

/**
 * Draws the map: every domain conquers the ground its course count entitles it
 * to, and the coastline is whatever that leaves behind.
 *
 * Three decisions carry the whole thing.
 *
 *  1. **The land is the result, not the container.** An earlier version drew a
 *     continent silhouette first and had the domains fill it. Whatever the
 *     domains did not want went to whoever was nearest, so the largest field
 *     flooded every gap and its territory stopped meaning anything. Here a
 *     territory claims exactly its quota and stops; the union of the
 *     territories *is* the continent, and there is no leftover to hand out.
 *
 *  2. **Compactness is measured from the seed, never from the centroid.** A
 *     centroid follows whatever was last claimed, so growing a tendril drags
 *     the centre after it and makes extending the same tendril cheaper still.
 *     That feedback loop is what turns this family of algorithms into spaghetti.
 *
 *  3. **Borders live in one shared graph.** Every border vertex exists once, so
 *     two neighbours cannot disagree about where their border runs, and the
 *     corner rounding applied when the path is written cannot open a gap.
 */

const SQRT3 = Math.sqrt(3);
const TAU = Math.PI * 2;

/* ────────────────────────────────  Config  ─────────────────────────────── */

export type MapConfig = {
  width: number;
  height: number;

  /** Side of a grid hex, in map units. Big enough that the grid reads. */
  hexR: number;
  /** Share of the canvas the land adds up to. Sets how many hexes exist. */
  landFraction: number;
  /** Ocean between one landmass and the next, in map units. */
  strait: number;

  /** Pull towards a territory's own seed. High = round, low = rambling. */
  compactness: number;
  /** How much terrain noise steers a claim. High = ragged, wandering borders. */
  irregularity: number;
  /** Corner rounding of the hex outline, in map units. 0 = hard geometry. */
  cornerRadius: number;

  /**
   * How firmly the dependency order is imposed on the vertical axis.
   * 0 ignores it; 1 pulls every domain onto the row its level asks for.
   */
  layering: number;
  /** How strongly linked domains pull towards each other while seeding. */
  linkPull: number;

  /** How far a peninsula is pushed out of its continent's huddle. */
  peninsulaReach: number;
  /** Ocean kept clear around an island. */
  islandGap: number;

  seed: number;
};

export const defaultConfig: MapConfig = {
  width: 1680,
  height: 980,
  hexR: 16,
  landFraction: 0.44,
  strait: 90,
  compactness: 1,
  irregularity: 0.4,
  cornerRadius: 5,
  layering: 0.7,
  linkPull: 0.55,
  peninsulaReach: 0.5,
  islandGap: 34,
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

/** Value noise on an integer lattice — no tables, reproducible anywhere. */
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

/* ───────────────────────────────  Geometry  ────────────────────────────── */

export type Point = { x: number; y: number };

/** Neighbour directions, ordered so direction d sits between corners d and d+1. */
const DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

const cellKey = (q: number, r: number): number => (q + 4096) * 16384 + (r + 4096);
const keyQ = (key: number): number => Math.floor(key / 16384) - 4096;
const keyR = (key: number): number => (key % 16384) - 4096;

const centreOf = (q: number, r: number, hexR: number): Point => ({
  x: hexR * SQRT3 * (q + r / 2),
  y: hexR * 1.5 * r,
});

const cornerOf = (q: number, r: number, index: number, hexR: number): Point => {
  const c = centreOf(q, r, hexR);
  const angle = ((60 * index - 30) * Math.PI) / 180;
  return { x: c.x + hexR * Math.cos(angle), y: c.y + hexR * Math.sin(angle) };
};

/* ──────────────────────────────  Landmasses  ───────────────────────────── */

/**
 * A cluster of territories with a coastline of its own.
 *
 * `reach` is not a shape to be filled — it is only the room the cluster may
 * spread into, so that two landmasses cannot grow into one another. What the
 * land ends up looking like is decided entirely by the territories inside it.
 */
type Landmass = {
  id: string;
  kind: 'continent' | 'island';
  continent: Continent;
  members: string[];
  centre: Point;
  /** Half-axes of the room the cluster may spread into. rx*ry is its area. */
  rx: number;
  ry: number;
};

/** Is the point inside the landmass's room? */
const within = (mass: Landmass, x: number, y: number): boolean =>
  ((x - mass.centre.x) / mass.rx) ** 2 + ((y - mass.centre.y) / mass.ry) ** 2 <= 1;

/** Room for the cluster plus slack for it to take an interesting shape. */
const ROOM = 1.25;

/**
 * How much taller than wide a landmass gets per unit of level spread.
 *
 * A cluster laid out in rows needs vertical room in proportion to how many
 * rows it holds. Given a circle it cannot fit, and the ends get clamped until
 * the middle empties and the continent tears into two islands — which is
 * exactly what happened before this existed.
 */
const STRETCH = 0.1;

/** Never so tall that the row of continents cannot be packed side by side. */
const MAX_STRETCH = 1.5;

/**
 * Taller than wide in proportion to how many rows the cluster has to hold.
 * The area is preserved — rx is divided by exactly what ry is multiplied by —
 * so stretching a continent never changes how much land it gets.
 *
 * Counted in levels rather than in pixels. Pixels would make a small continent
 * spanning many levels stretch to the full height of the canvas on an area
 * that cannot reach that far, and it tears into a string of islands.
 */
function aspectFor(members: string[], levelOf: (id: string) => number): number {
  if (members.length < 2) return 1;
  const levels = members.map(levelOf);
  const span = Math.max(...levels) - Math.min(...levels);
  return Math.min(MAX_STRETCH, 1 + STRETCH * span);
}

function layoutWorld(
  domains: Domain[],
  targetOf: (id: string) => number,
  landformOf: (id: string) => Landform,
  reachesOf: (id: string) => Continent[],
  rowOf: (id: string) => number,
  levelOf: (id: string) => number,
  hexArea: number,
  config: MapConfig
): Landmass[] {
  const order: Continent[] = ['formal', 'social', 'humanities'];
  const radiusFor = (cells: number) => Math.sqrt((cells * hexArea) / Math.PI) * ROOM;

  const islanders = domains.filter((d) => landformOf(d.id) === 'island');
  const present = order.filter((c) =>
    domains.some((d) => d.continent === c && landformOf(d.id) !== 'island')
  );

  const cores = present.map((continent) => {
    const members = domains.filter(
      (d) => d.continent === continent && landformOf(d.id) !== 'island'
    );
    const cells = members.reduce((sum, d) => sum + targetOf(d.id), 0);
    const reach = radiusFor(cells);
    const stretch = aspectFor(members.map((d) => d.id), levelOf);
    return {
      continent,
      members: members.map((d) => d.id),
      rx: reach / stretch,
      ry: reach * stretch,
    };
  });

  const spanX = cores.reduce((sum, c) => sum + c.rx * 2, 0) + config.strait * (cores.length - 1);

  const world: Landmass[] = [];
  let cursor = (config.width - spanX) / 2;
  for (const core of cores) {
    // A continent floats to the height its own content asks for: one built on
    // foundations everything else rests on sits low, one made of fields that
    // draw on three other continents sits high. Clamped so it stays on canvas,
    // which is also what keeps a shallow continent from hugging the edge.
    const rows = core.members.map(rowOf);
    const wanted = rows.length ? rows.reduce((sum, y) => sum + y, 0) / rows.length : config.height / 2;
    const pad = core.ry + 8;
    world.push({
      id: core.continent,
      kind: 'continent',
      continent: core.continent,
      members: core.members,
      centre: {
        x: cursor + core.rx,
        y: Math.min(config.height - pad, Math.max(pad, wanted)),
      },
      rx: core.rx,
      ry: core.ry,
    });
    cursor += core.rx * 2 + config.strait;
  }

  const continentAt = new Map(world.map((m) => [m.continent, m]));

  // An island starts where its links average out — between its own continent
  // and the ones it reaches. That midpoint is the claim it exists to make.
  const islands: Landmass[] = islanders.map((domain) => {
    const local = rng(hash(`${domain.id}#island#${config.seed}`));
    const pull = [domain.continent, ...reachesOf(domain.id)]
      .map((c) => continentAt.get(c))
      .filter((m): m is Landmass => Boolean(m));
    const start = pull.length
      ? {
          x: pull.reduce((sum, m) => sum + m.centre.x, 0) / pull.length,
          y: pull.reduce((sum, m) => sum + m.centre.y, 0) / pull.length,
        }
      : { x: config.width / 2, y: config.height / 2 };

    return {
      id: `island:${domain.id}`,
      kind: 'island' as const,
      continent: domain.continent,
      members: [domain.id],
      centre: {
        x: start.x + (local() * 2 - 1) * config.strait * 0.5,
        // An island keeps its row too: it depends on things, and drifting off
        // the vertical axis would be the one place the map stopped saying so.
        y: rowOf(domain.id) + (local() * 2 - 1) * config.height * 0.1,
      },
      rx: radiusFor(targetOf(domain.id)),
      ry: radiusFor(targetOf(domain.id)),
    };
  });

  // Float them clear. An island overlapping a continent is not an island, and
  // two overlapping islands are one island with a strange outline.
  for (let pass = 0; pass < 300; pass++) {
    for (const island of islands) {
      for (const other of [...world, ...islands]) {
        if (other === island) continue;
        const dx = island.centre.x - other.centre.x;
        const dy = island.centre.y - other.centre.y;
        const distance = Math.hypot(dx, dy) || 1;
        const wanted =
          Math.max(island.rx, island.ry) +
          Math.max(other.rx, other.ry) +
          config.islandGap;
        if (distance >= wanted) continue;
        const push = ((wanted - distance) / distance) * (other.kind === 'island' ? 0.3 : 0.5);
        island.centre.x += dx * push;
        island.centre.y += dy * push;
        if (other.kind === 'island') {
          other.centre.x -= dx * push;
          other.centre.y -= dy * push;
        }
      }
      const padX = island.rx + 8;
      const padY = island.ry + 8;
      island.centre.x = Math.min(config.width - padX, Math.max(padX, island.centre.x));
      island.centre.y = Math.min(config.height - padY, Math.max(padY, island.centre.y));
    }
  }

  return [...world, ...islands];
}

/* ─────────────────────────────  Seed placement  ─────────────────────────── */

/**
 * Where each territory starts. All this has to get right is that related
 * domains begin near each other and that nobody starts inside a neighbour's
 * ground — growth decides everything else.
 *
 * A peninsula is pushed outwards on purpose. It has almost no links home, and a
 * domain seeded on the rim with nothing behind it grows into open water on
 * three sides, which is what a peninsula is.
 */
function placeSeeds(
  domains: Domain[],
  world: Landmass[],
  homeOf: Map<string, string>,
  targetOf: (id: string) => number,
  landformOf: (id: string) => Landform,
  edges: Array<{ from: string; to: string; weight: number }>,
  levelOf: (id: string) => number,
  hexArea: number,
  config: MapConfig,
  random: () => number
): Map<string, Point> {
  const seeds = new Map<string, Point>();
  const radiusOf = (id: string) => Math.sqrt((targetOf(id) * hexArea) / Math.PI);
  const massById = new Map(world.map((m) => [m.id, m]));

  /**
   * The row a domain belongs on, in pixels, inside its own landmass.
   *
   * The order is global — a domain's level counts every chain that reaches it,
   * from any continent — but the spacing is local. Spacing the rows globally
   * asks a small continent that happens to span five levels to stretch across
   * the whole canvas on an area that cannot reach, and it snaps into a chain
   * of islands. Normalising inside the landmass keeps the order and drops only
   * the promise that a row means the same height everywhere, which no reader
   * was going to measure across an ocean anyway.
   */
  const rowIn = new Map<string, number>();
  for (const mass of world) {
    const levels = mass.members.map(levelOf);
    const low = Math.min(...levels);
    const high = Math.max(...levels);
    for (const id of mass.members) {
      const t = high > low ? (levelOf(id) - low) / (high - low) : 0.5;
      rowIn.set(id, mass.centre.y + (0.5 - t) * 2 * mass.ry * 0.78);
    }
  }
  const rowOf = (id: string): number => rowIn.get(id) ?? 0;

  for (const mass of world) {
    const spin = random() * TAU;
    mass.members.forEach((id, index) => {
      // Golden angle: an even spread favouring no direction, so adding a domain
      // rotates the arrangement instead of reshuffling it.
      const t = (index + 0.5) / mass.members.length;
      const angle = spin + index * 2.399963;
      const out = landformOf(id) === 'peninsula' ? 0.6 + config.peninsulaReach * 0.35 : 0.48;
      // Start on the row the dependency order asks for and let the forces sort
      // out the rest. Starting from a spiral and relaxing towards the rows
      // wastes most of the passes undoing the spiral.
      const spiralY = mass.centre.y + Math.sin(angle) * mass.ry * out * Math.sqrt(t);
      seeds.set(id, {
        x: mass.centre.x + Math.cos(angle) * mass.rx * out * Math.sqrt(t),
        y: spiralY * (1 - config.layering) + rowOf(id) * config.layering,
      });
    });
  }

  const linked = new Map<string, Array<{ id: string; weight: number }>>();
  for (const edge of edges) {
    if (homeOf.get(edge.from) !== homeOf.get(edge.to)) continue;
    // Attraction is symmetric even though the edge is not: both ends of a
    // dependency want to be near each other. Direction is spent on the
    // vertical axis instead, where it means something.
    linked.set(edge.from, [...(linked.get(edge.from) ?? []), { id: edge.to, weight: edge.weight }]);
    linked.set(edge.to, [...(linked.get(edge.to) ?? []), { id: edge.from, weight: edge.weight }]);
  }

  for (let pass = 0; pass < 90; pass++) {
    const cooling = 1 - pass / 180;

    for (const domain of domains) {
      const own = seeds.get(domain.id);
      const mass = massById.get(homeOf.get(domain.id) ?? '');
      if (!own || !mass) continue;

      const neighbours = linked.get(domain.id) ?? [];
      if (neighbours.length) {
        let sx = 0;
        let sy = 0;
        let total = 0;
        for (const link of neighbours) {
          const point = seeds.get(link.id);
          if (!point) continue;
          sx += point.x * link.weight;
          sy += point.y * link.weight;
          total += link.weight;
        }
        if (total) {
          const pull = 0.16 * config.linkPull * cooling;
          own.x += (sx / total - own.x) * pull;
          own.y += (sy / total - own.y) * pull;
        }
      }

      // Cohesion holds the cluster together while repulsion spreads it out. A
      // peninsula is exempt: pulling it back in is the one thing that would
      // stop it being a peninsula.
      if (landformOf(domain.id) !== 'peninsula') {
        own.x += (mass.centre.x - own.x) * 0.035;
        own.y += (mass.centre.y - own.y) * 0.035;
      }

      // The vertical axis is the dependency order: a domain is pulled onto the
      // row its level asks for, so what everything else rests on ends up at the
      // bottom and the most dependent fields at the top.
      own.y += (rowOf(domain.id) - own.y) * config.layering * 0.3;
    }

    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        if (homeOf.get(domains[i].id) !== homeOf.get(domains[j].id)) continue;
        const a = seeds.get(domains[i].id)!;
        const b = seeds.get(domains[j].id)!;
        // Deliberately closer than the two areas need. Seeds spaced by the
        // full radii leave the continent full of holes: every territory stops
        // at its quota, and with nobody flooding the leftovers the gaps simply
        // stay. Packed tighter, the territories meet and grow around each
        // other, and the landmass comes out solid.
        const wanted = (radiusOf(domains[i].id) + radiusOf(domains[j].id)) * 0.82;
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
        // Two domains on the same row must give way sideways, not vertically —
        // resolving a collision by moving one up is exactly the thing the
        // level spring is there to prevent, and the two would fight forever.
        const sideways = 1 - config.layering * 0.75;
        a.x -= dx * push;
        a.y -= dy * push * sideways;
        b.x += dx * push;
        b.y += dy * push * sideways;
      }
    }

    for (const domain of domains) {
      const own = seeds.get(domain.id);
      const mass = massById.get(homeOf.get(domain.id) ?? '');
      if (!own || !mass) continue;
      // Pull the seed back onto the ellipse, keeping room for its own area.
      const inset = radiusOf(domain.id) * 0.6;
      const rx = Math.max(1, mass.rx - inset);
      const ry = Math.max(1, mass.ry - inset);
      const dx = own.x - mass.centre.x;
      const dy = own.y - mass.centre.y;
      const reach = Math.hypot(dx / rx, dy / ry);
      if (reach <= 1 || reach < 1e-6) continue;
      own.x = mass.centre.x + dx / reach;
      own.y = mass.centre.y + dy / reach;
    }
  }

  return seeds;
}

/* ────────────────────────────────  Growth  ─────────────────────────────── */

type Growth = { owner: Map<number, string>; sizes: Map<string, number>; hexR: number };

type Plot = {
  id: string;
  size: number;
  seed: Point;
  ideal: number;
  frontier: Set<number>;
  noiseSeed: number;
};

/**
 * Every territory claims hexes until it holds the number its course count is
 * due, then stops. Whoever is furthest behind goes next, so they expand
 * together instead of the first one taking the middle.
 *
 * Which hex it takes is the whole of the map's character: the pull towards its
 * own seed keeps it compact enough to hold a label, the count of neighbours it
 * already owns stops it reaching out on a single point of contact, and terrain
 * noise keeps the edge from being a circle.
 */
function grow(
  domains: Domain[],
  world: Landmass[],
  homeOf: Map<string, string>,
  seeds: Map<string, Point>,
  targetOf: (id: string) => number,
  hexArea: number,
  config: MapConfig
): Growth {
  const { hexR } = config;
  const massById = new Map(world.map((m) => [m.id, m]));
  const owner = new Map<number, string>();
  const plots = new Map<string, Plot>();
  const grain = Math.max(1, hexR * 2.6);

  /** Hexes a landmass may use. Not a shape — only a fence between clusters. */
  const roomFor = (massId: string, x: number, y: number): boolean => {
    const mass = massById.get(massId);
    if (!mass) return false;
    return within(mass, x, y);
  };

  const claim = (key: number, plot: Plot, massId: string): void => {
    const q = keyQ(key);
    const r = keyR(key);
    owner.set(key, plot.id);
    plot.size += 1;
    plot.frontier.delete(key);
    for (const dir of DIRECTIONS) {
      const nq = q + dir.q;
      const nr = r + dir.r;
      const nk = cellKey(nq, nr);
      if (owner.has(nk)) continue;
      const centre = centreOf(nq, nr, hexR);
      if (!roomFor(massId, centre.x, centre.y)) continue;
      plot.frontier.add(nk);
    }
  };

  // Seed largest first, so the big fields take the open middle and the small
  // ones settle around them rather than the other way about.
  const order = [...domains].sort((a, b) => targetOf(b.id) - targetOf(a.id));
  for (const domain of order) {
    const massId = homeOf.get(domain.id);
    const seed = seeds.get(domain.id);
    if (!massId || !seed) continue;

    // Nearest free hex to the seed, searched outwards from the one it lands in.
    const r0 = Math.round(seed.y / (hexR * 1.5));
    const q0 = Math.round(seed.x / (hexR * SQRT3) - r0 / 2);
    let best = -1;
    let bestDistance = Infinity;
    for (let dr = -8; dr <= 8; dr++) {
      for (let dq = -8; dq <= 8; dq++) {
        const key = cellKey(q0 + dq, r0 + dr);
        if (owner.has(key)) continue;
        const centre = centreOf(q0 + dq, r0 + dr, hexR);
        if (!roomFor(massId, centre.x, centre.y)) continue;
        const d = (centre.x - seed.x) ** 2 + (centre.y - seed.y) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = key;
        }
      }
    }
    if (best < 0) continue;

    const plot: Plot = {
      id: domain.id,
      size: 0,
      seed: centreOf(keyQ(best), keyR(best), hexR),
      ideal: Math.max(hexR, Math.sqrt((targetOf(domain.id) * hexArea) / Math.PI)),
      frontier: new Set(),
      noiseSeed: hash(`${domain.id}#${config.seed}`) % 100000,
    };
    plots.set(domain.id, plot);
    claim(best, plot, massId);
  }

  const hungry = new Set([...plots.keys()].filter((id) => plots.get(id)!.size < targetOf(id)));

  while (hungry.size) {
    let chosen: Plot | null = null;
    let lowest = Infinity;
    for (const id of hungry) {
      const plot = plots.get(id)!;
      const fill = plot.size / targetOf(id);
      if (fill < lowest) {
        lowest = fill;
        chosen = plot;
      }
    }
    if (!chosen) break;

    const massId = homeOf.get(chosen.id)!;
    for (const key of [...chosen.frontier]) if (owner.has(key)) chosen.frontier.delete(key);
    if (!chosen.frontier.size) {
      hungry.delete(chosen.id); // walled in — `settle` gives it its due back
      continue;
    }

    let pick = -1;
    let bestScore = -Infinity;
    for (const key of chosen.frontier) {
      const q = keyQ(key);
      const r = keyR(key);
      const centre = centreOf(q, r, hexR);
      const distance = Math.hypot(centre.x - chosen.seed.x, centre.y - chosen.seed.y);

      let support = 0;
      for (const dir of DIRECTIONS) {
        if (owner.get(cellKey(q + dir.q, r + dir.r)) === chosen.id) support += 1;
      }

      const compact = -((distance / chosen.ideal) ** 2);
      const terrain = noise2(centre.x / grain, centre.y / grain, chosen.noiseSeed) - 0.5;
      const score =
        config.compactness * (2.2 * compact + 0.95 * support) + config.irregularity * 2 * terrain;

      if (score > bestScore) {
        bestScore = score;
        pick = key;
      }
    }

    if (pick < 0) {
      hungry.delete(chosen.id);
      continue;
    }
    claim(pick, chosen, massId);
    if (chosen.size >= targetOf(chosen.id)) hungry.delete(chosen.id);
  }

  const sizes = new Map<string, number>();
  for (const [id, plot] of plots) sizes.set(id, plot.size);

  fillHoles(owner, sizes);
  settle(owner, sizes, targetOf);
  return { owner, sizes, hexR };
}

/**
 * Claims the pockmarks — hexes left unowned with land all around them.
 *
 * They are the one place the "no leftovers" rule reads as a mistake rather than
 * as a coastline: a single empty hex ringed by five or six territories is not a
 * lake, it is a gap. Only fully-enclosed hexes qualify, so this cannot creep
 * outward and become the flooding it replaced, and `settle` runs afterwards to
 * pay for the extra ground out of whoever ended up with a surplus.
 */
function fillHoles(owner: Map<number, string>, sizes: Map<string, number>): void {
  for (let pass = 0; pass < 4; pass++) {
    const holes = new Set<number>();
    for (const key of owner.keys()) {
      const q = keyQ(key);
      const r = keyR(key);
      for (const dir of DIRECTIONS) {
        const nk = cellKey(q + dir.q, r + dir.r);
        if (!owner.has(nk)) holes.add(nk);
      }
    }

    let filled = 0;
    for (const key of [...holes].sort((a, b) => a - b)) {
      const q = keyQ(key);
      const r = keyR(key);
      const ring = DIRECTIONS.map((dir) => owner.get(cellKey(q + dir.q, r + dir.r)));
      if (ring.filter(Boolean).length < 5) continue;

      const votes = new Map<string, number>();
      for (const id of ring) if (id) votes.set(id, (votes.get(id) ?? 0) + 1);
      let winner: string | null = null;
      let best = 0;
      for (const [id, count] of [...votes].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (count > best) {
          best = count;
          winner = id;
        }
      }
      if (!winner) continue;
      owner.set(key, winner);
      sizes.set(winner, (sizes.get(winner) ?? 0) + 1);
      filled += 1;
    }
    if (!filled) break;
  }
}

/**
 * Hands hexes from territories that overshot to neighbours walled in before
 * they had their share.
 *
 * Two guards keep this from undoing the shapes growth just made. A hex is given
 * up only if its owner stays in one piece without it — the simple-point test,
 * counting the runs of same-owner neighbours around it — and taken only if the
 * receiver already holds two of its neighbours, so nobody grows a one-hex spike
 * into somebody else's land.
 */
function settle(
  owner: Map<number, string>,
  sizes: Map<string, number>,
  targetOf: (id: string) => number
): void {
  const debt = (id: string) => (sizes.get(id) ?? 0) - targetOf(id);
  // Sorted, because iteration over a Map follows insertion order and would bias
  // every correction towards one side of the map.
  const keys = [...owner.keys()].sort((a, b) => a - b);

  for (let pass = 0; pass < 40; pass++) {
    let moved = 0;

    for (const key of keys) {
      const mine = owner.get(key);
      if (!mine || debt(mine) <= 0) continue;
      const q = keyQ(key);
      const r = keyR(key);
      const ring = DIRECTIONS.map((dir) => owner.get(cellKey(q + dir.q, r + dir.r)));

      let runs = 0;
      let ours = 0;
      for (let i = 0; i < 6; i++) {
        const here = ring[i] === mine;
        if (here) ours += 1;
        if (here && ring[(i + 5) % 6] !== mine) runs += 1;
      }
      if (runs !== 1 || ours < 2) continue;

      let taker: string | null = null;
      let worst = 0;
      for (let i = 0; i < 6; i++) {
        const other = ring[i];
        if (!other || other === mine) continue;
        if (ring.filter((x) => x === other).length < 2) continue;
        const owed = debt(other);
        if (owed < worst) {
          worst = owed;
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

/* ──────────────────────────  The border graph  ─────────────────────────── */

/**
 * Every border on the map as one planar graph.
 *
 * A vertex is stored once, so two territories cannot end up with different
 * ideas of where their shared border runs. An arc is the run of border between
 * two junctions and belongs to exactly two sides — which is what makes the
 * corner rounding safe: an arc is rounded once and both its owners draw the
 * result, so the curve cannot open a gap.
 */
type Arc = { vertices: number[]; left: string | null; right: string | null };

type BorderGraph = { xs: number[]; ys: number[]; arcs: Arc[] };

function buildBorderGraph(growth: Growth): BorderGraph {
  const { owner, hexR } = growth;
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

  // Sorted, so the arcs come out the same on every run regardless of the order
  // the territories happened to claim their hexes in.
  for (const key of [...owner.keys()].sort((a, b) => a - b)) {
    const mine = owner.get(key)!;
    const q = keyQ(key);
    const r = keyR(key);
    for (let d = 0; d < 6; d++) {
      const theirs = owner.get(cellKey(q + DIRECTIONS[d].q, r + DIRECTIONS[d].r)) ?? null;
      if (theirs === mine) continue;
      // Record each border once: the side with the smaller id keeps it.
      if (theirs !== null && theirs < mine) continue;
      segments.push({
        a: intern(cornerOf(q, r, d, hexR)),
        b: intern(cornerOf(q, r, (d + 1) % 6, hexR)),
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
  const isJunction = (v: number): boolean => {
    const list = incident[v];
    if (list.length !== 2) return true;
    return pairOf(segments[list[0]]) !== pairOf(segments[list[1]]);
  };

  const used = new Set<number>();
  const arcs: Arc[] = [];

  const walk = (start: number, first: number): void => {
    const segment = segments[first];
    let current = segment.a === start ? segment.b : segment.a;
    const vertices = [start, current];
    used.add(first);
    let at = first;

    for (let guard = 0; guard < 1e6; guard++) {
      if (isJunction(current)) break;
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
    if (!isJunction(v)) continue;
    for (const at of incident[v]) if (!used.has(at)) walk(v, at);
  }
  segments.forEach((segment, at) => {
    if (!used.has(at)) walk(segment.a, at); // a closed loop with no junction
  });

  return { xs, ys, arcs };
}

/* ────────────────────────  Outlines and rendering  ─────────────────────── */

const fixed = (value: number): string => value.toFixed(1);

/**
 * Chains arcs into closed rings and writes them out with the corners rounded.
 *
 * The rounding is a fillet rather than a smoothing pass: at each turn the path
 * stops short of the vertex, curves through it, and carries on. At zero the
 * outline is the hex grid exactly; raised, the hexes soften while staying
 * recognisably hexes. Because a fillet depends only on the two edges meeting at
 * the vertex, and both owners of a border see the same two, neighbours round it
 * identically and no gap can open between them.
 */
function pathFrom(arcs: Arc[], graph: BorderGraph, radius: number): string {
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
    const ring = [...arcs[start].vertices];

    if (head !== tail) {
      for (let guard = 0; guard < 1e5; guard++) {
        const next = (ends.get(tail) ?? []).find((i) => remaining.has(i));
        if (next === undefined) break;
        remaining.delete(next);
        const vertices = arcs[next].vertices;
        const forward = vertices[0] === tail;
        ring.push(...(forward ? vertices : [...vertices].reverse()).slice(1));
        tail = forward ? vertices[vertices.length - 1] : vertices[0];
        if (tail === head) break;
      }
    }

    // The chain comes back with its first vertex repeated at the end; the ring
    // is closed by the path command, so that copy would double a corner.
    if (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    if (ring.length < 3) continue;

    const points = ring.map((v) => ({ x: graph.xs[v], y: graph.ys[v] }));
    parts.push(radius > 0.05 ? filletRing(points, radius) : polygonRing(points));
  }

  return parts.join('');
}

function polygonRing(points: Point[]): string {
  return `M${points.map((p) => `${fixed(p.x)} ${fixed(p.y)}`).join('L')}Z`;
}

function filletRing(points: Point[], radius: number): string {
  const n = points.length;
  const at = (i: number) => points[((i % n) + n) % n];
  let d = '';

  for (let i = 0; i < n; i++) {
    const previous = at(i - 1);
    const here = at(i);
    const next = at(i + 1);

    const inX = here.x - previous.x;
    const inY = here.y - previous.y;
    const outX = next.x - here.x;
    const outY = next.y - here.y;
    const inLength = Math.hypot(inX, inY) || 1;
    const outLength = Math.hypot(outX, outY) || 1;

    // Never eat more than half of either edge, or two consecutive fillets
    // overrun each other and the outline folds over itself.
    const cut = Math.min(radius, inLength / 2, outLength / 2);
    const from = { x: here.x - (inX / inLength) * cut, y: here.y - (inY / inLength) * cut };
    const to = { x: here.x + (outX / outLength) * cut, y: here.y + (outY / outLength) * cut };

    d += i === 0 ? `M${fixed(from.x)} ${fixed(from.y)}` : `L${fixed(from.x)} ${fixed(from.y)}`;
    d += `Q${fixed(here.x)} ${fixed(here.y)},${fixed(to.x)} ${fixed(to.y)}`;
  }

  return `${d}Z`;
}

/* ──────────────────────────────  Label anchors  ────────────────────────── */

/**
 * Pole of inaccessibility — the centre of the largest circle that fits inside
 * the territory. A centroid lands outside a crescent and drops the label on the
 * neighbour's ground; this cannot. The radius that comes with it decides the
 * type size and whether the name fits at all.
 */
function poles(growth: Growth): Map<string, { point: Point; radius: number }> {
  const { owner, hexR } = growth;
  const depth = new Map<number, number>();
  const queue: number[] = [];

  for (const [key, mine] of owner) {
    const q = keyQ(key);
    const r = keyR(key);
    const edge = DIRECTIONS.some((d) => owner.get(cellKey(q + d.q, r + d.r)) !== mine);
    if (edge) {
      depth.set(key, 0);
      queue.push(key);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const q = keyQ(key);
    const r = keyR(key);
    const mine = owner.get(key);
    const d = depth.get(key)!;
    for (const dir of DIRECTIONS) {
      const nk = cellKey(q + dir.q, r + dir.r);
      if (depth.has(nk) || owner.get(nk) !== mine) continue;
      depth.set(nk, d + 1);
      queue.push(nk);
    }
  }

  const best = new Map<string, { point: Point; radius: number }>();
  for (const [key, id] of owner) {
    const radius = ((depth.get(key) ?? 0) + 0.5) * hexR * 1.5;
    const current = best.get(id);
    if (!current || radius > current.radius) {
      best.set(id, { point: centreOf(keyQ(key), keyR(key), hexR), radius });
    }
  }
  return best;
}

/* ─────────────────────────────────  Public  ────────────────────────────── */

export type Territory = {
  id: string;
  continent: Continent;
  landform: Landform;
  colour: string;
  /** Closed outline, shared with the neighbours vertex for vertex. */
  path: string;
  label: Point;
  room: number;
  cells: number;
  target: number;
  /** Signed share by which the territory misses the area it is due. */
  areaError: number;
};

export type MapInput = {
  domains: Domain[];
  courseCounts: Map<string, number>;
  /** Where the graph says each domain belongs. Absent = everyone inland. */
  landform?: Map<string, Landform>;
  /** Continents an offshore domain links to, so its island sits between them. */
  reaches?: Map<string, Continent[]>;
  /** Directed, weighted domain graph. `from` depends on `to`. */
  edges?: Array<{ from: string; to: string; weight: number }>;
  /** Depth in the dependency order. Roots are 0 and belong at the bottom. */
  levels?: Map<string, number>;
  maxLevel?: number;
};

export type MapResult = {
  territories: Territory[];
  coasts: Array<{ id: string; kind: 'continent' | 'island'; continent: Continent; path: string }>;
  /** Links that cross open water — where the reference map draws rope bridges. */
  links: Array<{ from: string; to: string; a: Point; b: Point }>;
  viewBox: string;
  width: number;
  height: number;
  metrics: {
    areaError: number;
    worstAreaError: number;
    hexes: number;
    smallest: number;
    /** Share of dependencies whose source ended up below its dependant. */
    upwardRate: number;
    elapsedMs: number;
  };
};

/**
 * How many hexes the world may contain.
 *
 * The obvious approach — take a share of the canvas and then scale the
 * arrangement down if the row of continents is too wide — quietly ruins the
 * map: scaling shrinks the room each cluster has but not the hexes inside it,
 * so the territories end up packed into a perfect disc and every continent
 * comes out a circle. So the budget is solved instead. A cluster's radius grows
 * as the square root of its hex count, which makes the row's width a function
 * of the budget that can simply be inverted.
 */
function hexBudget(
  domains: Domain[],
  weightOf: (id: string) => number,
  totalWeight: number,
  landformOf: (id: string) => Landform,
  hexArea: number,
  config: MapConfig
): number {
  const order: Continent[] = ['formal', 'social', 'humanities'];
  const shares = order
    .map((continent) =>
      domains
        .filter((d) => d.continent === continent && landformOf(d.id) !== 'island')
        .reduce((sum, d) => sum + weightOf(d.id), 0)
    )
    .filter((share) => share > 0);
  if (!shares.length) return 1;

  // Radius of a cluster holding one hex-budget's worth of this share. The row
  // is packed by the horizontal half-axis, so allow for the widest stretch a
  // layered continent can take — otherwise the row overflows once the levels
  // pull the continents tall and thin.
  const unit = shares.map((share) => Math.sqrt((share / totalWeight) * (hexArea / Math.PI)) * ROOM);
  const margin = 24;

  const acrossX =
    (config.width - margin * 2 - config.strait * (shares.length - 1)) /
    (2 * unit.reduce((sum, u) => sum + u, 0));
  const acrossY = (config.height - margin * 2) / (2 * Math.max(...unit) * MAX_STRETCH);

  const room = Math.min(acrossX, acrossY) ** 2;
  const wanted = (config.width * config.height * config.landFraction) / hexArea;
  return Math.max(12, Math.min(wanted, room));
}

/**
 * How much of the dependency order the picture actually shows: the share of
 * dependencies whose source ended up lower on the map than the domain that
 * rests on it.
 *
 * The layout only ever asks for this, it cannot promise it — a domain is also
 * being pulled sideways by its relatives and pushed around by its neighbours'
 * areas. So the claim is measured rather than assumed, and a number that drops
 * after a data change is the signal that the map has stopped meaning what it
 * used to.
 */
function upwardRate(
  domains: Domain[],
  territories: Territory[],
  levels: Map<string, number>
): number {
  const at = new Map(territories.map((t) => [t.id, t.label.y]));
  let wanted = 0;
  let honoured = 0;

  for (const domain of domains) {
    for (const source of domain.dependsOn) {
      const mine = at.get(domain.id);
      const theirs = at.get(source);
      if (mine === undefined || theirs === undefined) continue;
      // Same level, no claim to check — two roots are not above each other.
      if ((levels.get(domain.id) ?? 0) <= (levels.get(source) ?? 0)) continue;
      wanted += 1;
      if (theirs > mine) honoured += 1; // y grows downwards
    }
  }
  return wanted ? honoured / wanted : 1;
}

export function generateMap(input: MapInput, overrides: Partial<MapConfig> = {}): MapResult {
  const started = Date.now();
  const config: MapConfig = { ...defaultConfig, ...overrides };
  const hexArea = 1.5 * SQRT3 * config.hexR * config.hexR;

  const { domains, courseCounts } = input;
  const landformOf = (id: string): Landform => input.landform?.get(id) ?? 'mainland';
  const reachesOf = (id: string): Continent[] => input.reaches?.get(id) ?? [];

  // The floor keeps an empty domain on the map — an untouched outskirt is a
  // task, not a hole — and it also keeps the smallest territory large enough to
  // put a name inside. Four hexes is about the least that can hold one.
  const weightOf = (id: string) => 1 + (courseCounts.get(id) ?? 0) * 3;
  const totalWeight = domains.reduce((sum, d) => sum + weightOf(d.id), 0) || 1;
  const budget = hexBudget(domains, weightOf, totalWeight, landformOf, hexArea, config);
  const targets = new Map<string, number>(
    domains.map((d) => [d.id, Math.max(4, Math.round((budget * weightOf(d.id)) / totalWeight))])
  );
  const targetOf = (id: string) => targets.get(id) ?? 4;

  // The vertical axis. Level 0 — what nothing else rests on — sits at the
  // bottom, and each step of the dependency order climbs from there.
  const levels = input.levels ?? new Map<string, number>();
  const maxLevel = Math.max(1, input.maxLevel ?? Math.max(0, ...levels.values()));
  const margin = 70;
  const levelOf = (id: string): number => levels.get(id) ?? 0;
  const rowOf = (id: string): number =>
    config.height - margin - (levelOf(id) / maxLevel) * (config.height - margin * 2);

  const random = rng(config.seed * 7919 + 13);
  const world = layoutWorld(
    domains,
    targetOf,
    landformOf,
    reachesOf,
    rowOf,
    levelOf,
    hexArea,
    config
  );

  const homeOf = new Map<string, string>();
  for (const mass of world) for (const id of mass.members) homeOf.set(id, mass.id);

  const seeds = placeSeeds(
    domains,
    world,
    homeOf,
    targetOf,
    landformOf,
    input.edges ?? [],
    levelOf,
    hexArea,
    config,
    random
  );
  const growth = grow(domains, world, homeOf, seeds, targetOf, hexArea, config);
  const graph = buildBorderGraph(growth);
  const anchor = poles(growth);

  const territories: Territory[] = [];
  for (const domain of domains) {
    const mine = graph.arcs.filter((arc) => arc.left === domain.id || arc.right === domain.id);
    if (!mine.length) continue;
    const spot = anchor.get(domain.id);
    const cells = growth.sizes.get(domain.id) ?? 0;
    const target = targetOf(domain.id);
    territories.push({
      id: domain.id,
      continent: domain.continent,
      landform: landformOf(domain.id),
      colour: domain.color,
      path: pathFrom(mine, graph, config.cornerRadius),
      label: spot?.point ?? { x: 0, y: 0 },
      room: spot?.radius ?? 0,
      cells,
      target,
      areaError: (cells - target) / target,
    });
  }

  const coasts = world.map((mass) => {
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
      path: pathFrom(arcs, graph, config.cornerRadius),
    };
  });

  const labelAt = new Map(territories.map((t) => [t.id, t.label]));
  const seen = new Set<string>();
  const links: MapResult['links'] = [];
  const candidates = input.edges?.length
    ? input.edges.map((edge) => ({ from: edge.from, to: edge.to }))
    : domains.flatMap((d) => d.dependsOn.map((to) => ({ from: d.id, to })));

  for (const edge of candidates) {
    if (homeOf.get(edge.from) === homeOf.get(edge.to)) continue;
    const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
    if (seen.has(key)) continue;
    const a = labelAt.get(edge.from);
    const b = labelAt.get(edge.to);
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
      areaError:
        territories.reduce((sum, t) => sum + Math.abs(t.areaError), 0) /
        (territories.length || 1),
      worstAreaError: territories.reduce((worst, t) => Math.max(worst, Math.abs(t.areaError)), 0),
      hexes: growth.owner.size,
      // The tightest territory, in px of inscribed radius: the number that says
      // whether the smallest name on the map still fits inside its border.
      smallest: territories.reduce((least, t) => Math.min(least, t.room), Infinity),
      upwardRate: upwardRate(domains, territories, levels),
      elapsedMs: Date.now() - started,
    },
  };
}
