/**
 * Gap between a floating layer and the viewport edge it would otherwise touch.
 * Exported because every layer over the catalogue keeps the same one — a menu
 * that stops 8px short of the window and a tooltip that stops 12px short read
 * as two different products.
 */
export const EDGE = 8;
/** Enough of a popover to be worth opening downwards for. */
const ROOM_BELOW = 240;

/** Enough of a popover to be worth showing at all before it starts scrolling. */
const MIN_HEIGHT = 120;

export type Placement = {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  /**
   * How tall the popover may grow before it has to scroll: the room between the
   * edge it hangs off and the far side of the viewport. It comes from the
   * placement because only the placement knows which way the panel grows, and a
   * fixed panel that overshoots the viewport cannot be scrolled back into it —
   * the rows past the edge are simply unreachable.
   */
  maxHeight: number;
};

/**
 * Anchored to a trigger in viewport coordinates, and clamped to the viewport so
 * a trigger near an edge — the far end of a scrolling filter strip, or a help
 * button pinned to the right of a narrow phone — still opens a popover that is
 * fully on screen.
 */
export function placeBy(trigger: DOMRect, align: 'left' | 'right', width: number): Placement {
  const limit = Math.max(EDGE, window.innerWidth - width - EDGE);
  const across =
    align === 'right'
      ? { right: Math.min(Math.max(window.innerWidth - trigger.right, EDGE), limit) }
      : { left: Math.min(Math.max(trigger.left, EDGE), limit) };

  // Upwards when there is not enough room under the trigger and more over it.
  // Either way the offset is from one viewport edge and the panel grows towards
  // the other, so the room left is the same subtraction.
  const below = window.innerHeight - trigger.bottom;
  const upwards = below < ROOM_BELOW && trigger.top > below;
  const offset = upwards ? window.innerHeight - trigger.top + 4 : trigger.bottom + 4;
  const along = upwards ? { bottom: offset } : { top: offset };

  return { ...across, ...along, maxHeight: Math.max(MIN_HEIGHT, window.innerHeight - offset - EDGE) };
}

export const samePlace = (a: Partial<Placement>, b: Placement): boolean =>
  a.left === b.left &&
  a.right === b.right &&
  a.top === b.top &&
  a.bottom === b.bottom &&
  a.maxHeight === b.maxHeight;
