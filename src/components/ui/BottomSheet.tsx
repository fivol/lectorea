import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { clamp } from '@/lib/format';
import { useFocusTrap, useScrollLock } from '@/lib/hooks';
import IconButton from './IconButton';

type Props = {
  /** The accessible name of the dialog. */
  label: string;
  /** Name for the × — the kit stays out of i18n, so the caller translates. */
  closeLabel: string;
  /**
   * Where the sheet comes to rest, as a fraction of the window. Below its full
   * height it opens part-way and can be pulled the rest of the way up; `1`
   * gives a single position and no detent to pull towards.
   */
  peek?: number;
  /** Changing it returns the content to the top — a new subject reads from its start. */
  contentKey?: string;
  onClose: () => void;
  children: ReactNode;
};

/** Entering, settling between detents, and leaving. */
const ENTER = 'var(--dur-slow) var(--ease-out)';
const SNAP = 'var(--dur-base) var(--ease-out)';
/*
 * Leaving would be `--ease-in` by the design system, but that curve holds still
 * for its first fifth — after a flick, which is how a sheet is usually sent
 * away, the hesitation reads as the gesture not having been felt.
 */
const EXIT = 'var(--dur-base) var(--ease-inout)';

/** A flick, in px/ms: past this the throw decides, not where the finger stopped. */
const FLICK = 0.5;
/** How far ahead of the release a flick is credited with carrying the sheet. */
const PROJECTION = 140;
/** Movement before a touch is a drag rather than a tap. */
const SLOP = 5;
/** Pulling above the top is resisted rather than refused. */
const RUBBER = 0.35;

/**
 * A panel that comes up from the bottom edge of a phone and is put away by
 * pushing it back down.
 *
 * The gesture is the point. A sheet with a grab bar that answers nothing but a
 * × is a modal wearing the costume of a sheet, so this one follows the finger
 * the whole way: it tracks the drag, dims the page in proportion to how much of
 * itself is left on screen, and on release either settles onto a detent or
 * carries on out of the window. A throw is honoured for what it was — where the
 * finger was going, not where it happened to stop.
 *
 * Position is written straight to the node during a drag rather than kept in
 * state: this runs on every pointer event, and a React render per frame is the
 * difference between the sheet being under the finger and trailing behind it.
 */
export default function BottomSheet({
  label,
  closeLabel,
  peek = 1,
  contentKey,
  onClose,
  children,
}: Props) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trapRef = useFocusTrap(true);
  useScrollLock(true);

  /** Everything below is in px *below* the sheet's fully open position. */
  const offset = useRef(0);
  /** The resting detent — 0 when the sheet is short enough to open whole. */
  const rest = useRef(0);
  /** The sheet's own height, which is also the position where it is off screen. */
  const height = useRef(0);

  const leaving = useRef(false);
  const alive = useRef(true);

  const [open, setOpen] = useState(peek >= 1);
  const openRef = useRef(open);
  const [dragging, setDragging] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  /** One node, two owners: the sheet is both what moves and what traps focus. */
  const setSheet = useCallback(
    (node: HTMLDivElement | null) => {
      sheetRef.current = node;
      (trapRef as unknown as { current: HTMLDivElement | null }).current = node;
    },
    [trapRef]
  );

  /** Puts the sheet at `next`, with the backdrop as dim as the sheet is visible. */
  const place = useCallback((next: number, motion: string | null) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    offset.current = next;
    sheet.style.transition = motion ? `transform ${motion}` : 'none';
    sheet.style.transform = `translate3d(0, ${next}px, 0)`;

    const backdrop = backdropRef.current;
    if (!backdrop) return;
    // Full dim from the resting detent upwards, fading only as the sheet leaves.
    const span = height.current - rest.current || 1;
    backdrop.style.transition = motion ? `opacity ${motion}` : 'none';
    backdrop.style.opacity = String(clamp((height.current - next) / span, 0, 1));
  }, []);

  const measure = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    height.current = sheet.offsetHeight;
    const detent = height.current - window.innerHeight * peek;
    // A detent within a thumb's width of the top is not a second position,
    // it is a sheet that opens whole with a wobble in it.
    rest.current = detent > 40 ? detent : 0;
  }, [peek]);

  const settle = useCallback(
    (next: boolean, motion: string | null = SNAP) => {
      openRef.current = next;
      setOpen(next);
      if (!next) {
        scrollRef.current?.scrollTo({ top: 0 });
        setScrolled(false);
      }
      place(next ? 0 : rest.current, motion);
    },
    [place]
  );

  /* ──────────────────────────  Entering and leaving  ────────────────────── */

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    measure();
    place(height.current, null);
    // The reflow is what makes the two writes a transition rather than a jump.
    void sheet.offsetHeight;
    settle(rest.current <= 0, ENTER);
  }, [measure, place, settle]);

  // A sheet already taken off the screen has nobody to tell that it left.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setDragging(false);
    place(height.current, EXIT);

    // The caller unmounts the sheet, so it is told once the sheet is off screen
    // — and told anyway if the transition never reports back.
    let done = false;
    const finish = (): void => {
      if (done || !alive.current) return;
      done = true;
      onClose();
    };
    const timer = window.setTimeout(finish, 600);
    sheetRef.current?.addEventListener(
      'transitionend',
      (event) => {
        if (event.propertyName !== 'transform') return;
        window.clearTimeout(timer);
        finish();
      },
      { once: true }
    );
  }, [onClose, place]);

  /* ─────────────────────────────  The drag  ─────────────────────────────── */

  const drag = useRef<{
    id: number;
    y: number;
    from: number;
    lastY: number;
    lastT: number;
    velocity: number;
    active: boolean;
    grip: boolean;
  } | null>(null);
  /** A drag that ends on a link must not also follow it. */
  const swallowClick = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (leaving.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    swallowClick.current = false;
    const target = event.target as HTMLElement;
    drag.current = {
      id: event.pointerId,
      y: event.clientY,
      from: offset.current,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
      active: false,
      grip: Boolean(target.closest('[data-grip]')) && !target.closest('button, a'),
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;

    if (!state.active) {
      const moved = event.clientY - state.y;
      if (Math.abs(moved) < SLOP) return;
      const scroller = scrollRef.current;
      const atTop = !scroller || scroller.scrollTop <= 0;
      /*
       * Down inside a list that has been scrolled is scrolling, not dragging;
       * up is a drag only while there is somewhere above to go. The grab bar is
       * neither — it is the handle, and it always moves the sheet.
       */
      const takes = state.grip || (moved > 0 ? atTop : offset.current > 0);
      if (!takes) {
        drag.current = null;
        return;
      }
      state.active = true;
      // Rebased, so the sheet starts from the finger rather than jumping the slop.
      state.y = event.clientY;
      setDragging(true);
      // Keeps the drag on the sheet once it has begun, wherever the finger goes
      // — and is allowed to fail: a pointer let go this same frame has nothing
      // left to capture, which is not a reason to drop the gesture.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* no pointer to capture */
      }
    }

    const elapsed = event.timeStamp - state.lastT;
    if (elapsed > 0) {
      state.velocity = (event.clientY - state.lastY) / elapsed;
      state.lastY = event.clientY;
      state.lastT = event.timeStamp;
    }

    const next = state.from + (event.clientY - state.y);
    place(next < 0 ? next * RUBBER : Math.min(next, height.current), null);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;

    // A tap on the grab bar is the gesture without the travel: it toggles.
    if (!state.active) {
      if (state.grip && rest.current > 0) settle(!openRef.current);
      return;
    }

    setDragging(false);
    swallowClick.current = true;

    const here = offset.current;
    const detents = rest.current > 0 ? [0, rest.current, height.current] : [0, height.current];

    /*
     * A flick is a step, not a distance: it moves the sheet to the next place
     * there is, counted from where the drag began rather than from where the
     * finger let go. Pushed down from the top the sheet goes to the detent
     * below; pushed again it goes away. Otherwise a hard flick would skip the
     * detent it was aimed at, and a gentle one would be treated as a throw.
     */
    if (state.velocity > FLICK) {
      const below = detents.find((detent) => detent > state.from + 1) ?? height.current;
      if (below >= height.current) dismiss();
      else settle(false);
      return;
    }
    if (state.velocity < -FLICK) {
      settle(true);
      return;
    }

    // Let go slowly: it settles on whichever position it stopped nearest,
    // credited with a little of the movement it still had.
    const thrown = clamp(here + state.velocity * PROJECTION, 0, height.current);
    const target = detents.reduce((best, candidate) =>
      Math.abs(candidate - thrown) < Math.abs(best - thrown) ? candidate : best
    );
    if (target >= height.current) dismiss();
    else settle(target <= 0);
  };

  const onPointerCancel = (): void => {
    const state = drag.current;
    drag.current = null;
    if (!state?.active) return;
    setDragging(false);
    settle(Math.abs(offset.current) < Math.abs(offset.current - rest.current));
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  /* ───────────────────────────  Staying put  ────────────────────────────── */

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const refit = (): void => {
      if (leaving.current || drag.current?.active) return;
      measure();
      place(openRef.current ? 0 : rest.current, SNAP);
    };
    // A course with less in it is a shorter sheet; a turned phone is a new
    // window. Neither should leave the sheet resting where the old one was.
    const observer = new ResizeObserver(() => {
      if (sheet.offsetHeight !== height.current) refit();
    });
    observer.observe(sheet);
    window.addEventListener('resize', refit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refit);
    };
  }, [measure, place]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [contentKey]);

  return createPortal(
    /* `z-40`, under the modal layer: a playlist opened from inside the sheet is
       portalled after it and would otherwise be decided by DOM order alone. */
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <div
        ref={backdropRef}
        className="fade-only absolute inset-0 bg-overlay"
        onClick={dismiss}
        aria-hidden="true"
      />

      <div
        ref={setSheet}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
        className={`relative flex max-h-[92svh] flex-col overflow-hidden rounded-t-pop border-t
                    border-line bg-surface shadow-[var(--shadow-modal)] outline-none
                    ${dragging ? 'select-none' : ''}`}
        /*
         * `none` while the sheet is part-way up: there is nothing to scroll
         * there, and the drag must not be given away to the browser. `pan-y`
         * once it is open, so the list inside scrolls natively and the sheet
         * takes over only where the list has run out.
         */
        style={{ touchAction: open ? 'pan-y' : 'none', willChange: 'transform' }}
      >
        {/*
          The handle, and the only piece of chrome the sheet adds. The rule
          under it appears when there is text scrolled up behind it — a line
          drawn over nothing is a seam in an unbroken surface.
        */}
        <div
          data-grip
          className={`relative flex shrink-0 items-center justify-center border-b py-2.5
                      transition-colors duration-fast ease-out
                      ${scrolled ? 'border-line' : 'border-transparent'}`}
        >
          <span
            className={`h-1 w-10 rounded-full transition-colors duration-fast ease-out
                        ${dragging ? 'bg-ink-dim' : 'bg-line-strong'}`}
            aria-hidden="true"
          />
          <IconButton
            icon="close"
            label={closeLabel}
            tap
            onClick={dismiss}
            className="absolute right-1.5 top-1/2 -translate-y-1/2"
          />
        </div>

        <div
          ref={scrollRef}
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
          /* Tabbing into something below the fold opens the sheet rather than
             scrolling a box that has been told not to scroll. Keyboard focus
             only: a tap focuses the button it lands on too, and every tap on a
             link down there would otherwise haul the sheet up with it. */
          onFocusCapture={(event) => {
            const node = event.target as HTMLElement;
            if (!openRef.current && node.matches?.(':focus-visible')) settle(true);
          }}
          className={`min-h-0 flex-1 overscroll-contain pb-[env(safe-area-inset-bottom)]
                      ${open ? 'overflow-y-auto' : 'overflow-hidden'}`}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
