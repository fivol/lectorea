import { useCallback, useEffect, useState } from 'react';
import { COLUMN_GAP } from '@/lib/layout';

/**
 * `depth` is the source's distance from the selected course — the cascade order.
 * `spine` marks the main line through the target: see `ColumnsView`.
 */
export type Link = { from: string; to: string; depth: number; spine: boolean };

type Props = {
  /** The scroll container the cards live in; also the SVG's coordinate space. */
  scrollRef: React.RefObject<HTMLElement>;
  links: Link[];
  /** Bumped by the caller when the layout may have changed under the curves. */
  revision: unknown;
  animate: boolean;
};

type Curve = { key: string; d: string; length: number; depth: number; spine: boolean };

/** Corner radius where a horizontal stub turns into the vertical run. */
const RADIUS = 10;
/** Below this the two cards are level with each other and a straight line does. */
const FLAT = 6;
/** The most two neighbouring lanes are ever pushed apart. */
const LANE_SPACING = 12;

type Raw = {
  link: Link;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Drops further than it reaches — the case a single cubic cannot draw. */
  steep: boolean;
};

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
 * Even along one chain they read as noise until they are routed. A single
 * cubic from card to card takes its bow from the horizontal distance, and
 * between adjacent columns that distance *is* the gap — so a card four rows
 * down was reached by a line that spent its whole descent inside the gap,
 * hugging the edges of the cards on both sides. Eight of those look like
 * borders, not like connections, and any two sharing a gap are one line.
 *
 * So a steep link is routed rather than drawn: out of the source's right edge,
 * along to a lane in the gap, down the lane, and into the target's left edge,
 * with the corners rounded. Shallow links keep the curve — a gentle diagonal
 * over a long horizontal run is exactly what a cubic is good at, and 16 % of
 * the edges in this catalogue span more than one column.
 *
 * Lanes are assigned per *target*, not per link. Everything feeding one course
 * comes down the same lane and merges at its edge, which is the fork a chain
 * actually has; separate targets sharing a gap get lanes of their own and stop
 * overlapping. That is where the tree-like reading comes from, and it costs no
 * edges: nothing is dropped to get it.
 *
 * Geometry comes from the DOM rather than from the layout code, because the
 * layout is the browser's: cards are flex children, and their real positions
 * are the only ones that are true after a filter, a resize or a scroll.
 */
export default function ChainLinks({ scrollRef, links, revision, animate }: Props) {
  const [curves, setCurves] = useState<Curve[]>([]);

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

    const raws: Raw[] = [];
    for (const link of links) {
      const from = boxOf(link.from);
      const to = boxOf(link.to);
      if (!from || !to) continue;

      const x1 = from.right + dx;
      const y1 = from.top + from.height / 2 + dy;
      const x2 = to.left + dx;
      const y2 = to.top + to.height / 2 + dy;
      const gap = x2 - x1;

      raws.push({
        link,
        x1,
        y1,
        x2,
        y2,
        steep: gap > 0 && Math.abs(y2 - y1) > Math.max(gap, FLAT),
      });
    }

    const steep = raws.filter((raw) => raw.steep);

    /**
     * Lane per target, spread across the corridor its gap offers.
     *
     * Targets are grouped by the column they stand in — everything arriving at
     * one column shares one gap — and ordered top to bottom, so lanes do not
     * cross each other on their way in.
     */
    const laneOf = new Map<string, number>();
    const byColumn = new Map<number, Raw[]>();
    for (const raw of steep) {
      if (laneOf.has(raw.link.to)) continue;
      const column = Math.round(raw.x2);
      byColumn.set(column, [...(byColumn.get(column) ?? []), raw]);
      laneOf.set(raw.link.to, 0); // reserved; the value is filled in below
    }

    for (const [, arrivals] of byColumn) {
      const ordered = arrivals.sort((a, b) => a.y2 - b.y2);
      for (const [index, raw] of ordered.entries()) {
        const low = Math.max(raw.x1, raw.x2 - COLUMN_GAP) + RADIUS;
        const high = raw.x2 - RADIUS;
        if (low >= high) {
          laneOf.set(raw.link.to, (raw.x1 + raw.x2) / 2);
          continue;
        }
        const centre = (low + high) / 2;
        const count = ordered.length;
        const spacing = count > 1 ? Math.min(LANE_SPACING, (high - low) / (count - 1)) : 0;
        const offset = (index - (count - 1) / 2) * spacing;
        laneOf.set(raw.link.to, Math.min(high, Math.max(low, centre + offset)));
      }
    }

    const next: Curve[] = [];
    for (const raw of raws) {
      const { link, x1, y1, x2, y2 } = raw;
      const drop = y2 - y1;
      const gap = x2 - x1;
      const lane = raw.steep ? laneOf.get(link.to) : undefined;

      let d: string;
      let length: number;

      if (lane === undefined) {
        // A horizontal pull proportional to the gap: short hops stay gentle,
        // long ones bow out far enough not to run along the cards in between.
        const pull = Math.max(24, gap * 0.5);
        d =
          `M${x1.toFixed(1)} ${y1.toFixed(1)} ` +
          `C${(x1 + pull).toFixed(1)} ${y1.toFixed(1)}, ` +
          `${(x2 - pull).toFixed(1)} ${y2.toFixed(1)}, ` +
          `${x2.toFixed(1)} ${y2.toFixed(1)}`;
        length = Math.hypot(gap, drop) + pull;
      } else {
        const sign = Math.sign(drop);
        const radius = Math.min(RADIUS, lane - x1, x2 - lane, Math.abs(drop) / 2);
        d =
          `M${x1.toFixed(1)} ${y1.toFixed(1)} ` +
          `H${(lane - radius).toFixed(1)} ` +
          `Q${lane.toFixed(1)} ${y1.toFixed(1)}, ${lane.toFixed(1)} ${(y1 + sign * radius).toFixed(1)} ` +
          `V${(y2 - sign * radius).toFixed(1)} ` +
          `Q${lane.toFixed(1)} ${y2.toFixed(1)}, ${(lane + radius).toFixed(1)} ${y2.toFixed(1)} ` +
          `H${x2.toFixed(1)}`;
        length = lane - x1 + Math.abs(drop) + (x2 - lane);
      }

      next.push({
        key: `${link.from}->${link.to}`,
        d,
        length,
        depth: link.depth,
        spine: link.spine,
      });
    }

    setCurves(next);
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
      // Over the cards, not under them. The curves are the answer to the click;
      // a card in the middle of a long hop — dimmed, out of the chain, and still
      // opaque — used to cut the line in half exactly where it had the most to
      // say. The column headers stay above them: they carry the same z and come
      // later in the document, so a curve passes behind the sticky label rather
      // than across it.
      //
      // Sized by the columns it covers rather than by a measurement of the
      // scroller. Measuring gave the layer a width of its own, which the
      // scroller then had to scroll, which the next measurement read back:
      // switch to a field with three courses in it and the canvas stayed as
      // wide as the field before it, three cards adrift in a page that could
      // not shrink. Stretched to the row of columns instead, it can never be
      // larger than what is already there, and there is nothing to measure.
      // A viewport of no size was the other way out of that loop, and it drew
      // nothing at all: an outermost `svg` of 0 × 0 paints no overflow.
      className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
      aria-hidden="true"
    >
      {curves.map((curve) => (
        <path
          key={curve.key}
          d={curve.d}
          fill="none"
          stroke="var(--c-accent)"
          // Two weights, so the chain reads as a line with things joining it
          // rather than as a mesh. The main line through each course is drawn
          // in full; a second prerequisite feeding the same course is thinner
          // and quieter. Both are there — the quiet one is the fact that two
          // branches meet here, which is the most informative thing on the
          // screen and the first casualty of any attempt to prune to a tree.
          strokeWidth={curve.spine ? 2 : 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={curve.spine ? 0.7 : 0.38}
          style={
            animate
              ? {
                  // Every curve starts drawing on the click itself. Staggering
                  // them by depth made the far end of a long chain arrive a
                  // third of a second late — the path looked hesitant, and the
                  // cards it connects had already lit up without it.
                  ['--dash' as string]: curve.length,
                  strokeDasharray: curve.length,
                  animation: 'draw-line 400ms var(--ease-out) both',
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}
