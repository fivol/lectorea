import type { Course } from './schema.js';

/**
 * Pure graph logic, shared between the build and the browser.
 *
 * The build owns levels and the column order; the client re-derives paths and
 * dependants from `deps` alone, which is why this lives in `shared/` rather
 * than in `scripts/lib/`.
 */

export class GraphError extends Error {
  constructor(
    message: string,
    readonly details: string[] = []
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export type CourseIndex = Map<string, Course>;

export function indexCourses(courses: Course[]): CourseIndex {
  const index: CourseIndex = new Map();
  for (const course of courses) {
    if (index.has(course.id)) {
      throw new GraphError(`Duplicate course id: ${course.id}`);
    }
    index.set(course.id, course);
  }
  return index;
}

/**
 * Finds a cycle in the `deps` graph and returns it as a node list, or null.
 *
 * `soft` and `related` are deliberately excluded: `related` is symmetric by
 * design, and including it would make this fire on every humanities pair.
 * `scope` narrows the search to the nodes Kahn's algorithm could not settle,
 * which is exactly the set that must contain a cycle.
 */
export function findCycle(courses: Course[], scope?: Set<string>): string[] | null {
  const index = indexCourses(courses);
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on stack, 2 done
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    if (scope && !scope.has(id)) return null;
    const current = state.get(id) ?? 0;
    if (current === 2) return null;
    if (current === 1) {
      // Cut the stack down to where this node first appeared.
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }

    state.set(id, 1);
    stack.push(id);
    for (const dep of index.get(id)?.deps ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  }

  for (const course of courses) {
    if (scope && !scope.has(course.id)) continue;
    const found = visit(course.id);
    if (found) return found;
  }
  return null;
}

export type Levels = {
  /** Topological order: a course always comes after everything it depends on. */
  order: string[];
  /** Column index per course. */
  level: Map<string, number>;
};

/**
 * Kahn's algorithm. One pass gives the topological order, the levels and cycle
 * detection — they are the same traversal, so computing them separately would
 * be three walks over the graph to learn the same thing.
 *
 *   level(c) = minLevel(c)                              if deps is empty
 *            = max(minLevel(c), 1 + max(level(d)))      over d in deps(c)
 *
 * The *longest* chain, not the shortest: if probability needs calculus-2
 * (level 2) and combinatorics (level 1) it belongs at 3. A shortest-path rule
 * would put it at 2, level with a course that is its own prerequisite.
 *
 * Only `deps` counts. `soft` and `related` are excluded — mutual humanities
 * links would otherwise make the ranking unsolvable.
 */
export function buildLevels(courses: Course[]): Levels {
  const byId = indexCourses(courses);
  const indegree = new Map<string, number>();
  const dependants = new Map<string, string[]>();
  const level = new Map<string, number>();

  for (const course of courses) {
    indegree.set(course.id, course.deps.length);
    for (const dep of course.deps) {
      if (!byId.has(dep)) {
        throw new GraphError(`${course.id}: unknown dependency "${dep}"`);
      }
      dependants.set(dep, [...(dependants.get(dep) ?? []), course.id]);
    }
  }

  // Source order decides ties, so the output is stable between builds.
  const queue = courses.filter((course) => !course.deps.length).map((course) => course.id);
  const order: string[] = [];

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const course = byId.get(id)!;

    // Every dependency has already left the queue, so their levels are final
    // and `max` over them is one operation — no recursion, no memoisation.
    const base = course.deps.length
      ? Math.max(...course.deps.map((dep) => level.get(dep)!)) + 1
      : 0;
    level.set(id, Math.max(base, course.minLevel ?? 0));
    order.push(id);

    for (const next of dependants.get(id) ?? []) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (order.length < courses.length) {
    const stuck = new Set(courses.filter((c) => !level.has(c.id)).map((c) => c.id));
    const cycle = findCycle(courses, stuck);
    throw new GraphError(
      'The deps graph has a cycle',
      cycle ? [cycle.join(' → ')] : [[...stuck].join(', ')]
    );
  }

  return { order, level };
}

/** courseId → the courses that list it in their `deps`. */
export function dependantsIndex(courses: Course[]): Map<string, string[]> {
  const dependants = new Map<string, string[]>();
  for (const course of courses) {
    for (const dep of course.deps) {
      dependants.set(dep, [...(dependants.get(dep) ?? []), course.id]);
    }
  }
  return dependants;
}

/**
 * Everything that has to come before a course — the transitive `deps` closure,
 * unordered. Callers sort it: the build has no reason to, and the client sorts
 * by level, which is a correct study order for free.
 */
export function upstreamOf(index: CourseIndex, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const dep of index.get(current)?.deps ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      stack.push(dep);
    }
  }
  return seen;
}

/** How many courses open up behind each one, following `deps` forward. */
export function forwardClosureSizes(courses: Course[], order: string[]): Map<string, number> {
  const dependants = dependantsIndex(courses);
  const closure = new Map<string, Set<string>>();

  // Reverse topological order: everything a node unlocks is already computed.
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const set = new Set<string>();
    for (const child of dependants.get(id) ?? []) {
      set.add(child);
      for (const inherited of closure.get(child) ?? []) set.add(inherited);
    }
    closure.set(id, set);
  }

  return new Map([...closure].map(([id, set]) => [id, set.size]));
}

/**
 * `related` is conceptually mutual but written on one side only. Mirroring it
 * at build time means the client never has to check both directions.
 */
export function symmetrizeRelated(courses: Course[]): void {
  const index = indexCourses(courses);
  for (const course of courses) {
    for (const target of course.related) {
      const other = index.get(target);
      if (other && !other.related.includes(course.id)) {
        other.related.push(course.id);
      }
    }
  }
}
