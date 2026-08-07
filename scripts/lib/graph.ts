import type { Course } from '../../shared/schema.js';
import { GraphError, indexCourses } from '../../shared/graph.js';

/**
 * Build-time checks on the course graph.
 *
 * The traversals themselves live in `shared/graph.ts` — the client needs them
 * too. What is here is the part only the build cares about: catching markup
 * mistakes and saying where in which file they are.
 */

export {
  buildLevels,
  dependantsIndex,
  findCycle,
  forwardClosureSizes,
  GraphError,
  indexCourses,
  symmetrizeRelated,
  upstreamOf,
  type CourseIndex,
  type Levels,
} from '../../shared/graph.js';

/** courseId → `data/courses/math.yaml:44`, filled in by the loader. */
export type SourceLocations = Map<string, string>;

function at(where: SourceLocations | undefined, id: string): string {
  const location = where?.get(id);
  return location ? `${location} [${id}]` : `[${id}]`;
}

/** Every `deps`, `soft` and `related` target must exist. Typos are silent otherwise. */
export function validateReferences(
  courses: Course[],
  domainIds: Set<string>,
  where?: SourceLocations
): void {
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
          problems.push(`${at(where, course.id)} ${field} → unknown course "${target}"`);
        }
        if (target === course.id) {
          problems.push(`${at(where, course.id)} ${field} → refers to itself`);
        }
      }
    }
    for (const domain of course.domains) {
      if (!domainIds.has(domain)) {
        problems.push(`${at(where, course.id)} domains → unknown domain "${domain}"`);
      }
    }
  }

  if (problems.length) {
    throw new GraphError(`Broken references (${problems.length})`, problems);
  }
}

/**
 * Markup that is not wrong but rots the graph, reported as warnings.
 *
 * A redundant edge is the common one: if A → B → C and C also lists A, the
 * A → C edge says nothing the graph did not already imply. Left alone they
 * accumulate until every course lists half the catalogue and the direct-only
 * rule stops meaning anything.
 */
export function findGraphWarnings(courses: Course[], where?: SourceLocations): string[] {
  const index = indexCourses(courses);
  const warnings: string[] = [];

  for (const course of courses) {
    // Everything reachable from this course's dependencies, skipping the
    // direct hop itself — anything in here that is also a direct dep is implied.
    const implied = new Set<string>();
    for (const dep of course.deps) {
      const stack = [...(index.get(dep)?.deps ?? [])];
      while (stack.length) {
        const current = stack.pop()!;
        if (implied.has(current)) continue;
        implied.add(current);
        stack.push(...(index.get(current)?.deps ?? []));
      }
    }
    for (const dep of course.deps) {
      if (implied.has(dep)) {
        warnings.push(`${at(where, course.id)} deps → "${dep}" is already implied transitively`);
      }
    }

    for (const soft of course.soft) {
      if (course.deps.includes(soft)) {
        warnings.push(`${at(where, course.id)} soft → "${soft}" is already a hard dependency`);
      }
    }
  }

  return warnings;
}

/**
 * A course lives in the file named after its first domain. The rule exists so
 * that "where does this go?" has one answer; without a check it decays within a
 * dozen pull requests.
 */
export function validateFilePlacement(
  courses: Course[],
  fileOf: Map<string, string>
): void {
  const problems: string[] = [];
  for (const course of courses) {
    const expected = `${course.domains[0]}.yaml`;
    const actual = fileOf.get(course.id);
    if (actual && actual !== expected) {
      problems.push(`[${course.id}] is in ${actual} but its first domain says ${expected}`);
    }
  }
  if (problems.length) {
    throw new GraphError(`Courses in the wrong file (${problems.length})`, problems);
  }
}
