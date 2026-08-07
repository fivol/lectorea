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
const GAP = 8;
const EDGE = 8;

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
  const [place, setPlace] = useState<{ top: number; left: number; arrow: number } | null>(null);

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
      // Flips rather than hangs off the top of the window.
      const above = side === 'top' && anchor.top > bubble.height + GAP;
      const top = above ? anchor.top - bubble.height - GAP : anchor.bottom + GAP;

      setPlace({ top, left, arrow: centre - left });
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
                    [side === 'top' ? 'bottom' : 'top']: -3,
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
