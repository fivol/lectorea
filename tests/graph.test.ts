import { describe, expect, it } from 'vitest';
import type { Course } from '../shared/schema';
import {
  assertAcyclic,
  computeLevels,
  computeReachDown,
  computeReachUp,
  findCycle,
  GraphError,
  symmetrizeRelated,
  topoSort,
  validateReferences,
} from '../scripts/lib/graph';

/**
 * Graph logic is the only thing in this project where a silent mistake corrupts
 * everything downstream: a wrong level shifts the whole layout, a missed cycle
 * produces a catalogue where a course is its own prerequisite.
 */

function course(id: string, deps: string[] = [], extra: Partial<Course> = {}): Course {
  return { id, domains: ['math'], deps, soft: [], related: [], ...extra };
}

describe('cycle detection', () => {
  it('accepts a plain chain', () => {
    const courses = [course('a'), course('b', ['a']), course('c', ['b'])];
    expect(findCycle(courses)).toBeNull();
    expect(() => assertAcyclic(courses)).not.toThrow();
  });

  it('finds a two-node cycle', () => {
    const cycle = findCycle([course('a', ['b']), course('b', ['a'])]);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle)).toEqual(new Set(['a', 'b']));
  });

  it('finds a cycle that closes several hops later', () => {
    const courses = [course('a', ['c']), course('b', ['a']), course('c', ['b'])];
    expect(findCycle(courses)).not.toBeNull();
    expect(() => assertAcyclic(courses)).toThrow(GraphError);
  });

  it('ignores `related`, which is mutual by design', () => {
    const courses = [
      course('logic', [], { related: ['philosophy'] }),
      course('philosophy', [], { related: ['logic'] }),
    ];
    expect(findCycle(courses)).toBeNull();
  });

  it('ignores `soft`, which never enters the path', () => {
    const courses = [course('a', [], { soft: ['b'] }), course('b', [], { soft: ['a'] })];
    expect(findCycle(courses)).toBeNull();
  });

  it('reports the nodes involved, not just the fact', () => {
    try {
      assertAcyclic([course('a', ['b']), course('b', ['a'])]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as GraphError).details.join(' ')).toContain('→');
    }
  });
});

describe('levels', () => {
  it('is zero for a course with no dependencies', () => {
    expect(computeLevels([course('a')]).get('a')).toBe(0);
  });

  it('follows the longest chain, not the shortest', () => {
    // d depends on both a (short hop) and c (three hops) — the long one wins.
    const courses = [
      course('a'),
      course('b', ['a']),
      course('c', ['b']),
      course('d', ['a', 'c']),
    ];
    expect(computeLevels(courses).get('d')).toBe(3);
  });

  it('does not depend on the order courses are written in', () => {
    const forward = [course('a'), course('b', ['a']), course('c', ['b'])];
    const shuffled = [course('c', ['b']), course('a'), course('b', ['a'])];
    expect([...computeLevels(shuffled)].sort()).toEqual([...computeLevels(forward)].sort());
  });

  it('is not affected by soft dependencies', () => {
    const courses = [course('a'), course('b', [], { soft: ['a'] })];
    expect(computeLevels(courses).get('b')).toBe(0);
  });
});

describe('topological order', () => {
  it('places every course after everything it depends on', () => {
    const courses = [
      course('d', ['b', 'c']),
      course('c', ['a']),
      course('b', ['a']),
      course('a'),
    ];
    const order = topoSort(courses);
    const at = (id: string): number => order.indexOf(id);
    expect(at('a')).toBeLessThan(at('b'));
    expect(at('b')).toBeLessThan(at('d'));
    expect(at('c')).toBeLessThan(at('d'));
  });
});

describe('reachUp', () => {
  const courses = [
    course('school'),
    course('calc1', ['school']),
    course('calc2', ['calc1']),
    course('comb', ['school']),
    course('probability', ['calc2', 'comb']),
  ];

  it('is the full transitive closure, not just direct dependencies', () => {
    expect(new Set(computeReachUp(courses).get('probability'))).toEqual(
      new Set(['school', 'calc1', 'calc2', 'comb'])
    );
  });

  it('comes back in topological order, so it reads as a study plan', () => {
    const path = computeReachUp(courses).get('probability')!;
    expect(path.indexOf('school')).toBeLessThan(path.indexOf('calc1'));
    expect(path.indexOf('calc1')).toBeLessThan(path.indexOf('calc2'));
  });

  it('is empty for a base course', () => {
    expect(computeReachUp(courses).get('school')).toEqual([]);
  });

  it('lists a shared ancestor once', () => {
    const path = computeReachUp(courses).get('probability')!;
    expect(path.filter((id) => id === 'school')).toHaveLength(1);
  });
});

describe('reachDown', () => {
  const courses = [
    course('a'),
    course('b', ['a']),
    course('c', ['b']),
    course('d', ['b']),
  ];

  it('lists only the first step forward', () => {
    expect(computeReachDown(courses).get('a')!.map((step) => step.id)).toEqual(['b']);
  });

  it('counts what sits behind that step', () => {
    expect(computeReachDown(courses).get('a')![0].behind).toBe(2); // c and d
  });

  it('is empty for a leaf', () => {
    expect(computeReachDown(courses).get('c')).toEqual([]);
  });
});

describe('references', () => {
  const domains = new Set(['math']);

  it('rejects a dependency on a course that does not exist', () => {
    expect(() => validateReferences([course('a', ['ghost'])], domains)).toThrow(GraphError);
  });

  it('rejects a course that depends on itself', () => {
    expect(() => validateReferences([course('a', ['a'])], domains)).toThrow(GraphError);
  });

  it('rejects an unknown domain', () => {
    expect(() =>
      validateReferences([course('a', [], { domains: ['nowhere'] })], domains)
    ).toThrow(GraphError);
  });

  it('accepts a valid graph', () => {
    expect(() =>
      validateReferences([course('a'), course('b', ['a'])], domains)
    ).not.toThrow();
  });
});

describe('related edges', () => {
  it('are mirrored so the client never checks both directions', () => {
    const courses = [course('logic', [], { related: ['philosophy'] }), course('philosophy')];
    symmetrizeRelated(courses);
    expect(courses[1].related).toEqual(['logic']);
  });

  it('do not duplicate when already written on both sides', () => {
    const courses = [
      course('logic', [], { related: ['philosophy'] }),
      course('philosophy', [], { related: ['logic'] }),
    ];
    symmetrizeRelated(courses);
    expect(courses[0].related).toEqual(['philosophy']);
    expect(courses[1].related).toEqual(['logic']);
  });
});
