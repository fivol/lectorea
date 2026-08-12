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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useReducedMotion } from '@/lib/hooks';

/** Where the map has been moved to: `translate(x y) scale(k)`, in map units. */
export type Viewport = { x: number; y: number; k: number };

/** A rectangle of the map, in the map's own units. */
export type Frame = { x: number; y: number; w: number; h: number };

/**
 * How far in the reader may go.
 *
 * Four times the size the map opened at, and counted from it rather than from
 * the drawing's own scale, so that every screen gets the same journey: from the
 * opening view down to about one continent filling the window. That is where the
 * map runs out of things to say — past it a reader is looking at two territories
 * and a lot of hexagons, which is a worse view of the catalogue than the one
 * they started from, not a better one.
 *
 * Out is bounded by the whole of the land, which on a tall window is further out
 * than the map opened. There is no page behind that to reveal.
 */
export const MAX_MAGNIFICATION = 4;

/**
 * The widest the land is ever drawn, in screen pixels.
 *
 * The land, not the drawing: the file is a rectangle with the continents in the
 * middle of it and a third of its width in open water round the outside, and
 * fitting *that* to the window is how the map ended up drawn two thirds the
 * size of the room it was given. What a reader came for is the land, so the
 * land is what the window is measured against and the water is what runs off
 * the edges.
 *
 * The cap is still needed above it. Without one the drawing takes whatever it
 * is given, and on a large display that is a wall map — the eye has to travel
 * the width of the desk to get from one continent to the next. Past this the
 * land stops growing and the sea around it grows instead. Below it nothing
 * happens at all: a laptop and a phone still get the whole window, because on
 * those the room is the constraint and there is none to spare.
 */
const COMFORTABLE_WIDTH = 1800;

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
 * hundred, which is why the factor is capped afterwards: a notch has to be a
 * step rather than a leap, and the glide is what carries it across.
 */
const ZOOM_PER_PIXEL = 0.0085;
const ZOOM_PER_NOTCH = 1.18;

/**
 * How much of the way to where it is going the map travels each frame.
 *
 * Magnification is the one thing here that does not arrive continuously. A
 * trackpad pinch does — a few pixels a frame, and following it exactly is what
 * makes it feel like the map is being pulled apart. A wheel notch and a press
 * of the plus button do not: they are a fifth of a doubling arriving in one
 * instant, and applied as they arrive the map jumps rather than moves. So every
 * gesture writes down where the map should be and this walks it there, a fifth
 * of the remaining distance each frame — invisible under a pinch, which is
 * never more than a frame behind, and the whole difference between a step and a
 * jump for everything else.
 *
 * Carrying rather than magnifying is exempt: a hand on the map has to be obeyed
 * to the pixel, and a drag that lags behind the finger by four frames feels
 * like the map is stuck to something.
 */
const GLIDE = 0.2;

/** A wheel delta in pixels, whatever unit the browser chose to send it in. */
function wheelPixels(event: WheelEvent): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/**
 * Keeps the drawing over the room on one axis.
 *
 * The room and not the window, which is the whole point: the header floats over
 * the map, so the top of the window is a place the drawing may pass through but
 * not a place it may come to rest. Measured against the window instead, a map
 * that is a little shorter than the window gets centred in it — and the band the
 * chrome is standing on is taken out of the middle, which puts the northernmost
 * names under the search field.
 *
 * Two cases, and they are opposites: when the map is larger than the room it may
 * be moved until one of its edges reaches the room's and no further, and when it
 * is smaller it is not moved at all but centred there. Letting a fitted map
 * slide about inside its own margins is the difference between a map you are
 * looking at and a picture that has come loose.
 *
 * What shows outside the drawing either way is the water it is drawn on, which
 * the file carries a fifth of its own width past every edge.
 */
function settleAxis(pos: number, size: number, min: number, room: number): number {
  if (size <= room) return min + (room - size) / 2;
  return clamp(pos, min + room - size, min);
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

/**
 * What the viewport has to know about the map to place it.
 *
 * Three boxes, and no two of them are the same box.
 *
 * `extent` is everything the drawing covers, and it is what the map may not be
 * dragged off the window. `content` is the part a reader came for — the land and
 * the names on it — and it is as far out as the map will go: between the two
 * lies the open water the file carries round its edges, which is scenery and may
 * run off the screen.
 *
 * `opening` is where the map starts. On a wide window it is the whole of the
 * land, because the whole of the land is readable there. On a tall one it is
 * not: three continents fitted into a phone is the entire catalogue drawn at
 * four pixels a letter, which is not a map of anything. So the tall map opens
 * on part of its world and the rest is a drag away — which is what every map on
 * a phone has always done.
 */
export type MapPlan = {
  extent: { width: number; height: number };
  content: Frame;
  opening: Frame;
  /**
   * Bands of the window, in screen pixels, that the drawing passes under but
   * does not come to rest under — whatever floats over the map.
   */
  inset: { top: number; bottom: number };
};

export type MapViewport = {
  ref: React.RefObject<SVGSVGElement>;
  /** What to put on the group the whole drawing lives in. */
  transform: string;
  /** How far in the reader is; `rest` is where the map opened. */
  zoom: number;
  /**
   * The magnification the map opens at on this screen: the one that fits
   * `opening` into whatever is not covered by the chrome, unless that would
   * draw it wider than is comfortable to read. Everything written on the map is
   * sized against it, so a name is the same size on a laptop and on a wall
   * display — and on a phone, where the map opens closer in, the names it opens
   * with are the ones it was drawn for.
   */
  rest: number;
  /** The part of the drawing the window shows, in map units — null until measured. */
  window: Frame | null;
  /** True while the map is being dragged. */
  panning: boolean;
  /** The whole map is in the window — there is nothing further to come out to. */
  fitted: boolean;
  /** As far in as the map goes. */
  deepest: boolean;
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
 * @param plan How the map wants to be placed, or null while it is still
 *   loading — the listeners cannot be attached before the element they belong
 *   to exists, and this is what tells them it now does.
 */
export function useMapViewport(plan: MapPlan | null): MapViewport {
  const ref = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const reducedMotion = useReducedMotion();

  /**
   * Where the map is, and where it is going. They are the same thing except
   * during a glide, and every gesture reads the second: two wheel notches in one
   * frame have to compound into one journey rather than the second overwriting
   * the first halfway through the first.
   */
  const shown = useRef<Viewport>(view);
  const wanted = useRef<Viewport>(view);
  const walking = useRef<number | null>(null);

  /**
   * How the browser fitted the drawing into the element: the part of the map's
   * coordinate space the window covers at rest, and how many of those units go
   * into one screen pixel. Everything a gesture has to convert is in here, so
   * no handler has to ask the DOM for a matrix while the hand is moving.
   */
  const [frame, setFrame] = useState<(Frame & { unit: number }) | null>(null);
  const frameRef = useRef<(Frame & { unit: number }) | null>(null);
  frameRef.current = frame;

  /*
   * Measured before the browser paints, not after.
   *
   * The map cannot be placed until the window it is going into has been
   * measured, and the window cannot be measured until the map is in the DOM —
   * so there is one render where the drawing exists and nothing is known about
   * where it should sit. Run as an ordinary effect, that render reaches the
   * screen: the map appears at the wrong size and jumps to the right one a
   * frame later, every load and every return from the columns. A layout effect
   * closes the gap — React flushes the measurement, the placing and the second
   * render before a single pixel is drawn.
   */
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg || !plan) return;

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
  }, [plan]);

  /**
   * The part of the window the map settles inside: everything the chrome is not
   * standing on. In the drawing's own units, so that the fitting below is one
   * division rather than a change of coordinate system.
   */
  const room = useMemo(() => {
    if (!frame || !plan) return null;
    const top = plan.inset.top * frame.unit;
    const bottom = plan.inset.bottom * frame.unit;
    return { x: frame.x, y: frame.y + top, w: frame.w, h: Math.max(frame.h - top - bottom, 1) };
  }, [frame, plan]);

  const roomRef = useRef<typeof room>(null);
  roomRef.current = room;

  /**
   * The magnification at which a given box of the drawing fills that room — or
   * the one that keeps it under `COMFORTABLE_WIDTH`, whichever is smaller.
   */
  const fitTo = useCallback(
    (box: Frame): number => {
      if (!frame || !room || box.w <= 0 || box.h <= 0) return 1;
      const fits = Math.min(room.w / box.w, room.h / box.h);
      const comfortable = (COMFORTABLE_WIDTH * frame.unit) / box.w;
      return Math.min(fits, comfortable);
    },
    [frame, room]
  );

  /** As far out as the map goes: the whole of the land in the room. */
  const floor = useMemo(() => (plan ? fitTo(plan.content) : 1), [plan, fitTo]);

  /** Where the map opens. The same thing on a wide window; closer in on a tall one. */
  const rest = useMemo(() => (plan ? fitTo(plan.opening) : 1), [plan, fitTo]);

  /**
   * A box of the drawing centred in the room — not in the window. Those are
   * different points whenever the chrome is thicker on one side than the other,
   * and the second one puts the continents behind the header.
   */
  const centreOn = useCallback(
    (box: Frame, k: number): Viewport => {
      if (!room) return { x: 0, y: 0, k };
      return {
        k,
        x: room.x + room.w / 2 - k * (box.x + box.w / 2),
        y: room.y + room.h / 2 - k * (box.y + box.h / 2),
      };
    },
    [room]
  );

  /** Where the map sits when nothing has been asked of it. */
  const home = useCallback(
    (): Viewport => (plan ? centreOn(plan.opening, rest) : { x: 0, y: 0, k: rest }),
    [plan, centreOn, rest]
  );

  /** The whole map in the window, which is what the corner button offers. */
  const whole = useCallback(
    (): Viewport => (plan ? centreOn(plan.content, floor) : { x: 0, y: 0, k: floor }),
    [plan, centreOn, floor]
  );

  /** The map back over the window, after anything that may have moved it off. */
  const settle = useCallback(
    (next: Viewport): Viewport => {
      const area = roomRef.current;
      if (!area || !plan) return next;
      const { extent } = plan;
      return {
        k: next.k,
        x: settleAxis(next.x, extent.width * next.k, area.x, area.w),
        y: settleAxis(next.y, extent.height * next.k, area.y, area.h),
      };
    },
    [plan]
  );

  /** Put the map somewhere now, with nothing left to walk towards. */
  const land = useCallback((next: Viewport): void => {
    if (walking.current !== null) cancelAnimationFrame(walking.current);
    walking.current = null;
    shown.current = next;
    wanted.current = next;
    setView(next);
  }, []);

  /** One frame of the walk towards wherever the last gesture asked for. */
  const walk = useCallback((): void => {
    const goal = wanted.current;
    const from = shown.current;
    const dx = goal.x - from.x;
    const dy = goal.y - from.y;
    const dk = goal.k - from.k;
    // Near enough is the end of it: a walk that only ever covers a fifth of
    // what is left never arrives, and a map creeping the last hundredth of a
    // pixel forever is a repaint every frame for nothing.
    const there = Math.abs(dk) <= goal.k * 0.0008 && Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2;
    const next = there
      ? goal
      : { x: from.x + dx * GLIDE, y: from.y + dy * GLIDE, k: from.k + dk * GLIDE };
    shown.current = next;
    setView(next);
    walking.current = there ? null : requestAnimationFrame(walk);
  }, []);

  /** Ask for somewhere, and let the map walk there over the next few frames. */
  const glide = useCallback(
    (next: Viewport): void => {
      if (reducedMotion) return land(next);
      wanted.current = next;
      if (walking.current === null) walking.current = requestAnimationFrame(walk);
    },
    [land, walk, reducedMotion]
  );

  useEffect(
    () => () => {
      if (walking.current !== null) cancelAnimationFrame(walking.current);
    },
    []
  );

  /**
   * Fitting the map when the window is first measured, and again whenever it
   * changes shape — but only for a reader who has not moved it. Someone who has
   * zoomed into a corner and then resized the window wants that corner back,
   * not the whole map; all that is owed to them is the clamp, so the piece they
   * were looking at cannot end up hanging off an edge.
   *
   * Landed rather than walked to. A window changing shape is not a gesture, and
   * a map that slides into place afterwards reads as though it were still
   * settling from whatever the reader last did.
   */
  const fittedTo = useRef(1);
  useLayoutEffect(() => {
    const previous = fittedTo.current;
    fittedTo.current = rest;
    land(settle(wanted.current.k <= previous * 1.001 ? home() : wanted.current));
  }, [frame, rest, settle, land, home]);

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
      const from = wanted.current;
      const k = clamp(from.k * factor, floor, rest * MAX_MAGNIFICATION);
      const ratio = k / from.k;
      glide(
        settle({
          k,
          x: point.x - ratio * (point.x - from.x),
          y: point.y - ratio * (point.y - from.y),
        })
      );
    },
    [at, settle, glide, floor, rest]
  );

  /**
   * Move the map by a distance on the screen, not on the drawing — and now,
   * not over the next few frames. Carrying is the one thing a hand does
   * directly, so it also puts an end to any glide still in flight by landing on
   * wherever that glide was headed.
   */
  const panBy = useCallback(
    (dx: number, dy: number): void => {
      const window = frameRef.current;
      if (!window) return;
      const from = wanted.current;
      land(settle({ ...from, x: from.x + dx * window.unit, y: from.y + dy * window.unit }));
    },
    [settle, land]
  );

  /*
   * The wheel is listened for on the element rather than through React, and it
   * has to be: React attaches wheel at the root and does it passively, and a
   * passive listener cannot call `preventDefault` — so every two-finger swipe
   * would scroll the page out from under the map it was meant to be moving.
   */
  useEffect(() => {
    const svg = ref.current;
    if (!svg || !plan) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
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
  }, [plan, zoomAt, panBy]);

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
      // About the middle of the window: a button has no pointer to zoom about,
      // and the centre of what is on screen is what the reader is looking at.
      zoomAt(box.left + box.width / 2, box.top + box.height / 2, factor);
    },
    [zoomAt]
  );

  const reset = useCallback((): void => {
    glide(settle(whole()));
  }, [glide, settle, whole]);

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
    // At the resting size the map is smaller than the window on both axes, so
    // it is centred by the clamp and there is no position left to compare.
    fitted: view.k <= floor * 1.001,
    deepest: view.k >= rest * MAX_MAGNIFICATION * 0.999,
    moved: useCallback(() => dragged.current, []),
    zoomBy,
    reset,
    handlers,
  };
}
