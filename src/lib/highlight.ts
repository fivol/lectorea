import { useMemo } from 'react';
import { upstreamOf } from '@shared/graph';
import { useCatalog } from './catalog';

/**
 * What a selection says about every other course:
 *
 *   direct      — immediate `deps`
 *   transitive  — the rest of the upstream closure
 *   downstream  — what the selection opens up next
 *   soft, related — the weaker ties a course names
 *   everything else drops away
 *
 * A click, and only a click. Hover used to move the whole reading with it,
 * which meant dragging the pointer across the columns repainted three quarters
 * of the screen card by card — a strobe over a question nobody had asked. What
 * a pointer gets now is the card under it lifting; the reading belongs to the
 * course the reader actually picked, and holds still until they pick another.
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

export function useHighlight(selectedId: string | null): Highlight {
  const catalog = useCatalog();

  return useMemo(() => {
    const focusId = selectedId;
    if (!focusId) return INERT;

    const course = catalog.courseById.get(focusId);
    if (!course) return INERT;

    const direct = new Set(course.deps);
    const soft = new Set(course.soft);
    const related = new Set(course.related);
    const transitive = new Set<string>();
    const downstream = new Set<string>();

    for (const id of upstreamOf(catalog.courseById, focusId)) {
      if (!direct.has(id)) transitive.add(id);
    }
    for (const id of catalog.dependants.get(focusId) ?? []) downstream.add(id);

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
      pinned: true,
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
  }, [catalog, selectedId]);
}

/**
 * Opacity per emphasis level.
 *
 * Everything in the chain reads at full strength, the rest drops away. The
 * transitive part used to sit at 45 %, which made the far end of a long path —
 * exactly the part someone is trying to plan around — the hardest thing on the
 * screen to read. The contrast that matters is chain against not-chain.
 */
export const EMPHASIS_OPACITY: Record<Emphasis, number> = {
  self: 1,
  direct: 1,
  downstream: 1,
  transitive: 1,
  soft: 0.75,
  related: 0.75,
  // Dimmed, not erased. At 0.22 the rest of the map became unreadable, which
  // turns "this is not part of your chain" into "this no longer exists" — and
  // these cards are still focusable, still clickable, still the thing someone
  // is about to compare against. Desaturating carries the rest of the message.
  muted: 0.45,
};
