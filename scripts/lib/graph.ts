import type { Course } from '../../shared/schema.js';

/**
 * Pure graph logic. No filesystem, no database — so it can be unit-tested and
 * reused by the frontend if it ever needs to recompute anything.
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

/** Every `deps`, `soft` and `related` target must exist. Typos are silent otherwise. */
export function validateReferences(courses: Course[], domainIds: Set<string>): void {
  const ids = new Set(courses.map((c) => c.id));
  const problems: string[] = [];

  for (const course of courses) {
    for (const [field, list] of [
      ['deps', course.deps],
      ['soft', course.soft],
      ['related', course.related],
    ] as const) {
      for (const target of list) {
        if (!ids.has(target)) {
          problems.push(`${course.id}.${field} → unknown course "${target}"`);
        }
        if (target === course.id) {
          problems.push(`${course.id}.${field} → refers to itself`);
        }
      }
    }
    for (const domain of course.domains) {
      if (!domainIds.has(domain)) {
        problems.push(`${course.id}.domains → unknown domain "${domain}"`);
      }
    }
  }

  if (problems.length) {
    throw new GraphError(`Broken references (${problems.length})`, problems);
  }
}

/**
 * Finds a cycle in the `deps` graph and returns it as a node list, or null.
 * `soft` and `related` are deliberately excluded: `related` is symmetric by
 * design, and including it would make this check fire on every humanities pair.
 */
export function findCycle(courses: Course[]): string[] | null {
  const index = indexCourses(courses);
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on stack, 2 done
  const stack: string[] = [];

  function visit(id: string): string[] | null {
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
    const found = visit(course.id);
    if (found) return found;
  }
  return null;
}

/** Throws with a readable node list if the `deps` graph has a cycle. */
export function assertAcyclic(courses: Course[]): void {
  const cycle = findCycle(courses);
  if (cycle) {
    throw new GraphError('The deps graph has a cycle', [cycle.join(' → ')]);
  }
}

/**
 * Topological order of the `deps` graph: a course always comes after everything
 * it depends on. Assumes the graph is acyclic — call `assertAcyclic` first.
 */
export function topoSort(courses: Course[]): string[] {
  const index = indexCourses(courses);
  const seen = new Set<string>();
  const order: string[] = [];

  function visit(id: string): void {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of index.get(id)?.deps ?? []) visit(dep);
    order.push(id);
  }

  // Iterate the source order so the output is stable between builds.
  for (const course of courses) visit(course.id);
  return order;
}

/**
 * `level` = length of the longest `deps` chain ending at the node.
 * Computed globally, never assigned by hand — which is what makes a
 * right-to-left edge impossible and turns the layout into a validator.
 */
export function computeLevels(courses: Course[]): Map<string, number> {
  const index = indexCourses(courses);
  const level = new Map<string, number>();

  for (const id of topoSort(courses)) {
    const deps = index.get(id)!.deps;
    let max = 0;
    for (const dep of deps) {
      max = Math.max(max, (level.get(dep) ?? 0) + 1);
    }
    level.set(id, max);
  }
  return level;
}

/**
 * Transitive `deps` closure for every course, in topological order.
 * The order matters: the path panel reads it top to bottom as a study plan.
 */
export function computeReachUp(courses: Course[]): Map<string, string[]> {
  const index = indexCourses(courses);
  const order = topoSort(courses);
  const position = new Map(order.map((id, i) => [id, i]));
  const closure = new Map<string, Set<string>>();

  for (const id of order) {
    const set = new Set<string>();
    for (const dep of index.get(id)!.deps) {
      set.add(dep);
      for (const inherited of closure.get(dep) ?? []) set.add(inherited);
    }
    closure.set(id, set);
  }

  const result = new Map<string, string[]>();
  for (const [id, set] of closure) {
    result.set(
      id,
      [...set].sort((a, b) => position.get(a)! - position.get(b)!)
    );
  }
  return result;
}

export type ReachDownStep = { id: string; behind: number };

/**
 * What opens up after this course: the immediate dependants only, each carrying
 * a counter of how much sits further behind it. Showing the whole forward
 * closure turns the panel into a wall of chips nobody reads.
 */
export function computeReachDown(courses: Course[]): Map<string, ReachDownStep[]> {
  const dependants = new Map<string, string[]>();
  for (const course of courses) {
    for (const dep of course.deps) {
      const list = dependants.get(dep) ?? [];
      list.push(course.id);
      dependants.set(dep, list);
    }
  }

  // Full forward closure size, computed once in reverse topological order.
  const order = topoSort(courses);
  const forwardClosure = new Map<string, Set<string>>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const set = new Set<string>();
    for (const child of dependants.get(id) ?? []) {
      set.add(child);
      for (const inherited of forwardClosure.get(child) ?? []) set.add(inherited);
    }
    forwardClosure.set(id, set);
  }

  const result = new Map<string, ReachDownStep[]>();
  for (const course of courses) {
    const steps = (dependants.get(course.id) ?? []).map((id) => ({
      id,
      behind: forwardClosure.get(id)?.size ?? 0,
    }));
    steps.sort((a, b) => b.behind - a.behind || a.id.localeCompare(b.id));
    result.set(course.id, steps);
  }
  return result;
}

/**
 * `related` is conceptually mutual but written on one side only. Mirroring it
 * at build time means the frontend never has to check both directions.
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
