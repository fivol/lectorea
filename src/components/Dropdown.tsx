import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
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

/** Matches `w-60` below — the popover is measured before it is rendered. */
const POPOVER_WIDTH = 240;
const EDGE = 8;
/** Enough of the list to be worth opening downwards for. */
const ROOM_BELOW = 240;

type Placement = { left?: number; right?: number; top?: number; bottom?: number };

/**
 * Anchored to the trigger in viewport coordinates, and clamped to the viewport
 * so a trigger near an edge — the far end of a scrolling filter strip, say —
 * still opens a popover that is fully on screen.
 */
function placeBy(trigger: DOMRect, align: 'left' | 'right'): Placement {
  const place: Placement = {};
  const limit = Math.max(EDGE, window.innerWidth - POPOVER_WIDTH - EDGE);

  if (align === 'right') {
    place.right = Math.min(Math.max(window.innerWidth - trigger.right, EDGE), limit);
  } else {
    place.left = Math.min(Math.max(trigger.left, EDGE), limit);
  }

  const below = window.innerHeight - trigger.bottom;
  if (below < ROOM_BELOW && trigger.top > below) place.bottom = window.innerHeight - trigger.top + 4;
  else place.top = trigger.bottom + 4;

  return place;
}

const samePlace = (a: Placement, b: Placement): boolean =>
  a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;

/**
 * Minimal popover used by every filter control — one implementation, one
 * behaviour.
 *
 * The list is portalled to the body rather than positioned inside the trigger's
 * box, because the filter strips it lives in scroll sideways: an absolutely
 * positioned child of a scroll container is clipped by it, and a filter menu
 * cut off after two rows is worse than no menu at all.
 */
export default function Dropdown({
  label,
  active,
  children,
  align = 'left',
  className = '',
  search,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Placement>({});

  // Before paint, so the popover never shows up in the top-left corner first.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const trigger = ref.current?.getBoundingClientRect();
      if (!trigger) return;
      const next = placeBy(trigger, align);
      setPlace((prev) => (samePlace(prev, next) ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    // Pinned to the viewport, the popover has to be told when anything under it
    // moves: the strip it is anchored in scrolls sideways, and the panel that
    // strip lives in scrolls down. Following the trigger beats closing — a
    // click that first scrolls its own chip into view would close it instantly.
    document.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: Node | null): boolean =>
      Boolean(ref.current?.contains(target) || popoverRef.current?.contains(target));

    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target as Node)) setOpen(false);
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
      {/* No dot beside the label: the chip already changes colour when it holds
          a value, and what that value *is* is spelled out in the removable
          chips below — so the dot repeated a signal twice and crowded the row. */}
      <button
        type="button"
        className={`chip ${active ? 'chip-on' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {label}
        <Icon name="chevron-down" size={12} />
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              style={{ ...place, transformOrigin: place.bottom ? 'bottom' : 'top' }}
              className="fixed z-50 w-60 animate-pop-in rounded-pop border border-line bg-surface
                         shadow-[var(--shadow-pop)]"
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
                <DropdownContext.Provider value={() => setOpen(false)}>
                  {children}
                </DropdownContext.Provider>
              </div>
            </div>,
            document.body
          )
        : null}
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
  return <p className="mono-label px-2 pb-1 pt-0.5">{children}</p>;
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
