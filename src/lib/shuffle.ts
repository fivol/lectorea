import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Cards that changed places slide there, cards that just arrived fade in.
 *
 * Borrowed cards are placed by where the chain reads best rather than by their
 * catalogue row (see `placeGuests`), so a click can drop a card into the middle
 * of a column and push the rest down. Done in one frame that is a flicker: the
 * column is simply different, and it is not obvious that anything moved rather
 * than that the whole screen was replaced. Moving them tells the reader that
 * these are the same cards in new places.
 *
 * First and Last, then Invert and Play: positions are read after the browser
 * has laid the new order out, compared against the ones kept from the previous
 * commit, and the difference is played backwards as a transform. Nothing is
 * animated by React — the elements keep their own layout, and the transform is
 * dropped as soon as it has run.
 */

/** Long enough to be followed, short enough not to be waited on. */
const DURATION = 200;
/** `--ease-out`, which cannot be read from a stylesheet by the animation API. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

export function useShuffle(
  containerRef: React.RefObject<HTMLElement>,
  /** Changes whenever the order might have. */
  signature: string,
  enabled: boolean
): boolean {
  const seen = useRef<Map<string, number> | null>(null);
  const [settling, setSettling] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Measured inside the scrolled content, or scrolling sideways between two
    // renders would read as every card in the column having moved.
    const origin = container.getBoundingClientRect();
    const offset = container.scrollTop - origin.top;

    const cards = [...container.querySelectorAll<HTMLElement>('[data-card]')];
    const now = new Map<string, number>();
    const moved: Array<[HTMLElement, number]> = [];
    const arrived: HTMLElement[] = [];

    for (const card of cards) {
      const id = card.dataset.card;
      if (!id) continue;
      const top = card.getBoundingClientRect().top + offset;
      now.set(id, top);

      const was = seen.current?.get(id);
      if (was === undefined) arrived.push(card);
      else if (Math.abs(was - top) > 0.5) moved.push([card, was - top]);
    }

    // The first pass only takes the measurements: everything is new on a first
    // render, and a whole screen of cards fading in one by one is a page that
    // looks like it is still loading.
    const first = seen.current === null;
    seen.current = now;
    if (first || !enabled || (!moved.length && !arrived.length)) return;

    for (const [card, delta] of moved) {
      card.animate(
        [{ transform: `translateY(${delta.toFixed(1)}px)` }, { transform: 'none' }],
        { duration: DURATION, easing: EASE }
      );
    }
    for (const card of arrived) {
      card.animate(
        [
          { opacity: 0, transform: 'scale(0.94)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: DURATION, easing: EASE }
      );
    }

    setSettling(true);
    const done = window.setTimeout(() => setSettling(false), DURATION);
    return () => window.clearTimeout(done);
  }, [containerRef, signature, enabled]);

  return settling;
}
