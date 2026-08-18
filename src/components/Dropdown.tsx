import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { placeBy, samePlace, type Placement } from '@/lib/popover';
import Icon from './Icon';
import { Chip, Input } from './ui';

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
   * Something other than a chip to open it with.
   *
   * The filters are chips and want to stay chips; the strip under a running
   * lecture is the one place that cannot have one, because a plate there
   * shouts over the video — which is the whole argument `PlayerSpeed` is
   * written from. What the popover is worth reusing for is everything below
   * the trigger: the portal, the placement that follows a scrolling anchor,
   * and the `Escape` that closes the menu **without** closing the modal
   * underneath it.
   */
  trigger?: (state: { open: boolean; toggle: () => void }) => ReactNode;
  /**
   * A wider panel, where the rows are controls rather than a list of names.
   * Both the measurement and the box take it, or the panel is placed for one
   * width and drawn at another — and lands half off a narrow window.
   */
  width?: number;
  /**
   * Turns on a filter field above the list. The caller owns the query and does
   * the filtering — the popover has no idea what its children are, and a list
   * long enough to need searching always knows how it wants to be matched.
   */
  search?: { value: string; onChange: (next: string) => void; placeholder: string };
};

/** Matches `w-60` below — the popover is measured before it is rendered. */
const POPOVER_WIDTH = 240;

/**
 * A filter menu taller than this stops being a menu and becomes a page. The
 * viewport room from `placeBy` is the other ceiling; whichever is lower wins.
 */
const POPOVER_HEIGHT = 320;

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
  trigger,
  width = POPOVER_WIDTH,
  search,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Partial<Placement>>({});

  /**
   * Closing throws the query away. A menu that reopens still filtered shows
   * three rows out of two hundred with nothing on screen explaining why — the
   * field is a way to reach a row now, not a setting the control remembers.
   *
   * Which is why no filter may keep its value in this field: a row closes the
   * popover when it is picked, so anything the field owns is wiped the instant
   * it is chosen. The lecturer filter learned that the hard way — see
   * `PlaylistFilters`.
   */
  const searchRef = useRef(search);
  searchRef.current = search;
  const close = useCallback(() => {
    setOpen(false);
    searchRef.current?.onChange('');
  }, []);

  // Before paint, so the popover never shows up in the top-left corner first.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const anchor = ref.current?.getBoundingClientRect();
      if (!anchor) return;
      const next = placeBy(anchor, align, width);
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
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: Node | null): boolean =>
      Boolean(ref.current?.contains(target) || popoverRef.current?.contains(target));

    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Escape closes the top layer, and while this is open the top layer is
      // this. Without the stop it also reaches the modal underneath — whose
      // own handler sits on `window`, one step further along the same bubble —
      // and a reader dismissing a menu loses the player behind it.
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* No dot beside the label: the chip already changes colour when it holds
          a value, and what that value *is* is spelled out in the removable
          chips below — so the dot repeated a signal twice and crowded the row. */}
      {trigger ? (
        trigger({ open, toggle: () => (open ? close() : setOpen(true)) })
      ) : (
        <Chip on={active} onClick={() => (open ? close() : setOpen(true))} ariaExpanded={open}>
          {label}
          <Icon name="chevron-down" size={12} />
        </Chip>
      )}
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                ...place,
                width,
                maxHeight: Math.min(place.maxHeight ?? POPOVER_HEIGHT, POPOVER_HEIGHT),
                transformOrigin: place.bottom ? 'bottom' : 'top',
              }}
              className="fixed z-50 flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden
                         animate-pop-in rounded-pop border border-line bg-surface
                         shadow-[var(--shadow-pop)]"
            >
              {search ? (
                <div className="shrink-0 border-b border-line p-2">
                  <Input
                    type="search"
                    autoFocus
                    value={search.value}
                    onChange={(event) => search.onChange(event.target.value)}
                    placeholder={search.placeholder}
                  />
                </div>
              ) : null}
              {/* The ceiling is the placement's, not a number of its own: a
                  `max-h-72` list under a search field overshoots a landscape
                  phone, and what hangs past the edge of a fixed panel cannot be
                  scrolled to. The field stays put and only the list moves. */}
              <div className="panel-scroll min-h-0 flex-1 p-2">
                <DropdownContext.Provider value={close}>
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
    <label className="menu-row cursor-pointer">
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
      className="menu-row text-xs text-ink-faint"
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
      className={`menu-row ${checked ? 'bg-surface-2 text-ink' : ''}`}
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
  const { t } = useT();
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
        aria-label={t('ui.filters.range.min')}
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
        aria-label={t('ui.filters.range.max')}
      />
    </div>
  );
}
