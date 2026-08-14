import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  done: number;
  total: number;
  /**
   * The part-finished share, as a fraction of the whole bar, drawn past the
   * solid fill in a lighter tone.
   *
   * A path is counted in whole courses, but somebody three weeks into a
   * forty-hour prerequisite has a bar that has not moved since they started —
   * which is the opposite of what a progress bar is for. So the course in hand
   * is drawn as the part of it that is done, and the label keeps counting whole
   * ones: two facts, one bar, neither of them rounded into the other.
   */
  partial?: number;
  /**
   * How full the bar is, 0..1, when that is not `done / total`.
   *
   * A playlist is counted in lectures and measured in hours — seven of fourteen
   * is the number people hold in their head, and four hours of nine is the one
   * that says how much is left. The label counts, the bar measures, and
   * `aria-valuenow` stays on the countable one because that is what a screen
   * reader can say out loud.
   */
  fill?: number;
  /**
   * Rendered to the right of the bar; mono, so the digits do not jitter.
   *
   * A node rather than a string, so a caller can colour its own numbers — a
   * week's goal turns them accent the moment it is made — without this
   * component growing a prop for every mood a number can be in.
   */
  label?: ReactNode;
  className?: string;
};

/**
 * How far along a path someone is.
 *
 * The fill grows from zero the first time the bar is on screen — a bar that is
 * simply already full says nothing, and the one moment it can say "you have
 * done this much" is the moment you first look at it. After that it animates
 * only when the number itself changes.
 */
export default function ProgressBar({
  done,
  total,
  partial = 0,
  fill,
  label,
  className = '',
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  const solid =
    fill === undefined ? (total > 0 ? (done / total) * 100 : 0) : Math.min(100, fill * 100);
  // Clamped against the remainder: a rounding error must never push the two
  // segments past the end of the track and make a full bar out of a half one.
  const soft = Math.max(0, Math.min(100 - solid, partial * 100));

  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);

  /*
   * A span rather than a div, all the way down.
   *
   * Half the places this appears are inside a button — a playlist row, a card
   * in the profile — and a div inside a button is not something HTML allows.
   * `display: flex` does not care what the element is called, so the cheap fix
   * is to be phrasing content everywhere and never think about it again.
   */
  return (
    <span ref={ref} className={`flex items-center gap-2 ${className}`}>
      <span
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
      >
        <span
          className="h-full bg-accent transition-[width] duration-slow ease-out"
          style={{ width: `${seen ? solid : 0}%` }}
        />
        {/* The same hue at a third of its weight rather than a second colour:
            this is the same progress, less of it, and a new colour would read
            as a different kind of thing. */}
        <span
          className="h-full bg-accent/35 transition-[width] duration-slow ease-out"
          style={{ width: `${seen ? soft : 0}%` }}
        />
      </span>
      {label ? <span className="num shrink-0 text-[11px] text-ink-dim">{label}</span> : null}
    </span>
  );
}
