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

export type DomainEdge = { a: string; b: string; weight: number };

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

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

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

  const add = (a: string, b: string, weight: number): void => {
    if (a === b || !known.has(a) || !known.has(b)) return;
    const key = pairKey(a, b);
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
      const [a, b] = key.split('|');
      return { a, b, weight };
    })
    // Sorted so the layout is reproducible: iteration order over a Map depends
    // on insertion order, and insertion order depends on the file walk.
    .sort((x, y) => pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)));
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
  for (const edge of edges) {
    neighbours.get(edge.a)?.push({ id: edge.b, weight: edge.weight });
    neighbours.get(edge.b)?.push({ id: edge.a, weight: edge.weight });
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
