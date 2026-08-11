import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { EDGE } from '@/lib/popover';

type Props = {
  /** What the tooltip says. Falsy content disables it entirely. */
  content: ReactNode;
  /**
   * The element the tooltip belongs to. It is cloned with the handlers and the
   * `aria-describedby` wiring, so whatever it already is — a button, a link, a
   * span — it stays that.
   */
  children: ReactElement;
  side?: 'top' | 'bottom';
};

/** Long enough that it never fires while the pointer is only passing over. */
const DELAY = 400;
const MAX_WIDTH = 260;
/** Between the bubble and the thing it explains — room for the arrow to sit in. */
const GAP = 8;

/**
 * The explained state.
 *
 * Every badge, dimmed card and metric in this product is supposed to be able to
 * say what it means, and the browser's own `title` cannot: it appears after a
 * second or so, is unstyled, never shows on keyboard focus, and on touch does
 * not exist. So this one is real markup — which also means it can hold a
 * sentence and a number rather than a single line of plain text.
 *
 * Positioned in viewport coordinates and portalled to the body: the things that
 * need explaining sit inside scroll containers and clipped strips, and a
 * tooltip cropped by its own parent is worse than none.
 */
export default function Tooltip({ content, children, side = 'top' }: Props) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{
    top: number;
    left: number;
    arrow: number;
    /** Where it actually went, which is not always where it was asked to go. */
    above: boolean;
  } | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // Appearing is deliberate, disappearing is not — the delay is only on the way in.
  const show = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => setOpen(true), DELAY);
  }, [cancel]);

  const hide = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const bubble = bubbleRef.current?.getBoundingClientRect();
      if (!anchor || !bubble) return;

      const centre = anchor.left + anchor.width / 2;
      const left = Math.min(
        Math.max(centre - bubble.width / 2, EDGE),
        Math.max(EDGE, window.innerWidth - bubble.width - EDGE)
      );

      // The side asked for while the bubble fits there; otherwise whichever
      // side has more room. Which one it ends up on has to be remembered, not
      // re-derived from `side` further down: a bubble that flipped and kept its
      // arrow where it was asked to put it points away from what it explains.
      const needed = bubble.height + GAP + EDGE;
      const roomAbove = anchor.top;
      const roomBelow = window.innerHeight - anchor.bottom;
      const wantsAbove = side === 'top';
      const above = needed <= (wantsAbove ? roomAbove : roomBelow)
        ? wantsAbove
        : roomAbove > roomBelow;

      // Neither side fits a bubble taller than the window — pin it inside
      // rather than let the far end hang off where nothing can reach it.
      const top = Math.min(
        Math.max(above ? anchor.top - bubble.height - GAP : anchor.bottom + GAP, EDGE),
        Math.max(EDGE, window.innerHeight - bubble.height - EDGE)
      );

      setPlace({ top, left, above, arrow: centre - left });
    };
    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [open, side, content]);

  // Escape closes the top layer, and a tooltip is one.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, hide]);

  if (!content) return children;

  // Anchors are plain DOM elements throughout, so the ref can simply be taken —
  // nothing this wraps has one of its own to merge with.
  const anchor = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
    },
    'aria-describedby': open ? id : undefined,
    onPointerEnter: (event: React.PointerEvent) => {
      children.props.onPointerEnter?.(event);
      // Touch already has no hover; opening on a tap would fight the tap.
      if (event.pointerType !== 'touch') show();
    },
    onPointerLeave: (event: React.PointerEvent) => {
      children.props.onPointerLeave?.(event);
      hide();
    },
    onFocus: (event: React.FocusEvent) => {
      children.props.onFocus?.(event);
      setOpen(true);
    },
    onBlur: (event: React.FocusEvent) => {
      children.props.onBlur?.(event);
      hide();
    },
  } as Record<string, unknown>);

  return (
    <>
      {anchor}
      {open
        ? createPortal(
            <div
              ref={bubbleRef}
              id={id}
              role="tooltip"
              style={{
                top: place?.top ?? -9999,
                left: place?.left ?? -9999,
                maxWidth: MAX_WIDTH,
                visibility: place ? 'visible' : 'hidden',
              }}
              className="fade-only pointer-events-none fixed z-[60] animate-fade-in rounded-chip
                         bg-ink px-2.5 py-1.5 text-caption text-canvas shadow-[var(--shadow-pop)]"
            >
              {content}
              {place ? (
                <span
                  aria-hidden="true"
                  className="absolute h-1.5 w-1.5 rotate-45 bg-ink"
                  style={{
                    left: Math.min(Math.max(place.arrow, 10), MAX_WIDTH - 10) - 3,
                    [place.above ? 'bottom' : 'top']: -3,
                  }}
                />
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
