import { useMemo } from 'react';
import { upstreamOf } from '@shared/graph';
import { useCatalog } from './catalog';

/**
 * Three levels of highlighting, because with fewer everything blends together:
 *
 *   direct      — immediate `deps`, lit on hover and on click
 *   transitive  — the rest of the upstream closure, click only, at 45 %
 *   downstream  — what opens up next, click only, in the accent colour
 *   everything else drops to 20 %
 *
 * Hover is temporary; a click pins the highlight until another course is picked.
 */

export type Emphasis = 'self' | 'direct' | 'transitive' | 'downstream' | 'soft' | 'related' | 'muted';

export type Highlight = {
  active: boolean;
  emphasisOf: (courseId: string) => Emphasis;
  /** Steps from the focused course, right to left — drives the cascade delay. */
  depthOf: (courseId: string) => number;
  focusId: string | null;
  pinned: boolean;
};

const INERT: Highlight = {
  active: false,
  emphasisOf: () => 'self',
  depthOf: () => 0,
  focusId: null,
  pinned: false,
};

export function useHighlight(
  selectedId: string | null,
  hoveredId: string | null
): Highlight {
  const catalog = useCatalog();

  return useMemo(() => {
    // Hover wins while it lasts, so pointing at a card always answers
    // "what does this need" without losing the pinned selection underneath.
    const focusId = hoveredId ?? selectedId;
    if (!focusId) return INERT;

    const course = catalog.courseById.get(focusId);
    if (!course) return INERT;

    const pinned = !hoveredId && Boolean(selectedId);
    const showFullChain = Boolean(selectedId) && (!hoveredId || hoveredId === selectedId);

    const direct = new Set(course.deps);
    const soft = new Set(course.soft);
    const related = new Set(course.related);
    const transitive = new Set<string>();
    const downstream = new Set<string>();

    if (showFullChain) {
      for (const id of upstreamOf(catalog.courseById, focusId)) {
        if (!direct.has(id)) transitive.add(id);
      }
      for (const id of catalog.dependants.get(focusId) ?? []) downstream.add(id);
    }

    // Distance in dependency hops, for the right-to-left cascade.
    const depth = new Map<string, number>([[focusId, 0]]);
    const queue: string[] = [focusId];
    while (queue.length) {
      const id = queue.shift()!;
      const current = depth.get(id)!;
      for (const dep of catalog.courseById.get(id)?.deps ?? []) {
        if (depth.has(dep)) continue;
        depth.set(dep, current + 1);
        queue.push(dep);
      }
    }

    return {
      active: true,
      focusId,
      pinned,
      emphasisOf: (courseId: string): Emphasis => {
        if (courseId === focusId) return 'self';
        if (direct.has(courseId)) return 'direct';
        if (downstream.has(courseId)) return 'downstream';
        if (transitive.has(courseId)) return 'transitive';
        if (soft.has(courseId)) return 'soft';
        if (related.has(courseId)) return 'related';
        return 'muted';
      },
      depthOf: (courseId: string) => depth.get(courseId) ?? 0,
    };
  }, [catalog, selectedId, hoveredId]);
}

/** Opacity per emphasis level — one table so the graph and the edges agree. */
export const EMPHASIS_OPACITY: Record<Emphasis, number> = {
  self: 1,
  direct: 1,
  downstream: 1,
  transitive: 0.45,
  soft: 0.7,
  related: 0.7,
  muted: 0.2,
};
