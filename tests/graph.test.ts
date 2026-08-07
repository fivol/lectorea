import { describe, expect, it } from 'vitest';
import type { Course } from '../shared/schema';
import {
  buildLevels,
  dependantsIndex,
  findCycle,
  forwardClosureSizes,
  GraphError,
  indexCourses,
  symmetrizeRelated,
  upstreamOf,
} from '../shared/graph';
import { findGraphWarnings, validateFilePlacement, validateReferences } from '../scripts/lib/graph';

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
    expect(() => buildLevels(courses)).not.toThrow();
  });

  it('finds a two-node cycle', () => {
    const cycle = findCycle([course('a', ['b']), course('b', ['a'])]);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle)).toEqual(new Set(['a', 'b']));
  });

  it('finds a cycle that closes several hops later', () => {
    const courses = [course('a', ['c']), course('b', ['a']), course('c', ['b'])];
    expect(findCycle(courses)).not.toBeNull();
    expect(() => buildLevels(courses)).toThrow(GraphError);
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
      buildLevels([course('a', ['b']), course('b', ['a'])]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as GraphError).details.join(' ')).toContain('→');
    }
  });

  it('names the cycle even when acyclic courses hang off it', () => {
    // `tail` is settled by Kahn and must not muddy the reported loop.
    const courses = [course('root'), course('tail', ['root']), course('x', ['y']), course('y', ['x'])];
    try {
      buildLevels(courses);
      expect.unreachable('should have thrown');
    } catch (error) {
      const reported = (error as GraphError).details.join(' ');
      expect(reported).toContain('x');
      expect(reported).toContain('y');
      expect(reported).not.toContain('tail');
    }
  });
});

describe('levels', () => {
  const levelsOf = (courses: Course[]): Map<string, number> => buildLevels(courses).level;

  it('is zero for a course with no dependencies', () => {
    expect(levelsOf([course('a')]).get('a')).toBe(0);
  });

  it('follows the longest chain, not the shortest', () => {
    // d depends on both a (short hop) and c (three hops) — the long one wins.
    const courses = [
      course('a'),
      course('b', ['a']),
      course('c', ['b']),
      course('d', ['a', 'c']),
    ];
    expect(levelsOf(courses).get('d')).toBe(3);
  });

  it('does not depend on the order courses are written in', () => {
    const forward = [course('a'), course('b', ['a']), course('c', ['b'])];
    const shuffled = [course('c', ['b']), course('a'), course('b', ['a'])];
    expect([...levelsOf(shuffled)].sort()).toEqual([...levelsOf(forward)].sort());
  });

  it('is not affected by soft dependencies', () => {
    const courses = [course('a'), course('b', [], { soft: ['a'] })];
    expect(levelsOf(courses).get('b')).toBe(0);
  });

  it('respects minLevel as a floor for a course with no prerequisites', () => {
    expect(levelsOf([course('art', [], { minLevel: 2 })]).get('art')).toBe(2);
  });

  it('lets the computed level win when it is already deeper than minLevel', () => {
    const courses = [course('a'), course('b', ['a']), course('c', ['b'], { minLevel: 1 })];
    expect(levelsOf(courses).get('c')).toBe(2);
  });

  it('pushes dependants along when minLevel raises a course', () => {
    const courses = [course('a', [], { minLevel: 3 }), course('b', ['a'])];
    expect(levelsOf(courses).get('b')).toBe(4);
  });

  it('rejects a dependency on a course that does not exist', () => {
    expect(() => buildLevels([course('a', ['ghost'])])).toThrow(GraphError);
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
    const { order } = buildLevels(courses);
    const at = (id: string): number => order.indexOf(id);
    expect(at('a')).toBeLessThan(at('b'));
    expect(at('b')).toBeLessThan(at('d'));
    expect(at('c')).toBeLessThan(at('d'));
  });
});

describe('upstream closure', () => {
  const courses = [
    course('school'),
    course('calc1', ['school']),
    course('calc2', ['calc1']),
    course('comb', ['school']),
    course('probability', ['calc2', 'comb']),
  ];
  const index = indexCourses(courses);

  it('is the full transitive closure, not just direct dependencies', () => {
    expect(upstreamOf(index, 'probability')).toEqual(
      new Set(['school', 'calc1', 'calc2', 'comb'])
    );
  });

  it('is empty for a base course', () => {
    expect(upstreamOf(index, 'school').size).toBe(0);
  });

  it('sorting it by level gives a valid study order', () => {
    const { level } = buildLevels(courses);
    const path = [...upstreamOf(index, 'probability')].sort(
      (a, b) => level.get(a)! - level.get(b)!
    );
    expect(path.indexOf('school')).toBeLessThan(path.indexOf('calc1'));
    expect(path.indexOf('calc1')).toBeLessThan(path.indexOf('calc2'));
  });
});

describe('dependants and what sits behind them', () => {
  const courses = [course('a'), course('b', ['a']), course('c', ['b']), course('d', ['b'])];

  it('lists only the first step forward', () => {
    expect(dependantsIndex(courses).get('a')).toEqual(['b']);
  });

  it('counts what sits behind that step', () => {
    const { order } = buildLevels(courses);
    expect(forwardClosureSizes(courses, order).get('b')).toBe(2); // c and d
  });

  it('is empty for a leaf', () => {
    expect(dependantsIndex(courses).get('c')).toBeUndefined();
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

  it('points at the file and line when the loader knows them', () => {
    const where = new Map([['a', 'data/courses/math.yaml:12']]);
    try {
      validateReferences([course('a', ['ghost'])], domains, where);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as GraphError).details[0]).toContain('data/courses/math.yaml:12');
    }
  });

  it('accepts a valid graph', () => {
    expect(() =>
      validateReferences([course('a'), course('b', ['a'])], domains)
    ).not.toThrow();
  });
});

describe('graph warnings', () => {
  it('flags a dependency the graph already implies transitively', () => {
    const courses = [course('a'), course('b', ['a']), course('c', ['b', 'a'])];
    expect(findGraphWarnings(courses).join(' ')).toContain('implied transitively');
  });

  it('says nothing when every edge is direct', () => {
    expect(findGraphWarnings([course('a'), course('b', ['a']), course('c', ['b'])])).toEqual([]);
  });

  it('flags a soft edge that duplicates a hard one', () => {
    const courses = [course('a'), course('b', ['a'], { soft: ['a'] })];
    expect(findGraphWarnings(courses).join(' ')).toContain('already a hard dependency');
  });
});

describe('file placement', () => {
  it('rejects a course filed under something other than its first domain', () => {
    const courses = [course('a', [], { domains: ['physics', 'math'] })];
    expect(() => validateFilePlacement(courses, new Map([['a', 'math.yaml']]))).toThrow(GraphError);
  });

  it('accepts a course filed under its first domain', () => {
    const courses = [course('a', [], { domains: ['physics', 'math'] })];
    expect(() =>
      validateFilePlacement(courses, new Map([['a', 'physics.yaml']]))
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
