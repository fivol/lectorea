import { useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';

type Props = {
  label: ReactNode;
  /** Shown as a dot on the trigger when the control holds a value. */
  active?: boolean;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
};

/** Minimal popover used by every filter control — one implementation, one behaviour. */
export default function Dropdown({ label, active, children, align = 'left', className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        className={`chip ${active ? 'border-accent text-ink' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {label}
        {active ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
        <Icon name="chevron-down" size={12} />
      </button>
      {open ? (
        <div
          className={`panel-scroll absolute z-40 mt-1 max-h-72 w-56 rounded-lg border border-line
                      bg-surface p-2 shadow-[var(--shadow-panel)]
                      ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink-dim hover:bg-surface-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-[var(--c-accent)]"
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </label>
  );
}

export function RadioRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm
                  ${checked ? 'bg-surface-2 text-ink' : 'text-ink-dim hover:bg-surface-2'}`}
    >
      <span
        className={`h-3 w-3 shrink-0 rounded-full border ${checked ? 'border-accent bg-accent' : 'border-line'}`}
      />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function RangeRow({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
}) {
  return (
    <div className="px-2 py-1">
      <div className="num mb-1 flex justify-between text-xs text-ink-faint">
        <span>{value[0]}</span>
        <span>{value[1]}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value[0]}
        onChange={(event) =>
          onChange([Math.min(Number(event.target.value), value[1]), value[1]])
        }
        className="w-full accent-[var(--c-accent)]"
        aria-label="min"
      />
      <input
        type="range"
        min={min}
        max={max}
        value={value[1]}
        onChange={(event) =>
          onChange([value[0], Math.max(Number(event.target.value), value[0])])
        }
        className="w-full accent-[var(--c-accent)]"
        aria-label="max"
      />
    </div>
  );
}
