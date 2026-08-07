import type { Course, Domain } from '../../shared/schema.js';
import { dependantsIndex } from '../../shared/graph.js';

/**
 * Vertical order of the cards inside each column, computed at build time.
 *
 * The horizontal axis is not a layout decision at all — the column *is* the
 * level, and the level comes from the topological sort. All that is left is the
 * order within a column, and that is what decides whether the screen reads as
 * tracks of a field or as confetti.
 *
 * Not dagre: its default `network-simplex` ranker minimises edge length instead
 * of producing our levels, so calculus drifts right towards whatever consumes
 * it. `longest-path` fixes the ranking but still cannot express domain bands,
 * which are the whole point here. This is ~80 lines and answers to nobody.
 */

export type Column = { level: number; count: number };

export type LayoutResult = {
  /** courseId → position inside its column. */
  row: Map<string, number>;
  columns: Column[];
};

const SWEEPS = 4;

export function layoutColumns(
  courses: Course[],
  levels: Map<string, number>,
  domains: Domain[]
): LayoutResult {
  const bandOf = new Map(domains.map((domain) => [domain.id, domain.bandOrder]));
  const dependants = dependantsIndex(courses);

  type Node = {
    id: string;
    band: number;
    deps: string[];
    dependants: string[];
    row: number;
    bary: number;
  };

  const nodes = new Map<string, Node>();
  const columns = new Map<number, Node[]>();

  for (const course of courses) {
    const node: Node = {
      id: course.id,
      // An unknown domain is caught earlier as an error; the fallback only
      // keeps this function total.
      band: bandOf.get(course.domains[0]) ?? Number.MAX_SAFE_INTEGER,
      deps: course.deps,
      dependants: dependants.get(course.id) ?? [],
      row: 0,
      bary: 0,
    };
    nodes.set(course.id, node);
    const level = levels.get(course.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), node]);
  }

  const order = [...columns.keys()].sort((a, b) => a - b);

  // Seed: band order, then source order. Without a deterministic seed the
  // barycentric passes converge to a different answer on every build.
  for (const level of order) {
    const column = columns.get(level)!;
    column.sort((a, b) => a.band - b.band);
    column.forEach((node, index) => {
      node.row = index;
    });
  }

  /**
   * Barycentric ordering: each card slides towards the average row of what it
   * connects to in the neighbouring column. Sweeping forwards then backwards a
   * few times drops the visual scatter sharply and then stops improving — four
   * passes is where it flattens out.
   *
   * `band` stays the primary sort key, so the barycentre only ever reorders
   * cards *within* a domain's band. That costs some tidiness in exchange for the
   * domain filter lighting up a contiguous stripe instead of a spray of cards,
   * and the filter is used constantly while precise neighbour order is not.
   */
  const reorder = (column: Node[], side: 'deps' | 'dependants'): void => {
    for (const node of column) {
      const neighbours = node[side];
      const rows = neighbours
        .map((id) => nodes.get(id)?.row)
        .filter((row): row is number => row !== undefined);
      node.bary = rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : node.row;
    }
    column.sort((a, b) => a.band - b.band || a.bary - b.bary || a.id.localeCompare(b.id));
    column.forEach((node, index) => {
      node.row = index;
    });
  };

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (const level of order) reorder(columns.get(level)!, 'deps');
    for (const level of [...order].reverse()) reorder(columns.get(level)!, 'dependants');
  }

  return {
    row: new Map([...nodes.values()].map((node) => [node.id, node.row])),
    columns: order.map((level) => ({ level, count: columns.get(level)!.length })),
  };
}
