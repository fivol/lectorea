import { describe, expect, it } from 'vitest';
import type { Course, Domain } from '../shared/schema';
import { buildLevels } from '../shared/graph';
import { layoutColumns } from '../scripts/lib/layout';

/**
 * The column order is the only thing left for the layout to decide — the column
 * itself comes from the topological sort. What matters is that the result is
 * deterministic, that domains stay together, and that rows within a column are
 * a dense 0..n-1 range, because the screen aligns cards by row index.
 */

function course(id: string, deps: string[] = [], domain = 'math'): Course {
  return { id, domains: [domain], stage: 'bachelor-1', deps, soft: [], related: [] };
}

function domain(id: string, bandOrder: number): Domain {
  return {
    id,
    continent: 'formal',
    bridge: false,
    color: '#4CC9F0',
    shapeId: `shape-${id}`,
    dependsOn: [],
    bandOrder,
  };
}

const DOMAINS = [domain('math', 10), domain('cs', 20), domain('physics', 30)];

function layout(courses: Course[]) {
  const { level } = buildLevels(courses);
  return { ...layoutColumns(courses, level, DOMAINS), level };
}

describe('columns', () => {
  it('reports one column per level, with its size', () => {
    const courses = [course('a'), course('b'), course('c', ['a'])];
    expect(layout(courses).columns).toEqual([
      { level: 0, count: 2 },
      { level: 1, count: 1 },
    ]);
  });

  it('numbers rows densely from zero inside each column', () => {
    const courses = [course('a'), course('b'), course('c'), course('d', ['a'])];
    const { row } = layout(courses);
    expect([row.get('a'), row.get('b'), row.get('c')].sort()).toEqual([0, 1, 2]);
    expect(row.get('d')).toBe(0);
  });
});

describe('domain bands', () => {
  it('keeps a domain contiguous inside a column, whatever the source order', () => {
    const courses = [
      course('m1', [], 'math'),
      course('c1', [], 'cs'),
      course('m2', [], 'math'),
      course('c2', [], 'cs'),
    ];
    const { row } = layout(courses);
    const maths = [row.get('m1')!, row.get('m2')!].sort((a, b) => a - b);
    const cs = [row.get('c1')!, row.get('c2')!].sort((a, b) => a - b);
    expect(maths[1] - maths[0]).toBe(1);
    expect(cs[1] - cs[0]).toBe(1);
  });

  it('orders the bands by bandOrder, fundamental first', () => {
    const courses = [course('p', [], 'physics'), course('m', [], 'math')];
    const { row } = layout(courses);
    expect(row.get('m')!).toBeLessThan(row.get('p')!);
  });

  it('never lets the barycentre reorder across bands', () => {
    // `cs2` is pulled hard towards row 2 by its dependency, but maths still
    // owns the rows above it.
    const courses = [
      course('m0', [], 'math'),
      course('m1', [], 'math'),
      course('deep', [], 'cs'),
      course('cs2', ['deep'], 'cs'),
      course('m2', ['m0'], 'math'),
    ];
    const { row, level } = layout(courses);
    const column1 = ['cs2', 'm2'].filter((id) => level.get(id) === 1);
    expect(column1).toContain('m2');
    expect(row.get('m2')!).toBeLessThan(row.get('cs2')!);
  });
});

describe('determinism', () => {
  it('gives the same rows for the same input', () => {
    const build = () => [
      course('a'),
      course('b', ['a']),
      course('c', ['a'], 'cs'),
      course('d', ['b', 'c']),
    ];
    const first = layout(build()).row;
    const second = layout(build()).row;
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
  });

  it('does not depend on the order courses are written in', () => {
    const forward = [course('a'), course('b', ['a']), course('c', ['a'])];
    const reversed = [course('c', ['a']), course('b', ['a']), course('a')];
    expect([...layout(forward).row.entries()].sort()).toEqual(
      [...layout(reversed).row.entries()].sort()
    );
  });
});

describe('barycentric pull', () => {
  it('pulls a prerequisite towards the course that needs it', () => {
    // Six maths courses at level 0, only the last of them has a dependant.
    // `next` is alone in column 1 and therefore at row 0, so the backward sweep
    // should drag its prerequisite up to meet it rather than leave it at row 5.
    const base = Array.from({ length: 6 }, (_, i) => course(`base${i}`));
    const { row } = layout([...base, course('next', ['base5'])]);
    expect(row.get('next')).toBe(0);
    expect(row.get('base5')).toBeLessThan(3);
  });

  it('orders a busy column to follow its prerequisites', () => {
    const roots = ['r0', 'r1', 'r2'].map((id) => course(id));
    const leaves = [course('l2', ['r2']), course('l0', ['r0']), course('l1', ['r1'])];
    const { row } = layout([...roots, ...leaves]);
    expect(row.get('l0')!).toBeLessThan(row.get('l1')!);
    expect(row.get('l1')!).toBeLessThan(row.get('l2')!);
  });
});
