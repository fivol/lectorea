/**
 * The reader's hand on the map: what two fingers on a trackpad, a pinch, a drag
 * or the plate of buttons in the corner do to the drawing.
 *
 * One state — where the map has been moved to and how far in — and every way of
 * changing it funnels through the same two verbs, `panBy` and `zoomAt`, so a
 * pinch and the plus button cannot end up disagreeing about what zooming means.
 *
 * Everything here is measured in the drawing's own units rather than in pixels.
 * The window onto them is re-measured only when the element changes size, which
 * is what makes a wheel event cost one arithmetic pass instead of a walk up the
 * DOM: `frame` is where the browser's own fitting of the viewBox into the
 * element is recorded, and it is the only place this file has to know about it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Where the map has been moved to: `translate(x y) scale(k)`, in map units. */
export type Viewport = { x: number; y: number; k: number };

/** A rectangle of the map, in the map's own units. */
export type Frame = { x: number; y: number; w: number; h: number };

/**
 * How far in the reader may go.
 *
 * Measured against the drawing rather than against where it came to rest,
 * because what runs out at the far end belongs to the drawing: the hexes, the
 * relief and the coastline are all at their own size by then, and more
 * magnification only makes the corners bigger. A display that shows the map
 * small at rest therefore has further to travel, which is right — it had more
 * of the map on screen to begin with.
 *
 * Out is bounded by the resting size instead. The whole map is already there,
 * and there is no page behind it to reveal.
 */
export const MAX_ZOOM = 8;

/**
 * The widest the map is ever drawn, in screen pixels.
 *
 * Without a cap the drawing takes whatever it is given, and on a large display
 * that is a wall map: the reader's eye has to travel the width of the desk to
 * get from one continent to the next, and the lettering — which is sized off
 * the drawing — comes out at heading size. Past this the map stops growing and
 * the sea around it grows instead, which is the same picture at a comfortable
 * size rather than a bigger one. Below it nothing happens at all: a laptop and
 * a phone still get the whole window, because on those the room is the
 * constraint and there is none to spare.
 */
const COMFORTABLE_WIDTH = 1600;

/** One press of the plus button. A quarter of a doubling reads as a step. */
export const ZOOM_STEP = 2 ** 0.25;

/**
 * How far a press may travel before it stops being a pick and becomes a drag,
 * in screen pixels.
 *
 * A territory is a link, and a hand that moves four pixels while clicking one
 * still means to open it. Past that the reader is moving the map, and the click
 * that ends the movement must not also navigate away from it.
 */
const SLOP = 5;

/**
 * How much of a doubling one pixel of pinch is worth.
 *
 * A trackpad pinch arrives as a wheel event with `ctrlKey` set and a delta of a
 * few pixels per frame, so this has to be small enough to feel continuous under
 * the fingers. A mouse wheel with the same modifier arrives in notches of a
 * hundred, which is why the factor is capped afterwards: without the cap one
 * notch of a real wheel crossed half the range.
 */
const ZOOM_PER_PIXEL = 0.0085;
const ZOOM_PER_NOTCH = 1.3;

/** A wheel delta in pixels, whatever unit the browser chose to send it in. */
function wheelPixels(event: WheelEvent): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/**
 * Keeps the drawing over the window on one axis.
 *
 * Two cases, and they are opposites: when the map is larger than the window it
 * may be moved until one of its edges reaches the edge of the window and no
 * further, and when it is smaller — which is the whole of it at rest, and one
 * axis of it for a while after — it is not moved at all but centred. Letting a
 * fitted map slide inside its own letterbox is the difference between a map you
 * are looking at and a picture that has come loose.
 */
function settleAxis(pos: number, size: number, min: number, view: number): number {
  if (size <= view) return min + (view - size) / 2;
  return clamp(pos, min + view - size, min);
}

type Track = { x: number; y: number; fromX: number; fromY: number };

/** Distance between two fingers, and the point between them. */
function spanOf(points: Track[]): { distance: number; x: number; y: number } {
  const [a, b] = points;
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export type MapViewport = {
  ref: React.RefObject<SVGSVGElement>;
  /** What to put on the group the whole drawing lives in. */
  transform: string;
  /** How far in the reader is; `rest` is the whole map in the window. */
  zoom: number;
  /**
   * The magnification the map settles at on this screen: 1 where the window is
   * the constraint, less where the map would otherwise be drawn larger than it
   * is comfortable to read. Everything written on the map is sized against it,
   * so a name is the same size on a laptop and on a wall display.
   */
  rest: number;
  /** The part of the drawing the window shows, in map units — null until measured. */
  window: Frame | null;
  /** True while the map is being dragged. */
  panning: boolean;
  /** The last change came from a button, and so may be eased rather than tracked. */
  eased: boolean;
  /** Nothing has been moved: the whole map is in the window. */
  fitted: boolean;
  /** Whether the press that has just ended moved the map instead of picking something. */
  moved: () => boolean;
  zoomBy: (factor: number) => void;
  reset: () => void;
  handlers: {
    onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => void;
    onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => void;
    onPointerUp: (event: React.PointerEvent<SVGSVGElement>) => void;
    onPointerCancel: (event: React.PointerEvent<SVGSVGElement>) => void;
  };
};

/**
 * @param content The extent of the drawing in its own units, or null while the
 *   map is still loading — the listeners cannot be attached before the element
 *   they belong to exists, and this is what tells them it now does.
 */
export function useMapViewport(content: { width: number; height: number } | null): MapViewport {
  const ref = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const [eased, setEased] = useState(false);

  /**
   * How the browser fitted the drawing into the element: the part of the map's
   * coordinate space the window covers at rest, and how many of those units go
   * into one screen pixel. Everything a gesture has to convert is in here, so
   * no handler has to ask the DOM for a matrix while the hand is moving.
   */
  const [frame, setFrame] = useState<(Frame & { unit: number }) | null>(null);
  const frameRef = useRef<(Frame & { unit: number }) | null>(null);
  frameRef.current = frame;

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !content) return;

    const measure = (): void => {
      const matrix = svg.getScreenCTM();
      const box = svg.getBoundingClientRect();
      if (!matrix || !box.width || !box.height) return;
      const inverse = matrix.inverse();
      const start = new DOMPoint(box.left, box.top).matrixTransform(inverse);
      const end = new DOMPoint(box.right, box.bottom).matrixTransform(inverse);
      setFrame({
        x: start.x,
        y: start.y,
        w: end.x - start.x,
        h: end.y - start.y,
        unit: (end.x - start.x) / box.width,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [content]);

  /**
   * Where the map comes to rest on this screen.
   *
   * The browser has already fitted the drawing to the element, so at 1 the map
   * is exactly as wide as there is room for — which on a large display is far
   * wider than anyone wants to read. This is the fraction of that fit which
   * keeps the drawing under `COMFORTABLE_WIDTH`, and it is 1 on every screen
   * small enough for the question not to arise.
   */
  const rest = useMemo(() => {
    if (!frame || !content) return 1;
    const natural = content.width / frame.unit;
    return natural > 0 ? Math.min(1, COMFORTABLE_WIDTH / natural) : 1;
  }, [frame, content]);

  /** The map back over the window, after anything that may have moved it off. */
  const settle = useCallback(
    (next: Viewport): Viewport => {
      const window = frameRef.current;
      if (!window || !content) return next;
      return {
        k: next.k,
        x: settleAxis(next.x, content.width * next.k, window.x, window.w),
        y: settleAxis(next.y, content.height * next.k, window.y, window.h),
      };
    },
    [content]
  );

  /**
   * Fitting the map when the window is first measured, and again whenever it
   * changes shape — but only for a reader who has not moved it. Someone who has
   * zoomed into a corner and then resized the window wants that corner back,
   * not the whole map; all that is owed to them is the clamp, so the piece they
   * were looking at cannot end up hanging off an edge.
   */
  const fittedTo = useRef(1);
  useEffect(() => {
    const previous = fittedTo.current;
    fittedTo.current = rest;
    setView((current) =>
      settle(current.k <= previous * 1.001 ? { x: 0, y: 0, k: rest } : current)
    );
  }, [frame, rest, settle]);

  /** Where a point of the screen falls on the drawing, before the map was moved. */
  const at = useCallback((clientX: number, clientY: number) => {
    const window = frameRef.current;
    const box = ref.current?.getBoundingClientRect();
    if (!window || !box) return null;
    return {
      x: window.x + (clientX - box.left) * window.unit,
      y: window.y + (clientY - box.top) * window.unit,
    };
  }, []);

  /**
   * Magnify about a point of the screen, keeping whatever is under it exactly
   * where it is. That fixed point is the whole of what makes a pinch feel like
   * the map is being pulled apart rather than replaced by a bigger one.
   */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number): void => {
      const point = at(clientX, clientY);
      if (!point) return;
      setView((current) => {
        const k = clamp(current.k * factor, rest, MAX_ZOOM);
        const ratio = k / current.k;
        return settle({
          k,
          x: point.x - ratio * (point.x - current.x),
          y: point.y - ratio * (point.y - current.y),
        });
      });
    },
    [at, settle, rest]
  );

  /** Move the map by a distance on the screen, not on the drawing. */
  const panBy = useCallback(
    (dx: number, dy: number): void => {
      const window = frameRef.current;
      if (!window) return;
      setView((current) =>
        settle({ ...current, x: current.x + dx * window.unit, y: current.y + dy * window.unit })
      );
    },
    [settle]
  );

  /*
   * The wheel is listened for on the element rather than through React, and it
   * has to be: React attaches wheel at the root and does it passively, and a
   * passive listener cannot call `preventDefault` — so every two-finger swipe
   * would scroll the page out from under the map it was meant to be moving.
   */
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !content) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      setEased(false);
      const delta = wheelPixels(event);
      // A trackpad pinch is a wheel event with `ctrlKey` set — the browser
      // decided that years ago and every one of them still does it. The command
      // key is here for the mouse, which has no second gesture to offer.
      if (event.ctrlKey || event.metaKey) {
        const factor = clamp(
          Math.exp(-delta.y * ZOOM_PER_PIXEL),
          1 / ZOOM_PER_NOTCH,
          ZOOM_PER_NOTCH
        );
        zoomAt(event.clientX, event.clientY, factor);
      } else {
        panBy(-delta.x, -delta.y);
      }
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [content, zoomAt, panBy]);

  /* ─────────────────────────────  Fingers  ──────────────────────────────── */

  const pointers = useRef(new Map<number, Track>());
  const pinch = useRef<ReturnType<typeof spanOf> | null>(null);
  const dragged = useRef(false);

  const handlers = useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<SVGSVGElement>): void => {
        // The primary button only. A right click is the browser's, and the
        // middle one is the platform's autoscroll on half the machines that
        // have one — a map that fought it would win in one browser and lose in
        // the next.
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        pointers.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
          fromX: event.clientX,
          fromY: event.clientY,
        });
        if (pointers.current.size === 1) dragged.current = false;
        if (pointers.current.size === 2) {
          // Two fingers are never a pick, whatever they do next.
          dragged.current = true;
          pinch.current = spanOf([...pointers.current.values()]);
        }
      },

      onPointerMove: (event: React.PointerEvent<SVGSVGElement>): void => {
        const track = pointers.current.get(event.pointerId);
        if (!track) return;
        const dx = event.clientX - track.x;
        const dy = event.clientY - track.y;
        track.x = event.clientX;
        track.y = event.clientY;
        setEased(false);

        // Two fingers do both things at once, because a hand does: the map is
        // magnified by however much they spread and carried by however far
        // their midpoint travelled. Splitting them would make a pinch that
        // drifts feel like it is fighting the reader.
        if (pointers.current.size >= 2) {
          const now = spanOf([...pointers.current.values()].slice(0, 2));
          if (pinch.current && pinch.current.distance > 0) {
            zoomAt(now.x, now.y, now.distance / pinch.current.distance);
            panBy(now.x - pinch.current.x, now.y - pinch.current.y);
          }
          pinch.current = now;
          return;
        }

        if (!dragged.current) {
          if (Math.hypot(event.clientX - track.fromX, event.clientY - track.fromY) < SLOP) return;
          dragged.current = true;
          setPanning(true);
          // Taken only once the press has become a drag. Capturing on the way
          // down would send the click that follows a plain press to the svg
          // instead of to the territory under it, and nothing would open.
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        panBy(dx, dy);
      },

      onPointerUp: (event: React.PointerEvent<SVGSVGElement>): void => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) setPanning(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        // `dragged` is deliberately left standing: the click that follows this
        // release is what has to read it, and the next press clears it.
      },

      onPointerCancel: (event: React.PointerEvent<SVGSVGElement>): void => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        if (pointers.current.size === 0) setPanning(false);
      },
    }),
    [zoomAt, panBy]
  );

  const zoomBy = useCallback(
    (factor: number): void => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      setEased(true);
      // About the middle of the window: a button has no pointer to zoom about,
      // and the centre of what is on screen is what the reader is looking at.
      zoomAt(box.left + box.width / 2, box.top + box.height / 2, factor);
    },
    [zoomAt]
  );

  const reset = useCallback((): void => {
    setEased(true);
    setView(settle({ x: 0, y: 0, k: rest }));
  }, [settle, rest]);

  const window = useMemo(
    () =>
      frame
        ? {
            x: (frame.x - view.x) / view.k,
            y: (frame.y - view.y) / view.k,
            w: frame.w / view.k,
            h: frame.h / view.k,
          }
        : null,
    [frame, view]
  );

  return {
    ref,
    transform: `translate(${view.x} ${view.y}) scale(${view.k})`,
    zoom: view.k,
    rest,
    window,
    panning,
    eased,
    // At the resting size the map is smaller than the window on both axes, so
    // it is centred by the clamp and there is no position left to compare.
    fitted: view.k <= rest * 1.001,
    moved: useCallback(() => dragged.current, []),
    zoomBy,
    reset,
    handlers,
  };
}
