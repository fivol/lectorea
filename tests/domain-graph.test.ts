import { describe, expect, it } from 'vitest';
import {
  buildDomainGraph,
  classifyLandforms,
  defaultLandformConfig,
  type LandformConfig,
} from '../shared/domain-graph.js';
import type { Course, Domain } from '../shared/schema.js';

/**
 * The classification decides what the map claims about a field — inland, on a
 * limb, or out at sea — so it is tested on its claims rather than on numbers.
 */

const domain = (id: string, continent: Domain['continent'], dependsOn: string[] = []): Domain => ({
  id,
  continent,
  color: '#000000',
  shapeId: `shape-${id}`,
  bandOrder: 10,
  bridge: false,
  dependsOn,
});

const course = (id: string, domains: string[], deps: string[] = []): Course =>
  ({ id, domains, deps }) as Course;

const config = (overrides: Partial<LandformConfig> = {}): LandformConfig => ({
  ...defaultLandformConfig,
  randomness: 0, // thresholds are being tested, not the jitter around them
  ...overrides,
});

describe('buildDomainGraph', () => {
  const domains = [domain('math', 'formal'), domain('cs', 'formal', ['math'])];

  it('sums declared and course-derived links into one edge', () => {
    const edges = buildDomainGraph(
      domains,
      [course('algorithms', ['cs'], ['calculus']), course('calculus', ['math'])],
      { declaredWeight: 3, derivedWeight: 1 }
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(4);
  });

  it('finds links the hand-written list never declared', () => {
    const plain = [domain('math', 'formal'), domain('cs', 'formal')];
    const edges = buildDomainGraph(
      plain,
      [course('algorithms', ['cs'], ['calculus']), course('calculus', ['math'])],
      { declaredWeight: 3, derivedWeight: 1 }
    );
    expect(edges.map((e) => [e.a, e.b])).toEqual([['cs', 'math']]);
  });

  it('ignores dependencies on courses that are not in the catalogue', () => {
    const edges = buildDomainGraph(domains, [course('algorithms', ['cs'], ['missing'])], {
      declaredWeight: 0,
      derivedWeight: 1,
    });
    expect(edges).toHaveLength(0);
  });

  it('is ordered, so two builds of the same catalogue lay out the same', () => {
    const courses = [
      course('a', ['cs'], ['b']),
      course('b', ['math']),
      course('c', ['cs'], ['b']),
    ];
    const once = buildDomainGraph(domains, courses, defaultLandformConfig);
    const twice = buildDomainGraph([...domains].reverse(), courses, defaultLandformConfig);
    expect(once).toEqual(twice);
  });
});

describe('classifyLandforms', () => {
  const classify = (domains: Domain[], courses: Course[], overrides?: Partial<LandformConfig>) => {
    const settings = config(overrides);
    const counts = new Map<string, number>();
    for (const c of courses) for (const d of c.domains) counts.set(d, (counts.get(d) ?? 0) + 1);
    const edges = buildDomainGraph(domains, courses, settings);
    return classifyLandforms(domains, edges, counts, settings);
  };

  it('leaves a well-connected domain inland', () => {
    const domains = [
      domain('math', 'formal'),
      domain('cs', 'formal', ['math']),
      domain('physics', 'formal', ['math', 'cs']),
    ];
    const result = classify(domains, [course('c1', ['math']), course('c2', ['physics'])]);
    expect(result.get('physics')?.landform).toBe('mainland');
  });

  it('hangs a domain with no relatives off the coast', () => {
    const domains = [domain('math', 'formal'), domain('art', 'humanities')];
    const result = classify(domains, [course('c1', ['art'])]);
    expect(result.get('art')?.landform).toBe('peninsula');
  });

  it('strands a domain whose links mostly point at another continent', () => {
    const domains = [
      domain('math', 'formal'),
      domain('linguistics', 'humanities'),
      domain('complinguistics', 'humanities', ['math', 'math', 'linguistics']),
    ];
    // Two links out to formal, one home: the majority is across the water.
    const result = classify(
      domains,
      [
        course('c1', ['complinguistics'], ['c2']),
        course('c2', ['math']),
        course('c3', ['math']),
        course('c4', ['linguistics']),
      ],
      { islandForeignShare: 0.5, islandContinents: 1 }
    );
    const entry = result.get('complinguistics')!;
    expect(entry.landform).toBe('island');
    expect(entry.reaches).toContain('formal');
  });

  it('keeps a large field ashore however far its links reach', () => {
    const domains = [
      domain('math', 'formal'),
      domain('economics', 'social', ['math', 'math']),
    ];
    const courses = Array.from({ length: 9 }, (_, i) => course(`e${i}`, ['economics'], ['m0']));
    const result = classify(domains, [...courses, course('m0', ['math'])], {
      mainlandCourses: 8,
    });
    // Every link it has leaves the continent, and it still stays put.
    expect(result.get('economics')?.foreignWeight).toBeGreaterThan(0);
    expect(result.get('economics')?.ownWeight).toBe(0);
    expect(result.get('economics')?.landform).toBe('mainland');
  });

  it('does not strand a hub just because it is cited everywhere', () => {
    const domains = [
      domain('probability', 'formal'),
      domain('math', 'formal', ['probability']),
      domain('cs', 'formal', ['probability']),
      domain('physics', 'formal', ['probability']),
      domain('psychology', 'social', ['probability']),
      domain('history', 'humanities', ['probability']),
    ];
    const result = classify(domains, [course('c1', ['probability'])], { mainlandCourses: 99 });
    // Three links home is what saves it, not its size.
    expect(result.get('probability')?.ownLinks).toBe(3);
    expect(result.get('probability')?.landform).toBe('mainland');
  });
});
