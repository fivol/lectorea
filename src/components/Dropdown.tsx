import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';

/**
 * Lets a row close the popover it lives in.
 *
 * The rule is about what the control means, not about who owns the state: a
 * single-choice control is finished the moment something is picked, so leaving
 * it open makes the user close it by hand for no reason. A multi-select is not
 * finished, so it stays.
 */
const DropdownContext = createContext<() => void>(() => {});

export function useCloseDropdown(): () => void {
  return useContext(DropdownContext);
}

type Props = {
  label: ReactNode;
  /** Shown as a dot on the trigger when the control holds a value. */
  active?: boolean;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  /**
   * Turns on a filter field above the list. The caller owns the query and does
   * the filtering — the popover has no idea what its children are, and a list
   * long enough to need searching always knows how it wants to be matched.
   */
  search?: { value: string; onChange: (next: string) => void; placeholder: string };
};

/** Minimal popover used by every filter control — one implementation, one behaviour. */
export default function Dropdown({
  label,
  active,
  children,
  align = 'left',
  className = '',
  search,
}: Props) {
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
          className={`absolute z-40 mt-1 w-60 rounded-lg border border-line bg-surface
                      shadow-[var(--shadow-panel)] ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {search ? (
            <div className="border-b border-line p-2">
              <input
                type="search"
                autoFocus
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                placeholder={search.placeholder}
                className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-sm
                           text-ink outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </div>
          ) : null}
          <div className="panel-scroll max-h-72 p-2">
            <DropdownContext.Provider value={() => setOpen(false)}>{children}</DropdownContext.Provider>
          </div>
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

/**
 * A caption over the list, naming what is in it.
 *
 * A search field above an unlabelled list reads as "type something and hope".
 * Saying "Популярные" up front tells you the rows already there are worth
 * looking at, and that typing narrows them rather than starting a search.
 */
export function Caption({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-0.5 text-[11px] uppercase tracking-wide text-ink-faint">{children}</p>
  );
}

/** A one-shot action inside a popover — "clear all" and the like. Closes on click. */
export function ActionRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  const close = useCloseDropdown();
  return (
    <button
      type="button"
      className="w-full rounded px-2 py-1 text-left text-xs text-ink-faint hover:bg-surface-2"
      onClick={() => {
        onClick();
        close();
      }}
    >
      {children}
    </button>
  );
}

/** One of several mutually exclusive options. Picking one closes the popover. */
export function RadioRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  const close = useCloseDropdown();
  return (
    <button
      type="button"
      onClick={() => {
        onChange();
        close();
      }}
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
