/** Gap between a popover and the viewport edge it would otherwise touch. */
const EDGE = 8;
/** Enough of a popover to be worth opening downwards for. */
const ROOM_BELOW = 240;

export type Placement = { left?: number; right?: number; top?: number; bottom?: number };

/**
 * Anchored to a trigger in viewport coordinates, and clamped to the viewport so
 * a trigger near an edge — the far end of a scrolling filter strip, or a help
 * button pinned to the right of a narrow phone — still opens a popover that is
 * fully on screen.
 */
export function placeBy(trigger: DOMRect, align: 'left' | 'right', width: number): Placement {
  const place: Placement = {};
  const limit = Math.max(EDGE, window.innerWidth - width - EDGE);

  if (align === 'right') {
    place.right = Math.min(Math.max(window.innerWidth - trigger.right, EDGE), limit);
  } else {
    place.left = Math.min(Math.max(trigger.left, EDGE), limit);
  }

  const below = window.innerHeight - trigger.bottom;
  if (below < ROOM_BELOW && trigger.top > below) place.bottom = window.innerHeight - trigger.top + 4;
  else place.top = trigger.bottom + 4;

  return place;
}

export const samePlace = (a: Placement, b: Placement): boolean =>
  a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
