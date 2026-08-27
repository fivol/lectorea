import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';

/**
 * The band of chrome that floats along the bottom of the screen — and the one
 * place that knows how tall it is.
 *
 * On a phone the foot of the window is a stack of things lying over whatever is
 * behind them: where the reader stopped, the view switch, the contribute line.
 * Every row of it is conditional — the resume bar only exists for somebody with
 * a past here, the contribute line only over the map — so how much of the
 * window the band takes is not a number anybody can write down in advance.
 *
 * It was written down anyway, in each thing that had to stand clear of it: the
 * map's controls at a hand-measured `6.5rem`, the map's own fitting at 144px.
 * Both were measured against a stack of two rows, and both were wrong the day
 * the resume bar became a third — the controls came to rest underneath it.
 *
 * So the band measures itself and publishes what it takes: `--foot` for
 * anything placed in CSS, `useFoot()` for anything that has to do arithmetic
 * with it. Everything above the foot reads that one number instead of guessing,
 * and a row added or dropped here moves all of them at once.
 */

const useBand = create<{ height: number; set: (height: number) => void }>((set) => ({
  height: 0,
  set: (height) => set((state) => (state.height === height ? state : { height })),
}));

/**
 * How much of the bottom of the window the floating chrome takes, in screen
 * pixels — zero when there is none. The CSS equivalent is `var(--foot)`.
 */
export const useFoot = (): number => useBand((state) => state.height);

export default function FloatingFoot({
  children,
  fixed = false,
  className = '',
}: {
  children: ReactNode;
  /**
   * Pinned to the window rather than riding the bottom of a scrolling column.
   *
   * The navigation is the app's, not a screen's: rendered inside a screen it
   * inherits whatever that screen keeps under its scroller — the desk has a
   * contribute line, the map does not — and the bar lands at two different
   * heights on two tabs and jumps as a reader crosses between them. Fixed, it
   * is in the same place on every screen it appears on, and it is above the
   * settings sheet rather than under it.
   */
  fixed?: boolean;
  className?: string;
}) {
  const band = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const publish = useBand((state) => state.set);

  /*
   * Before the paint, not after: the things that place themselves against
   * `--foot` are on screen in the same frame, and a band measured afterwards
   * would show them at nothing for one frame and then move them.
   *
   * Measured from the foot of the band to the top of the stack rather than off
   * the stack's own height, so that the air underneath — a thumb's margin, or
   * the phone's rounded corner, whichever is deeper — is counted without this
   * having to know which of them it turned out to be. An empty stack is worth
   * nothing rather than worth its padding: on a window wide enough for the
   * corner card there is nothing down here, and the map's controls belong back
   * in the corner.
   */
  useLayoutEffect(() => {
    const outer = band.current;
    const inner = stack.current;
    if (!outer || !inner) return;

    const measure = (): void => {
      const rows = inner.getBoundingClientRect();
      publish(rows.height ? Math.round(outer.getBoundingClientRect().bottom - rows.top) : 0);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      publish(0);
    };
  }, [publish]);

  const height = useFoot();
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--foot', `${height}px`);
    return () => {
      document.documentElement.style.removeProperty('--foot');
    };
  }, [height]);

  return (
    /*
      A row of no height, so that in a scrolling view the grid underneath does
      not have to leave a gap for something that floats. `sticky` by default for
      the same reason: it rides the bottom of the column it is in instead of
      standing over the middle of it. `fixed` is for the one band that belongs
      to the app rather than to a screen — see the prop.
    */
    <div
      ref={band}
      className={`pointer-events-none flex h-0 items-end justify-center
                  pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-12
                  ${fixed ? 'fixed inset-x-0 bottom-0 z-[60]' : 'sticky bottom-0 z-30'}
                  ${className}`}
    >
      <div ref={stack} className="flex flex-col items-center gap-1.5">
        {children}
      </div>
    </div>
  );
}
