import type { Continent, Course, Domain } from './schema.js';

/**
 * The graph between domains, and what it says about the shape of the world.
 *
 * `data/domains.yaml` declares dependencies by hand, but only the obvious ones:
 * nine domains declare nothing at all, and a map laid out from that graph alone
 * has nothing to say about where most of the humanities belong. The course
 * catalogue knows better — a course dependency crossing two domains is evidence
 * that those domains belong near each other — so the two sources are summed and
 * the map is laid out from the result.
 *
 * The landform then follows from the graph instead of from a list someone
 * maintains: a domain tied into its own continent sits inland, one tied to two
 * other continents is out in the strait, one tied to almost nothing hangs off
 * the coast. That is the point of deriving it — the map keeps telling the truth
 * after the catalogue changes.
 */

/**
 * `from` depends on `to`. Direction is the point of this type: the map uses it
 * to decide what sits above what, and an undirected version cannot say whether
 * physics rests on mathematics or the other way round.
 */
export type DomainEdge = { from: string; to: string; weight: number };

export type Landform = 'mainland' | 'peninsula' | 'island';

export type LandformConfig = {
  /** Weight of one hand-declared dependency in `data/domains.yaml`. */
  declaredWeight: number;
  /** Weight of one course-level dependency crossing the two domains. */
  derivedWeight: number;
  /** Share of a domain's links that must leave its continent to strand it. */
  islandForeignShare: number;
  /** How many other continents those links must reach. */
  islandContinents: number;
  /**
   * Above this many same-continent links a domain stays ashore whatever its
   * outward share. Without it probability — six links into its own continent
   * and a habit of turning up everywhere else — floats off into the ocean.
   */
  islandOwnLinks: number;
  /** At or below this many same-continent links, a domain becomes a lobe. */
  peninsulaOwnLinks: number;
  /** A domain with at least this many courses stays inland regardless. */
  mainlandCourses: number;
  /** Jitter on the thresholds, per domain, so seeds differ in topology too. */
  randomness: number;
  seed: number;
};

export const defaultLandformConfig: LandformConfig = {
  declaredWeight: 3,
  derivedWeight: 1,
  islandForeignShare: 0.5,
  islandContinents: 1,
  islandOwnLinks: 2,
  peninsulaOwnLinks: 1,
  mainlandCourses: 8,
  randomness: 0.15,
  seed: 7,
};

/* ──────────────────────────────  The graph  ────────────────────────────── */

/**
 * Declared dependencies and course-derived ones, summed into one weighted
 * undirected graph. Undirected on purpose: the map places territories beside
 * each other, and adjacency has no direction to carry.
 */
export function buildDomainGraph(
  domains: Domain[],
  courses: Course[],
  config: Pick<LandformConfig, 'declaredWeight' | 'derivedWeight'>
): DomainEdge[] {
  const known = new Set(domains.map((d) => d.id));
  const weights = new Map<string, number>();

  const add = (from: string, to: string, weight: number): void => {
    if (from === to || !known.has(from) || !known.has(to)) return;
    const key = `${from}>${to}`;
    weights.set(key, (weights.get(key) ?? 0) + weight);
  };

  for (const domain of domains) {
    for (const source of domain.dependsOn) add(domain.id, source, config.declaredWeight);
  }

  const domainsOf = new Map(courses.map((course) => [course.id, course.domains]));
  for (const course of courses) {
    for (const dependency of course.deps) {
      const theirs = domainsOf.get(dependency);
      if (!theirs) continue;
      for (const mine of course.domains) {
        for (const other of theirs) add(mine, other, config.derivedWeight);
      }
    }
  }

  return [...weights.entries()]
    // A zero-weight edge claims a relationship nothing supports. It can appear
    // when a weight knob is turned to zero, and downstream it counts as a link
    // like any other — a domain would be held ashore by evidence that is not
    // there.
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => {
      const [from, to] = key.split('>');
      return { from, to, weight };
    })
    // Sorted so the layout is reproducible: iteration order over a Map depends
    // on insertion order, and insertion order depends on the file walk.
    .sort((x, y) => `${x.from}>${x.to}`.localeCompare(`${y.from}>${y.to}`));
}

/* ────────────────────────────────  Levels  ─────────────────────────────── */

export type DomainLevels = {
  /** Longest chain of dependencies ending at this domain. Roots are 0. */
  level: Map<string, number>;
  maxLevel: number;
  /** The loop, if the declared graph has one. Layering is meaningless then. */
  cycle: string[] | null;
};

/**
 * How deep each domain sits in the dependency order — the map's vertical axis.
 *
 * The **longest** chain, not the shortest, exactly as course levels are
 * computed: if a domain rests on something at level 3 and something at level 1,
 * it belongs at 4, or it would be drawn level with its own foundation.
 *
 * Only the declared `dependsOn` counts. The course-derived links are evidence
 * of affinity, not of order — six pairs of domains cite each other through
 * their courses (biology and biochemistry, economics and mathematics), and
 * feeding those into a layering turns a clean order into a knot. They earn
 * their keep elsewhere, pulling related domains together.
 */
export function domainLevels(domains: Domain[]): DomainLevels {
  const indegree = new Map<string, number>(domains.map((d) => [d.id, 0]));
  const dependants = new Map<string, string[]>(domains.map((d) => [d.id, []]));
  const known = new Set(domains.map((d) => d.id));

  for (const domain of domains) {
    for (const source of domain.dependsOn) {
      if (!known.has(source)) continue;
      dependants.set(source, [...(dependants.get(source) ?? []), domain.id]);
      indegree.set(domain.id, (indegree.get(domain.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm: when a domain leaves the queue every one of its sources
  // has already left, so its level is final and `max` over them is one step.
  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const domain of domains) {
    if (!indegree.get(domain.id)) {
      level.set(domain.id, 0);
      queue.push(domain.id);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const next of dependants.get(id) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, (level.get(id) ?? 0) + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (!indegree.get(next)) queue.push(next);
    }
  }

  // Fewer domains came out than went in: what is left is exactly the part of
  // the graph inside a cycle. Naming it beats a bare "cycle detected".
  let cycle: string[] | null = null;
  if (queue.length < domains.length) {
    const stuck = domains.filter((d) => !level.has(d.id)).map((d) => d.id);
    cycle = findLoop(domains, new Set(stuck));
    for (const id of stuck) level.set(id, 0);
  }

  return { level, maxLevel: Math.max(0, ...level.values()), cycle };
}

/** Depth-first walk inside the tangled subset, returning the loop it finds. */
function findLoop(domains: Domain[], scope: Set<string>): string[] | null {
  const byId = new Map(domains.map((d) => [d.id, d]));
  const state = new Map<string, 'open' | 'done'>();
  const trail: string[] = [];

  const walk = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'open') return [...trail.slice(trail.indexOf(id)), id];
    state.set(id, 'open');
    trail.push(id);
    for (const source of byId.get(id)?.dependsOn ?? []) {
      if (!scope.has(source)) continue;
      const found = walk(source);
      if (found) return found;
    }
    trail.pop();
    state.set(id, 'done');
    return null;
  };

  for (const id of scope) {
    const found = walk(id);
    if (found) return found;
  }
  return null;
}

/* ────────────────────────────  Landform from it  ───────────────────────── */

export type DomainTopology = {
  id: string;
  continent: Continent;
  landform: Landform;
  /** Total weight of links staying inside the domain's own continent. */
  ownWeight: number;
  foreignWeight: number;
  /** How many distinct same-continent domains it links to. */
  ownLinks: number;
  /** Continents its links reach, its own excluded — where an island belongs. */
  reaches: Continent[];
};

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

/**
 * Reads each domain's neighbourhood and decides where in the world it sits.
 *
 * The order of the tests matters. Size wins first: a field with a large
 * catalogue is what makes a continent recognisable, and casting it adrift
 * because its links happen to point outward would hollow out the mainland.
 * Only then does reach decide, and only then isolation.
 */
export function classifyLandforms(
  domains: Domain[],
  edges: DomainEdge[],
  courseCounts: Map<string, number>,
  config: LandformConfig
): Map<string, DomainTopology> {
  const byId = new Map(domains.map((d) => [d.id, d]));
  const neighbours = new Map<string, Array<{ id: string; weight: number }>>();
  for (const domain of domains) neighbours.set(domain.id, []);
  // Landform asks who a domain is close to, not who came first, so a directed
  // edge is read from both ends here.
  for (const edge of edges) {
    neighbours.get(edge.from)?.push({ id: edge.to, weight: edge.weight });
    neighbours.get(edge.to)?.push({ id: edge.from, weight: edge.weight });
  }

  const topology = new Map<string, DomainTopology>();

  for (const domain of domains) {
    let ownWeight = 0;
    let foreignWeight = 0;
    let ownLinks = 0;
    const reaches = new Set<Continent>();

    for (const link of neighbours.get(domain.id) ?? []) {
      const other = byId.get(link.id);
      if (!other) continue;
      if (other.continent === domain.continent) {
        ownWeight += link.weight;
        ownLinks += 1;
      } else {
        foreignWeight += link.weight;
        reaches.add(other.continent);
      }
    }

    const total = ownWeight + foreignWeight;
    const foreignShare = total ? foreignWeight / total : 0;

    // Jitter is per domain and per seed, so stepping the variant reshuffles
    // which borderline domains break off. Sizes and continent membership are
    // never touched by it — only the coastline changes.
    const local = rng(hash(`${domain.id}#${config.seed}`));
    const wobble = (local() * 2 - 1) * config.randomness;
    const courses = courseCounts.get(domain.id) ?? 0;

    let landform: Landform;
    if (courses >= config.mainlandCourses) {
      landform = 'mainland';
    } else if (
      reaches.size >= config.islandContinents &&
      ownLinks <= config.islandOwnLinks &&
      foreignShare + wobble >= config.islandForeignShare
    ) {
      landform = 'island';
    } else if (ownLinks <= config.peninsulaOwnLinks) {
      landform = 'peninsula';
    } else {
      landform = 'mainland';
    }

    topology.set(domain.id, {
      id: domain.id,
      continent: domain.continent,
      landform,
      ownWeight,
      foreignWeight,
      ownLinks,
      reaches: [...reaches],
    });
  }

  return topology;
}
