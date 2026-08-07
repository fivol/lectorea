import { useEffect, useRef, useState } from 'react';

type Props = {
  done: number;
  total: number;
  /** Rendered to the right of the bar; mono, so the digits do not jitter. */
  label?: string;
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
export default function ProgressBar({ done, total, label, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);

  return (
    <div ref={ref} className={`flex items-center gap-2 ${className}`}>
      <span
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
      >
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-slow ease-out"
          style={{ width: `${seen ? percent : 0}%` }}
        />
      </span>
      {label ? <span className="num shrink-0 text-[11px] text-ink-dim">{label}</span> : null}
    </div>
  );
}
