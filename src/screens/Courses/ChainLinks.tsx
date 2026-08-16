import { useCallback, useEffect, useState } from 'react';
import { routeCurves, routeSteps, type Path, type Rect } from '@/lib/route';

/** `depth` is the source's distance from the selected course — the cascade order. */
export type Link = { from: string; to: string; depth: number };

type Props = {
  /** The scroll container the cards live in; also the SVG's coordinate space. */
  scrollRef: React.RefObject<HTMLElement>;
  links: Link[];
  /** Bumped by the caller when the layout may have changed under the curves. */
  revision: unknown;
  animate: boolean;
  /** Cards are sliding to new rows right now — see `useShuffle`. */
  settling: boolean;
  /** Right angles down the gaps, rather than one curve from card to card. */
  stepped: boolean;
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
 * How a line is drawn is the reader's — see `routeSteps` and `routeCurves` for
 * the two answers and what each is good at. This measures and paints; the
 * shape of a route is decided there, where it can be reasoned about without a
 * browser in the way.
 *
 * Geometry comes from the DOM rather than from the layout code, because the
 * layout is the browser's: cards are flex children, and their real positions
 * are the only ones that are true after a filter, a resize or a scroll. Every
 * card is measured, not only the ones being joined — a stepped route runs down
 * the gaps between columns and along the gaps between rows, and where those are
 * is a fact about the whole board.
 */
export default function ChainLinks({
  scrollRef,
  links,
  revision,
  animate,
  settling,
  stepped,
}: Props) {
  const [curves, setCurves] = useState<Path[]>([]);

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

    const boxes = new Map<string, Rect>();
    const cards: Rect[] = [];
    for (const node of container.querySelectorAll<HTMLElement>('[data-course]')) {
      const id = node.dataset.course;
      if (!id) continue;
      const box = node.getBoundingClientRect();
      const rect: Rect = {
        left: box.left + dx,
        right: box.right + dx,
        top: box.top + dy,
        bottom: box.bottom + dy,
      };
      boxes.set(id, rect);
      cards.push(rect);
    }

    setCurves(stepped ? routeSteps(links, boxes, cards) : routeCurves(links, boxes));
  }, [scrollRef, links, stepped]);

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

  /**
   * While cards are sliding, follow them.
   *
   * The measurement above happens once, and once is right for a layout that
   * has finished moving. A card animating to a new row is somewhere else on
   * every frame, and a curve pinned to where it will end up detaches from the
   * card it is drawn from for the length of the animation — the one moment the
   * line is most obviously about that card.
   */
  useEffect(() => {
    if (!settling) return;
    let frame = requestAnimationFrame(function tick() {
      measure();
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [settling, measure]);

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
          // One weight for every edge. Drawing the main line into each course
          // heavier than whatever else fed it was tried, and a reader has no
          // way to know what two thicknesses are supposed to mean — it reads as
          // an error in the picture rather than as a fact about the graph. How
          // many edges there are is the switch's business now, not the paint's.
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
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
