import dagre from 'dagre';
import type { Course } from '../../shared/schema.js';

/**
 * Layered layout, computed at build time. The client only reads coordinates —
 * shipping dagre to the browser would cost weight and a layout pass on 500
 * nodes at every page load, for a result that never changes between deploys.
 */

/** Card geometry. The frontend reads the same constants from `src/lib/layout.ts`. */
export const CARD_WIDTH = 180;
export const CARD_HEIGHT = 140;
export const COLUMN_GAP = 110;
export const ROW_GAP = 28;

export type Point = { x: number; y: number };

export function layoutCourses(
  courses: Course[],
  levels: Map<string, number>
): Map<string, Point> {
  const g = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  g.setGraph({
    rankdir: 'LR',
    // `longest-path` ranks a node exactly at its longest dependency chain,
    // which is the same number as `level`. Any other ranker would drift.
    ranker: 'longest-path',
    nodesep: ROW_GAP,
    ranksep: COLUMN_GAP,
    edgesep: 12,
    marginx: 80,
    marginy: 80,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const course of courses) {
    g.setNode(course.id, { width: CARD_WIDTH, height: CARD_HEIGHT });
  }
  // Only hard dependencies shape the layout: `soft` and `related` would pull
  // nodes sideways and break the "everything flows left to right" promise.
  for (const course of courses) {
    for (const dep of course.deps) g.setEdge(dep, course.id);
  }

  dagre.layout(g);

  const columnStride = CARD_WIDTH + COLUMN_GAP;
  const positions = new Map<string, Point>();

  for (const course of courses) {
    const node = g.node(course.id) as Point | undefined;
    const level = levels.get(course.id) ?? 0;
    positions.set(course.id, {
      // x is derived from `level`, not from dagre: a node with no edges gets
      // rank 0 from dagre regardless of its level, and columns must line up.
      x: Math.round(80 + level * columnStride),
      y: Math.round(node ? node.y - CARD_HEIGHT / 2 : 80),
    });
  }

  compact(courses, levels, positions);
  normaliseTop(positions);
  return positions;
}

const ROW_PITCH = CARD_HEIGHT + ROW_GAP;

/**
 * Dagre leaves large vertical gaps it reserves for edge routing, which on this
 * graph produces a canvas six times taller than it is wide — mostly emptiness.
 *
 * The ordering dagre computed is the valuable part (it is what minimises edge
 * crossings), so it is kept: nodes are only re-stacked at a fixed pitch and
 * then nudged towards the average height of their neighbours.
 */
function compact(
  courses: Course[],
  levels: Map<string, number>,
  positions: Map<string, Point>
): void {
  const columns = new Map<number, string[]>();
  for (const course of courses) {
    const level = levels.get(course.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), course.id]);
  }

  const neighbours = new Map<string, { up: string[]; down: string[] }>();
  for (const course of courses) neighbours.set(course.id, { up: [], down: [] });
  for (const course of courses) {
    for (const dep of course.deps) {
      neighbours.get(course.id)!.up.push(dep);
      neighbours.get(dep)?.down.push(course.id);
    }
  }

  const order = [...columns.keys()].sort((a, b) => a - b);

  // Stack every column at a fixed pitch, in dagre's order. The height of the
  // canvas is now exactly what the busiest column needs and nothing more.
  for (const level of order) {
    const ids = columns
      .get(level)!
      .sort((a, b) => positions.get(a)!.y - positions.get(b)!.y);
    columns.set(level, ids);
    ids.forEach((id, index) => {
      positions.get(id)!.y = (index - (ids.length - 1) / 2) * ROW_PITCH;
    });
  }

  /**
   * Then slide whole columns — never individual cards — towards the average
   * height of what they connect to. Moving cards individually is what let the
   * columns spread out again and undid the compaction; moving the column as a
   * unit improves the edge angles at zero cost in height.
   */
  for (let pass = 0; pass < 12; pass++) {
    const sweep = pass % 2 === 0 ? order : [...order].reverse();
    const side: 'up' | 'down' = pass % 2 === 0 ? 'up' : 'down';

    for (const level of sweep) {
      const ids = columns.get(level)!;
      let drift = 0;
      let counted = 0;

      for (const id of ids) {
        const related = neighbours.get(id)![side];
        if (!related.length) continue;
        const mean =
          related.reduce((sum, other) => sum + (positions.get(other)?.y ?? 0), 0) /
          related.length;
        drift += mean - positions.get(id)!.y;
        counted += 1;
      }
      if (!counted) continue;

      const shift = (drift / counted) * 0.5;
      for (const id of ids) positions.get(id)!.y += shift;
    }
  }

  for (const position of positions.values()) position.y = Math.round(position.y);
}

/** Dagre can produce negative coordinates; shift everything into the positive quadrant. */
function normaliseTop(positions: Map<string, Point>): void {
  let minY = Infinity;
  for (const p of positions.values()) minY = Math.min(minY, p.y);
  if (!Number.isFinite(minY) || minY >= 0) return;
  for (const p of positions.values()) p.y -= minY - 80;
}

export function graphBounds(positions: Map<string, Point>): {
  width: number;
  height: number;
} {
  let maxX = 0;
  let maxY = 0;
  for (const p of positions.values()) {
    maxX = Math.max(maxX, p.x + CARD_WIDTH);
    maxY = Math.max(maxY, p.y + CARD_HEIGHT);
  }
  return { width: maxX + 80, height: maxY + 80 };
}
