import { useCallback, useEffect, useState } from 'react';

/** `depth` is the source's distance from the selected course — the cascade order. */
export type Link = { from: string; to: string; depth: number };

type Props = {
  /** The scroll container the cards live in; also the SVG's coordinate space. */
  scrollRef: React.RefObject<HTMLElement>;
  links: Link[];
  /** Bumped by the caller when the layout may have changed under the curves. */
  revision: unknown;
  animate: boolean;
};

type Curve = { key: string; d: string; length: number; depth: number };

/**
 * The arrows, drawn only for the chain in hand.
 *
 * Columns already say what comes before what — a card is always to the right of
 * everything it needs. What they cannot say is *which* of the forty cards on
 * the left this one needs, and that is the question a selection is asking. So
 * the curves appear on selection and only along the selected chain: drawn for
 * the whole catalogue they were two hundred crossing lines, which is why they
 * were taken out in the first place.
 *
 * Geometry comes from the DOM rather than from the layout code, because the
 * layout is the browser's: cards are flex children, and their real positions
 * are the only ones that are true after a filter, a resize or a scroll.
 */
export default function ChainLinks({ scrollRef, links, revision, animate }: Props) {
  const [curves, setCurves] = useState<Curve[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !links.length) {
      setCurves([]);
      return;
    }

    const origin = container.getBoundingClientRect();
    // Positions are taken inside the scrolled content, so the layer scrolls
    // with the cards instead of being re-measured on every scroll frame.
    const dx = container.scrollLeft - origin.left;
    const dy = container.scrollTop - origin.top;

    const boxOf = (id: string): DOMRect | null => {
      const node = container.querySelector(`[data-course="${CSS.escape(id)}"]`);
      return node ? (node as HTMLElement).getBoundingClientRect() : null;
    };

    const next: Curve[] = [];
    for (const link of links) {
      const from = boxOf(link.from);
      const to = boxOf(link.to);
      if (!from || !to) continue;

      const x1 = from.right + dx;
      const y1 = from.top + from.height / 2 + dy;
      const x2 = to.left + dx;
      const y2 = to.top + to.height / 2 + dy;
      // A horizontal pull proportional to the gap: short hops stay gentle, long
      // ones bow out far enough not to run along the cards in between.
      const pull = Math.max(24, (x2 - x1) * 0.5);
      const d = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + pull).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - pull).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      next.push({
        key: `${link.from}->${link.to}`,
        d,
        length: Math.hypot(x2 - x1, y2 - y1) + pull,
        depth: link.depth,
      });
    }

    setCurves(next);
    setSize({ width: container.scrollWidth, height: container.scrollHeight });
  }, [scrollRef, links]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    let frame = 0;
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [measure, scrollRef, revision]);

  if (!curves.length) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-0"
      width={size.width}
      height={size.height}
      aria-hidden="true"
    >
      {curves.map((curve) => (
        <path
          key={curve.key}
          d={curve.d}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.7}
          style={
            animate
              ? {
                  // Each curve draws itself just after the card it points at
                  // lights up, so the line and the highlight read as one move.
                  ['--dash' as string]: curve.length,
                  strokeDasharray: curve.length,
                  animation: `draw-line 400ms var(--ease-out) ${curve.depth * 30}ms both`,
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}
